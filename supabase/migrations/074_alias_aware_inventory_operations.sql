-- Keep historical recipe/order references on their original product IDs, but
-- resolve every new connection and inventory mutation to the active canonical
-- product while a reversible alias link is active.

create or replace function public.generate_invite_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  generated_code text := '';
begin
  for index_value in 1..8 loop
    generated_code := generated_code
      || substr(alphabet, 1 + floor(random() * length(alphabet))::integer, 1);
  end loop;
  return generated_code;
end;
$$;

revoke all on function public.generate_invite_code()
from public, anon, authenticated;

create or replace function public.canonicalize_new_prep_ingredient()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_store_id uuid;
  resolved_product_id uuid;
  resolved_store_id uuid;
begin
  select prep.store_id
  into target_store_id
  from public.prep_items prep
  where prep.id = new.prep_item_id;

  if target_store_id is null then
    raise exception '프랩 품목을 찾을 수 없습니다.';
  end if;

  new.store_id := target_store_id;
  if new.ingredient_product_id is null then
    return new;
  end if;

  select
    coalesce(link.canonical_product_id, product.id),
    canonical.store_id
  into resolved_product_id, resolved_store_id
  from public.products product
  left join public.product_alias_links link
    on link.alias_product_id = product.id
   and link.unmerged_at is null
  join public.products canonical
    on canonical.id = coalesce(link.canonical_product_id, product.id)
   and canonical.is_active = true
  where product.id = new.ingredient_product_id;

  if resolved_product_id is null or resolved_store_id <> target_store_id then
    raise exception '같은 매장의 활성 재료 품목만 등록할 수 있습니다.';
  end if;

  new.ingredient_product_id := resolved_product_id;
  return new;
end;
$$;

drop trigger if exists canonicalize_new_prep_ingredient_row
on public.prep_item_ingredients;
create trigger canonicalize_new_prep_ingredient_row
before insert on public.prep_item_ingredients
for each row execute function public.canonicalize_new_prep_ingredient();

create or replace function public.validate_group_order_recipe_ingredient()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  menu_store_id uuid;
  resolved_product_id uuid;
  product_store_id uuid;
begin
  select menu.store_id
  into menu_store_id
  from public.group_order_menus menu
  where menu.id = new.menu_id;

  if menu_store_id is null then
    raise exception '메뉴 레시피를 찾을 수 없습니다.';
  end if;

  if new.product_id is not null then
    select
      coalesce(link.canonical_product_id, product.id),
      canonical.store_id
    into resolved_product_id, product_store_id
    from public.products product
    left join public.product_alias_links link
      on link.alias_product_id = product.id
     and link.unmerged_at is null
    join public.products canonical
      on canonical.id = coalesce(link.canonical_product_id, product.id)
     and canonical.is_active = true
    where product.id = new.product_id;

    if resolved_product_id is null then
      raise exception '재료 품목을 찾을 수 없습니다.';
    end if;
    new.product_id := resolved_product_id;
  elsif char_length(trim(coalesce(new.ingredient_name, ''))) = 0 then
    raise exception '재고 품목 또는 임시 재료명이 필요합니다.';
  end if;

  if new.store_id is null then
    new.store_id := menu_store_id;
  end if;
  if new.store_id <> menu_store_id
    or (product_store_id is not null and new.store_id <> product_store_id) then
    raise exception '같은 매장의 메뉴와 재료만 등록할 수 있습니다.';
  end if;

  if new.quantity_per_item is null or new.quantity_per_item <= 0 then
    raise exception '재료 사용량은 0보다 커야 합니다.';
  end if;
  if new.quantity_unit not in ('g', 'kg', 'ml', 'L', '개') then
    raise exception '지원하지 않는 레시피 단위입니다.';
  end if;
  if new.product_id is not null then
    new.ingredient_name := null;
  end if;
  return new;
end;
$$;

