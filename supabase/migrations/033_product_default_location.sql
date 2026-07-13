alter table public.products
add column if not exists default_location text not null default '창고';

alter table public.products drop constraint if exists products_default_location_check;
alter table public.products add constraint products_default_location_check
check (default_location in ('창고', '매장'));

