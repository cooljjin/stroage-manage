alter table public.products drop constraint if exists products_category_check;
alter table public.products add column if not exists is_active boolean not null default true;
update public.products set is_active = true where is_active is null;

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  is_active boolean not null default true,
  sort_order integer not null default 1000,
  created_at timestamptz not null default now()
);

alter table public.categories add column if not exists sort_order integer not null default 1000;

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

create index if not exists products_is_active_idx on public.products (is_active);
create index if not exists categories_is_active_idx on public.categories (is_active);
create index if not exists categories_sort_order_idx on public.categories (sort_order, name);

alter table public.products enable row level security;
alter table public.categories enable row level security;

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

grant select, insert, update, delete on public.products to authenticated;
grant select, insert, update, delete on public.categories to authenticated;

notify pgrst, 'reload schema';
