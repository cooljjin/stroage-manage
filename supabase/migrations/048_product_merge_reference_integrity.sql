create table if not exists public.product_merge_history (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  source_product_id uuid not null unique references public.products(id) on delete restrict,
  target_product_id uuid not null references public.products(id) on delete restrict,
  merged_by uuid references auth.users(id) on delete set null,
  merged_at timestamptz not null default now(),
  check (source_product_id <> target_product_id)
);

create index if not exists product_merge_history_store_merged_at_idx
on public.product_merge_history (store_id, merged_at desc);

alter table public.product_merge_history enable row level security;

drop policy if exists "Users can read product merge history in their store" on public.product_merge_history;
create policy "Users can read product merge history in their store"
on public.product_merge_history for select to authenticated
using (public.can_access_store(store_id));

grant select on public.product_merge_history to authenticated;

create or replace function public.merge_products(target_product_id uuid, source_product_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_product public.products%rowtype;
  source_product public.products%rowtype;
  source_warehouse_qty numeric(12, 4);
  source_store_qty numeric(12, 4);
begin
  if target_product_id = source_product_id then
    raise exception '같은 상품은 병합할 수 없습니다.';
  end if;

  select *
  into target_product
  from public.products
  where id = target_product_id;

  if not found then
    raise exception '남길 상품을 찾을 수 없습니다.';
  end if;

  select *
  into source_product
  from public.products
  where id = source_product_id;

  if not found then
    raise exception '병합할 상품을 찾을 수 없습니다.';
  end if;

  if target_product.store_id <> source_product.store_id then
    raise exception '다른 매장의 상품은 병합할 수 없습니다.';
  end if;

  if exists (
    select 1
    from public.product_merge_history history
    where history.source_product_id = merge_products.source_product_id
  ) then
    raise exception '이미 병합된 상품입니다.';
  end if;

  if exists (
    select 1
    from public.prep_items source_prep
    join public.prep_items target_prep on target_prep.product_id = target_product_id
    where source_prep.product_id = source_product_id
  ) then
    raise exception '두 상품이 모두 프랩 품목으로 등록되어 있어 병합할 수 없습니다. 프랩 품목을 먼저 정리해 주세요.';
  end if;

  if exists (
    select 1
    from public.prep_item_ingredients source_ingredient
    join public.prep_item_ingredients target_ingredient
      on target_ingredient.prep_item_id = source_ingredient.prep_item_id
     and target_ingredient.ingredient_product_id = target_product_id
    where source_ingredient.ingredient_product_id = source_product_id
  ) then
    raise exception '같은 프랩 레시피에 두 상품이 함께 등록되어 있어 병합할 수 없습니다. 레시피를 먼저 정리해 주세요.';
  end if;

  if exists (
    select 1
    from public.group_order_recipe_ingredients source_ingredient
    join public.group_order_recipe_ingredients target_ingredient
      on target_ingredient.menu_id = source_ingredient.menu_id
     and target_ingredient.product_id = target_product_id
    where source_ingredient.product_id = source_product_id
  ) then
    raise exception '같은 단체주문 레시피에 두 상품이 함께 등록되어 있어 병합할 수 없습니다. 레시피를 먼저 정리해 주세요.';
  end if;

  insert into public.inventory (product_id, store_id)
  values (target_product_id, target_product.store_id), (source_product_id, source_product.store_id)
  on conflict (product_id) do nothing;

  insert into public.product_barcodes (product_id, store_id, barcode)
  select target_product_id, target_product.store_id, target_product.barcode
  where target_product.barcode is not null and target_product.barcode <> ''
  on conflict (store_id, barcode) do update set product_id = excluded.product_id;

  insert into public.product_barcodes (product_id, store_id, barcode)
  select target_product_id, target_product.store_id, source_product.barcode
  where source_product.barcode is not null and source_product.barcode <> ''
  on conflict (store_id, barcode) do update set product_id = excluded.product_id;

  update public.product_barcodes
  set product_id = target_product_id
  where product_id = source_product_id
    and store_id = target_product.store_id;

  select warehouse_qty, store_qty
  into source_warehouse_qty, source_store_qty
  from public.inventory
  where product_id = source_product_id;

  update public.inventory
  set warehouse_qty = warehouse_qty + coalesce(source_warehouse_qty, 0),
      store_qty = store_qty + coalesce(source_store_qty, 0)
  where product_id = target_product_id;

  update public.inventory_logs
  set product_id = target_product_id
  where product_id = source_product_id
    and store_id = target_product.store_id;

  update public.dashboard_receipt_deletions
  set product_id = target_product_id
  where product_id = source_product_id
    and store_id = target_product.store_id;

  delete from public.dashboard_todos source_todo
  using public.dashboard_todos target_todo
  where source_todo.stale_inventory_product_id = source_product_id
    and target_todo.stale_inventory_product_id = target_product_id
    and source_todo.store_id = target_product.store_id
    and target_todo.store_id = target_product.store_id
    and source_todo.task_date = target_todo.task_date;

  update public.dashboard_todos
  set stale_inventory_product_id = target_product_id
  where stale_inventory_product_id = source_product_id
    and store_id = target_product.store_id;

  update public.prep_items
  set product_id = target_product_id
  where product_id = source_product_id
    and store_id = target_product.store_id;

  update public.prep_item_ingredients
  set ingredient_product_id = target_product_id
  where ingredient_product_id = source_product_id
    and store_id = target_product.store_id;

  update public.group_order_recipe_ingredients
  set product_id = target_product_id
  where product_id = source_product_id
    and store_id = target_product.store_id;

  insert into public.confirmed_order_items (
    store_id,
    order_date,
    product_id,
    product_name,
    category,
    supplier_name,
    total_stock,
    minimum_stock,
    required_quantity,
    is_low_stock,
    fresh_order_selected,
    urgent_order_requested,
    urgent_order_quantity,
    order_completed,
    confirmed_by,
    confirmed_at,
    created_at
  )
  select
    source_confirmation.store_id,
    source_confirmation.order_date,
    target_product_id,
    target_product.name,
    target_product.category,
    target_product.supplier_name,
    source_confirmation.total_stock,
    source_confirmation.minimum_stock,
    source_confirmation.required_quantity,
    source_confirmation.is_low_stock,
    source_confirmation.fresh_order_selected,
    source_confirmation.urgent_order_requested,
    source_confirmation.urgent_order_quantity,
    source_confirmation.order_completed,
    source_confirmation.confirmed_by,
    source_confirmation.confirmed_at,
    source_confirmation.created_at
  from public.confirmed_order_items source_confirmation
  where source_confirmation.product_id = source_product_id
    and source_confirmation.store_id = target_product.store_id
  on conflict (store_id, order_date, product_id) do update
  set product_name = target_product.name,
      category = target_product.category,
      supplier_name = coalesce(confirmed_order_items.supplier_name, excluded.supplier_name),
      total_stock = coalesce(confirmed_order_items.total_stock, excluded.total_stock),
      minimum_stock = coalesce(confirmed_order_items.minimum_stock, excluded.minimum_stock),
      required_quantity = coalesce(confirmed_order_items.required_quantity, excluded.required_quantity),
      is_low_stock = confirmed_order_items.is_low_stock or excluded.is_low_stock,
      fresh_order_selected = confirmed_order_items.fresh_order_selected or excluded.fresh_order_selected,
      urgent_order_requested = confirmed_order_items.urgent_order_requested or excluded.urgent_order_requested,
      urgent_order_quantity = case
        when confirmed_order_items.urgent_order_requested or excluded.urgent_order_requested
          then nullif(greatest(coalesce(confirmed_order_items.urgent_order_quantity, 0), coalesce(excluded.urgent_order_quantity, 0)), 0)
        else null
      end,
      order_completed = confirmed_order_items.order_completed or excluded.order_completed,
      confirmed_by = coalesce(confirmed_order_items.confirmed_by, excluded.confirmed_by),
      confirmed_at = greatest(confirmed_order_items.confirmed_at, excluded.confirmed_at),
      created_at = least(confirmed_order_items.created_at, excluded.created_at);

  delete from public.confirmed_order_items
  where product_id = source_product_id
    and store_id = target_product.store_id;

  insert into public.product_merge_history (
    store_id,
    source_product_id,
    target_product_id,
    merged_by
  )
  values (
    target_product.store_id,
    source_product_id,
    target_product_id,
    auth.uid()
  );

  delete from public.inventory
  where product_id = source_product_id;

  update public.products
  set is_active = false,
      barcode = null,
      fresh_order_selected = false,
      fresh_order_selected_at = null,
      urgent_order_requested = false,
      urgent_order_quantity = null,
      order_completed = false
  where id = source_product_id
    and store_id = target_product.store_id;
end;
$$;

notify pgrst, 'reload schema';
