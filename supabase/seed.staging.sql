-- Run only against the staging project after the dedicated test account has created `테스트 매장`.
do $$
declare
  staging_store_id uuid;
begin
  select id into strict staging_store_id
  from public.stores
  where name = '테스트 매장';

  insert into public.products (name, category, barcode, store_id)
  select '테스트 등록 바코드 상품', '기타', '8801234567893', staging_store_id
  where not exists (
    select 1 from public.products
    where store_id = staging_store_id and barcode = '8801234567893'
  );

  insert into public.product_catalog (gtin, canonical_name, source)
  values ('00036000291452', '테스트 후보 상품', 'staging-seed')
  on conflict (gtin) do update
  set canonical_name = excluded.canonical_name,
      source = excluded.source;
end
$$;
