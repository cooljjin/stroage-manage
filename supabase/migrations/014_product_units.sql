alter table public.products
add column if not exists unit_name text;

create table if not exists public.product_units (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  is_active boolean not null default true,
  sort_order integer not null default 1000,
  created_at timestamptz not null default now()
);

insert into public.product_units (name, sort_order)
values
  ('박스', 1),
  ('낱개', 2),
  ('줄', 3),
  ('팩', 4)
on conflict (name) do nothing;

create index if not exists products_unit_name_idx on public.products (unit_name);
create index if not exists product_units_is_active_idx on public.product_units (is_active);
create index if not exists product_units_sort_order_idx on public.product_units (sort_order, name);

alter table public.product_units enable row level security;

drop policy if exists "Authenticated users can read product units" on public.product_units;
create policy "Authenticated users can read product units"
on public.product_units for select
to authenticated
using (true);

drop policy if exists "Authenticated users can insert product units" on public.product_units;
create policy "Authenticated users can insert product units"
on public.product_units for insert
to authenticated
with check (true);

drop policy if exists "Authenticated users can update product units" on public.product_units;
create policy "Authenticated users can update product units"
on public.product_units for update
to authenticated
using (true)
with check (true);

drop policy if exists "Authenticated users can delete inactive product units" on public.product_units;
create policy "Authenticated users can delete inactive product units"
on public.product_units for delete
to authenticated
using (is_active = false);

grant select, insert, update, delete on public.product_units to authenticated;
grant select, insert, update, delete on public.products to authenticated;

notify pgrst, 'reload schema';
