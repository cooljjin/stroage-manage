-- Behavioral contract for migration 086. Run after a clean migration replay.
begin;

insert into public.stores (id, name) values
  ('11000000-0000-0000-0000-000000000001', '카탈로그 테스트 매장')
on conflict (id) do nothing;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  '21000000-0000-0000-0000-000000000001',
  'authenticated', 'authenticated', 'catalog-contract@example.invalid', '',
  clock_timestamp(), '{"provider":"email","providers":["email"]}', '{}',
  clock_timestamp(), clock_timestamp()
) on conflict (id) do nothing;

insert into public.profiles (id, email, display_name, store_id, role)
values (
  '21000000-0000-0000-0000-000000000001', 'catalog-contract@example.invalid',
  '카탈로그 테스트 관리자', '11000000-0000-0000-0000-000000000001', 'store_admin'
) on conflict (id) do nothing;

insert into public.stores (id, name) values
  ('11000000-0000-0000-0000-000000000002', '다른 테스트 매장')
on conflict (id) do nothing;
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000', '21000000-0000-0000-0000-000000000002',
  'authenticated', 'authenticated', 'catalog-contract-other@example.invalid', '',
  clock_timestamp(), '{"provider":"email","providers":["email"]}', '{}', clock_timestamp(), clock_timestamp()
) on conflict (id) do nothing;
insert into public.profiles (id, email, display_name, store_id, role)
values (
  '21000000-0000-0000-0000-000000000002', 'catalog-contract-other@example.invalid',
  '다른 테스트 관리자', '11000000-0000-0000-0000-000000000002', 'store_admin'
) on conflict (id) do nothing;

insert into public.product_catalog (id, gtin, canonical_name, brand, image_url, source)
values
  ('61000000-0000-0000-0000-000000000001', '00000000000017', '카탈로그 A', '브랜드 A', 'https://a.invalid/a.png', 'contract'),
  ('61000000-0000-0000-0000-000000000002', '00000000000024', '카탈로그 B', '브랜드 B', 'https://b.invalid/b.png', 'contract'),
  ('61000000-0000-0000-0000-000000000003', '00000000000031', '카탈로그 C', '브랜드 C', 'https://c.invalid/c.png', 'contract')
on conflict (id) do nothing;

create temporary table catalog_before on commit drop as
select * from public.product_catalog
where id in ('61000000-0000-0000-0000-000000000001',
             '61000000-0000-0000-0000-000000000002',
             '61000000-0000-0000-0000-000000000003');
insert into public.products (
  id, store_id, name, barcode, category, unit_name, is_active,
  catalog_id, brand, image_url, catalog_confirmed_at
) values
  ('31000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000001',
   '대표 A', 'CAT-A', '기타', '개', true,
   '61000000-0000-0000-0000-000000000001', '로컬 A', 'https://local.invalid/a.png', '2026-01-01 01:02:03+00'),
  ('31000000-0000-0000-0000-000000000002', '11000000-0000-0000-0000-000000000001',
   '원본 B', 'CAT-B', '기타', '개', true,
   '61000000-0000-0000-0000-000000000002', '로컬 B', 'https://local.invalid/b.png', '2026-02-02 02:03:04+00'),
  ('31000000-0000-0000-0000-000000000003', '11000000-0000-0000-0000-000000000001',
   '동일 C', 'CAT-C', '기타', '개', true,
   '61000000-0000-0000-0000-000000000003', '로컬 C', 'https://local.invalid/c.png', '2026-03-03 03:04:05+00'),
  ('31000000-0000-0000-0000-000000000004', '11000000-0000-0000-0000-000000000001',
   '등록 병합 D', 'CAT-D', '기타', '개', true,
   '61000000-0000-0000-0000-000000000003', '로컬 D', 'https://local.invalid/d.png', '2026-04-04 04:05:06+00')
