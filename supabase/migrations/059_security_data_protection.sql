-- P0 security and data-protection hardening.
-- Inventory mutations, order-confirmation mutations, and unit-name propagation
-- are executed by transaction-scoped RPCs. Product units become store scoped.

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
  target_product public.products%rowtype;
  current_inventory public.inventory%rowtype;
  next_warehouse_qty numeric(12, 4);
  next_store_qty numeric(12, 4);
  source_location_value text;
  destination_location_value text;
  previous_quantity_value numeric(12, 4);
  new_quantity_value numeric(12, 4);
  created_log_id uuid;
  is_no_longer_low_stock boolean;
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.';
  end if;

  select * into target_product
  from public.products
  where id = target_product_id
  for update;

  if not found or not public.can_access_store(target_product.store_id) then
    raise exception '해당 상품에 접근할 권한이 없습니다.';
  end if;
  if target_product.receipt_check_only then
    raise exception '입고여부만 확인 품목은 별도 입고 확인으로 처리해 주세요.';
  end if;
  if operation_action not in ('입고', '출고', '이동', '조정') then
    raise exception '지원하지 않는 재고 작업입니다.';
  end if;
  if target_location not in ('창고', '매장') then
    raise exception '재고 위치를 확인해 주세요.';
  end if;
  if operation_quantity is null
    or (operation_action = '조정' and operation_quantity < 0)
    or (operation_action <> '조정' and operation_quantity <= 0) then
    raise exception '재고 수량을 확인해 주세요.';
  end if;

  insert into public.inventory (product_id, store_id)
  values (target_product.id, target_product.store_id)
  on conflict (product_id) do nothing;

  select * into current_inventory
  from public.inventory
  where product_id = target_product.id
    and store_id = target_product.store_id
  for update;

  if expected_inventory_updated_at is null
    or current_inventory.updated_at is distinct from expected_inventory_updated_at then
    raise exception '다른 직원이 먼저 재고를 변경했습니다. 최신 수량을 불러온 뒤 다시 저장해 주세요.';
  end if;

  next_warehouse_qty := current_inventory.warehouse_qty;
  next_store_qty := current_inventory.store_qty;

  if operation_action = '입고' then
    destination_location_value := target_location;
    if target_location = '창고' then
      previous_quantity_value := current_inventory.warehouse_qty;
      next_warehouse_qty := next_warehouse_qty + operation_quantity;
      new_quantity_value := next_warehouse_qty;
    else
      previous_quantity_value := current_inventory.store_qty;
      next_store_qty := next_store_qty + operation_quantity;
      new_quantity_value := next_store_qty;
    end if;
  elsif operation_action = '출고' then
    source_location_value := target_location;
    if target_location = '창고' then
      previous_quantity_value := current_inventory.warehouse_qty;
      next_warehouse_qty := next_warehouse_qty - operation_quantity;
      new_quantity_value := next_warehouse_qty;
    else
      previous_quantity_value := current_inventory.store_qty;
      next_store_qty := next_store_qty - operation_quantity;
      new_quantity_value := next_store_qty;
    end if;
  elsif operation_action = '이동' then
    if move_direction = 'warehouse-to-store' then
      source_location_value := '창고';
      destination_location_value := '매장';
      previous_quantity_value := current_inventory.warehouse_qty;
      next_warehouse_qty := next_warehouse_qty - operation_quantity;
      next_store_qty := next_store_qty + operation_quantity;
      new_quantity_value := next_warehouse_qty;
    elsif move_direction = 'store-to-warehouse' then
      source_location_value := '매장';
      destination_location_value := '창고';
      previous_quantity_value := current_inventory.store_qty;
      next_store_qty := next_store_qty - operation_quantity;
      next_warehouse_qty := next_warehouse_qty + operation_quantity;
      new_quantity_value := next_store_qty;
    else
      raise exception '이동 방향을 확인해 주세요.';
    end if;
  else
    source_location_value := target_location;
    if target_location = '창고' then
      previous_quantity_value := current_inventory.warehouse_qty;
      next_warehouse_qty := operation_quantity;
      new_quantity_value := next_warehouse_qty;
    else
      previous_quantity_value := current_inventory.store_qty;
      next_store_qty := operation_quantity;
      new_quantity_value := next_store_qty;
    end if;
  end if;

  if next_warehouse_qty < 0 or next_store_qty < 0 then
    raise exception '재고 수량은 음수가 될 수 없습니다.';
  end if;

  update public.inventory
  set warehouse_qty = next_warehouse_qty,
      store_qty = next_store_qty
  where id = current_inventory.id;

  insert into public.inventory_logs (
    store_id, product_id, user_id, action, source_location,
    destination_location, previous_quantity, new_quantity, quantity, note,
    warehouse_qty_before, store_qty_before, warehouse_qty_after, store_qty_after
  ) values (
    target_product.store_id, target_product.id, auth.uid(), operation_action,
    source_location_value, destination_location_value, previous_quantity_value,
    new_quantity_value, operation_quantity, null, current_inventory.warehouse_qty,
    current_inventory.store_qty, next_warehouse_qty, next_store_qty
  ) returning id into created_log_id;

  is_no_longer_low_stock := case
    when target_product.status_enabled then target_product.stock_status is distinct from '발주 필요'
    else next_warehouse_qty + next_store_qty > target_product.minimum_stock
  end;

  if operation_action = '입고' then
    update public.products
    set fresh_order_selected = false,
        fresh_order_selected_at = null,
        urgent_order_requested = false,
        urgent_order_quantity = null,
        order_completed = false,
        confirmed_order_pending = false
    where id = target_product.id;
  elsif operation_action = '조정'
    and target_product.confirmed_order_pending
    and is_no_longer_low_stock then
    update public.products
    set order_completed = false,
        confirmed_order_pending = false
    where id = target_product.id;
  end if;

  return created_log_id;
