begin;

do $$
declare
  staging_store_id uuid;
  registered_count integer;
  candidate_count integer;
begin
  select id into strict staging_store_id
  from public.stores
  where name = '테스트 매장';

  if exists (
    select 1 from public.products
    where store_id = staging_store_id
      and name not like '테스트%'
  ) then
    raise exception 'staging test store contains a product without the 테스트 prefix';
  end if;

  select count(*) into registered_count
  from public.products
  where store_id = staging_store_id
    and name = '테스트 등록 바코드 상품'
    and barcode = '8801234567893';
  if registered_count <> 1 then
    raise exception 'registered staging barcode fixture is missing or duplicated';
  end if;

  if exists (
    select 1 from public.products
    where store_id = staging_store_id
      and barcode = '00036000291452'
  ) then
    raise exception 'candidate GTIN must remain unregistered in the staging test store';
  end if;

  select count(*) into candidate_count
  from public.product_catalog
  where gtin = '00036000291452'
    and canonical_name = '테스트 후보 상품'
    and source = 'staging-seed';
  if candidate_count <> 1 then
    raise exception 'candidate catalog fixture is missing or duplicated';
  end if;
end
$$;

rollback;
