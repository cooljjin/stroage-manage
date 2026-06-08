alter table public.products add column if not exists urgent_order_requested boolean not null default false;
alter table public.products add column if not exists urgent_order_quantity integer;

alter table public.products drop constraint if exists products_urgent_order_quantity_check;
alter table public.products add constraint products_urgent_order_quantity_check
check (urgent_order_quantity is null or urgent_order_quantity > 0);

notify pgrst, 'reload schema';
