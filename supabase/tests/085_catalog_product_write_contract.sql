-- Behavioral contract for migration 085. Run inside an isolated disposable DB.
begin;

insert into public.stores (id, name) values
  ('85000000-0000-0000-0000-000000000001', 'Catalog 계약 매장 A'),
  ('85000000-0000-0000-0000-000000000002', 'Catalog 계약 매장 B');

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', '85000000-0000-0000-0000-000000000011', 'authenticated', 'authenticated', 'catalog-a@example.invalid', '', clock_timestamp(), '{}', '{}', clock_timestamp(), clock_timestamp()),
  ('00000000-0000-0000-0000-000000000000', '85000000-0000-0000-0000-000000000012', 'authenticated', 'authenticated', 'catalog-b@example.invalid', '', clock_timestamp(), '{}', '{}', clock_timestamp(), clock_timestamp()),
  ('00000000-0000-0000-0000-000000000000', '85000000-0000-0000-0000-000000000013', 'authenticated', 'authenticated', 'catalog-master@example.invalid', '', clock_timestamp(), '{}', '{}', clock_timestamp(), clock_timestamp());

insert into public.profiles (id, email, display_name, store_id, role) values
  ('85000000-0000-0000-0000-000000000011', 'catalog-a@example.invalid', 'Catalog A', '85000000-0000-0000-0000-000000000001', 'store_admin'),
  ('85000000-0000-0000-0000-000000000012', 'catalog-b@example.invalid', 'Catalog B', '85000000-0000-0000-0000-000000000002', 'store_admin'),
  ('85000000-0000-0000-0000-000000000013', 'catalog-master@example.invalid', 'Catalog Master', '85000000-0000-0000-0000-000000000001', 'master');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"85000000-0000-0000-0000-000000000011","role":"authenticated"}', true);

-- Legacy public RPC remains callable and keeps the manual catalog-null path.
create temporary table legacy_product on commit preserve rows as
select (public.create_product_with_inventory(
  '85000000-0000-0000-0000-000000000001',
  '{"name":"레거시 등록","category":"기타","barcode":"legacy-8501"}'::jsonb
)).id as id;

do $$
begin
  if (select catalog_id from public.products where id = (select id from legacy_product)) is not null
    or not exists (select 1 from public.inventory where product_id = (select id from legacy_product)) then
    raise exception 'legacy registration did not preserve catalog-null plus inventory behavior';
  end if;
end;
$$;

-- Legacy master/current-store context remains compatible with the public RPC.
select set_config('request.jwt.claims', '{"sub":"85000000-0000-0000-0000-000000000013","role":"authenticated"}', true);
do $$
declare
  master_product public.products%rowtype;
begin
  master_product := public.create_product_with_inventory(
    '85000000-0000-0000-0000-000000000001',
    '{"name":"레거시 마스터 등록","category":"기타","barcode":"legacy-master-8501"}'::jsonb
  );
  if master_product.store_id <> '85000000-0000-0000-0000-000000000001'
    or not exists (select 1 from public.inventory where product_id = master_product.id) then
    raise exception 'legacy master/current-store RPC compatibility failed';
  end if;
end;
$$;

reset role;
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);

-- Foundation constraints remain fail-closed with their exact SQLSTATE and name.
reset role;
do $$
declare
  sqlstate_code text;
  constraint_name text;
