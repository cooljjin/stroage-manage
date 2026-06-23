alter table public.inventory_logs drop constraint if exists inventory_logs_action_check;
alter table public.inventory_logs add constraint inventory_logs_action_check
check (action in ('입고', '출고', '이동', '조정', '프랩 제조', '프랩 소진', '프랩 폐기'));

create or replace function public.record_prep_operation(
  target_prep_item_id uuid,
  operation_type text,
  operation_quantity numeric
)
returns uuid
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
  required_quantity numeric(12, 2);
  remaining_quantity numeric(12, 2);
  consumed_from_batch numeric(12, 2);
  ingredient_total_before numeric(12, 2);
  ingredient_store_consumed numeric(12, 2);
  ingredient_warehouse_consumed numeric(12, 2);
  ingredient_next_store_qty numeric(12, 2);
  ingredient_next_warehouse_qty numeric(12, 2);
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
    where ingredients.prep_item_id = prep_item.id
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
      order by ingredients.ingredient_product_id
      for update of inventory
    loop
      required_quantity := ingredient.quantity_per_unit * operation_quantity;
      ingredient_total_before := ingredient.warehouse_qty + ingredient.store_qty;

      if ingredient_total_before < required_quantity then
        raise exception '% 재고가 부족합니다. 필요 수량 %, 현재 수량 %',
          ingredient.ingredient_name,
          required_quantity,
          ingredient_total_before;
      end if;

      ingredient_store_consumed := least(ingredient.store_qty, required_quantity);
      ingredient_warehouse_consumed := required_quantity - ingredient_store_consumed;
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
        ingredient_total_before - required_quantity,
        required_quantity,
        '[프랩 제조] ' || prep_item.name || ' +' || operation_quantity::text,
        ingredient.warehouse_qty,
        ingredient.store_qty,
        ingredient_next_warehouse_qty,
        ingredient_next_store_qty,
        changed_at
      );
    end loop;

    manufactured_date := (changed_at at time zone 'Asia/Seoul')::date;
    expires_date := manufactured_date + prep_item.shelf_life_days;

    update public.inventory as inventory
    set store_qty = prep_inventory.store_qty + operation_quantity,
        updated_at = changed_at
    where inventory.id = prep_inventory.id;

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
      '만료일 ' || expires_date::text,
      prep_inventory.warehouse_qty,
      prep_inventory.store_qty,
      prep_inventory.warehouse_qty,
      prep_inventory.store_qty + operation_quantity,
      changed_at
    )
    returning id into inserted_log_id;

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

    return inserted_log_id;
  end if;

  if prep_inventory.store_qty < operation_quantity then
    raise exception '프랩 재고가 부족합니다. 현재 수량 %', prep_inventory.store_qty;
  end if;

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

  return inserted_log_id;
end;
$$;

grant execute on function public.record_prep_operation(uuid, text, numeric) to authenticated;

notify pgrst, 'reload schema';
