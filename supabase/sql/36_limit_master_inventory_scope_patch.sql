drop policy if exists "Users can read products in their store" on public.products;
drop policy if exists "Users can insert products in their store" on public.products;
drop policy if exists "Users can update products in their store" on public.products;
drop policy if exists "Users can delete inactive products in their store" on public.products;
create policy "Users can read products in their store" on public.products for select to authenticated
using (store_id = public.current_store_id(auth.uid()));
create policy "Users can insert products in their store" on public.products for insert to authenticated
with check (store_id = public.current_store_id(auth.uid()));
create policy "Users can update products in their store" on public.products for update to authenticated
using (store_id = public.current_store_id(auth.uid()))
with check (store_id = public.current_store_id(auth.uid()));
create policy "Users can delete inactive products in their store" on public.products for delete to authenticated
using (store_id = public.current_store_id(auth.uid()) and is_active = false);

drop policy if exists "Users can read inventory in their store" on public.inventory;
drop policy if exists "Users can insert inventory in their store" on public.inventory;
drop policy if exists "Users can update inventory in their store" on public.inventory;
create policy "Users can read inventory in their store" on public.inventory for select to authenticated
using (store_id = public.current_store_id(auth.uid()));
create policy "Users can insert inventory in their store" on public.inventory for insert to authenticated
with check (store_id = public.current_store_id(auth.uid()));
create policy "Users can update inventory in their store" on public.inventory for update to authenticated
using (store_id = public.current_store_id(auth.uid()))
with check (store_id = public.current_store_id(auth.uid()) and warehouse_qty >= 0 and store_qty >= 0);

drop policy if exists "Users can read product barcodes in their store" on public.product_barcodes;
drop policy if exists "Users can insert product barcodes in their store" on public.product_barcodes;
drop policy if exists "Users can update product barcodes in their store" on public.product_barcodes;
create policy "Users can read product barcodes in their store" on public.product_barcodes for select to authenticated
using (store_id = public.current_store_id(auth.uid()));
create policy "Users can insert product barcodes in their store" on public.product_barcodes for insert to authenticated
with check (store_id = public.current_store_id(auth.uid()));
create policy "Users can update product barcodes in their store" on public.product_barcodes for update to authenticated
using (store_id = public.current_store_id(auth.uid()))
with check (store_id = public.current_store_id(auth.uid()));

drop policy if exists "Users can read logs in their store" on public.inventory_logs;
drop policy if exists "Users can insert own logs in their store" on public.inventory_logs;
create policy "Users can read logs in their store" on public.inventory_logs for select to authenticated
using (store_id = public.current_store_id(auth.uid()));
create policy "Users can insert own logs in their store" on public.inventory_logs for insert to authenticated
with check (store_id = public.current_store_id(auth.uid()) and user_id = auth.uid());