on conflict (id) do nothing;
insert into public.products (id, store_id, name, barcode, category, unit_name, is_active)
values ('31000000-0000-0000-0000-000000000005', '11000000-0000-0000-0000-000000000002', '다른 매장 상품', 'CAT-OTHER', '기타', '개', true)
on conflict (id) do nothing;

insert into public.inventory (product_id, store_id, warehouse_qty, store_qty)
values
  ('31000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000001', 10, 5),
  ('31000000-0000-0000-0000-000000000002', '11000000-0000-0000-0000-000000000001', 3, 2),
  ('31000000-0000-0000-0000-000000000003', '11000000-0000-0000-0000-000000000001', 6, 1),
  ('31000000-0000-0000-0000-000000000004', '11000000-0000-0000-0000-000000000001', 7, 4)
on conflict (product_id) do nothing;
insert into public.inventory (product_id, store_id, warehouse_qty, store_qty)
values ('31000000-0000-0000-0000-000000000005', '11000000-0000-0000-0000-000000000002', 0, 0)
on conflict (product_id) do nothing;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"21000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

-- Matching catalogs do not create aliases without an explicit merge call.
do $$
begin
  if exists (
    select 1 from public.product_alias_links
    where canonical_product_id = '31000000-0000-0000-0000-000000000003'
       or alias_product_id = '31000000-0000-0000-0000-000000000003'
  ) then raise exception 'catalog equality auto-merged a product'; end if;
end $$;

create temporary table merged_link on commit drop as
select (public.merge_products_reversible(
  '31000000-0000-0000-0000-000000000001',
  '31000000-0000-0000-0000-000000000002',
  0, 0, 0, 0,
  '71000000-0000-0000-0000-000000000001'
)).id as id;

do $$
declare
  link_row public.product_alias_links%rowtype;
  state_row record;
  canonical public.products%rowtype;
begin
  select link.* into link_row
  from public.product_alias_links link
  where link.id = (select id from merged_link);

  if link_row.catalog_id_snapshot is distinct from '61000000-0000-0000-0000-000000000002'
    or link_row.brand_snapshot is distinct from '로컬 B'
    or link_row.image_url_snapshot is distinct from 'https://local.invalid/b.png'
    or link_row.catalog_confirmed_at_snapshot is distinct from '2026-02-02 02:03:04+00'::timestamptz then
    raise exception 'alias catalog metadata was not snapshotted';
  end if;

  select * into canonical from public.products
  where id = '31000000-0000-0000-0000-000000000001';
  if canonical.catalog_id is distinct from '61000000-0000-0000-0000-000000000001'
    or canonical.brand is distinct from '로컬 A'
    or canonical.image_url is distinct from 'https://local.invalid/a.png'
    or canonical.catalog_confirmed_at is distinct from '2026-01-01 01:02:03+00'::timestamptz then
    raise exception 'survivor catalog metadata changed';
  end if;

  select * into state_row from public.resolve_product_catalog_state(
    '31000000-0000-0000-0000-000000000002');
  if state_row.canonical_product_id is distinct from '31000000-0000-0000-0000-000000000001'
    or state_row.is_mixed_catalog is not true
    or state_row.canonical_catalog_id is distinct from '61000000-0000-0000-0000-000000000001'
    or state_row.alias_catalog_ids is distinct from array['61000000-0000-0000-0000-000000000002']::uuid[] then
    raise exception 'mixed catalog state is unreadable';
  end if;

  if not exists (
    select 1 from public.inventory
    where product_id = '31000000-0000-0000-0000-000000000002'
      and warehouse_qty is not distinct from 0
      and store_qty is not distinct from 0
  ) then
    raise exception 'merge quantity distribution changed';
  end if;
end $$;

select public.unmerge_product_alias(
  (select id from merged_link), 10, 5, 3, 2, 1, 1, 1, 1,
  '72000000-0000-0000-0000-000000000001'
);

do $$
declare
  restored public.products%rowtype;