end;
$$;

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
  target_product public.products%rowtype;
  current_inventory public.inventory%rowtype;
  created_log_id uuid;
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.';
  end if;

  select * into target_product
  from public.products
  where id = target_product_id
  for update;

  if not found or not public.can_access_store(target_product.store_id) then
    raise exception '해당 상품에 접근할 권한이 없습니다.';
  end if;
  if not target_product.receipt_check_only then
    raise exception '입고여부만 확인 품목이 아닙니다.';
  end if;
  if receipt_quantity is not null and receipt_quantity <= 0 then
    raise exception '입고 개수는 0보다 커야 합니다.';
  end if;

  insert into public.inventory (product_id, store_id)
  values (target_product.id, target_product.store_id)
  on conflict (product_id) do nothing;

  select * into current_inventory
  from public.inventory
  where product_id = target_product.id
    and store_id = target_product.store_id
  for update;

  insert into public.inventory_logs (
    store_id, product_id, user_id, action, source_location,
    destination_location, previous_quantity, new_quantity, quantity, note,
    warehouse_qty_before, store_qty_before, warehouse_qty_after, store_qty_after
  ) values (
    target_product.store_id, target_product.id, auth.uid(), '입고', null, null,
    null, null, receipt_quantity, nullif(trim(coalesce(receipt_note, '')), ''),
    current_inventory.warehouse_qty, current_inventory.store_qty,
    current_inventory.warehouse_qty, current_inventory.store_qty
  ) returning id into created_log_id;

  update public.products
  set fresh_order_selected = false,
      fresh_order_selected_at = null,
      urgent_order_requested = false,
      urgent_order_quantity = null,
      order_completed = false,
      confirmed_order_pending = false
  where id = target_product.id;

  return created_log_id;
end;
$$;

