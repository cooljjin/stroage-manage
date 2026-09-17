-- Cross-store sharing for supported scanned linear barcodes. Disposable DB only.
begin;

insert into public.stores (id, name) values
  ('89000000-0000-0000-0000-000000000001', '스캔 공유 매장 A'),
  ('89000000-0000-0000-0000-000000000002', '스캔 공유 매장 B'),
  ('89000000-0000-0000-0000-000000000003', '스캔 공유 매장 C');

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', '89000000-0000-0000-0000-000000000011', 'authenticated', 'authenticated', 'scan-a@example.invalid', '', clock_timestamp(), '{}', '{}', clock_timestamp(), clock_timestamp()),
  ('00000000-0000-0000-0000-000000000000', '89000000-0000-0000-0000-000000000012', 'authenticated', 'authenticated', 'scan-b@example.invalid', '', clock_timestamp(), '{}', '{}', clock_timestamp(), clock_timestamp()),
  ('00000000-0000-0000-0000-000000000000', '89000000-0000-0000-0000-000000000013', 'authenticated', 'authenticated', 'scan-staff@example.invalid', '', clock_timestamp(), '{}', '{}', clock_timestamp(), clock_timestamp()),
  ('00000000-0000-0000-0000-000000000000', '89000000-0000-0000-0000-000000000014', 'authenticated', 'authenticated', 'scan-c@example.invalid', '', clock_timestamp(), '{}', '{}', clock_timestamp(), clock_timestamp());

insert into public.profiles (id, email, display_name, store_id, role) values
  ('89000000-0000-0000-0000-000000000011', 'scan-a@example.invalid', '스캔 A', '89000000-0000-0000-0000-000000000001', 'store_admin'),
  ('89000000-0000-0000-0000-000000000012', 'scan-b@example.invalid', '스캔 B', '89000000-0000-0000-0000-000000000002', 'store_admin'),
  ('89000000-0000-0000-0000-000000000013', 'scan-staff@example.invalid', '스캔 직원', '89000000-0000-0000-0000-000000000001', 'staff'),
  ('89000000-0000-0000-0000-000000000014', 'scan-c@example.invalid', '스캔 C', '89000000-0000-0000-0000-000000000003', 'store_admin');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"89000000-0000-0000-0000-000000000011","role":"authenticated"}', true);
select plan(40);

select public.create_product_with_inventory(
  '89000000-0000-0000-0000-000000000001',
  '{"name":"공유 CODE128 토마토","barcode":"R011824490001","barcode_format":"CODE_128","category":"채소","storage_type":"냉장","supplier_name":"공용 발주처","product_url":"https://orders.example.invalid/item/tomato?store=A#tracking"}'::jsonb
);
select public.create_product_with_inventory(
  '89000000-0000-0000-0000-000000000001',
  '{"name":"공백 없는 CODE128","barcode":"PADDED","barcode_format":"CODE_128"}'::jsonb
);
select public.create_product_with_inventory(
  '89000000-0000-0000-0000-000000000001',
  '{"name":"공백 보존 CODE128","barcode":" PADDED ","barcode_format":"CODE_128"}'::jsonb
);
select public.create_product_with_inventory(
  '89000000-0000-0000-0000-000000000001',
  '{"name":"숫자 CODE128","barcode":"05012345678900","barcode_format":"CODE_128"}'::jsonb
);
select set_config('request.jwt.claims', '{"sub":"89000000-0000-0000-0000-000000000014","role":"authenticated"}', true);
select public.create_product_with_inventory(
  '89000000-0000-0000-0000-000000000003',
  '{"name":"충돌 오염 시도","barcode":"R011824490001","barcode_format":"CODE_128","category":"오염"}'::jsonb
);
select set_config('request.jwt.claims', '{"sub":"89000000-0000-0000-0000-000000000012","role":"authenticated"}', true);
select public.create_product_with_inventory(
  '89000000-0000-0000-0000-000000000002',
  '{"name":"CODE39 별도 상품","barcode":"R011824490001","barcode_format":"CODE_39","category":"기타"}'::jsonb
);
select set_config('request.jwt.claims', '{"sub":"89000000-0000-0000-0000-000000000011","role":"authenticated"}', true);
select public.create_product_with_inventory(
  '89000000-0000-0000-0000-000000000001',
  '{"name":"공유 GTIN 상품","barcode":"8809084013546","barcode_format":"EAN_13","category":"음료"}'::jsonb
);
select public.create_product_with_inventory(
  '89000000-0000-0000-0000-000000000001',
  '{"name":"형식 미확인 상품","barcode":"UNREVIEWED-1"}'::jsonb
);
select ok(public.publish_existing_product_defaults((select id from public.products where barcode = 'UNREVIEWED-1'), 'CODE_93'), 'admin can publish a reviewed existing product');
select public.create_product_with_inventory(
  '89000000-0000-0000-0000-000000000001',
  '{"name":"형식 없는 기존 GTIN","barcode":"036000291452","category":"음료"}'::jsonb
);
select public.create_product_with_inventory(
  '89000000-0000-0000-0000-000000000001',
  '{"name":"잘못된 소문자 형식","barcode":"LOWER-FORMAT","barcode_format":"code_128"}'::jsonb
);
select set_config('request.jwt.claims', '{"sub":"89000000-0000-0000-0000-000000000013","role":"authenticated"}', true);
select public.create_product_with_inventory(
  '89000000-0000-0000-0000-000000000001',
  '{"name":"직원 ITF 상품","barcode":"001122","barcode_format":"ITF"}'::jsonb
);
select set_config('request.jwt.claims', '{"sub":"89000000-0000-0000-0000-000000000011","role":"authenticated"}', true);
select public.merge_products_reversible(
  (select id from public.products where name = '공유 CODE128 토마토'),
  (select id from public.products where name = '공백 보존 CODE128'),
  0, 0, 0, 0, '89000000-0000-4000-8000-000000000099'
);
select public.merge_products_reversible(
  (select id from public.products where name = '공유 CODE128 토마토'),
  (select id from public.products where name = '공백 없는 CODE128'),
  0, 0, 0, 0, '89000000-0000-4000-8000-000000000100'
);