begin
  foreach constraint_name in array array['checksum', 'malformed', 'short'] loop
    begin
      insert into public.product_catalog (gtin, canonical_name, source)
      values (
        case constraint_name
          when 'checksum' then '00036000291453'
          when 'malformed' then '0003600029145X'
          else '0003600029145'
        end,
        '잘못된 GTIN', 'contract-test'
      );
      raise exception 'invalid % GTIN was accepted', constraint_name;
    exception when others then
      get stacked diagnostics sqlstate_code = returned_sqlstate,
        constraint_name = constraint_name;
      if sqlstate_code <> '23514'
        or constraint_name <> 'product_catalog_gtin_check' then
        raise exception 'invalid GTIN raised %, %', sqlstate_code, constraint_name;
      end if;
    end;
  end loop;

  insert into public.product_catalog (gtin, canonical_name, source)
  values ('00036000291452', '중복 기준', 'contract-test');

  begin
    insert into public.product_catalog (gtin, canonical_name, source)
    values ('00036000291452', '중복 GTIN', 'contract-test');
    raise exception 'duplicate GTIN was accepted';
  exception when others then
    get stacked diagnostics sqlstate_code = returned_sqlstate,
      constraint_name = constraint_name;
    if sqlstate_code <> '23505' or constraint_name <> 'product_catalog_gtin_key' then
      raise exception 'duplicate GTIN raised %, %', sqlstate_code, constraint_name;
    end if;
  end;
  delete from public.product_catalog where gtin = '00036000291452';

  begin
    update public.products
    set catalog_id = '85000000-0000-0000-0000-000000000099'
    where id = (select id from legacy_product);
    raise exception 'missing catalog foreign key was accepted';
  exception when others then
    get stacked diagnostics sqlstate_code = returned_sqlstate,
      constraint_name = constraint_name;
    if sqlstate_code <> '23503' or constraint_name <> 'products_catalog_id_fkey' then
      raise exception 'missing catalog foreign key raised %, %', sqlstate_code, constraint_name;
    end if;
  end;
end;
$$;
set local role service_role;

-- First server write inserts the canonical row and product/inventory atomically.
create temporary table catalog_product on commit preserve rows as
select (public.create_product_with_catalog(
  '85000000-0000-0000-0000-000000000011',
  '85000000-0000-0000-0000-000000000001',
  '{"name":"Catalog 상품","category":"기타","barcode":"catalog-8501"}'::jsonb,
  '{"gtin":"00036000291452","canonical_name":"원본 Catalog 상품","brand":"원본 브랜드","source":"contract-test","confidence":0.7}'::jsonb,
  '85000000-0000-0000-0000-000000000101'
)).id as id;

-- The initial write persisted the canonical link and metadata before the
-- next ordinary barcode edit in this same transaction.
do $$
begin
  if coalesce(current_setting('app.catalog_write_guard', true), '') <> ''
    or not exists (
      select 1
      from public.products product
      join public.product_catalog catalog on catalog.id = product.catalog_id
      where product.id = (select id from catalog_product)
        and product.catalog_id is not distinct from catalog.id
        and catalog.gtin is not distinct from '00036000291452'
        and product.brand is not distinct from '원본 브랜드'
        and product.image_url is not distinct from null
        and product.catalog_confirmed_at is distinct from null
    )
    or not exists (
      select 1 from public.inventory
      where product_id = (select id from catalog_product)
    ) then
    raise exception 'catalog/product/inventory write did not persist its canonical linkage';
  end if;
end;
$$;
update public.products set barcode = 'catalog-same-transaction-edit'
where id = (select id from catalog_product);
do $$
begin
  if exists (
    select 1 from public.products
    where id = (select id from catalog_product)
      and (catalog_id is distinct from null or brand is distinct from null
        or image_url is distinct from null or catalog_confirmed_at is distinct from null)
  ) then
    raise exception 'same-transaction ordinary barcode edit retained stale catalog link';
  end if;
end;
$$;

create temporary table replay_product on commit preserve rows as
select (public.create_product_with_catalog(
  '85000000-0000-0000-0000-000000000011',
  '85000000-0000-0000-0000-000000000001',
  '{"name":"Catalog 상품","category":"기타","barcode":"catalog-8501"}'::jsonb,
  '{"gtin":"00036000291452","canonical_name":"원본 Catalog 상품","brand":"원본 브랜드","source":"contract-test","confidence":0.7}'::jsonb,
  '85000000-0000-0000-0000-000000000101'
)).id as id;

do $$
begin
  if (select id from catalog_product) is distinct from (select id from replay_product)
    or (select count(*) from public.mutation_requests where request_id = '85000000-0000-0000-0000-000000000101') <> 1
    or not exists (
      select 1 from public.products
      where id = (select id from catalog_product)
        and catalog_id is not distinct from null
        and brand is not distinct from null
        and image_url is not distinct from null
        and catalog_confirmed_at is not distinct from null
    )
    or (select count(*) from public.inventory where product_id = (select id from catalog_product)) <> 1 then
    raise exception 'atomic catalog/product/inventory write or replay did not preserve the cleared original product';
  end if;