begin
  select * into restored from public.products
  where id = '31000000-0000-0000-0000-000000000002';
  if restored.catalog_id is distinct from '61000000-0000-0000-0000-000000000002'
    or restored.brand is distinct from '로컬 B'
    or restored.image_url is distinct from 'https://local.invalid/b.png'
    or restored.catalog_confirmed_at is distinct from '2026-02-02 02:03:04+00'::timestamptz then
    raise exception 'unmerge did not restore original alias metadata';
  end if;
  if not exists (
    select 1 from public.inventory
    where product_id = '31000000-0000-0000-0000-000000000001'
      and warehouse_qty is not distinct from 10
      and store_qty is not distinct from 5
  ) or not exists (
    select 1 from public.inventory
    where product_id = '31000000-0000-0000-0000-000000000002'
      and warehouse_qty is not distinct from 3
      and store_qty is not distinct from 2
  ) then
    raise exception 'unmerge changed quantity restoration';
  end if;
  if (select count(*) from public.product_alias_links where unmerged_at is null) <> 0 then
    raise exception 'unmerge left an active alias';
  end if;
end $$;

-- The register-and-merge path reaches the same merge root.
select public.register_and_merge_product_reversible(
  '11000000-0000-0000-0000-000000000001',
  '{"name":"등록된 새 상품","barcode":"CAT-NEW","category":"기타","unit_name":"개"}'::jsonb,
  '31000000-0000-0000-0000-000000000004',
  true, 0, 0,
  '75000000-0000-0000-0000-000000000001'
);

do $$
declare
  snapshot_row public.product_alias_links%rowtype;
begin
  select * into snapshot_row
  from public.product_alias_links
  where alias_product_id = '31000000-0000-0000-0000-000000000004'
    and unmerged_at is null;
  if snapshot_row.catalog_id_snapshot is distinct from '61000000-0000-0000-0000-000000000003'
    or snapshot_row.brand_snapshot is distinct from '로컬 D'
    or snapshot_row.image_url_snapshot is distinct from 'https://local.invalid/d.png' then
    raise exception 'register-then-merge did not preserve catalog metadata';
  end if;
end $$;

select public.unmerge_product_alias(
  (select id from public.product_alias_links where alias_product_id = '31000000-0000-0000-0000-000000000004' and unmerged_at is null),
  4, 2, 3, 2,
  (select warehouse_version from public.inventory where product_id = (select canonical_product_id from public.product_alias_links where alias_product_id = '31000000-0000-0000-0000-000000000004' and unmerged_at is null)),
  (select store_version from public.inventory where product_id = (select canonical_product_id from public.product_alias_links where alias_product_id = '31000000-0000-0000-0000-000000000004' and unmerged_at is null)),
  (select warehouse_version from public.inventory where product_id = '31000000-0000-0000-0000-000000000004'),
  (select store_version from public.inventory where product_id = '31000000-0000-0000-0000-000000000004'),
  '75000000-0000-0000-0000-000000000002'
);

do $$
declare
  link_row public.product_alias_links%rowtype;
  survivor public.products%rowtype;
  restored public.products%rowtype;
begin
  select link.* into link_row from public.product_alias_links link
  where link.alias_product_id = '31000000-0000-0000-0000-000000000004'
  order by link.merged_at desc limit 1;
  select * into survivor from public.products where id = link_row.canonical_product_id;
  select * into restored from public.products where id = link_row.alias_product_id;
  if survivor.catalog_id is distinct from null
    or survivor.catalog_confirmed_at is distinct from null
    or not exists (select 1 from public.inventory where product_id = survivor.id and warehouse_qty = 4 and store_qty = 2)
    or restored.catalog_id is distinct from '61000000-0000-0000-0000-000000000003'
    or restored.brand is distinct from '로컬 D'
    or restored.image_url is distinct from 'https://local.invalid/d.png'
    or restored.catalog_confirmed_at is distinct from '2026-04-04 04:05:06+00'::timestamptz
    or not exists (select 1 from public.inventory where product_id = restored.id and warehouse_qty = 3 and store_qty = 2)
    or link_row.unmerged_at is null then
    raise exception 'keep-new unmerge did not restore metadata, quantities, or inactive alias';
  end if;
