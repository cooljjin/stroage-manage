alter table public.prep_items
add column if not exists shelf_life_enabled boolean not null default true;

drop function if exists public.save_prep_item(uuid, text, integer, integer, jsonb, boolean);
drop function if exists public.save_prep_item(uuid, text, boolean, integer, integer, jsonb, boolean);

create or replace function public.save_prep_item(
  target_prep_item_id uuid,
  item_name text,
  item_shelf_life_enabled boolean,
  item_shelf_life_days integer,
  item_sort_order integer,
  ingredient_rows jsonb,
  item_is_active boolean default true
)
returns public.prep_items
language plpgsql
security definer
set search_path = public
as $$
declare
  requester_store_id uuid;
  saved_item public.prep_items%rowtype;
  target_product_id uuid;
  ingredient jsonb;
  ingredient_index integer := 0;
  v_ingredient_product_id uuid;
  v_ingredient_name text;
  v_ingredient_unit text;
  v_ingredient_quantity numeric(12, 4);
  v_ingredient_sort_order integer;
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.';
  end if;

  requester_store_id := public.current_store_id(auth.uid());
  if requester_store_id is null or not public.can_admin_store(requester_store_id) then
    raise exception '프랩 품목 관리 권한이 없습니다.';
  end if;

  if item_name is null or char_length(trim(item_name)) = 0 then
    raise exception '프랩 품목명은 비워둘 수 없습니다.';
  end if;

  if coalesce(item_shelf_life_enabled, true) and (item_shelf_life_days is null or item_shelf_life_days < 1) then
    raise exception '유통기한은 1일 이상이어야 합니다.';
  end if;

  if ingredient_rows is null or jsonb_typeof(ingredient_rows) <> 'array' or jsonb_array_length(ingredient_rows) = 0 then
    raise exception '사용 재료를 1개 이상 등록해 주세요.';
  end if;

  if target_prep_item_id is null then
    insert into public.products (
      store_id,
      name,
      category,
      unit_name,
      minimum_stock,
      is_active
    )
    values (
      requester_store_id,
      trim(item_name),
      '기타',
      '개',
      0,
      false
    )
    returning id into target_product_id;

    insert into public.inventory (product_id, store_id)
    values (target_product_id, requester_store_id)
    on conflict (product_id) do nothing;

    insert into public.prep_items (
      store_id,
      product_id,
      name,
      shelf_life_enabled,
      shelf_life_days,
      sort_order,
      is_active
    )
    values (
      requester_store_id,
      target_product_id,
      trim(item_name),
      coalesce(item_shelf_life_enabled, true),
      coalesce(item_shelf_life_days, 1),
      coalesce(item_sort_order, 1000),
      coalesce(item_is_active, true)
    )
    returning * into saved_item;
  else
    select *
    into saved_item
    from public.prep_items
    where id = target_prep_item_id
    for update;

    if not found then
      raise exception '프랩 품목을 찾을 수 없습니다.';
    end if;

    if not public.can_admin_store(saved_item.store_id) then
      raise exception '프랩 품목 관리 권한이 없습니다.';
    end if;

    requester_store_id := saved_item.store_id;
    target_product_id := saved_item.product_id;

    update public.products
    set name = trim(item_name),
        category = '기타',
        unit_name = '개',
        is_active = false
    where id = target_product_id
      and store_id = requester_store_id;

    update public.prep_items
    set name = trim(item_name),
        shelf_life_enabled = coalesce(item_shelf_life_enabled, shelf_life_enabled),
        shelf_life_days = coalesce(item_shelf_life_days, shelf_life_days),
        sort_order = coalesce(item_sort_order, sort_order),
        is_active = coalesce(item_is_active, is_active)
    where id = saved_item.id
    returning * into saved_item;

    delete from public.prep_item_ingredients
    where prep_item_id = saved_item.id;
  end if;

  for ingredient in
    select value from jsonb_array_elements(ingredient_rows)
  loop
    ingredient_index := ingredient_index + 1;
    v_ingredient_product_id := nullif(ingredient ->> 'product_id', '')::uuid;
    v_ingredient_name := nullif(trim(coalesce(ingredient ->> 'ingredient_name', '')), '');
    v_ingredient_unit := nullif(ingredient ->> 'ingredient_unit', '');
    v_ingredient_quantity := nullif(ingredient ->> 'quantity_per_unit', '')::numeric(12, 4);
    v_ingredient_sort_order := coalesce(nullif(ingredient ->> 'sort_order', '')::integer, ingredient_index);

    if v_ingredient_product_id is null and v_ingredient_name is null then
      raise exception '재료 품목을 선택하거나 임의 재료명을 입력해 주세요.';
    end if;

    if v_ingredient_product_id is not null and v_ingredient_product_id = target_product_id then
      raise exception '프랩 품목 자체는 재료로 등록할 수 없습니다.';
    end if;

    if v_ingredient_unit is not null and v_ingredient_unit not in ('g', 'kg', 'ml', 'L', '개') then
      raise exception '임의 재료 단위를 선택해 주세요.';
    end if;

    if v_ingredient_quantity is null or v_ingredient_quantity <= 0 then
      raise exception '재료 사용량은 0보다 커야 합니다.';
    end if;

    if v_ingredient_product_id is not null then
      perform 1
      from public.products
      where id = v_ingredient_product_id
        and store_id = requester_store_id
        and is_active = true;

      if not found then
        raise exception '재료 품목을 찾을 수 없습니다.';
      end if;
    end if;

    insert into public.prep_item_ingredients (
      store_id,
      prep_item_id,
      ingredient_product_id,
      ingredient_name,
      ingredient_unit,
      quantity_per_unit,
      sort_order
    )
    values (
      requester_store_id,
      saved_item.id,
      v_ingredient_product_id,
      v_ingredient_name,
      v_ingredient_unit,
      v_ingredient_quantity,
      v_ingredient_sort_order
    );
  end loop;

  return saved_item;
