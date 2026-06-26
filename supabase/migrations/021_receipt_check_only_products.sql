alter table public.products
add column if not exists receipt_check_only boolean not null default false;

create index if not exists products_receipt_check_only_idx
on public.products (receipt_check_only)
where receipt_check_only = true;

update public.products
set minimum_stock = 0,
    status_enabled = false,
    stock_status = null
where receipt_check_only = true;

notify pgrst, 'reload schema';
