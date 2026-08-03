alter table public.products
  alter column minimum_stock type numeric(12, 4)
  using minimum_stock::numeric;

alter table public.confirmed_order_items
  alter column minimum_stock type numeric(12, 4)
  using minimum_stock::numeric;

notify pgrst, 'reload schema';
