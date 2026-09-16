-- Cross-store catalog behavior and privacy contract. Run in an isolated disposable DB.
begin;

insert into public.stores (id, name) values
  ('88000000-0000-0000-0000-000000000001', '공유 카탈로그 매장 A'),
  ('88000000-0000-0000-0000-000000000002', '공유 카탈로그 매장 B');

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', '88000000-0000-0000-0000-000000000011', 'authenticated', 'authenticated', 'shared-a@example.invalid', '', clock_timestamp(), '{}', '{}', clock_timestamp(), clock_timestamp()),
  ('00000000-0000-0000-0000-000000000000', '88000000-0000-0000-0000-000000000012', 'authenticated', 'authenticated', 'shared-b@example.invalid', '', clock_timestamp(), '{}', '{}', clock_timestamp(), clock_timestamp()),
  ('00000000-0000-0000-0000-000000000000', '88000000-0000-0000-0000-000000000013', 'authenticated', 'authenticated', 'shared-staff@example.invalid', '', clock_timestamp(), '{}', '{}', clock_timestamp(), clock_timestamp()),
  ('00000000-0000-0000-0000-000000000000', '88000000-0000-0000-0000-000000000014', 'authenticated', 'authenticated', 'shared-deleting@example.invalid', '', clock_timestamp(), '{}', '{}', clock_timestamp(), clock_timestamp());

insert into public.profiles (id, email, display_name, store_id, role, deletion_requested_at) values
  ('88000000-0000-0000-0000-000000000011', 'shared-a@example.invalid', '매장 A 사용자', '88000000-0000-0000-0000-000000000001', 'store_admin', null),
  ('88000000-0000-0000-0000-000000000012', 'shared-b@example.invalid', '매장 B 사용자', '88000000-0000-0000-0000-000000000002', 'store_admin', null),
  ('88000000-0000-0000-0000-000000000013', 'shared-staff@example.invalid', '매장 A 직원', '88000000-0000-0000-0000-000000000001', 'staff', null),
  ('88000000-0000-0000-0000-000000000014', 'shared-deleting@example.invalid', '삭제 요청 사용자', '88000000-0000-0000-0000-000000000001', 'store_admin', clock_timestamp());

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"88000000-0000-0000-0000-000000000011","role":"authenticated"}', true);

select public.create_product_with_inventory(
  '88000000-0000-0000-0000-000000000001',
  '{"name":"A 매장 공유 상품","barcode":"8809084013546","category":"음료","storage_type":"냉장","supplier_name":"공용 발주처","product_url":"https://orders.example.invalid/item/123?store=A&token=secret#tracking"}'::jsonb
);

create temporary table restored_product on commit drop as
select (public.create_product_with_inventory(
  '88000000-0000-0000-0000-000000000001',
  '{"name":"복구 전 상품","barcode":"legacy-shared-088"}'::jsonb
)).id as id;
update public.products set is_active = false where id = (select id from restored_product);
select public.restore_product_with_inventory(
  (select id from restored_product),
  '{"name":"복구 공유 상품","barcode":"036000291452","category":"원두","storage_type":"상온"}'::jsonb
);

select set_config('request.jwt.claims', '{"sub":"88000000-0000-0000-0000-000000000013","role":"authenticated"}', true);
select public.create_product_with_inventory(
  '88000000-0000-0000-0000-000000000001',
  '{"name":"직원 전용 상품","barcode":"4006381333931"}'::jsonb
);

select set_config('request.jwt.claims', '{"sub":"88000000-0000-0000-0000-000000000014","role":"authenticated"}', true);
select public.create_product_with_inventory(
  '88000000-0000-0000-0000-000000000001',
  '{"name":"삭제 요청자 상품","barcode":"5901234123457"}'::jsonb
);

select set_config('request.jwt.claims', '{"sub":"88000000-0000-0000-0000-000000000011","role":"authenticated"}', true);
create temporary table long_url_product on commit drop as
select (public.create_product_with_inventory(
  '88000000-0000-0000-0000-000000000001',
  jsonb_build_object('name', '긴 링크 상품', 'barcode', '5012345678900', 'product_url', 'https://orders.example.invalid/' || repeat('x', 2100))
)).id as id;

select plan(14);

select ok(
  not has_table_privilege('authenticated', 'public.product_catalog', 'SELECT'),
  'authenticated role cannot inspect the catalog table directly'
);
select ok(
  not has_table_privilege('authenticated', 'public.shared_catalog_lookup_quota', 'SELECT'),
  'authenticated role cannot inspect shared catalog lookup activity'
);
select ok(
  exists (select 1 from public.products where id = (select id from long_url_product)),
  'an overlong shared URL does not roll back local product registration'
);
select is(
  (select product_url from public.lookup_shared_product_catalog('05012345678900')),
  null::text,
  'an overlong URL is not published to the shared catalog'
);

select set_config('request.jwt.claims', '{"sub":"88000000-0000-0000-0000-000000000012","role":"authenticated"}', true);

select is(
  (select canonical_name from public.lookup_shared_product_catalog('08809084013546')),
  'A 매장 공유 상품',
  'store B receives the reusable product name'
);
select is(
  (select source from public.lookup_shared_product_catalog('08809084013546')),
  'catalog',
  'lookup source does not disclose tenant registration provenance'
);
select is(
  (select count(*) from public.lookup_shared_product_catalog('04006381333931')),
  0::bigint,
  'staff registrations are not published as cross-store defaults'
);
select is(
  (select count(*) from public.lookup_shared_product_catalog('05901234123457')),
  0::bigint,
  'deletion-requested accounts cannot publish cross-store defaults'
);
select is(
  (select category from public.lookup_shared_product_catalog('08809084013546')),
  '음료',
  'store B receives the reusable category'
);
select is(
  (select storage_type from public.lookup_shared_product_catalog('08809084013546')),
  '냉장',
  'store B receives the reusable storage type'
);
select is(
  (select supplier_name from public.lookup_shared_product_catalog('08809084013546')),
  '공용 발주처',
  'store B receives the reusable supplier name'
);
select is(
  (select product_url from public.lookup_shared_product_catalog('08809084013546')),
  'https://orders.example.invalid/item/123',
  'store B receives the reusable order URL'
);
select is(
  (select canonical_name from public.lookup_shared_product_catalog('00036000291452')),
  '복구 공유 상품',
  'restoring a registration also publishes reusable catalog defaults'
);
select is(
  (select count(*) from public.products where store_id = '88000000-0000-0000-0000-000000000001'),
  0::bigint,
  'store B cannot read store A product rows'
);

select * from finish();
rollback;