create or replace function public.replace_confirmed_order_items(
  target_store_id uuid,
  target_order_date date,
  item_rows jsonb,
  confirmation_note text default null
)
returns setof public.confirmed_order_items
language plpgsql
security definer
set search_path = public
as $$
declare
  confirmed_at_value timestamptz := clock_timestamp();
  requested_count integer;
  valid_count integer;
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다.'; end if;
  if not public.can_manage_store_task(target_store_id, 'order_confirmation') then
    raise exception '발주 품목을 확정할 권한이 없습니다.';
  end if;
  if jsonb_typeof(item_rows) is distinct from 'array' then
    raise exception '확정할 품목을 확인해 주세요.';
  end if;

  select count(*) into requested_count from jsonb_array_elements(item_rows);
  if requested_count = 0 then raise exception '확정할 품목이 없습니다.'; end if;
  if exists (
    select 1 from jsonb_array_elements(item_rows) row
    where nullif(row->>'required_quantity', '')::numeric < 0
  ) then
    raise exception '필요 개수는 음수가 될 수 없습니다.';
  end if;

  select count(*) into valid_count
  from (
    select distinct (row->>'product_id')::uuid as product_id
    from jsonb_array_elements(item_rows) row
  ) requested
  join public.products product on product.id = requested.product_id
  where product.store_id = target_store_id and product.is_active;

  if valid_count <> requested_count then
    raise exception '확정 품목에 중복되거나 다른 매장의 상품이 있습니다.';
  end if;

  perform 1 from public.products
  where store_id = target_store_id
    and id in (
      select product_id from public.confirmed_order_items
      where store_id = target_store_id and order_date = target_order_date
      union
      select (row->>'product_id')::uuid from jsonb_array_elements(item_rows) row
    )
  for update;

  update public.products product
  set order_completed = false,
      confirmed_order_pending = false,
      fresh_order_selected = case when confirmed.fresh_order_selected then true else product.fresh_order_selected end,
      fresh_order_selected_at = case when confirmed.fresh_order_selected then clock_timestamp() else product.fresh_order_selected_at end
  from public.confirmed_order_items confirmed
  where confirmed.store_id = target_store_id
    and confirmed.order_date = target_order_date
    and product.id = confirmed.product_id;

  delete from public.confirmed_order_items
  where store_id = target_store_id and order_date = target_order_date;

  insert into public.confirmed_order_items (
    store_id, order_date, product_id, product_name, category, supplier_name,
    total_stock, minimum_stock, required_quantity, is_low_stock,
    fresh_order_selected, urgent_order_requested, urgent_order_quantity,
    order_completed, confirmation_note, receipt_expected_deleted_at,
    receipt_expected_deleted_by, confirmed_by, confirmed_at
  )
  select
    target_store_id, target_order_date, product.id, product.name,
    coalesce(product.category, '기타'), product.supplier_name,
    case when product.receipt_check_only then null else inventory.warehouse_qty + inventory.store_qty end,
    case when product.receipt_check_only then null else product.minimum_stock end,
    nullif(row->>'required_quantity', '')::numeric,
    not product.receipt_check_only and case when product.status_enabled
      then product.stock_status = '발주 필요'
      else coalesce(inventory.warehouse_qty, 0) + coalesce(inventory.store_qty, 0) <= product.minimum_stock end,
    product.fresh_order_selected, product.urgent_order_requested,
    product.urgent_order_quantity, true, nullif(trim(coalesce(confirmation_note, '')), ''),
    null, null, auth.uid(), confirmed_at_value
  from jsonb_array_elements(item_rows) row
  join public.products product on product.id = (row->>'product_id')::uuid
  left join public.inventory inventory on inventory.product_id = product.id
  where product.store_id = target_store_id;

  update public.products product
  set order_completed = true,
      confirmed_order_pending = true,
      fresh_order_selected = false,
      fresh_order_selected_at = null
  where product.store_id = target_store_id
    and product.id in (select (row->>'product_id')::uuid from jsonb_array_elements(item_rows) row);

  return query
  select * from public.confirmed_order_items
  where store_id = target_store_id and order_date = target_order_date
  order by urgent_order_requested desc, product_name;
end;
$$;

