-- Share reusable defaults for supported scanned one-dimensional barcodes.
-- Keep the external product_catalog GTIN contract unchanged.

alter table public.products
  add column if not exists barcode_format text;

alter table public.products
  add constraint products_barcode_format_check
  check (barcode_format is null or barcode_format in (
    'EAN_13', 'EAN_8', 'UPC_A', 'CODE_128', 'CODE_39', 'CODE_93', 'ITF', 'CODABAR'
  ));

create table public.shared_product_defaults (
  id uuid primary key default gen_random_uuid(),
  identity_format text not null check (identity_format in ('GTIN', 'CODE_128', 'CODE_39', 'CODE_93', 'ITF', 'CODABAR')),
  identity_value text not null check (char_length(identity_value) between 1 and 128),
  canonical_name text not null check (char_length(trim(canonical_name)) between 1 and 200),
  category text check (category is null or char_length(category) <= 100),
  storage_type text check (storage_type is null or char_length(storage_type) <= 50),
  supplier_name text check (supplier_name is null or char_length(supplier_name) <= 200),
  product_url text check (product_url is null or (char_length(product_url) <= 2048 and product_url ~ '^https://')),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (identity_format, identity_value)
);

alter table public.shared_product_defaults enable row level security;
revoke all on public.shared_product_defaults from public, anon, authenticated;
grant select on public.shared_product_defaults to service_role;

create or replace function public.normalize_shared_barcode_identity(value text, barcode_format text)
returns table (identity_format text, identity_value text)
language plpgsql
immutable
set search_path = public, pg_catalog
as $$
declare
  trimmed_value text := trim(value);
  normalized_gtin text;
  normalized_format text := barcode_format;
begin
  if value is null or trimmed_value = '' or char_length(value) > 128 or value ~ '[[:cntrl:]]' then
    return;
  end if;

  if normalized_format is null then
    normalized_gtin := public.normalize_shared_catalog_gtin(trimmed_value);
    if normalized_gtin is null then return; end if;
    return query select 'GTIN'::text, normalized_gtin;
    return;
  end if;

  if normalized_format in ('EAN_13', 'EAN_8', 'UPC_A', 'GTIN14') then
    normalized_gtin := public.normalize_shared_catalog_gtin(trimmed_value);
    if normalized_gtin is null then return; end if;
    if normalized_format = 'EAN_13' and char_length(trimmed_value) <> 13 then return; end if;
    if normalized_format = 'EAN_8' and char_length(trimmed_value) <> 8 then return; end if;
    if normalized_format = 'UPC_A' and char_length(trimmed_value) <> 12 then return; end if;
    if normalized_format = 'GTIN14' and char_length(trimmed_value) <> 14 then return; end if;
    return query select 'GTIN'::text, normalized_gtin;
    return;
  end if;

  if normalized_format = 'ITF' then
    if value !~ '^[0-9]+$' or char_length(value) % 2 <> 0 then return; end if;
  elsif normalized_format = 'CODABAR' then
    if value !~ '^[0-9A-Da-d\-$:/.+]+$' then return; end if;
  elsif normalized_format in ('CODE_128', 'CODE_39', 'CODE_93') then
    if value collate "C" !~ '^[ -~]+$' then return; end if;
  else
    return;
  end if;

  return query select normalized_format, value;
end;
$$;