end;
$$;

-- Same request ID with a different payload is rejected.
do $$
begin
  begin
    perform public.create_product_with_catalog(
      '85000000-0000-0000-0000-000000000011',
      '85000000-0000-0000-0000-000000000001',
      '{"name":"변조 상품","category":"기타","barcode":"catalog-8502"}'::jsonb,
      '{"gtin":"00036000291452","canonical_name":"변조 Catalog","source":"attacker","confidence":1}'::jsonb,
      '85000000-0000-0000-0000-000000000101'
    );
    raise exception 'conflicting request payload was accepted';
  exception when others then
    if sqlstate <> 'P0001' or sqlerrm not like '%다른 상품 저장 내용%' then
      raise exception 'conflicting request rejection changed: sqlstate %, message %', sqlstate, sqlerrm;
    end if;
  end;
end;
$$;

-- Two independent writes for one GTIN have the unique index as their
-- serialization point: the first canonical row wins and the second reuses it.
select public.create_product_with_catalog(
  '85000000-0000-0000-0000-000000000011',
  '85000000-0000-0000-0000-000000000001',
  '{"name":"Catalog 상품 2","category":"기타","barcode":"catalog-8502"}'::jsonb,
  '{"gtin":"00036000291452","canonical_name":"덮어쓰기 시도","source":"other-source","confidence":0.1}'::jsonb,
  '85000000-0000-0000-0000-000000000102'
);

do $$
begin
  if (select canonical_name from public.product_catalog where gtin = '00036000291452') <> '원본 Catalog 상품'
    or (select count(*) from public.product_catalog where gtin = '00036000291452') <> 1
    or (select catalog_id from public.products where barcode = 'catalog-8502')
      <> (select id from public.product_catalog where gtin = '00036000291452')
    or not exists (select 1 from public.inventory where product_id = (select id from public.products where barcode = 'catalog-8502')) then
    raise exception 'concurrent-equivalent GTIN conflict did not reuse the winning canonical row';
  end if;
  if not exists (
    select 1
    from pg_index index_row
    join pg_class table_row on table_row.oid = index_row.indrelid
    join pg_class index_class on index_class.oid = index_row.indexrelid
    where table_row.oid = 'public.product_catalog'::regclass
      and index_row.indisunique
      and index_class.relname like '%gtin%'
  ) then
    raise exception 'GTIN uniqueness is not available as the concurrent conflict boundary';
  end if;
end;
$$;

-- Commit the disposable fixtures so independent sessions can exercise the race.
commit;
begin;
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);

-- Exercise the GTIN unique-conflict path from two independent database sessions.
create extension if not exists dblink;
reset role;
select dblink_connect('catalog_race_a', format('dbname=%I user=supabase_admin', current_database()));
select dblink_connect('catalog_race_b', format('dbname=%I user=supabase_admin', current_database()));
select dblink_send_query('catalog_race_a', $$
  select ((public.create_product_with_catalog(
    '85000000-0000-0000-0000-000000000011',
    '85000000-0000-0000-0000-000000000001',
    '{"name":"동시 Catalog A","category":"기타","barcode":"catalog-race-a"}'::jsonb,
    '{"gtin":"00036000291438","canonical_name":"동시 Catalog 승자","source":"race-a","confidence":0.7}'::jsonb,
    '85000000-0000-0000-0000-000000000107'
  )).id)::text
  from (select set_config('request.jwt.claim.role', 'service_role', true) as configured) claims
  where claims.configured = 'service_role'
$$);
select dblink_send_query('catalog_race_b', $$
  select ((public.create_product_with_catalog(
    '85000000-0000-0000-0000-000000000011',
    '85000000-0000-0000-0000-000000000001',
    '{"name":"동시 Catalog B","category":"기타","barcode":"catalog-race-b"}'::jsonb,
    '{"gtin":"00036000291438","canonical_name":"동시 Catalog 패자","source":"race-b","confidence":0.1}'::jsonb,
    '85000000-0000-0000-0000-000000000108'
  )).id)::text
  from (select set_config('request.jwt.claim.role', 'service_role', true) as configured) claims
  where claims.configured = 'service_role'
$$);
create temporary table catalog_race_results(product_id uuid) on commit preserve rows;
insert into catalog_race_results
select product_id::uuid from dblink_get_result('catalog_race_a') as result(product_id text);
insert into catalog_race_results
select product_id::uuid from dblink_get_result('catalog_race_b') as result(product_id text);
select dblink_disconnect('catalog_race_a');
select dblink_disconnect('catalog_race_b');
do $$
declare
  race_catalog_id uuid;
