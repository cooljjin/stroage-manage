alter table public.inventory
  alter column warehouse_qty type numeric(12, 2) using warehouse_qty::numeric(12, 2),
  alter column store_qty type numeric(12, 2) using store_qty::numeric(12, 2);

alter table public.inventory_logs
  alter column previous_quantity type numeric(12, 2) using previous_quantity::numeric(12, 2),
  alter column new_quantity type numeric(12, 2) using new_quantity::numeric(12, 2),
  alter column quantity type numeric(12, 2) using quantity::numeric(12, 2);

notify pgrst, 'reload schema';