end;
$$;

grant execute on function public.save_prep_item(uuid, text, boolean, integer, integer, jsonb, boolean) to authenticated;

drop function if exists public.record_prep_operation(uuid, text, numeric);

create or replace function public.record_prep_operation(
  target_prep_item_id uuid,
  operation_type text,
  operation_quantity numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  prep_item public.prep_items%rowtype;
  prep_inventory public.inventory%rowtype;
  ingredient record;
  batch record;
  changed_at timestamptz := clock_timestamp();
  manufactured_date date;
  expires_date date;
  action_label text;
  inserted_log_id uuid;
  recipe_count integer;
  required_quantity numeric(12, 4);
  consumable_quantity numeric(12, 4);
  remaining_quantity numeric(12, 4);
  consumed_from_batch numeric(12, 4);
  ingredient_total_before numeric(12, 4);
  ingredient_store_consumed numeric(12, 4);
  ingredient_warehouse_consumed numeric(12, 4);
  ingredient_next_store_qty numeric(12, 4);
  ingredient_next_warehouse_qty numeric(12, 4);
  repaired_prep_product_id uuid;
  shortage_messages text[] := array[]::text[];
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.';
  end if;

  if operation_type not in ('제조', '소진', '폐기') then
    raise exception '지원하지 않는 프랩 작업입니다.';
  end if;

  if operation_quantity is null or operation_quantity <= 0 then
    raise exception '수량은 0보다 커야 합니다.';
  end if;

  select prep_items.*
  into prep_item
  from public.prep_items prep_items
  where prep_items.id = target_prep_item_id
    and prep_items.is_active = true
  for update;

  if not found then
    raise exception '프랩 품목을 찾을 수 없습니다.';
  end if;

  if not public.can_access_store(prep_item.store_id) then
    raise exception '프랩 품목 접근 권한이 없습니다.';
  end if;

  perform 1
  from public.products
  where id = prep_item.product_id
    and store_id = prep_item.store_id;

  if not found then
    insert into public.products (
      store_id,
      name,
      category,
      unit_name,
      minimum_stock,
      is_active
    )
    values (
      prep_item.store_id,
      prep_item.name,
      '기타',
      '개',
      0,
      false
    )
    returning id into repaired_prep_product_id;

    update public.prep_items
    set product_id = repaired_prep_product_id,
        updated_at = changed_at
    where id = prep_item.id;

    prep_item.product_id := repaired_prep_product_id;
  end if;

  insert into public.inventory (product_id, store_id)
  values (prep_item.product_id, prep_item.store_id)
  on conflict (product_id) do nothing;

  select inventory.*
  into prep_inventory
  from public.inventory inventory
  where inventory.product_id = prep_item.product_id
    and inventory.store_id = prep_item.store_id
  for update;

  if not found then
    raise exception '프랩 재고 정보를 찾을 수 없습니다.';
  end if;

  if operation_type = '제조' then
    select count(*)
    into recipe_count
    from public.prep_item_ingredients ingredients
    where ingredients.prep_item_id = prep_item.id;

    if recipe_count = 0 then
      raise exception '등록된 프랩 레시피가 없습니다.';
    end if;

    insert into public.inventory (product_id, store_id)
    select ingredients.ingredient_product_id, prep_item.store_id
    from public.prep_item_ingredients ingredients
    join public.products products
      on products.id = ingredients.ingredient_product_id
     and products.store_id = prep_item.store_id
    where ingredients.prep_item_id = prep_item.id
      and ingredients.ingredient_product_id is not null
    on conflict (product_id) do nothing;

    for ingredient in
      select
        ingredients.ingredient_product_id,
        ingredients.quantity_per_unit,
        products.name as ingredient_name,
        inventory.id as inventory_id,
        inventory.warehouse_qty,
        inventory.store_qty
      from public.prep_item_ingredients ingredients
      join public.products products
        on products.id = ingredients.ingredient_product_id
       and products.store_id = prep_item.store_id
      join public.inventory inventory
        on inventory.product_id = ingredients.ingredient_product_id
       and inventory.store_id = prep_item.store_id
      where ingredients.prep_item_id = prep_item.id
        and ingredients.ingredient_product_id is not null
      order by ingredients.ingredient_product_id
      for update of inventory
    loop
      required_quantity := ingredient.quantity_per_unit * operation_quantity;
      ingredient_total_before := ingredient.warehouse_qty + ingredient.store_qty;
      consumable_quantity := least(required_quantity, ingredient_total_before);

      if ingredient_total_before < required_quantity then
        shortage_messages := array_append(
          shortage_messages,
          ingredient.ingredient_name || '재고가 부족합니다. 재고를 확인해 주세요.'
        );
      end if;

      if consumable_quantity <= 0 then
        continue;
      end if;

      ingredient_store_consumed := least(ingredient.store_qty, consumable_quantity);
      ingredient_warehouse_consumed := consumable_quantity - ingredient_store_consumed;
      ingredient_next_store_qty := ingredient.store_qty - ingredient_store_consumed;
      ingredient_next_warehouse_qty := ingredient.warehouse_qty - ingredient_warehouse_consumed;

      update public.inventory as inventory
      set warehouse_qty = ingredient_next_warehouse_qty,
          store_qty = ingredient_next_store_qty,
          updated_at = changed_at
      where inventory.id = ingredient.inventory_id;

      insert into public.inventory_logs (
        product_id,
        store_id,
        user_id,
        action,
        source_location,
        destination_location,
        previous_quantity,
        new_quantity,
        quantity,
        note,
        warehouse_qty_before,
        store_qty_before,
        warehouse_qty_after,
        store_qty_after,
        created_at
      )
      values (
        ingredient.ingredient_product_id,
        prep_item.store_id,
        auth.uid(),
        '출고',
        null,
        null,
        ingredient_total_before,
        ingredient_total_before - consumable_quantity,
        consumable_quantity,
        '[프랩 제조] ' || prep_item.name || ' +' || operation_quantity::text,
        ingredient.warehouse_qty,
        ingredient.store_qty,
        ingredient_next_warehouse_qty,
        ingredient_next_store_qty,
        changed_at
      );
    end loop;

    manufactured_date := (changed_at at time zone 'Asia/Seoul')::date;
    if prep_item.shelf_life_enabled then
      expires_date := manufactured_date + prep_item.shelf_life_days;
    end if;

    update public.inventory as inventory
    set store_qty = prep_inventory.store_qty + operation_quantity,
        updated_at = changed_at
    where inventory.id = prep_inventory.id;

    if prep_item.shelf_life_enabled then
      insert into public.prep_batches (
        store_id,
        prep_item_id,
        quantity_produced,
        quantity_remaining,
        manufactured_at,
        expires_on,
        created_by,
        created_at
      )
      values (
        prep_item.store_id,
        prep_item.id,
        operation_quantity,
        operation_quantity,
        changed_at,
        expires_date,
        auth.uid(),
        changed_at
      );
    end if;

    insert into public.inventory_logs (
      product_id,
      store_id,
      user_id,
      action,
      source_location,
      destination_location,
      previous_quantity,
      new_quantity,
      quantity,
      note,
      warehouse_qty_before,
      store_qty_before,
      warehouse_qty_after,
      store_qty_after,
      created_at
    )
    values (
      prep_item.product_id,
      prep_item.store_id,
      auth.uid(),
      '프랩 제조',
      null,
      '매장',
      prep_inventory.store_qty,
      prep_inventory.store_qty + operation_quantity,
      operation_quantity,
      case when prep_item.shelf_life_enabled then '만료일 ' || expires_date::text else '유통기한 없음' end,
      prep_inventory.warehouse_qty,
      prep_inventory.store_qty,
      prep_inventory.warehouse_qty,
      prep_inventory.store_qty + operation_quantity,
      changed_at
    )
    returning id into inserted_log_id;

    if prep_item.shelf_life_enabled then
      insert into public.dashboard_todos (
        store_id,
        task_date,
        content,
        created_by,
        created_at
      )
      select
        prep_item.store_id,
        expires_date,
        '[' || prep_item.name || '] 폐기하기',
        auth.uid(),
        changed_at
      where not exists (
        select 1
        from public.dashboard_todos todos
        where todos.store_id = prep_item.store_id
          and todos.task_date = expires_date
          and todos.content = '[' || prep_item.name || '] 폐기하기'
          and todos.is_completed = false
      );
    end if;

    return jsonb_build_object(
      'log_id', inserted_log_id,
      'warning_message', nullif(array_to_string(shortage_messages, E'\n'), '')
    );
  end if;

  if prep_inventory.store_qty < operation_quantity then
    raise exception '프랩 재고가 부족합니다. 현재 수량 %', prep_inventory.store_qty;
  end if;

  if prep_item.shelf_life_enabled then
    remaining_quantity := operation_quantity;

    for batch in
      select prep_batches.*
      from public.prep_batches prep_batches
      where prep_batches.prep_item_id = prep_item.id
        and prep_batches.store_id = prep_item.store_id
        and prep_batches.quantity_remaining > 0
      order by prep_batches.expires_on, prep_batches.manufactured_at, prep_batches.created_at
      for update
    loop
      consumed_from_batch := least(batch.quantity_remaining, remaining_quantity);

      update public.prep_batches as prep_batches
      set quantity_remaining = prep_batches.quantity_remaining - consumed_from_batch
      where prep_batches.id = batch.id;

      remaining_quantity := remaining_quantity - consumed_from_batch;
      exit when remaining_quantity <= 0;
    end loop;

    if remaining_quantity > 0 then
      raise exception '제조 단위별 프랩 재고가 부족합니다.';
    end if;
  end if;

  update public.inventory as inventory
  set store_qty = prep_inventory.store_qty - operation_quantity,
      updated_at = changed_at
  where inventory.id = prep_inventory.id;

  action_label := case operation_type
    when '소진' then '프랩 소진'
    else '프랩 폐기'
  end;

  insert into public.inventory_logs (
    product_id,
    store_id,
    user_id,
    action,
    source_location,
    destination_location,
    previous_quantity,
    new_quantity,
    quantity,
    note,
    warehouse_qty_before,
    store_qty_before,
    warehouse_qty_after,
    store_qty_after,
    created_at
  )
  values (
    prep_item.product_id,
    prep_item.store_id,
    auth.uid(),
    action_label,
    '매장',
    null,
    prep_inventory.store_qty,
    prep_inventory.store_qty - operation_quantity,
    operation_quantity,
    null,
    prep_inventory.warehouse_qty,
    prep_inventory.store_qty,
    prep_inventory.warehouse_qty,
    prep_inventory.store_qty - operation_quantity,
    changed_at
  )
  returning id into inserted_log_id;

  return jsonb_build_object(
    'log_id', inserted_log_id,
    'warning_message', null
  );
end;
$$;

grant execute on function public.record_prep_operation(uuid, text, numeric) to authenticated;

notify pgrst, 'reload schema';