begin
  select id into race_catalog_id from public.product_catalog where gtin = '00036000291438';
  if (select count(*) from catalog_race_results) <> 2
    or (select count(*) from public.product_catalog where gtin = '00036000291438') <> 1
    or (select count(*) from public.products where barcode in ('catalog-race-a', 'catalog-race-b')) <> 2
    or (select count(*) from public.products where barcode in ('catalog-race-a', 'catalog-race-b') and catalog_id = race_catalog_id) <> 2
    or (select count(*) from public.inventory inventory join public.products product on product.id = inventory.product_id where product.barcode in ('catalog-race-a', 'catalog-race-b')) <> 2
    or (select canonical_name from public.product_catalog where gtin = '00036000291438') not in ('동시 Catalog 승자', '동시 Catalog 패자') then
    raise exception 'two-session GTIN race did not reuse one winning canonical row';
  end if;
end;
$$;
delete from public.mutation_requests where request_id in (
  '85000000-0000-0000-0000-000000000107',
  '85000000-0000-0000-0000-000000000108'
);
delete from public.inventory where product_id in (select id from public.products where barcode in ('catalog-race-a', 'catalog-race-b'));
delete from public.products where barcode in ('catalog-race-a', 'catalog-race-b');
delete from public.product_catalog where gtin = '00036000291438';

-- Restore with catalog data keeps the existing product and its single inventory row.
update public.products
set is_active = false, barcode = 'restore-8501'
where id = (select id from legacy_product);
select public.restore_product_with_catalog(
  '85000000-0000-0000-0000-000000000011',
  (select id from legacy_product),
  '{"name":"복구 Catalog 상품","category":"기타","barcode":"restore-8501"}'::jsonb,
  '{"gtin":"00036000291469","canonical_name":"복구 Catalog","brand":"복구 브랜드","source":"restore-contract","confidence":0.8}'::jsonb,
  '85000000-0000-0000-0000-000000000106'
);
do $$
begin
  if not exists (
    select 1 from public.products product
    join public.product_catalog catalog on catalog.id = product.catalog_id
    where product.id = (select id from legacy_product)
      and product.is_active
      and catalog.gtin = '00036000291469'
  ) or (select count(*) from public.inventory where product_id = (select id from legacy_product)) <> 1 then
    raise exception 'restore did not link the canonical catalog row with exactly one inventory row';
  end if;
end;
$$;

-- A post-product-insert failure rolls back the catalog, product, inventory,
-- and idempotency rows as one statement.
create or replace function public.catalog_contract_fail_after_insert()
returns trigger
language plpgsql
as $$
begin
  raise exception 'contract post-write failure';
end;
$$;
create trigger catalog_contract_fail_after_insert
after insert on public.products
for each row when (new.barcode = 'catalog-rollback-after-write')
execute function public.catalog_contract_fail_after_insert();

do $$
begin
  begin
    perform public.create_product_with_catalog(
      '85000000-0000-0000-0000-000000000011',
      '85000000-0000-0000-0000-000000000001',
      '{"name":"Rollback 상품","category":"기타","barcode":"catalog-rollback-after-write"}'::jsonb,
      '{"gtin":"00036000291445","canonical_name":"Rollback Catalog","source":"contract-test","confidence":0.5}'::jsonb,
      '85000000-0000-0000-0000-000000000103'
    );
    raise exception 'post-write failure injection was not raised';
  exception when others then
    if sqlstate <> 'P0001' or sqlerrm <> 'contract post-write failure' then
      raise exception 'post-write rejection changed: sqlstate %, message %', sqlstate, sqlerrm;
    end if;
  end;
  if exists (select 1 from public.products where barcode = 'catalog-rollback-after-write')
    or exists (select 1 from public.product_catalog where gtin = '00036000291445')
    or exists (select 1 from public.mutation_requests where request_id = '85000000-0000-0000-0000-000000000103') then
    raise exception 'failed write left partial rows';
  end if;
