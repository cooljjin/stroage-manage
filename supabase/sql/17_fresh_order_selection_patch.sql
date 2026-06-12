alter table public.products
add column if not exists fresh_order_selected boolean not null default false;

create index if not exists products_fresh_order_selected_idx
on public.products (fresh_order_selected)
where fresh_order_selected = true;

notify pgrst, 'reload schema';
