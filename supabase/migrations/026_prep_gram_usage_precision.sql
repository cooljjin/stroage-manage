alter table public.prep_item_ingredients
  alter column quantity_per_unit type numeric(12, 4) using quantity_per_unit::numeric(12, 4);

drop policy if exists "Users can update inventory in their store" on public.inventory;

alter table public.inventory
  alter column warehouse_qty type numeric(12, 4) using warehouse_qty::numeric(12, 4),
  alter column store_qty type numeric(12, 4) using store_qty::numeric(12, 4);

create policy "Users can update inventory in their store" on public.inventory for update to authenticated
using (store_id = public.current_store_id(auth.uid()))
with check (store_id = public.current_store_id(auth.uid()) and warehouse_qty >= 0 and store_qty >= 0);

alter table public.inventory_logs
  alter column previous_quantity type numeric(12, 4) using previous_quantity::numeric(12, 4),
  alter column new_quantity type numeric(12, 4) using new_quantity::numeric(12, 4),
  alter column quantity type numeric(12, 4) using quantity::numeric(12, 4),
  alter column warehouse_qty_before type numeric(12, 4) using warehouse_qty_before::numeric(12, 4),
  alter column store_qty_before type numeric(12, 4) using store_qty_before::numeric(12, 4),
  alter column warehouse_qty_after type numeric(12, 4) using warehouse_qty_after::numeric(12, 4),
  alter column store_qty_after type numeric(12, 4) using store_qty_after::numeric(12, 4);

notify pgrst, 'reload schema';