end;
$$;
drop trigger catalog_contract_fail_after_insert on public.products;
drop function public.catalog_contract_fail_after_insert();

-- Foreign actor/store mismatch and deleted actor are denied.
do $$
begin
  begin
    perform public.create_product_with_catalog(
      '85000000-0000-0000-0000-000000000011',
      '85000000-0000-0000-0000-000000000002',
      '{"name":"타 매장","category":"기타"}'::jsonb, null,
      '85000000-0000-0000-0000-000000000104'
    );
    raise exception 'cross-store actor was accepted';
  exception when others then
    if sqlstate <> 'P0001' or sqlerrm not like '%활성 계정과 매장%' then
      raise exception 'cross-store rejection changed: sqlstate %, message %', sqlstate, sqlerrm;
    end if;
  end;
end;
$$;
update public.stores set status = 'inactive'
where id = '85000000-0000-0000-0000-000000000002';
do $$
begin
  begin
    perform public.create_product_with_catalog(
      '85000000-0000-0000-0000-000000000012',
      '85000000-0000-0000-0000-000000000002',
      '{"name":"폐점 매장","category":"기타"}'::jsonb, null,
      '85000000-0000-0000-0000-000000000109'
    );
    raise exception 'inactive store was accepted';
  exception when others then
    if sqlstate <> 'P0001' or sqlerrm not like '%활성 계정과 매장%' then
      raise exception 'inactive store rejection changed: sqlstate %, message %', sqlstate, sqlerrm;
    end if;
  end;
end;
$$;
update public.stores set status = 'active'
where id = '85000000-0000-0000-0000-000000000002';
delete from auth.users where id = '85000000-0000-0000-0000-000000000012';
do $$
begin
  begin
    perform public.create_product_with_catalog(
      '85000000-0000-0000-0000-000000000012',
      '85000000-0000-0000-0000-000000000002',
      '{"name":"삭제 계정","category":"기타"}'::jsonb, null,
      '85000000-0000-0000-0000-000000000105'
    );
    raise exception 'deleted actor was accepted';
  exception when others then
    if sqlstate <> 'P0001' or sqlerrm not like '%활성 계정과 매장%' then
      raise exception 'deleted actor rejection changed: sqlstate %, message %', sqlstate, sqlerrm;
    end if;
  end;
end;
$$;

-- Ordinary barcode edits clear stale confirmation; only explicit server
-- reconfirmation guard preserves catalog metadata.
select set_config('app.catalog_write_guard', 'off', true);
update public.products set barcode = 'catalog-edited' where id = (select id from catalog_product);
do $$
begin
  if exists (
    select 1 from public.products
    where id = (select id from catalog_product)
      and (catalog_id is not null or brand is not null or image_url is not null or catalog_confirmed_at is not null)
  ) then
    raise exception 'ordinary barcode edit retained stale catalog link';
  end if;
end;
$$;

select set_config('app.catalog_write_guard', 'on', true);
update public.products
set barcode = 'catalog-reconfirmed',
    catalog_id = (select id from public.product_catalog where gtin = '00036000291452'),
    brand = '재확인 브랜드',
    image_url = 'https://example.invalid/catalog-image',
    catalog_confirmed_at = clock_timestamp()
where id = (select id from catalog_product);

do $$
begin
  if not exists (
    select 1 from public.products
    where id = (select id from catalog_product)
      and catalog_id = (select id from public.product_catalog where gtin = '00036000291452')
      and brand = '재확인 브랜드'
      and image_url = 'https://example.invalid/catalog-image'
      and catalog_confirmed_at is not null
  ) then
    raise exception 'explicit catalog reconfirmation did not preserve metadata';
  end if;
end;
$$;

select set_config('app.catalog_write_guard', 'off', true);

do $$
declare
  function_definition text;
  function_name text;
