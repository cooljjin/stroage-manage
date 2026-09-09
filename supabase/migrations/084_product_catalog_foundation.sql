-- V1 catalog foundation. Existing products and inventory remain untouched.

create or replace function public.is_valid_gtin14(value text)
returns boolean
language sql
immutable
strict
set search_path = pg_catalog
as $$
  select value ~ '^[0-9]{14}$'
    and substring(value from 14 for 1)::integer = (
      10 - (
        select coalesce(sum(
          substring(value from positions.i for 1)::integer
          * case when positions.i % 2 = 1 then 3 else 1 end
        ), 0) % 10
        from generate_series(1, 13) as positions(i)
      )
    ) % 10
$$;

create table public.product_catalog (
  id uuid primary key default gen_random_uuid(),
  gtin text not null unique,
  canonical_name text not null check (char_length(trim(canonical_name)) > 0),
  brand text,
  manufacturer text,
  size numeric,
  unit text,
  quantity_text text,
  image_url text,
  source text not null check (char_length(trim(source)) > 0),
  source_url text,
  license text,
  image_license text,
  confidence numeric check (confidence between 0 and 1 or confidence is null),
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_catalog_gtin_check check (public.is_valid_gtin14(gtin))
);

create index product_catalog_source_idx on public.product_catalog (source);
create index product_catalog_updated_at_idx on public.product_catalog (updated_at desc);

alter table public.products
  add column if not exists catalog_id uuid references public.product_catalog(id) on delete set null,
  add column if not exists brand text,
  add column if not exists image_url text,
  add column if not exists catalog_confirmed_at timestamptz;

create index products_catalog_id_idx on public.products (catalog_id);

alter table public.product_catalog enable row level security;
revoke all on public.product_catalog from public, anon, authenticated;
grant select on public.product_catalog to authenticated;
grant select on public.product_catalog to service_role;

create policy "Authenticated users can read product catalog"
on public.product_catalog for select to authenticated
using (auth.uid() is not null);

revoke all on function public.is_valid_gtin14(text) from public, anon, authenticated, service_role;

notify pgrst, 'reload schema';
