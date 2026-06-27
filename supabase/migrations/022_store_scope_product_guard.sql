create or replace function public.fill_current_store_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.store_id is null then
    new.store_id := public.current_store_id(auth.uid());
  end if;

  if new.store_id is null then
    raise exception '매장 정보가 필요합니다.';
  end if;

  if not public.can_access_store(new.store_id) then
    raise exception '다른 매장의 데이터는 저장할 수 없습니다.';
  end if;

  return new;
end;
$$;

create or replace function public.ensure_product_child_store_scope()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  product_store_id uuid;
begin
  select store_id
  into product_store_id
  from public.products
  where id = new.product_id;

  if product_store_id is null then
    raise exception '상품을 찾을 수 없습니다.';
  end if;

  if new.store_id is null then
    new.store_id := product_store_id;
  end if;

  if new.store_id <> product_store_id then
    raise exception '상품과 매장 정보가 일치하지 않습니다.';
  end if;

  if not public.can_access_store(new.store_id) then
    raise exception '다른 매장의 데이터는 저장할 수 없습니다.';
  end if;

  return new;
end;
$$;

drop trigger if exists ensure_product_barcodes_store_scope on public.product_barcodes;
create trigger ensure_product_barcodes_store_scope
before insert or update on public.product_barcodes
for each row execute function public.ensure_product_child_store_scope();

drop trigger if exists ensure_inventory_store_scope on public.inventory;
create trigger ensure_inventory_store_scope
before insert or update on public.inventory
for each row execute function public.ensure_product_child_store_scope();

drop trigger if exists ensure_inventory_logs_store_scope on public.inventory_logs;
create trigger ensure_inventory_logs_store_scope
before insert or update on public.inventory_logs
for each row execute function public.ensure_product_child_store_scope();

drop policy if exists "Authenticated users can read products" on public.products;
drop policy if exists "Authenticated users can insert products" on public.products;
drop policy if exists "Authenticated users can update products" on public.products;
drop policy if exists "Authenticated users can delete inactive products" on public.products;
drop policy if exists "Users can read products in their store" on public.products;
drop policy if exists "Users can insert products in their store" on public.products;
drop policy if exists "Users can update products in their store" on public.products;
drop policy if exists "Users can delete inactive products in their store" on public.products;
create policy "Users can read products in their store" on public.products for select to authenticated using (public.can_access_store(store_id));
create policy "Users can insert products in their store" on public.products for insert to authenticated with check (public.can_access_store(store_id));
create policy "Users can update products in their store" on public.products for update to authenticated using (public.can_access_store(store_id)) with check (public.can_access_store(store_id));
create policy "Users can delete inactive products in their store" on public.products for delete to authenticated using (public.can_access_store(store_id) and is_active = false);

drop policy if exists "Authenticated users can read inventory" on public.inventory;
drop policy if exists "Authenticated users can insert inventory" on public.inventory;
drop policy if exists "Authenticated users can update inventory" on public.inventory;
drop policy if exists "Users can read inventory in their store" on public.inventory;
drop policy if exists "Users can insert inventory in their store" on public.inventory;
drop policy if exists "Users can update inventory in their store" on public.inventory;
create policy "Users can read inventory in their store" on public.inventory for select to authenticated using (public.can_access_store(store_id));
create policy "Users can insert inventory in their store" on public.inventory for insert to authenticated with check (public.can_access_store(store_id));
create policy "Users can update inventory in their store" on public.inventory for update to authenticated using (public.can_access_store(store_id)) with check (public.can_access_store(store_id) and warehouse_qty >= 0 and store_qty >= 0);

drop policy if exists "Authenticated users can read product barcodes" on public.product_barcodes;
drop policy if exists "Authenticated users can insert product barcodes" on public.product_barcodes;
drop policy if exists "Authenticated users can update product barcodes" on public.product_barcodes;
drop policy if exists "Users can read product barcodes in their store" on public.product_barcodes;
drop policy if exists "Users can insert product barcodes in their store" on public.product_barcodes;
drop policy if exists "Users can update product barcodes in their store" on public.product_barcodes;
create policy "Users can read product barcodes in their store" on public.product_barcodes for select to authenticated using (public.can_access_store(store_id));
create policy "Users can insert product barcodes in their store" on public.product_barcodes for insert to authenticated with check (public.can_access_store(store_id));
create policy "Users can update product barcodes in their store" on public.product_barcodes for update to authenticated using (public.can_access_store(store_id)) with check (public.can_access_store(store_id));

drop policy if exists "Authenticated users can read logs" on public.inventory_logs;
drop policy if exists "Authenticated users can insert own logs" on public.inventory_logs;
drop policy if exists "Users can read logs in their store" on public.inventory_logs;
drop policy if exists "Users can insert own logs in their store" on public.inventory_logs;
create policy "Users can read logs in their store" on public.inventory_logs for select to authenticated using (public.can_access_store(store_id));
create policy "Users can insert own logs in their store" on public.inventory_logs for insert to authenticated with check (public.can_access_store(store_id) and user_id = auth.uid());

notify pgrst, 'reload schema';