end $$;

-- keep_new_product=false also uses the reversible merge root and public unmerge.
select public.register_and_merge_product_reversible(
  '11000000-0000-0000-0000-000000000001',
  '{"name":"기존 상품 유지","barcode":"CAT-KEEP-OLD","category":"기타","unit_name":"개"}'::jsonb,
  '31000000-0000-0000-0000-000000000003',
  false, 0, 0,
  '76000000-0000-0000-0000-000000000001'
);
select public.unmerge_product_alias(
  (select id from public.product_alias_links where canonical_product_id = '31000000-0000-0000-0000-000000000003' and unmerged_at is null),
  4, 0, 2, 1,
  (select warehouse_version from public.inventory where product_id = '31000000-0000-0000-0000-000000000003'),
  (select store_version from public.inventory where product_id = '31000000-0000-0000-0000-000000000003'),
  (select warehouse_version from public.inventory where product_id = (select alias_product_id from public.product_alias_links where canonical_product_id = '31000000-0000-0000-0000-000000000003' order by merged_at desc limit 1)),
  (select store_version from public.inventory where product_id = (select alias_product_id from public.product_alias_links where canonical_product_id = '31000000-0000-0000-0000-000000000003' order by merged_at desc limit 1)),
  '77000000-0000-0000-0000-000000000001'
);

do $$
declare
  link_row public.product_alias_links%rowtype;
  survivor public.products%rowtype;
  restored public.products%rowtype;
begin
  select link.* into link_row from public.product_alias_links link
  where link.canonical_product_id = '31000000-0000-0000-0000-000000000003'
  order by link.merged_at desc limit 1;
  select * into survivor from public.products where id = link_row.canonical_product_id;
  select * into restored from public.products where id = link_row.alias_product_id;
  if survivor.catalog_id is distinct from '61000000-0000-0000-0000-000000000003'
    or survivor.brand is distinct from '로컬 C'
    or survivor.image_url is distinct from 'https://local.invalid/c.png'
    or survivor.catalog_confirmed_at is distinct from '2026-03-03 03:04:05+00'::timestamptz
    or not exists (select 1 from public.inventory where product_id = survivor.id and warehouse_qty = 4 and store_qty = 0)
    or restored.catalog_id is distinct from null
    or restored.brand is distinct from null
    or restored.image_url is distinct from null
    or restored.catalog_confirmed_at is distinct from null
    or not exists (select 1 from public.inventory where product_id = restored.id and warehouse_qty = 2 and store_qty = 1)
    or link_row.unmerged_at is null then
    raise exception 'keep-existing unmerge did not preserve metadata, quantities, or inactive alias';
  end if;
end $$;