select ok(not has_table_privilege('authenticated', 'public.shared_product_defaults', 'SELECT'), 'shared defaults table is not directly readable');
select is((select barcode_format from public.products where name = '공유 CODE128 토마토'), 'CODE_128', 'trusted scan format is stored with the tenant product');
select is((select barcode from public.products where name = '공백 보존 CODE128'), ' PADDED ', 'tenant product preserves the exact scanned payload');
select is((select count(*) from public.products where name in ('공백 없는 CODE128', '공백 보존 CODE128')), 2::bigint, 'trim-distinct non-GTIN payloads coexist regardless of creation order');
select is((select catalog_id from public.products where name = '숫자 CODE128'), null::uuid, 'numeric non-GTIN never links to the GTIN catalog');
select is((select barcode from public.product_barcodes where barcode = ' PADDED '), ' PADDED ', 'merge preserves the exact non-GTIN alias');
select is((select barcode from public.product_barcodes where barcode = 'PADDED'), 'PADDED', 'later merge preserves a trim-equivalent exact alias');
select is((select count(*) from public.product_barcodes where product_id = (select id from public.products where name = '공유 CODE128 토마토') and barcode in ('PADDED', ' PADDED ')), 2::bigint, 'trim-equivalent aliases coexist on one canonical product');
select is((select name from public.resolve_product_by_barcode('89000000-0000-0000-0000-000000000001', ' PADDED ')), '공유 CODE128 토마토', 'exact merged non-GTIN alias resolves locally');
select is((select name from public.resolve_product_by_barcode('89000000-0000-0000-0000-000000000001', 'PADDED')), '공유 CODE128 토마토', 'unpadded merged alias resolves exactly to the canonical product');
select is((select barcode_format from public.products where name = '직원 ITF 상품'), 'ITF', 'staff scan format is retained without public publication');
select ok(exists(select 1 from public.products where name = '잘못된 소문자 형식'), 'invalid format metadata does not roll back the local save');
select is((select barcode_format from public.products where name = '잘못된 소문자 형식'), null, 'invalid format metadata is not persisted');
reset role;
select is((select count(*) from public.shared_product_defaults), 8::bigint, 'only eligible reviewed identities and valid GTINs are published');
select is((select identity_value from public.shared_product_defaults where canonical_name = '공백 보존 CODE128'), ' PADDED ', 'shared identity matches the exact local payload');
set local role authenticated;

