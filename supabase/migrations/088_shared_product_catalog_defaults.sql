-- Share reusable product defaults across stores without exposing store provenance.

alter table public.product_catalog
  add column if not exists category text,
  add column if not exists storage_type text,
  add column if not exists supplier_name text,
  add column if not exists product_url text;

alter table public.product_catalog
  add constraint product_catalog_category_length_check
    check (category is null or char_length(category) <= 100),
  add constraint product_catalog_storage_type_length_check
    check (storage_type is null or char_length(storage_type) <= 50),
  add constraint product_catalog_supplier_name_length_check
    check (supplier_name is null or char_length(supplier_name) <= 200),
  add constraint product_catalog_product_url_length_check
    check (product_url is null or (char_length(product_url) <= 2048 and product_url ~ '^https://'));

create table public.shared_catalog_lookup_quota (
  user_id uuid not null,
  lookup_day date not null default (clock_timestamp() at time zone 'utc')::date,
  consumed integer not null default 0 check (consumed >= 0),
  primary key (user_id, lookup_day)
);

alter table public.shared_catalog_lookup_quota enable row level security;
revoke all on public.shared_catalog_lookup_quota from public, anon, authenticated;

create or replace function public.sanitize_shared_catalog_url(value text)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select case
    when value is null or char_length(trim(value)) > 2048 or trim(value) !~ '^https://' then null
    else regexp_replace(trim(value), '[?#].*$', '')
  end
$$;

create or replace function public.normalize_shared_catalog_gtin(value text)
returns text
language plpgsql
immutable
strict
set search_path = public, pg_catalog
as $$
declare
  digits text := trim(value);
  normalized text;
begin
  if digits !~ '^[0-9]+$' or char_length(digits) not in (8, 12, 13, 14) then
    return null;
  end if;
  normalized := lpad(digits, 14, '0');
  return case when public.is_valid_gtin14(normalized) then normalized else null end;
end;
$$;

create or replace function public.create_product_with_inventory(
  product_store_id uuid,
  product_data jsonb
)
returns public.products
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  target_gtin text;
  catalog_data jsonb;
  product_row public.products%rowtype;
  safe_product_url text;
  may_publish boolean := false;
begin
  if actor_id is null then
    raise exception '로그인이 필요합니다.';
  end if;

  target_gtin := public.normalize_shared_catalog_gtin(product_data->>'barcode');
  select exists (
    select 1 from public.profiles profile
    where profile.id = actor_id
      and profile.store_id = product_store_id
      and profile.role = 'store_admin'
      and profile.deletion_requested_at is null
  ) into may_publish;
  if target_gtin is null or not may_publish then
    return public._catalog_product_write(actor_id, product_store_id, null, product_data, null, null, null);
  end if;

  safe_product_url := public.sanitize_shared_catalog_url(product_data->>'product_url');

  catalog_data := jsonb_build_object(
    'gtin', target_gtin,
    'canonical_name', left(trim(product_data->>'name'), 200),
    'brand', null,
    'manufacturer', null,
    'size', null,
    'unit', null,
    'quantity_text', null,
    'image_url', null,
    'source', 'stockly_catalog',
    'source_url', null,
    'license', null,
    'image_license', null,
    'confidence', null
  );

  product_row := public._catalog_product_write(
    actor_id,
    product_store_id,
    null,
    product_data,
    catalog_data,
    null,
    null
  );

  update public.product_catalog catalog
  set category = coalesce(catalog.category, nullif(left(trim(product_data->>'category'), 100), '')),
      storage_type = coalesce(catalog.storage_type, nullif(left(trim(product_data->>'storage_type'), 50), '')),
      supplier_name = coalesce(catalog.supplier_name, nullif(left(trim(product_data->>'supplier_name'), 200), '')),
      product_url = coalesce(catalog.product_url, safe_product_url),
      updated_at = clock_timestamp()
  where catalog.id = product_row.catalog_id;

  return product_row;
end;
$$;

create or replace function public.restore_product_with_inventory(
  target_product_id uuid,
  product_data jsonb
)
returns public.products
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  target_store_id uuid;
  target_gtin text;
  catalog_data jsonb;
  product_row public.products%rowtype;
  safe_product_url text;
  may_publish boolean := false;
