create extension if not exists "pgcrypto";

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  barcode text unique,
  name text not null,
  category text not null check (
    category in ('원두', '우유', '시럽', '베이커리', '아이스크림', '소모품', '음료', '기타')
  ),
  minimum_stock integer not null default 0 check (minimum_stock >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.inventory (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null unique references public.products(id) on delete cascade,
  warehouse_qty integer not null default 0 check (warehouse_qty >= 0),
  store_qty integer not null default 0 check (store_qty >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.inventory_logs (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete restrict,
  action text not null check (action in ('입고', '출고', '이동', '조정')),
  source_location text check (source_location in ('창고', '매장') or source_location is null),
  destination_location text check (destination_location in ('창고', '매장') or destination_location is null),
  previous_quantity integer,
  new_quantity integer,
  quantity integer check (quantity is null or quantity >= 0),
  note text,
  created_at timestamptz not null default now()
);

create index if not exists products_name_idx on public.products using gin (to_tsvector('simple', name));
create index if not exists products_barcode_idx on public.products (barcode);
create index if not exists inventory_product_id_idx on public.inventory (product_id);
create index if not exists inventory_logs_created_at_idx on public.inventory_logs (created_at desc);
create index if not exists inventory_logs_product_id_idx on public.inventory_logs (product_id);
