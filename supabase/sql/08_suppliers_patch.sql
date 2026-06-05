alter table public.products add column if not exists supplier_name text;

create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.suppliers (name)
values ('쿠팡'), ('쿠팡 프레시')
on conflict (name) do nothing;

create index if not exists products_supplier_name_idx on public.products (supplier_name);
create index if not exists suppliers_is_active_idx on public.suppliers (is_active);

alter table public.suppliers enable row level security;

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

grant select, insert, update, delete on public.suppliers to authenticated;

notify pgrst, 'reload schema';