-- Legacy snapshots without explicit 086 fields still restore their JSON metadata.
set local role postgres;
update public.products
set catalog_id = null, brand = null, image_url = null, catalog_confirmed_at = null, is_active = false
where id in ('31000000-0000-0000-0000-000000000002', '31000000-0000-0000-0000-000000000003');
update public.inventory
set warehouse_qty = 0, store_qty = 0
where product_id = '31000000-0000-0000-0000-000000000003';
insert into public.product_alias_links (
  store_id, canonical_product_id, alias_product_id, merged_by, merge_request_id,
  product_snapshot, barcode_snapshot, merge_inventory_snapshot
) values (
  '11000000-0000-0000-0000-000000000001',
  '31000000-0000-0000-0000-000000000001',
  '31000000-0000-0000-0000-000000000002',
  '21000000-0000-0000-0000-000000000001', '73000000-0000-0000-0000-000000000001',
  '{"catalog_id":"61000000-0000-0000-0000-000000000002","brand":"legacy brand","image_url":"https://legacy.invalid/image.png","catalog_confirmed_at":"2026-02-02T02:03:04Z"}'::jsonb,
  '{"rows":[]}'::jsonb, '{}'::jsonb
);
insert into public.product_alias_links (
  id, store_id, canonical_product_id, alias_product_id, merged_by, merge_request_id,
  product_snapshot, barcode_snapshot, merge_inventory_snapshot
) values (
  '78000000-0000-0000-0000-000000000001',
  '11000000-0000-0000-0000-000000000001',
  '31000000-0000-0000-0000-000000000001',
  '31000000-0000-0000-0000-000000000003',
  '21000000-0000-0000-0000-000000000001', '79000000-0000-0000-0000-000000000001',
  '{"name":"pre-catalog legacy"}'::jsonb, '{"rows":[]}'::jsonb, '{}'::jsonb
);
set local role authenticated;
select public.unmerge_product_alias(
  (select id from public.product_alias_links where alias_product_id = '31000000-0000-0000-0000-000000000002' and unmerged_at is null),
  10, 5, 3, 2,
  (select warehouse_version from public.inventory where product_id = '31000000-0000-0000-0000-000000000001'),
  (select store_version from public.inventory where product_id = '31000000-0000-0000-0000-000000000001'),
  (select warehouse_version from public.inventory where product_id = '31000000-0000-0000-0000-000000000002'),
  (select store_version from public.inventory where product_id = '31000000-0000-0000-0000-000000000002'),
  '74000000-0000-0000-0000-000000000001'
);
select public.unmerge_product_alias(
  '78000000-0000-0000-0000-000000000001',
  10, 5, 0, 0,
  (select warehouse_version from public.inventory where product_id = '31000000-0000-0000-0000-000000000001'),
  (select store_version from public.inventory where product_id = '31000000-0000-0000-0000-000000000001'),
  (select warehouse_version from public.inventory where product_id = '31000000-0000-0000-0000-000000000003'),
  (select store_version from public.inventory where product_id = '31000000-0000-0000-0000-000000000003'),
  '79000000-0000-0000-0000-000000000002'
);

do $$
begin
  if (select catalog_id from public.products where id = '31000000-0000-0000-0000-000000000002')
      is distinct from '61000000-0000-0000-0000-000000000002'
    or (select brand from public.products where id = '31000000-0000-0000-0000-000000000002') is distinct from 'legacy brand'
    or (select image_url from public.products where id = '31000000-0000-0000-0000-000000000002') is distinct from 'https://legacy.invalid/image.png'
    or (select catalog_confirmed_at from public.products where id = '31000000-0000-0000-0000-000000000002') is distinct from '2026-02-02T02:03:04Z'::timestamptz then
    raise exception 'legacy snapshot compatibility failed';
  end if;
end $$;

do $$
begin
  if not exists (select 1 from public.products
    where id = '31000000-0000-0000-0000-000000000003'
      and catalog_id is not distinct from null
      and brand is not distinct from null
      and image_url is not distinct from null
      and catalog_confirmed_at is not distinct from null) then
    raise exception 'pre-catalog snapshot did not restore four absent metadata keys';
  end if;
end $$;

set local role postgres;
do $$
begin
  if exists (
    select 1
    from catalog_before before_row
    full join public.product_catalog after_row on after_row.id = before_row.id
    where to_jsonb(before_row) is distinct from to_jsonb(after_row)
  ) then
    raise exception 'complete catalog rows or A/B/C GTIN mappings changed';
  end if;
end $$;

set local role authenticated;
set local role anon;
select set_config('request.jwt.claims', '{}', true);
do $$
declare
  denied boolean := false;
begin
  begin
    perform public.resolve_product_catalog_state('31000000-0000-0000-0000-000000000001');
  exception when others then
    denied := true;
  end;
  if not denied then raise exception 'unauthenticated catalog-state read was allowed'; end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"21000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
do $$
declare
  denied boolean := false;
begin
  begin
    perform public.resolve_product_catalog_state('31000000-0000-0000-0000-000000000001');
  exception when others then
    denied := true;
  end;
  if not denied then raise exception 'cross-store catalog-state read was allowed'; end if;
end $$;

rollback;
