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

insert into public.inventory (product_id)
select products.id
from public.products
where not exists (
  select 1
  from public.inventory
  where inventory.product_id = products.id
);

create or replace function public.touch_inventory_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists inventory_touch_updated_at on public.inventory;
create trigger inventory_touch_updated_at
before update on public.inventory
for each row
execute function public.touch_inventory_updated_at();

alter table public.products enable row level security;
alter table public.inventory enable row level security;
alter table public.inventory_logs enable row level security;

drop policy if exists "Authenticated users can read products" on public.products;
create policy "Authenticated users can read products"
on public.products for select
to authenticated
using (true);

drop policy if exists "Authenticated users can insert products" on public.products;
create policy "Authenticated users can insert products"
on public.products for insert
to authenticated
with check (true);

drop policy if exists "Authenticated users can update products" on public.products;
create policy "Authenticated users can update products"
on public.products for update
to authenticated
using (true)
with check (true);

drop policy if exists "Authenticated users can read inventory" on public.inventory;
create policy "Authenticated users can read inventory"
on public.inventory for select
to authenticated
using (true);

drop policy if exists "Authenticated users can insert inventory" on public.inventory;
create policy "Authenticated users can insert inventory"
on public.inventory for insert
to authenticated
with check (true);

drop policy if exists "Authenticated users can update inventory" on public.inventory;
create policy "Authenticated users can update inventory"
on public.inventory for update
to authenticated
using (true)
with check (warehouse_qty >= 0 and store_qty >= 0);

drop policy if exists "Authenticated users can read logs" on public.inventory_logs;
create policy "Authenticated users can read logs"
on public.inventory_logs for select
to authenticated
using (true);

drop policy if exists "Authenticated users can insert own logs" on public.inventory_logs;
create policy "Authenticated users can insert own logs"
on public.inventory_logs for insert
to authenticated
with check (user_id = auth.uid());

grant usage on schema public to authenticated;
grant select, insert, update on public.products to authenticated;
grant select, insert, update on public.inventory to authenticated;
grant select, insert on public.inventory_logs to authenticated;

notify pgrst, 'reload schema';
