alter table public.inventory_logs drop constraint if exists inventory_logs_action_check;
alter table public.inventory_logs add constraint inventory_logs_action_check
check (action in ('입고', '출고', '이동', '조정', '프랩 제조', '프랩 소진', '프랩 폐기'));

create table if not exists public.prep_items (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete restrict,
  product_id uuid not null unique references public.products(id) on delete restrict,
  name text not null check (char_length(trim(name)) > 0),
  shelf_life_days integer not null default 1 check (shelf_life_days >= 1),
  sort_order integer not null default 1000,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.prep_item_ingredients (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete restrict,
  prep_item_id uuid not null references public.prep_items(id) on delete cascade,
  ingredient_product_id uuid not null references public.products(id) on delete restrict,
  quantity_per_unit numeric(12, 2) not null check (quantity_per_unit > 0),
  sort_order integer not null default 1000,
  created_at timestamptz not null default now(),
  unique (prep_item_id, ingredient_product_id)
);

create table if not exists public.prep_batches (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete restrict,
  prep_item_id uuid not null references public.prep_items(id) on delete cascade,
  quantity_produced numeric(12, 2) not null check (quantity_produced > 0),
  quantity_remaining numeric(12, 2) not null check (quantity_remaining >= 0),
  manufactured_at timestamptz not null default now(),
  expires_on date not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index if not exists prep_items_store_sort_idx
on public.prep_items (store_id, sort_order, name);

create index if not exists prep_item_ingredients_item_sort_idx
on public.prep_item_ingredients (prep_item_id, sort_order);

create index if not exists prep_item_ingredients_product_idx
on public.prep_item_ingredients (ingredient_product_id);

create index if not exists prep_batches_active_fifo_idx
on public.prep_batches (prep_item_id, expires_on, manufactured_at, created_at)
where quantity_remaining > 0;

create or replace function public.touch_prep_item_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists prep_items_touch_updated_at on public.prep_items;
create trigger prep_items_touch_updated_at
before update on public.prep_items
for each row
execute function public.touch_prep_item_updated_at();

drop trigger if exists fill_prep_items_store_id on public.prep_items;
create trigger fill_prep_items_store_id before insert on public.prep_items
for each row execute function public.fill_current_store_id();

drop trigger if exists fill_prep_item_ingredients_store_id on public.prep_item_ingredients;
create trigger fill_prep_item_ingredients_store_id before insert on public.prep_item_ingredients
for each row execute function public.fill_current_store_id();

drop trigger if exists fill_prep_batches_store_id on public.prep_batches;
create trigger fill_prep_batches_store_id before insert on public.prep_batches
for each row execute function public.fill_current_store_id();

alter table public.prep_items enable row level security;
alter table public.prep_item_ingredients enable row level security;
alter table public.prep_batches enable row level security;

drop policy if exists "Users can read prep items in their store" on public.prep_items;
create policy "Users can read prep items in their store"
on public.prep_items for select to authenticated
using (public.can_access_store(store_id));

drop policy if exists "Admins can manage prep items in their store" on public.prep_items;
create policy "Admins can manage prep items in their store"
on public.prep_items for all to authenticated
using (public.can_admin_store(store_id))
with check (public.can_admin_store(store_id));

drop policy if exists "Users can read prep ingredients in their store" on public.prep_item_ingredients;
create policy "Users can read prep ingredients in their store"
on public.prep_item_ingredients for select to authenticated
using (public.can_access_store(store_id));

drop policy if exists "Admins can manage prep ingredients in their store" on public.prep_item_ingredients;
create policy "Admins can manage prep ingredients in their store"
on public.prep_item_ingredients for all to authenticated
using (public.can_admin_store(store_id))
with check (public.can_admin_store(store_id));

drop policy if exists "Users can read prep batches in their store" on public.prep_batches;
create policy "Users can read prep batches in their store"
on public.prep_batches for select to authenticated
using (public.can_access_store(store_id));

grant select, insert, update, delete on public.prep_items to authenticated;
grant select, insert, update, delete on public.prep_item_ingredients to authenticated;
grant select on public.prep_batches to authenticated;

create or replace function public.save_prep_item(
  target_prep_item_id uuid,
  item_name text,
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
  v_ingredient_quantity numeric(12, 2);
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

  if item_shelf_life_days is null or item_shelf_life_days < 1 then
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
      shelf_life_days,
      sort_order,
      is_active
    )
    values (
      requester_store_id,
      target_product_id,
      trim(item_name),
      item_shelf_life_days,
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
        shelf_life_days = item_shelf_life_days,
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
    v_ingredient_quantity := nullif(ingredient ->> 'quantity_per_unit', '')::numeric(12, 2);
    v_ingredient_sort_order := coalesce(nullif(ingredient ->> 'sort_order', '')::integer, ingredient_index);

    if v_ingredient_product_id is null then
      raise exception '재료 품목을 선택해 주세요.';
    end if;

    if v_ingredient_product_id = target_product_id then
      raise exception '프랩 품목 자체는 재료로 등록할 수 없습니다.';
    end if;

    if v_ingredient_quantity is null or v_ingredient_quantity <= 0 then
      raise exception '재료 사용량은 0보다 커야 합니다.';
    end if;

    perform 1
    from public.products
    where id = v_ingredient_product_id
      and store_id = requester_store_id
      and is_active = true;

    if not found then
      raise exception '재료 품목을 찾을 수 없습니다.';
    end if;

    insert into public.prep_item_ingredients (
      store_id,
      prep_item_id,
      ingredient_product_id,
      quantity_per_unit,
      sort_order
    )
    values (
      requester_store_id,
      saved_item.id,
      v_ingredient_product_id,
      v_ingredient_quantity,
      v_ingredient_sort_order
    )
    on conflict (prep_item_id, ingredient_product_id) do update set
      quantity_per_unit = excluded.quantity_per_unit,
      sort_order = excluded.sort_order;
  end loop;

  return saved_item;
end;
$$;

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

  select *
  into prep_item
  from public.prep_items
  where id = target_prep_item_id
    and is_active = true
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

  select *
  into prep_inventory
  from public.inventory
  where product_id = prep_item.product_id
    and store_id = prep_item.store_id
  for update;

  if not found then
    raise exception '프랩 재고 정보를 찾을 수 없습니다.';
  end if;

  if operation_type = '제조' then
    select count(*)
    into recipe_count
    from public.prep_item_ingredients
    where prep_item_id = prep_item.id;

    if recipe_count = 0 then
      raise exception '등록된 프랩 레시피가 없습니다.';
    end if;

    insert into public.inventory (product_id, store_id)
    select ingredient_product_id, prep_item.store_id
    from public.prep_item_ingredients
    where prep_item_id = prep_item.id
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
      where id = ingredient.inventory_id;

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
    where id = prep_inventory.id;

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
      from public.dashboard_todos
      where store_id = prep_item.store_id
        and task_date = expires_date
        and content = '[' || prep_item.name || '] 폐기하기'
        and is_completed = false
    );

    return inserted_log_id;
  end if;

  if prep_inventory.store_qty < operation_quantity then
    raise exception '프랩 재고가 부족합니다. 현재 수량 %', prep_inventory.store_qty;
  end if;

  remaining_quantity := operation_quantity;

  for batch in
    select *
    from public.prep_batches
    where prep_item_id = prep_item.id
      and store_id = prep_item.store_id
      and quantity_remaining > 0
    order by expires_on, manufactured_at, created_at
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
  where id = prep_inventory.id;

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

create or replace function public.reorder_prep_items(ordered_prep_item_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  requester_store_id uuid;
  prep_item_id uuid;
  next_sort_order integer := 0;
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.';
  end if;

  requester_store_id := public.current_store_id(auth.uid());
  if requester_store_id is null then
    raise exception '매장 정보가 필요합니다.';
  end if;

  if ordered_prep_item_ids is null or array_length(ordered_prep_item_ids, 1) is null then
    return;
  end if;

  foreach prep_item_id in array ordered_prep_item_ids
  loop
    next_sort_order := next_sort_order + 1;

    update public.prep_items
    set sort_order = next_sort_order
    where id = prep_item_id
      and store_id = requester_store_id;

    if not found then
      raise exception '순서를 변경할 수 없는 프랩 품목이 포함되어 있습니다.';
    end if;
  end loop;
end;
$$;

create or replace function public.delete_prep_item(target_prep_item_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  prep_item public.prep_items%rowtype;
  remaining_stock numeric(12, 2);
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.';
  end if;

  select *
  into prep_item
  from public.prep_items
  where id = target_prep_item_id
  for update;

  if not found then
    raise exception '삭제할 프랩 품목을 찾을 수 없습니다.';
  end if;

  if not public.can_admin_store(prep_item.store_id) then
    raise exception '프랩 품목을 삭제할 권한이 없습니다.';
  end if;

  select coalesce(sum(coalesce(warehouse_qty, 0) + coalesce(store_qty, 0)), 0)
  into remaining_stock
  from public.inventory
  where product_id = prep_item.product_id
    and store_id = prep_item.store_id;

  if remaining_stock > 0 then
    raise exception '프랩 재고가 남아 있어 삭제할 수 없습니다. 현재 수량 %', remaining_stock;
  end if;

  if exists (
    select 1
    from public.prep_batches
    where prep_item_id = prep_item.id
      and store_id = prep_item.store_id
      and quantity_remaining > 0
  ) then
    raise exception '남은 제조 단위가 있어 삭제할 수 없습니다.';
  end if;

  delete from public.prep_items
  where id = prep_item.id;

  update public.products
  set is_active = false
  where id = prep_item.product_id
    and store_id = prep_item.store_id;
end;
$$;

grant execute on function public.save_prep_item(uuid, text, integer, integer, jsonb, boolean) to authenticated;
grant execute on function public.record_prep_operation(uuid, text, numeric) to authenticated;
grant execute on function public.reorder_prep_items(uuid[]) to authenticated;
grant execute on function public.delete_prep_item(uuid) to authenticated;

notify pgrst, 'reload schema';
