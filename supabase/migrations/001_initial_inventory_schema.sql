create extension if not exists "pgcrypto";

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  barcode text unique,
  name text not null,
  category text not null,
  supplier_name text,
  storage_type text check (storage_type in ('냉장', '냉동', '상온') or storage_type is null),
  product_url text,
  order_completed boolean not null default false,
  urgent_order_requested boolean not null default false,
  urgent_order_quantity integer check (urgent_order_quantity is null or urgent_order_quantity > 0),
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
alter table public.products drop constraint if exists products_urgent_order_quantity_check;
alter table public.products add constraint products_urgent_order_quantity_check
check (urgent_order_quantity is null or urgent_order_quantity > 0);
alter table public.products drop constraint if exists products_storage_type_check;
alter table public.products add constraint products_storage_type_check
check (storage_type in ('냉장', '냉동', '상온') or storage_type is null);

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
alter table public.categories enable row level security;
alter table public.profiles enable row level security;
alter table public.suppliers enable row level security;
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

drop policy if exists "Authenticated users can delete inactive products" on public.products;
create policy "Authenticated users can delete inactive products"
on public.products for delete
to authenticated
using (is_active = false);

drop policy if exists "Authenticated users can read categories" on public.categories;
create policy "Authenticated users can read categories"
on public.categories for select
to authenticated
using (true);

drop policy if exists "Authenticated users can insert categories" on public.categories;
create policy "Authenticated users can insert categories"
on public.categories for insert
to authenticated
with check (true);

drop policy if exists "Authenticated users can update categories" on public.categories;
create policy "Authenticated users can update categories"
on public.categories for update
to authenticated
using (true)
with check (true);

drop policy if exists "Authenticated users can delete inactive categories" on public.categories;
create policy "Authenticated users can delete inactive categories"
on public.categories for delete
to authenticated
using (is_active = false);

drop policy if exists "Authenticated users can read suppliers" on public.suppliers;
create policy "Authenticated users can read suppliers"
on public.suppliers for select
to authenticated
using (true);

drop policy if exists "Authenticated users can insert suppliers" on public.suppliers;
create policy "Authenticated users can insert suppliers"
on public.suppliers for insert
to authenticated
with check (true);

drop policy if exists "Authenticated users can update suppliers" on public.suppliers;
create policy "Authenticated users can update suppliers"
on public.suppliers for update
to authenticated
using (true)
with check (true);

drop policy if exists "Authenticated users can delete inactive suppliers" on public.suppliers;
create policy "Authenticated users can delete inactive suppliers"
on public.suppliers for delete
to authenticated
using (is_active = false);

drop policy if exists "Authenticated users can read profiles" on public.profiles;
create policy "Authenticated users can read profiles"
on public.profiles for select
to authenticated
using (true);

drop policy if exists "Users can insert own profile" on public.profiles;
create policy "Users can insert own profile"
on public.profiles for insert
to authenticated
with check (id = auth.uid());

drop policy if exists "Admins can update profiles" on public.profiles;
create policy "Admins can update profiles"
on public.profiles for update
to authenticated
using (public.is_admin(auth.uid()))
with check (public.is_admin(auth.uid()));

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
grant select, insert, update, delete on public.products to authenticated;
grant select, insert, update, delete on public.categories to authenticated;
grant select, insert, update, delete on public.suppliers to authenticated;
grant select, insert, update on public.profiles to authenticated;
grant select, insert, update on public.inventory to authenticated;
grant select, insert on public.inventory_logs to authenticated;
grant execute on function public.is_admin(uuid) to authenticated;

notify pgrst, 'reload schema';