create or replace function public.link_recipe_product_alias(
  target_store_id uuid,
  target_alias text,
  target_product_id uuid,
  target_unit_context text default null
)
returns public.recipe_product_aliases
language plpgsql
security definer
set search_path = public
as $$
declare
  alias_row public.recipe_product_aliases%rowtype;
  normalized_alias text := lower(
    regexp_replace(trim(coalesce(target_alias, '')), '\s+', '', 'g')
  );
  resolved_product_id uuid;
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.';
  end if;
  if not public.can_manage_store_task(
    target_store_id,
    'group_order_recipe_management'
  ) then
    raise exception '메뉴 레시피 등록 권한이 없습니다.';
  end if;
  if normalized_alias = '' then
    raise exception '품목 별칭이 비어 있습니다.';
  end if;

  select coalesce(link.canonical_product_id, product.id)
  into resolved_product_id
  from public.products product
  left join public.product_alias_links link
    on link.alias_product_id = product.id
   and link.unmerged_at is null
  join public.products canonical
    on canonical.id = coalesce(link.canonical_product_id, product.id)
   and canonical.store_id = target_store_id
   and canonical.is_active = true
  where product.id = target_product_id
    and product.store_id = target_store_id;

  if resolved_product_id is null then
    raise exception '연결할 품목을 찾을 수 없습니다.';
  end if;

  insert into public.recipe_product_aliases (
    store_id,
    alias_normalized,
    alias_display,
    product_id,
    unit_context,
    confirmed_count
  ) values (
    target_store_id,
    normalized_alias,
    trim(target_alias),
    resolved_product_id,
    target_unit_context,
    1
  )
  on conflict (store_id, alias_normalized, unit_context) do update
  set product_id = excluded.product_id,
      alias_display = excluded.alias_display,
      confirmed_count = public.recipe_product_aliases.confirmed_count + 1
  returning * into alias_row;

  return alias_row;
end;
$$;

-- Wrap existing inventory RPCs instead of rewriting their proven arithmetic.
-- Their original bodies become private implementation details; callers always
-- resolve an active alias before versions, quantities, and logs are touched.

alter function public.record_inventory_operation(
  uuid, text, text, text, numeric, timestamptz
) rename to record_inventory_operation_pre_alias_074;

