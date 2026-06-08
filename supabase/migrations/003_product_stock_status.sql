alter table public.products add column if not exists status_enabled boolean not null default false;
alter table public.products add column if not exists stock_status text;

alter table public.products drop constraint if exists products_stock_status_check;
alter table public.products add constraint products_stock_status_check
check (stock_status in ('충분', '절반 이하', '발주 필요') or stock_status is null);

notify pgrst, 'reload schema';
