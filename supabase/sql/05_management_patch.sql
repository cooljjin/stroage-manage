alter table public.products drop constraint if exists products_category_check;
alter table public.products add column if not exists is_active boolean not null default true;
update public.products set is_active = true where is_active is null;

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.categories (name)
values ('원두'), ('우유'), ('시럽'), ('베이커리'), ('아이스크림'), ('소모품'), ('음료'), ('기타')
on conflict (name) do nothing;

create index if not exists products_is_active_idx on public.products (is_active);
create index if not exists categories_is_active_idx on public.categories (is_active);

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