create or replace function public.add_confirmed_order_item(
  target_store_id uuid,
  target_order_date date,
  target_product_id uuid,
  required_quantity_value numeric default null
)
returns public.confirmed_order_items
language plpgsql
security definer
set search_path = public
as $$
declare
  target_product public.products%rowtype;
  target_inventory public.inventory%rowtype;
  reference_item public.confirmed_order_items%rowtype;
  created_item public.confirmed_order_items%rowtype;
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다.'; end if;
  if not public.can_manage_store_task(target_store_id, 'order_confirmation') then
    raise exception '발주 품목을 수정할 권한이 없습니다.';
  end if;
  if required_quantity_value is not null and required_quantity_value < 0 then
    raise exception '필요 개수는 음수가 될 수 없습니다.';
  end if;

  select * into target_product from public.products
  where id = target_product_id and store_id = target_store_id and is_active
  for update;
  if not found then raise exception '추가할 상품을 찾을 수 없습니다.'; end if;

  select * into target_inventory from public.inventory where product_id = target_product.id;
  select * into reference_item from public.confirmed_order_items
  where store_id = target_store_id and order_date = target_order_date
  order by confirmed_at desc limit 1;

  insert into public.confirmed_order_items (
    store_id, order_date, product_id, product_name, category, supplier_name,
    total_stock, minimum_stock, required_quantity, is_low_stock,
    fresh_order_selected, urgent_order_requested, urgent_order_quantity,
    order_completed, confirmation_note, confirmed_by, confirmed_at
  ) values (
    target_store_id, target_order_date, target_product.id, target_product.name,
    coalesce(target_product.category, '기타'), target_product.supplier_name,
    case when target_product.receipt_check_only then null else coalesce(target_inventory.warehouse_qty, 0) + coalesce(target_inventory.store_qty, 0) end,
    case when target_product.receipt_check_only then null else target_product.minimum_stock end,
    required_quantity_value,
    not target_product.receipt_check_only and case when target_product.status_enabled
      then target_product.stock_status = '발주 필요'
      else coalesce(target_inventory.warehouse_qty, 0) + coalesce(target_inventory.store_qty, 0) <= target_product.minimum_stock end,
    target_product.fresh_order_selected, target_product.urgent_order_requested,
    target_product.urgent_order_quantity, true, reference_item.confirmation_note,
    coalesce(reference_item.confirmed_by, auth.uid()),
    coalesce(reference_item.confirmed_at, clock_timestamp())
  ) returning * into created_item;

  update public.products
  set order_completed = true,
      confirmed_order_pending = true,
      fresh_order_selected = false,
      fresh_order_selected_at = null
  where id = target_product.id;

  return created_item;
end;
$$;