create or replace function public.record_inventory_operation(
  target_product_id uuid,
  operation_action text,
  target_location text,
  move_direction text,
  operation_quantity numeric,
  expected_inventory_updated_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  canonical_product_id uuid;
begin
  canonical_product_id := public.resolve_canonical_product_id(target_product_id);
  return public.record_inventory_operation_pre_alias_074(
    canonical_product_id,
    operation_action,
    target_location,
    move_direction,
    operation_quantity,
    expected_inventory_updated_at
  );
end;
$$;

alter function public.record_receipt_check(
  uuid, numeric, text
) rename to record_receipt_check_pre_alias_074;

create or replace function public.record_receipt_check(
  target_product_id uuid,
  receipt_quantity numeric,
  receipt_note text default '입고여부만 확인'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  canonical_product_id uuid;
begin
  canonical_product_id := public.resolve_canonical_product_id(target_product_id);
  return public.record_receipt_check_pre_alias_074(
    canonical_product_id,
    receipt_quantity,
    receipt_note
  );
end;
$$;

alter function public.record_inventory_operation_idempotent_v2(
  uuid, text, text, text, numeric, bigint, bigint, uuid
) rename to record_inventory_operation_v2_pre_alias_074;

create or replace function public.record_inventory_operation_idempotent_v2(
  target_product_id uuid,
  operation_action text,
  target_location text,
  move_direction text,
  operation_quantity numeric,
  expected_warehouse_version bigint,
  expected_store_version bigint,
  request_id uuid
)
returns table (
  log_id uuid,
  warehouse_qty numeric,
  store_qty numeric,
  warehouse_version bigint,
  store_version bigint,
  inventory_updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  canonical_product_id uuid;
begin
  canonical_product_id := public.resolve_canonical_product_id(target_product_id);
  return query
  select *
  from public.record_inventory_operation_v2_pre_alias_074(
    canonical_product_id,
    operation_action,
    target_location,
    move_direction,
    operation_quantity,
    expected_warehouse_version,
    expected_store_version,
    request_id
  );
end;
$$;

alter function public.record_inventory_check(
  uuid, text, bigint, bigint, uuid
) rename to record_inventory_check_pre_alias_074;

create or replace function public.record_inventory_check(
  target_product_id uuid,
  target_location text,
  expected_warehouse_version bigint,
  expected_store_version bigint,
  request_id uuid
)
returns table (
  log_id uuid,
  checked_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  canonical_product_id uuid;
begin
  canonical_product_id := public.resolve_canonical_product_id(target_product_id);
  return query
  select *
  from public.record_inventory_check_pre_alias_074(
    canonical_product_id,
    target_location,
    expected_warehouse_version,
    expected_store_version,
    request_id
  );
end;
$$;

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
  canonical_prep_product_id uuid;
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

  select item.*
  into prep_item
  from public.prep_items item
  where item.id = target_prep_item_id
    and item.is_active = true
  for update;

  if not found then
    raise exception '프랩 품목을 찾을 수 없습니다.';
  end if;
  if not public.can_access_store(prep_item.store_id) then
    raise exception '프랩 품목 접근 권한이 없습니다.';
  end if;

  perform 1
  from public.products product
  where product.id = prep_item.product_id
    and product.store_id = prep_item.store_id;

  if not found then
    insert into public.products (
      store_id,
      name,
      category,
      unit_name,
      minimum_stock,
      is_active
    ) values (
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

  select coalesce(link.canonical_product_id, product.id)
  into canonical_prep_product_id
  from public.products product
  left join public.product_alias_links link
    on link.alias_product_id = product.id
   and link.unmerged_at is null
  join public.products canonical
    on canonical.id = coalesce(link.canonical_product_id, product.id)
   and canonical.store_id = prep_item.store_id
  where product.id = prep_item.product_id
    and product.store_id = prep_item.store_id;

  if canonical_prep_product_id is null then
    raise exception '프랩 재고 상품을 찾을 수 없습니다.';
  end if;

  insert into public.inventory (product_id, store_id)
  values (canonical_prep_product_id, prep_item.store_id)
  on conflict (product_id) do nothing;

  if operation_type = '제조' then
    select count(*)
    into recipe_count
    from public.prep_item_ingredients recipe
    where recipe.prep_item_id = prep_item.id;

    if recipe_count = 0 then
      raise exception '등록된 프랩 레시피가 없습니다.';
    end if;

    if exists (
      select 1
      from public.prep_item_ingredients recipe
      join public.products original
        on original.id = recipe.ingredient_product_id
      left join public.product_alias_links link
        on link.alias_product_id = original.id
       and link.unmerged_at is null
      left join public.products canonical
        on canonical.id = coalesce(link.canonical_product_id, original.id)
      where recipe.prep_item_id = prep_item.id
        and recipe.ingredient_product_id is not null
        and (
          canonical.id is null
          or canonical.store_id <> prep_item.store_id
          or canonical.is_active is distinct from true
        )
    ) then
      raise exception '프랩 레시피에 사용할 수 없는 재료 품목이 있습니다.';
    end if;

    if exists (
      select 1
      from public.prep_item_ingredients recipe
      left join public.product_alias_links link
        on link.alias_product_id = recipe.ingredient_product_id
       and link.unmerged_at is null
      where recipe.prep_item_id = prep_item.id
        and recipe.ingredient_product_id is not null
        and coalesce(
          link.canonical_product_id,
          recipe.ingredient_product_id
        ) = canonical_prep_product_id
    ) then
      raise exception '프랩 품목 자체는 재료로 사용할 수 없습니다.';
    end if;

    insert into public.inventory (product_id, store_id)
    select distinct
      coalesce(link.canonical_product_id, recipe.ingredient_product_id),
      prep_item.store_id
    from public.prep_item_ingredients recipe
    left join public.product_alias_links link
      on link.alias_product_id = recipe.ingredient_product_id
     and link.unmerged_at is null
    where recipe.prep_item_id = prep_item.id
      and recipe.ingredient_product_id is not null
    on conflict (product_id) do nothing;
  end if;

  -- All participating inventory rows are locked in UUID order to prevent
  -- reverse-order prep operations from deadlocking each other.
  perform inventory.id
  from public.inventory inventory
  where inventory.store_id = prep_item.store_id
    and (
      inventory.product_id = canonical_prep_product_id
      or (
        operation_type = '제조'
        and inventory.product_id in (
          select coalesce(
            link.canonical_product_id,
            recipe.ingredient_product_id
          )
          from public.prep_item_ingredients recipe
          left join public.product_alias_links link
            on link.alias_product_id = recipe.ingredient_product_id
           and link.unmerged_at is null
          where recipe.prep_item_id = prep_item.id
            and recipe.ingredient_product_id is not null
        )
      )
    )
  order by inventory.product_id
  for update;

  select inventory.*
  into prep_inventory
  from public.inventory inventory
  where inventory.product_id = canonical_prep_product_id
    and inventory.store_id = prep_item.store_id;

  if not found then
    raise exception '프랩 재고 정보를 찾을 수 없습니다.';
  end if;

  if operation_type = '제조' then
    for ingredient in
      with resolved_recipe as (
        select
          coalesce(
            link.canonical_product_id,
            recipe.ingredient_product_id
          ) as product_id,
          sum(recipe.quantity_per_unit)::numeric(12, 4) as quantity_per_unit
        from public.prep_item_ingredients recipe
        left join public.product_alias_links link
          on link.alias_product_id = recipe.ingredient_product_id
         and link.unmerged_at is null
        where recipe.prep_item_id = prep_item.id
          and recipe.ingredient_product_id is not null
        group by coalesce(
          link.canonical_product_id,
          recipe.ingredient_product_id
        )
      )
      select
        resolved.product_id as ingredient_product_id,
        resolved.quantity_per_unit,
        product.name as ingredient_name,
        inventory.id as inventory_id,
        inventory.warehouse_qty,
        inventory.store_qty
      from resolved_recipe resolved
      join public.products product
        on product.id = resolved.product_id
       and product.store_id = prep_item.store_id
      join public.inventory inventory
        on inventory.product_id = resolved.product_id
       and inventory.store_id = prep_item.store_id
      order by resolved.product_id
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

      ingredient_store_consumed := least(
        ingredient.store_qty,
        consumable_quantity
      );
      ingredient_warehouse_consumed :=
        consumable_quantity - ingredient_store_consumed;
      ingredient_next_store_qty :=
        ingredient.store_qty - ingredient_store_consumed;
      ingredient_next_warehouse_qty :=
        ingredient.warehouse_qty - ingredient_warehouse_consumed;

      update public.inventory inventory
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
      ) values (
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

    update public.inventory inventory
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
      ) values (
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
    ) values (
      canonical_prep_product_id,
      prep_item.store_id,
      auth.uid(),
      '프랩 제조',
      null,
      '매장',
      prep_inventory.store_qty,
      prep_inventory.store_qty + operation_quantity,
      operation_quantity,
      case
        when prep_item.shelf_life_enabled
          then '만료일 ' || expires_date::text
        else '유통기한 없음'
      end,
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
        from public.dashboard_todos todo
        where todo.store_id = prep_item.store_id
          and todo.task_date = expires_date
          and todo.content = '[' || prep_item.name || '] 폐기하기'
          and todo.is_completed = false
      );
    end if;

    return jsonb_build_object(
      'log_id', inserted_log_id,
      'warning_message', nullif(
        array_to_string(shortage_messages, E'\n'),
        ''
      )
    );
  end if;

  if prep_inventory.store_qty < operation_quantity then
    raise exception '프랩 재고가 부족합니다. 현재 수량 %',
      prep_inventory.store_qty;
  end if;

  if prep_item.shelf_life_enabled then
    remaining_quantity := operation_quantity;

    for batch in
      select prep_batch.*
      from public.prep_batches prep_batch
      where prep_batch.prep_item_id = prep_item.id
        and prep_batch.store_id = prep_item.store_id
        and prep_batch.quantity_remaining > 0
      order by
        prep_batch.expires_on,
        prep_batch.manufactured_at,
        prep_batch.created_at
      for update
    loop
      consumed_from_batch := least(
        batch.quantity_remaining,
        remaining_quantity
      );

      update public.prep_batches prep_batch
      set quantity_remaining =
        prep_batch.quantity_remaining - consumed_from_batch
      where prep_batch.id = batch.id;

      remaining_quantity := remaining_quantity - consumed_from_batch;
      exit when remaining_quantity <= 0;
    end loop;

    if remaining_quantity > 0 then
      raise exception '제조 단위별 프랩 재고가 부족합니다.';
    end if;
  end if;

  update public.inventory inventory
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
  ) values (
    canonical_prep_product_id,
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

revoke all on function public.canonicalize_new_prep_ingredient()
from public, anon, authenticated;
revoke all on function public.validate_group_order_recipe_ingredient()
from public, anon, authenticated;
revoke all on function public.record_inventory_operation_pre_alias_074(
  uuid, text, text, text, numeric, timestamptz
) from public, anon, authenticated;
revoke all on function public.record_receipt_check_pre_alias_074(
  uuid, numeric, text
) from public, anon, authenticated;
revoke all on function public.record_inventory_operation_v2_pre_alias_074(
  uuid, text, text, text, numeric, bigint, bigint, uuid
) from public, anon, authenticated;
revoke all on function public.record_inventory_check_pre_alias_074(
  uuid, text, bigint, bigint, uuid
) from public, anon, authenticated;

revoke all on function public.link_recipe_product_alias(
  uuid, text, uuid, text
) from public, anon;
revoke all on function public.record_inventory_operation(
  uuid, text, text, text, numeric, timestamptz
) from public, anon;
revoke all on function public.record_receipt_check(
  uuid, numeric, text
) from public, anon;
revoke all on function public.record_inventory_operation_idempotent_v2(
  uuid, text, text, text, numeric, bigint, bigint, uuid
) from public, anon;
revoke all on function public.record_inventory_check(
  uuid, text, bigint, bigint, uuid
) from public, anon;
revoke all on function public.record_prep_operation(uuid, text, numeric)
from public, anon;

grant execute on function public.link_recipe_product_alias(
  uuid, text, uuid, text
) to authenticated;
grant execute on function public.record_inventory_operation(
  uuid, text, text, text, numeric, timestamptz
) to authenticated;
grant execute on function public.record_receipt_check(
  uuid, numeric, text
) to authenticated;
grant execute on function public.record_inventory_operation_idempotent_v2(
  uuid, text, text, text, numeric, bigint, bigint, uuid
) to authenticated;
grant execute on function public.record_inventory_check(
  uuid, text, bigint, bigint, uuid
) to authenticated;
grant execute on function public.record_prep_operation(uuid, text, numeric)
to authenticated;

notify pgrst, 'reload schema';
