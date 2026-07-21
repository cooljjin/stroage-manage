alter table public.confirmed_order_items
add column if not exists required_quantity numeric(12, 2);

notify pgrst, 'reload schema';