create or replace function public.remove_confirmed_order_item(
  target_store_id uuid,
  target_confirmed_item_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target_item public.confirmed_order_items%rowtype;
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다.'; end if;
  if not public.can_manage_store_task(target_store_id, 'order_confirmation') then
    raise exception '발주 품목을 수정할 권한이 없습니다.';
  end if;

  select * into target_item from public.confirmed_order_items
  where id = target_confirmed_item_id and store_id = target_store_id
  for update;
  if not found then raise exception '확정 품목을 찾을 수 없습니다.'; end if;

  perform 1 from public.products where id = target_item.product_id for update;
  delete from public.confirmed_order_items where id = target_item.id;
  update public.products
  set order_completed = false,
      confirmed_order_pending = false,
      fresh_order_selected = case when target_item.fresh_order_selected then true else fresh_order_selected end,
      fresh_order_selected_at = case when target_item.fresh_order_selected then clock_timestamp() else fresh_order_selected_at end
  where id = target_item.product_id and store_id = target_store_id;
  return target_item.product_id;
end;
$$;

create or replace function public.cancel_confirmed_order(
  target_store_id uuid,
  target_order_date date
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  cancelled_count integer;
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다.'; end if;
  if not public.can_manage_store_task(target_store_id, 'order_confirmation') then
    raise exception '발주 확정을 취소할 권한이 없습니다.';
  end if;

  perform 1 from public.products
  where store_id = target_store_id
    and id in (select product_id from public.confirmed_order_items where store_id = target_store_id and order_date = target_order_date)
  for update;

  update public.products product
  set order_completed = false,
      confirmed_order_pending = false,
      fresh_order_selected = case when confirmed.fresh_order_selected then true else product.fresh_order_selected end,
      fresh_order_selected_at = case when confirmed.fresh_order_selected then clock_timestamp() else product.fresh_order_selected_at end
  from public.confirmed_order_items confirmed
  where confirmed.store_id = target_store_id
    and confirmed.order_date = target_order_date
    and product.id = confirmed.product_id;

  delete from public.confirmed_order_items
  where store_id = target_store_id and order_date = target_order_date;
  get diagnostics cancelled_count = row_count;
  return cancelled_count;
end;
$$;

alter table public.product_units
add column if not exists store_id uuid references public.stores(id) on delete cascade;

alter table public.product_units drop constraint if exists product_units_name_key;
drop index if exists public.product_units_name_key;

create unique index if not exists product_units_store_name_unique
on public.product_units (store_id, name);

insert into public.product_units (store_id, name, is_active, sort_order, created_at)
select store.id, unit.name, unit.is_active, unit.sort_order, unit.created_at
from public.stores store
cross join public.product_units unit
where unit.store_id is null
on conflict (store_id, name) do nothing;

delete from public.product_units where store_id is null;
alter table public.product_units alter column store_id set not null;

create index if not exists product_units_store_sort_idx
on public.product_units (store_id, sort_order, name);

drop policy if exists "Authenticated users can read product units" on public.product_units;
drop policy if exists "Authenticated users can insert product units" on public.product_units;
drop policy if exists "Authenticated users can update product units" on public.product_units;
drop policy if exists "Authenticated users can delete inactive product units" on public.product_units;

create policy "Users can read product units in their store"
on public.product_units for select to authenticated
using (public.can_access_store(store_id));

create policy "Admins can insert product units in their store"
on public.product_units for insert to authenticated
with check (public.can_admin_store(store_id));

create policy "Admins can update product units in their store"
on public.product_units for update to authenticated
using (public.can_admin_store(store_id))
with check (public.can_admin_store(store_id));

create policy "Admins can delete inactive product units in their store"
on public.product_units for delete to authenticated
using (public.can_admin_store(store_id) and is_active = false);

create or replace function public.rename_product_unit(
  target_unit_id uuid,
  next_name text
)
returns public.product_units
language plpgsql
security definer
set search_path = public
as $$
declare
  target_unit public.product_units%rowtype;
  normalized_name text := trim(coalesce(next_name, ''));
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다.'; end if;

  select * into target_unit from public.product_units
  where id = target_unit_id
  for update;
  if not found then raise exception '품목 단위를 찾을 수 없습니다.'; end if;
  if not public.can_admin_store(target_unit.store_id) then
    raise exception '품목 단위를 수정할 권한이 없습니다.';
  end if;
  if normalized_name = '' then raise exception '품목 단위 이름은 비워둘 수 없습니다.'; end if;

  update public.products
  set unit_name = normalized_name
  where store_id = target_unit.store_id and unit_name = target_unit.name;

  update public.product_units
  set name = normalized_name
  where id = target_unit.id
  returning * into target_unit;

  return target_unit;
end;
$$;

revoke all on function public.record_inventory_operation(uuid, text, text, text, numeric, timestamptz) from public, anon;
revoke all on function public.record_receipt_check(uuid, numeric, text) from public, anon;
revoke all on function public.replace_confirmed_order_items(uuid, date, jsonb, text) from public, anon;
revoke all on function public.add_confirmed_order_item(uuid, date, uuid, numeric) from public, anon;
revoke all on function public.remove_confirmed_order_item(uuid, uuid) from public, anon;
revoke all on function public.cancel_confirmed_order(uuid, date) from public, anon;
revoke all on function public.rename_product_unit(uuid, text) from public, anon;

grant execute on function public.record_inventory_operation(uuid, text, text, text, numeric, timestamptz) to authenticated;
grant execute on function public.record_receipt_check(uuid, numeric, text) to authenticated;
grant execute on function public.replace_confirmed_order_items(uuid, date, jsonb, text) to authenticated;
grant execute on function public.add_confirmed_order_item(uuid, date, uuid, numeric) to authenticated;
grant execute on function public.remove_confirmed_order_item(uuid, uuid) to authenticated;
grant execute on function public.cancel_confirmed_order(uuid, date) to authenticated;
grant execute on function public.rename_product_unit(uuid, text) to authenticated;

notify pgrst, 'reload schema';
