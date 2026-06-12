create extension if not exists "pgcrypto";

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  barcode text unique,
  name text not null,
  category text not null,
  supplier_name text,
  storage_type text,
  product_url text,
  order_completed boolean not null default false,
  urgent_order_requested boolean not null default false,
  urgent_order_quantity integer check (urgent_order_quantity is null or urgent_order_quantity > 0),
  fresh_order_selected boolean not null default false,
  status_enabled boolean not null default false,
  stock_status text check (stock_status in ('충분', '절반 이하', '발주 필요') or stock_status is null),
  minimum_stock integer not null default 0 check (minimum_stock >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.products drop constraint if exists products_category_check;
alter table public.products add column if not exists is_active boolean not null default true;
alter table public.products add column if not exists supplier_name text;
alter table public.products add column if not exists storage_type text;
alter table public.products add column if not exists product_url text;
alter table public.products add column if not exists order_completed boolean not null default false;
alter table public.products add column if not exists urgent_order_requested boolean not null default false;
alter table public.products add column if not exists urgent_order_quantity integer;
alter table public.products add column if not exists fresh_order_selected boolean not null default false;
alter table public.products add column if not exists status_enabled boolean not null default false;
alter table public.products add column if not exists stock_status text;
alter table public.products drop constraint if exists products_urgent_order_quantity_check;
alter table public.products add constraint products_urgent_order_quantity_check
check (urgent_order_quantity is null or urgent_order_quantity > 0);
alter table public.products drop constraint if exists products_stock_status_check;
alter table public.products add constraint products_stock_status_check
check (stock_status in ('충분', '절반 이하', '발주 필요') or stock_status is null);
alter table public.products drop constraint if exists products_storage_type_check;

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  is_active boolean not null default true,
  sort_order integer not null default 1000,
  created_at timestamptz not null default now()
);

alter table public.categories add column if not exists sort_order integer not null default 1000;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text not null,
  is_admin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.product_barcodes (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  barcode text not null unique,
  created_at timestamptz not null default now()
);

insert into public.suppliers (name)
values ('쿠팡'), ('쿠팡 프레시')
on conflict (name) do nothing;

create or replace function public.is_admin(user_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as 'select exists (select 1 from public.profiles where id = user_id and is_admin = true)';

insert into public.profiles (id, email, display_name, is_admin)
values ('dbe00a19-300b-4677-9339-225e52f2909b', 'jich980611@gmail.com', 'jinkim', true)
on conflict (id) do update
set email = excluded.email,
    display_name = coalesce(nullif(public.profiles.display_name, ''''), excluded.display_name),
    is_admin = true,
    updated_at = now();

insert into public.categories (name)
values ('원두'), ('우유'), ('시럽'), ('베이커리'), ('아이스크림'), ('소모품'), ('음료'), ('기타')
on conflict (name) do nothing;

update public.categories
set sort_order = case name
  when '원두' then 1
  when '우유' then 2
  when '시럽' then 3
  when '베이커리' then 4
  when '아이스크림' then 5
  when '소모품' then 6
  when '음료' then 7
  when '기타' then 8
  else sort_order
end;

create table if not exists public.inventory (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null unique references public.products(id) on delete cascade,
  warehouse_qty numeric(12, 2) not null default 0 check (warehouse_qty >= 0),
  store_qty numeric(12, 2) not null default 0 check (store_qty >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.inventory_logs (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete restrict,
  action text not null check (action in ('입고', '출고', '이동', '조정')),
  source_location text check (source_location in ('창고', '매장') or source_location is null),
  destination_location text check (destination_location in ('창고', '매장') or destination_location is null),
  previous_quantity numeric(12, 2),
  new_quantity numeric(12, 2),
  quantity numeric(12, 2) check (quantity is null or quantity >= 0),
  note text,
  created_at timestamptz not null default now()
);

create index if not exists products_name_idx on public.products using gin (to_tsvector('simple', name));
create index if not exists products_barcode_idx on public.products (barcode);
create index if not exists products_supplier_name_idx on public.products (supplier_name);
create index if not exists products_is_active_idx on public.products (is_active);
create index if not exists products_fresh_order_selected_idx on public.products (fresh_order_selected) where fresh_order_selected = true;
create index if not exists product_barcodes_product_id_idx on public.product_barcodes (product_id);
create index if not exists product_barcodes_barcode_idx on public.product_barcodes (barcode);
create index if not exists categories_is_active_idx on public.categories (is_active);
create index if not exists categories_sort_order_idx on public.categories (sort_order, name);
create index if not exists suppliers_is_active_idx on public.suppliers (is_active);
create index if not exists inventory_product_id_idx on public.inventory (product_id);
create index if not exists inventory_logs_created_at_idx on public.inventory_logs (created_at desc);
create index if not exists inventory_logs_product_id_idx on public.inventory_logs (product_id);

insert into public.inventory (product_id)
select products.id
from public.products
where not exists (
  select 1
  from public.inventory
  where inventory.product_id = products.id
);