select set_config('request.jwt.claims', '{"sub":"89000000-0000-0000-0000-000000000012","role":"authenticated"}', true);

select is((select status from public.lookup_shared_product_catalog_v2('R011824490001', 'CODE_128')), 'hit', 'CODE128 lookup hits');
select is((select canonical_name from public.lookup_shared_product_catalog_v2('R011824490001', 'CODE_128')), '공유 CODE128 토마토', 'first writer remains stable after a conflicting publication');
select is((select category from public.lookup_shared_product_catalog_v2('R011824490001', 'CODE_128')), '채소', 'store B receives category');
select is((select storage_type from public.lookup_shared_product_catalog_v2('R011824490001', 'CODE_128')), '냉장', 'store B receives storage type');
select is((select supplier_name from public.lookup_shared_product_catalog_v2('R011824490001', 'CODE_128')), '공용 발주처', 'store B receives supplier');
select is((select product_url from public.lookup_shared_product_catalog_v2('R011824490001', 'CODE_128')), 'https://orders.example.invalid/item/tomato', 'shared URL is sanitized');
select is((select source from public.lookup_shared_product_catalog_v2('R011824490001', 'CODE_128')), 'catalog', 'source is provenance-neutral');
select is((select canonical_name from public.lookup_shared_product_catalog_v2('R011824490001', 'CODE_39')), 'CODE39 별도 상품', 'same payload in another format remains distinct');
select is((select canonical_name from public.lookup_shared_product_catalog_v2('8809084013546', 'EAN_13')), '공유 GTIN 상품', 'EAN13 maps into unified shared defaults');
select is((select canonical_name from public.lookup_shared_product_catalog_v2('08809084013546', 'GTIN14')), '공유 GTIN 상품', 'GTIN14 resolves the same identity');
select is((select canonical_name from public.lookup_shared_product_catalog_v2('036000291452', 'UPC_A')), '형식 없는 기존 GTIN', 'formatless GTIN creation remains available through v2');
select is((select status from public.lookup_shared_product_catalog_v2('UNREVIEWED-1', 'UNKNOWN')), 'invalid', 'unknown formats are rejected');
select is((select status from public.lookup_shared_product_catalog_v2('12345', 'ITF')), 'invalid', 'malformed ITF is rejected');
select is((select count(*) from public.products where store_id = '89000000-0000-0000-0000-000000000001'), 0::bigint, 'store B cannot read store A products');
do $$ begin
  for attempt in 1..89 loop
    perform * from public.lookup_shared_product_catalog_v2('R011824490001', 'CODE_128');
  end loop;
end $$;
select is((select status from public.lookup_shared_product_catalog_v2('R011824490001', 'CODE_128')), 'rate_limited', 'the 101st valid lookup returns an explicit quota status');
select is((select count(*) from public.lookup_shared_product_catalog('08809084013546')), 0::bigint, 'legacy lookup shares the same quota cap');
reset role;
select is((select consumed from public.shared_catalog_lookup_quota where user_id = '89000000-0000-0000-0000-000000000012'), 100, 'quota stops at exactly 100 valid lookup actions');
select is((select identity_value from public.normalize_shared_barcode_identity('Code93-x', 'CODE_93')), 'Code93-x', 'CODE_93 remains lossless');
select is((select identity_value from public.normalize_shared_barcode_identity('123456', 'ITF')), '123456', 'ITF accepts even-length digits');
select is((select identity_value from public.normalize_shared_barcode_identity('1234', 'CODABAR')), '1234', 'CODABAR accepts decoder-stripped guards');
select is((select identity_value from public.normalize_shared_barcode_identity(' PADDED ', 'CODE_128')), ' PADDED ', 'printable payload padding is preserved exactly');
select is((select canonical_name from public.shared_product_defaults where identity_format = 'CODE_128' and identity_value = 'PADDED'), '공백 없는 CODE128', 'unpadded shared identity remains distinct');
select is((select count(*) from public.normalize_shared_barcode_identity('é', 'CODE_39')), 0::bigint, 'Unicode is rejected consistently with the client');
select is((select count(*) from public.normalize_shared_barcode_identity('LOWER', 'code_128')), 0::bigint, 'format labels are strict and never silently normalized');

select * from finish();
rollback;