begin
  if actor_id is null then
    raise exception '로그인이 필요합니다.';
  end if;

  select product.store_id into target_store_id
  from public.products product
  where product.id = target_product_id;

  target_gtin := public.normalize_shared_catalog_gtin(product_data->>'barcode');
  select exists (
    select 1 from public.profiles profile
    where profile.id = actor_id
      and profile.store_id = target_store_id
      and profile.role = 'store_admin'
      and profile.deletion_requested_at is null
  ) into may_publish;
  if target_gtin is null or not may_publish then
    return public._catalog_product_write(actor_id, target_store_id, target_product_id, product_data, null, null, null);
  end if;

  safe_product_url := public.sanitize_shared_catalog_url(product_data->>'product_url');

  catalog_data := jsonb_build_object(
    'gtin', target_gtin,
    'canonical_name', left(trim(product_data->>'name'), 200),
    'brand', null,
    'manufacturer', null,
    'size', null,
    'unit', null,
    'quantity_text', null,
    'image_url', null,
    'source', 'stockly_catalog',
    'source_url', null,
    'license', null,
    'image_license', null,
    'confidence', null
  );

  product_row := public._catalog_product_write(
    actor_id,
    target_store_id,
    target_product_id,
    product_data,
    catalog_data,
    null,
    null
  );

  update public.product_catalog catalog
  set category = coalesce(catalog.category, nullif(left(trim(product_data->>'category'), 100), '')),
      storage_type = coalesce(catalog.storage_type, nullif(left(trim(product_data->>'storage_type'), 50), '')),
      supplier_name = coalesce(catalog.supplier_name, nullif(left(trim(product_data->>'supplier_name'), 200), '')),
      product_url = coalesce(catalog.product_url, safe_product_url),
      updated_at = clock_timestamp()
  where catalog.id = product_row.catalog_id;

  return product_row;
end;
$$;

create or replace function public.lookup_shared_product_catalog(target_gtin text)
returns table (
  gtin text,
  canonical_name text,
  brand text,
  manufacturer text,
  size numeric,
  unit text,
  quantity_text text,
  image_url text,
  source text,
  source_url text,
  license text,
  image_license text,
  confidence numeric,
  category text,
  storage_type text,
  supplier_name text,
  product_url text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  lookup_count integer;
begin
  if auth.uid() is null or not exists (
    select 1
    from public.profiles profile
    join public.stores store_row on store_row.id = profile.store_id
    where profile.id = auth.uid()
      and profile.role <> 'master'
      and profile.deletion_requested_at is null
      and store_row.status = 'active'
  ) then
    return;
  end if;

  if target_gtin is null or not public.is_valid_gtin14(target_gtin) then
    return;
  end if;

  insert into public.shared_catalog_lookup_quota (user_id, consumed)
  values (auth.uid(), 1)
  on conflict (user_id, lookup_day) do update
    set consumed = public.shared_catalog_lookup_quota.consumed + 1
  returning consumed into lookup_count;
  if lookup_count > 100 then
    return;
  end if;

  return query
  select catalog.gtin,
         catalog.canonical_name,
         catalog.brand,
         catalog.manufacturer,
         catalog.size,
         catalog.unit,
         catalog.quantity_text,
         catalog.image_url,
         'catalog'::text,
         null::text,
         catalog.license,
         catalog.image_license,
         catalog.confidence,
         catalog.category,
         catalog.storage_type,
         catalog.supplier_name,
         catalog.product_url
  from public.product_catalog catalog
  where catalog.gtin = target_gtin;
end;
$$;

drop policy if exists "Authenticated users can read product catalog" on public.product_catalog;
revoke all on public.product_catalog from authenticated;
grant select on public.product_catalog to service_role;

revoke all on function public.normalize_shared_catalog_gtin(text) from public, anon, authenticated, service_role;
revoke all on function public.sanitize_shared_catalog_url(text) from public, anon, authenticated, service_role;
revoke all on function public.lookup_shared_product_catalog(text) from public, anon, service_role;
grant execute on function public.lookup_shared_product_catalog(text) to authenticated;

notify pgrst, 'reload schema';