create or replace function public.publish_shared_product_defaults(
  actor_id uuid,
  target_store_id uuid,
  target_product_id uuid,
  product_data jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized record;
  safe_product_url text;
  selected_format text := nullif(trim(product_data->>'barcode_format'), '');
begin
  if actor_id is null or target_store_id is null or target_product_id is null
    or product_data is null or jsonb_typeof(product_data) <> 'object' then
    return;
  end if;

  select * into normalized
  from public.normalize_shared_barcode_identity(product_data->>'barcode', selected_format);
  if normalized.identity_format is null then return; end if;

  if selected_format is not null then
    update public.products
    set barcode_format = selected_format,
        barcode = case
          when selected_format in ('CODE_128', 'CODE_39', 'CODE_93', 'ITF', 'CODABAR')
            then product_data->>'barcode'
          else barcode
        end
    where id = target_product_id and store_id = target_store_id;
  end if;

  if not exists (
    select 1
    from public.profiles profile
    join public.stores store_row on store_row.id = profile.store_id
    where profile.id = actor_id
      and profile.store_id = target_store_id
      and profile.role = 'store_admin'
      and profile.deletion_requested_at is null
      and store_row.status = 'active'
  ) then
    return;
  end if;

  safe_product_url := public.sanitize_shared_catalog_url(product_data->>'product_url');
  begin
    insert into public.shared_product_defaults (
      identity_format, identity_value, canonical_name, category,
      storage_type, supplier_name, product_url
    ) values (
      normalized.identity_format,
      normalized.identity_value,
      left(trim(product_data->>'name'), 200),
      nullif(left(trim(product_data->>'category'), 100), ''),
      nullif(left(trim(product_data->>'storage_type'), 50), ''),
      nullif(left(trim(product_data->>'supplier_name'), 200), ''),
      safe_product_url
    ) on conflict (identity_format, identity_value) do nothing;
  exception when others then
    -- Shared enrichment must never roll back a valid tenant-local product save.
    null;
  end;
end;
$$;

-- Backfill only already validated GTIN catalog records. Historical non-GTIN
-- products have no trusted symbology and are intentionally not inferred.
insert into public.shared_product_defaults (
  identity_format, identity_value, canonical_name, category,
  storage_type, supplier_name, product_url, created_at, updated_at
)
select 'GTIN', catalog.gtin, catalog.canonical_name, catalog.category,
       catalog.storage_type, catalog.supplier_name, catalog.product_url,
       catalog.created_at, catalog.updated_at
from public.product_catalog catalog
on conflict (identity_format, identity_value) do nothing;

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
  write_data jsonb := product_data;
  product_row public.products%rowtype;
  may_publish boolean := false;
begin
  if actor_id is null then raise exception '로그인이 필요합니다.'; end if;

  target_gtin := case
    when nullif(product_data->>'barcode_format', '') is null
      or product_data->>'barcode_format' in ('EAN_13', 'EAN_8', 'UPC_A')
    then public.normalize_shared_catalog_gtin(product_data->>'barcode')
    else null
  end;
  select exists (
    select 1 from public.profiles profile
    where profile.id = actor_id
      and profile.store_id = product_store_id
      and profile.role = 'store_admin'
      and profile.deletion_requested_at is null
  ) into may_publish;

  if target_gtin is not null and may_publish then
    catalog_data := jsonb_build_object(
      'gtin', target_gtin,
      'canonical_name', left(trim(product_data->>'name'), 200),
      'brand', null, 'manufacturer', null, 'size', null, 'unit', null,
      'quantity_text', null, 'image_url', null, 'source', 'stockly_catalog',
      'source_url', null, 'license', null, 'image_license', null, 'confidence', null,
      'category', nullif(left(trim(product_data->>'category'), 100), ''),
      'storage_type', nullif(left(trim(product_data->>'storage_type'), 100), ''),
      'supplier_name', nullif(left(trim(product_data->>'supplier_name'), 200), ''),
      'product_url', public.sanitize_shared_catalog_url(product_data->>'product_url')
    );
  end if;

  if product_data->>'barcode_format' in ('CODE_128', 'CODE_39', 'CODE_93', 'ITF', 'CODABAR')
    and exists (select 1 from public.normalize_shared_barcode_identity(product_data->>'barcode', product_data->>'barcode_format')) then
    write_data := jsonb_set(product_data, '{barcode}', to_jsonb('__stockly_pending__' || gen_random_uuid()::text));
  end if;

  product_row := public._catalog_product_write(
    actor_id, product_store_id, null, write_data, catalog_data, null, null
  );
  if product_row.catalog_id is not null then
    update public.product_catalog catalog
    set category = coalesce(catalog.category, nullif(left(trim(product_data->>'category'), 100), '')),
        storage_type = coalesce(catalog.storage_type, nullif(left(trim(product_data->>'storage_type'), 50), '')),
        supplier_name = coalesce(catalog.supplier_name, nullif(left(trim(product_data->>'supplier_name'), 200), '')),
        product_url = coalesce(catalog.product_url, public.sanitize_shared_catalog_url(product_data->>'product_url')),
        updated_at = clock_timestamp()
    where catalog.id = product_row.catalog_id;
  end if;
  perform public.publish_shared_product_defaults(actor_id, product_store_id, product_row.id, product_data);
  select * into product_row from public.products where id = product_row.id;
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
  write_data jsonb := product_data;
  product_row public.products%rowtype;
  may_publish boolean := false;
begin
  if actor_id is null then raise exception '로그인이 필요합니다.'; end if;
  select store_id into target_store_id from public.products where id = target_product_id;

  target_gtin := case
    when nullif(product_data->>'barcode_format', '') is null
      or product_data->>'barcode_format' in ('EAN_13', 'EAN_8', 'UPC_A')
    then public.normalize_shared_catalog_gtin(product_data->>'barcode')
    else null
  end;
  select exists (
    select 1 from public.profiles profile
    where profile.id = actor_id
      and profile.store_id = target_store_id
      and profile.role = 'store_admin'
      and profile.deletion_requested_at is null
  ) into may_publish;

  if target_gtin is not null and may_publish then
    catalog_data := jsonb_build_object(
      'gtin', target_gtin,
      'canonical_name', left(trim(product_data->>'name'), 200),
      'brand', null, 'manufacturer', null, 'size', null, 'unit', null,
      'quantity_text', null, 'image_url', null, 'source', 'stockly_catalog',
      'source_url', null, 'license', null, 'image_license', null, 'confidence', null,
      'category', nullif(left(trim(product_data->>'category'), 100), ''),
      'storage_type', nullif(left(trim(product_data->>'storage_type'), 100), ''),
      'supplier_name', nullif(left(trim(product_data->>'supplier_name'), 200), ''),
      'product_url', public.sanitize_shared_catalog_url(product_data->>'product_url')
    );
  end if;

  if product_data->>'barcode_format' in ('CODE_128', 'CODE_39', 'CODE_93', 'ITF', 'CODABAR')
    and exists (select 1 from public.normalize_shared_barcode_identity(product_data->>'barcode', product_data->>'barcode_format')) then
    write_data := jsonb_set(product_data, '{barcode}', to_jsonb('__stockly_pending__' || gen_random_uuid()::text));
  end if;

  product_row := public._catalog_product_write(
    actor_id, target_store_id, target_product_id, write_data, catalog_data, null, null
  );
  if product_row.catalog_id is not null then
    update public.product_catalog catalog
    set category = coalesce(catalog.category, nullif(left(trim(product_data->>'category'), 100), '')),
        storage_type = coalesce(catalog.storage_type, nullif(left(trim(product_data->>'storage_type'), 50), '')),
        supplier_name = coalesce(catalog.supplier_name, nullif(left(trim(product_data->>'supplier_name'), 200), '')),
        product_url = coalesce(catalog.product_url, public.sanitize_shared_catalog_url(product_data->>'product_url')),
        updated_at = clock_timestamp()
    where catalog.id = product_row.catalog_id;
  end if;
  perform public.publish_shared_product_defaults(actor_id, target_store_id, product_row.id, product_data);
  select * into product_row from public.products where id = product_row.id;
  return product_row;
end;
$$;

create or replace function public.lookup_shared_product_catalog_v2(
  target_barcode text,
  target_format text
)
returns table (
  status text,
  gtin text,
  barcode_format text,
  barcode_value text,
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
  normalized record;
  lookup_count integer;
  shared_row public.shared_product_defaults%rowtype;
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

  select * into normalized
  from public.normalize_shared_barcode_identity(target_barcode, target_format);
  if normalized.identity_format is null then
    return query select 'invalid'::text, null::text, null::text, null::text,
      null::text, null::text, null::text, null::numeric, null::text, null::text,
      null::text, null::text, null::text, null::text, null::text, null::numeric,
      null::text, null::text, null::text, null::text;
    return;
  end if;

  insert into public.shared_catalog_lookup_quota (user_id, consumed)
  values (auth.uid(), 1)
  on conflict (user_id, lookup_day) do update
    set consumed = public.shared_catalog_lookup_quota.consumed + 1
    where public.shared_catalog_lookup_quota.consumed < 100
  returning consumed into lookup_count;

  if lookup_count is null then
    return query select 'rate_limited'::text,
      case when normalized.identity_format = 'GTIN' then normalized.identity_value else null end,
      normalized.identity_format, normalized.identity_value,
      null::text, null::text, null::text, null::numeric, null::text, null::text,
      null::text, null::text, null::text, null::text, null::text, null::numeric,
      null::text, null::text, null::text, null::text;
    return;
  end if;

  select * into shared_row
  from public.shared_product_defaults shared
  where shared.identity_format = normalized.identity_format
    and shared.identity_value = normalized.identity_value;

  if shared_row.id is null then
    return query select 'miss'::text,
      case when normalized.identity_format = 'GTIN' then normalized.identity_value else null end,
      normalized.identity_format, normalized.identity_value,
      null::text, null::text, null::text, null::numeric, null::text, null::text,
      null::text, null::text, null::text, null::text, null::text, null::numeric,
      null::text, null::text, null::text, null::text;
    return;
  end if;

  return query select 'hit'::text,
    case when normalized.identity_format = 'GTIN' then normalized.identity_value else null end,
    normalized.identity_format, normalized.identity_value,
    shared_row.canonical_name, null::text, null::text, null::numeric,
    null::text, null::text, null::text, 'catalog'::text, null::text,
    null::text, null::text, null::numeric, shared_row.category,
    shared_row.storage_type, shared_row.supplier_name, shared_row.product_url;
end;
$$;

-- Keep the deployed one-argument contract for older clients, but route it
-- through v2 so both entry points share the same atomic quota cap.
create or replace function public.lookup_shared_product_catalog(target_gtin text)
returns table (
  gtin text, canonical_name text, brand text, manufacturer text, size numeric,
  unit text, quantity_text text, image_url text, source text, source_url text,
  license text, image_license text, confidence numeric, category text,
  storage_type text, supplier_name text, product_url text
)
language sql
security definer
set search_path = public
as $$
  select result.gtin, result.canonical_name, result.brand, result.manufacturer,
         result.size, result.unit, result.quantity_text, result.image_url,
         result.source, result.source_url, result.license, result.image_license,
         result.confidence, result.category, result.storage_type,
         result.supplier_name, result.product_url
  from public.lookup_shared_product_catalog_v2(target_gtin, 'GTIN14') result
  where result.status = 'hit'
$$;

create or replace function public.resolve_product_by_barcode(target_store_id uuid, target_barcode text)
returns setof public.products
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다.'; end if;
  if not public.can_access_store(target_store_id) then raise exception '해당 매장의 상품을 조회할 권한이 없습니다.'; end if;
  if target_barcode is null or target_barcode = '' then return; end if;

  return query
  with candidates as (
    select product.id as matched_product_id, 0 as match_rank
    from public.products product
    where product.store_id = target_store_id and product.is_active = true
      and product.barcode = target_barcode
    union all
    select barcode.product_id, 1
    from public.product_barcodes barcode
    where barcode.store_id = target_store_id and barcode.barcode = target_barcode
    union all
    select alias_product.id, 2
    from public.products alias_product
    join public.product_alias_links link on link.alias_product_id = alias_product.id and link.unmerged_at is null
    where alias_product.store_id = target_store_id and alias_product.barcode = target_barcode
    union all
    select product.id, 10
    from public.products product
    where product.store_id = target_store_id and product.is_active = true
      and product.barcode = trim(target_barcode)
      and coalesce(product.barcode_format, '') not in ('CODE_128', 'CODE_39', 'CODE_93', 'ITF', 'CODABAR')
  ), resolved as (
    select coalesce(link.canonical_product_id, candidates.matched_product_id) as product_id,
           min(candidates.match_rank) as match_rank
    from candidates
    left join public.product_alias_links link on link.alias_product_id = candidates.matched_product_id and link.unmerged_at is null
    group by coalesce(link.canonical_product_id, candidates.matched_product_id)
  )
  select product.* from resolved
  join public.products product on product.id = resolved.product_id
  where product.store_id = target_store_id and product.is_active = true
  order by resolved.match_rank, product.id limit 1;
end;
$$;

-- Migration 071 normalized aliases with trim(). Rewrite only those two known
-- expressions so already-deployed merge logic preserves exact scan payloads.
do $$
declare
  function_sql text;
  rewritten_sql text;
begin
  select pg_get_functiondef(
    'public.merge_products_reversible(uuid,uuid,bigint,bigint,bigint,bigint,uuid)'::regprocedure
  ) into function_sql;
  rewritten_sql := replace(
    replace(function_sql,
      'nullif(trim(source_product.barcode), '''')',
      'nullif(source_product.barcode, '''')'),
    'nullif(trim(barcode.barcode), '''')',
    'nullif(barcode.barcode, '''')'
  );
  if rewritten_sql = function_sql then
    raise exception 'merge_products_reversible exact-barcode rewrite did not match';
  end if;
  execute rewritten_sql;
end;
$$;

create or replace function public.publish_existing_product_defaults(target_product_id uuid, target_format text)
returns boolean
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  target_product public.products%rowtype;
  normalized record;
begin
  select product.* into target_product
  from public.products product
  join public.profiles profile on profile.id = auth.uid() and profile.store_id = product.store_id
  join public.stores store_row on store_row.id = product.store_id
  where product.id = target_product_id
    and product.is_active = true
    and profile.role = 'store_admin'
    and profile.deletion_requested_at is null
    and store_row.status = 'active';
  if not found or target_product.barcode is null then return false; end if;

  select * into normalized
  from public.normalize_shared_barcode_identity(target_product.barcode, target_format);
  if normalized.identity_format is null then return false; end if;

  update public.products set barcode_format = target_format where id = target_product.id;
  perform public.publish_shared_product_defaults(auth.uid(), target_product.store_id, target_product.id, to_jsonb(target_product) || jsonb_build_object('barcode_format', target_format));
  return exists (
    select 1 from public.shared_product_defaults shared
    where shared.identity_format = normalized.identity_format
      and shared.identity_value = normalized.identity_value
  );
end;
$$;

revoke all on function public.normalize_shared_barcode_identity(text, text) from public, anon, authenticated, service_role;
revoke all on function public.publish_shared_product_defaults(uuid, uuid, uuid, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.lookup_shared_product_catalog_v2(text, text) from public, anon, service_role;
grant execute on function public.lookup_shared_product_catalog_v2(text, text) to authenticated;
revoke all on function public.publish_existing_product_defaults(uuid, text) from public, anon, service_role;
grant execute on function public.publish_existing_product_defaults(uuid, text) to authenticated;

notify pgrst, 'reload schema';