begin
  foreach function_name in array array[
    'public._catalog_product_write(uuid,uuid,uuid,jsonb,jsonb,uuid,text)',
    'public.clear_stale_product_catalog_link()',
    'public.create_product_with_catalog(uuid,uuid,jsonb,jsonb,uuid)',
    'public.restore_product_with_catalog(uuid,uuid,jsonb,jsonb,uuid)'
  ] loop
    if has_function_privilege('public', function_name, 'EXECUTE')
       or has_function_privilege('anon', function_name, 'EXECUTE')
       or has_function_privilege('authenticated', function_name, 'EXECUTE') then
      raise exception 'untrusted EXECUTE privilege remains on %', function_name;
    end if;
  end loop;
  if not has_function_privilege('service_role', 'public.create_product_with_catalog(uuid,uuid,jsonb,jsonb,uuid)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.restore_product_with_catalog(uuid,uuid,jsonb,jsonb,uuid)', 'EXECUTE') then
    raise exception 'service_role EXECUTE grant is missing';
  end if;
  select pg_get_functiondef('public._catalog_product_write(uuid,uuid,uuid,jsonb,jsonb,uuid,text)'::regprocedure) into function_definition;
  if function_definition not like '%search_path%' or function_definition not like '%public%' then
    raise exception 'catalog write helper does not fix search_path';
  end if;
  if function_definition not like '%extensions.digest%' then
    raise exception 'catalog fingerprint digest is not schema-qualified';
  end if;
  select pg_get_functiondef('public.create_product_with_catalog(uuid,uuid,jsonb,jsonb,uuid)'::regprocedure) into function_definition;
  if function_definition not like '%search_path%' or function_definition not like '%public%' then
    raise exception 'create_product_with_catalog does not fix search_path';
  end if;
  select pg_get_functiondef('public.restore_product_with_catalog(uuid,uuid,jsonb,jsonb,uuid)'::regprocedure) into function_definition;
  if function_definition not like '%search_path%' or function_definition not like '%public%' then
    raise exception 'restore_product_with_catalog does not fix search_path';
  end if;
  select pg_get_functiondef('public.clear_stale_product_catalog_link()'::regprocedure) into function_definition;
  if function_definition not like '%search_path%' or function_definition not like '%public%' then
    raise exception 'catalog trigger helper does not fix search_path';
  end if;
  select pg_get_functiondef('public.create_product_with_catalog(uuid,uuid,jsonb,jsonb,uuid)'::regprocedure) into function_definition;
  if function_definition not like '%search_path%' or function_definition not like '%public%' then
    raise exception 'create catalog RPC does not fix search_path';
  end if;
  select pg_get_functiondef('public.restore_product_with_catalog(uuid,uuid,jsonb,jsonb,uuid)'::regprocedure) into function_definition;
  if function_definition not like '%search_path%' or function_definition not like '%public%' then
    raise exception 'restore catalog RPC does not fix search_path';
  end if;
  if not exists (
    select 1 from pg_proc
    where oid = 'public.create_product_with_inventory(uuid,jsonb)'::regprocedure
  ) or not exists (
    select 1 from pg_proc
    where oid = 'public.restore_product_with_inventory(uuid,jsonb)'::regprocedure
  ) then
    raise exception 'legacy public RPC signature was removed';
  end if;
end;
$$;

delete from public.inventory where store_id in (
  '85000000-0000-0000-0000-000000000001',
  '85000000-0000-0000-0000-000000000002'
);
delete from public.products where store_id in (
  '85000000-0000-0000-0000-000000000001',
  '85000000-0000-0000-0000-000000000002'
);
delete from public.mutation_requests where store_id in (
  '85000000-0000-0000-0000-000000000001',
  '85000000-0000-0000-0000-000000000002'
);
delete from public.product_catalog where gtin in (
  '00036000291452', '00036000291469'
);
delete from public.profiles where id in (
  '85000000-0000-0000-0000-000000000011',
  '85000000-0000-0000-0000-000000000012',
  '85000000-0000-0000-0000-000000000013'
);
delete from public.stores where id in (
  '85000000-0000-0000-0000-000000000001',
  '85000000-0000-0000-0000-000000000002'
);
delete from auth.users where id in (
  '85000000-0000-0000-0000-000000000011',
  '85000000-0000-0000-0000-000000000012',
  '85000000-0000-0000-0000-000000000013'
);
commit;
