alter table public.confirmed_order_items
add column if not exists confirmation_note text;

notify pgrst, 'reload schema';
