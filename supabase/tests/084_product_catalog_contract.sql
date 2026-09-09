begin;

insert into public.product_catalog (id, gtin, canonical_name, source)
values (
  '84000000-0000-0000-0000-000000000001',
  '00036000291452',
  '계약 테스트 상품',
  'contract-test'
);

do $$
declare
  sqlstate_code text;
  constraint_name text;
begin
  begin
    insert into public.product_catalog (gtin, canonical_name, source)
    values ('00036000291453', '잘못된 체크 숫자', 'contract-test');
    raise exception 'invalid GTIN checksum was accepted';
  exception
    when others then
      get stacked diagnostics sqlstate_code = returned_sqlstate,
        constraint_name = constraint_name;
      if sqlstate_code <> '23514'
        or constraint_name <> 'product_catalog_gtin_check' then
        raise exception 'invalid GTIN checksum raised %, %', sqlstate_code,
          constraint_name;
      end if;
  end;

  begin
    insert into public.product_catalog (gtin, canonical_name, source)
    values ('0003600029145X', '잘못된 GTIN 문자', 'contract-test');
    raise exception 'malformed GTIN was accepted';
  exception
    when others then
      get stacked diagnostics sqlstate_code = returned_sqlstate,
        constraint_name = constraint_name;
      if sqlstate_code <> '23514'
        or constraint_name <> 'product_catalog_gtin_check' then
        raise exception 'malformed GTIN raised %, %', sqlstate_code,
          constraint_name;
      end if;
  end;

  begin
    insert into public.product_catalog (gtin, canonical_name, source)
    values ('0003600029145', '길이가 잘못된 GTIN', 'contract-test');
    raise exception 'short GTIN was accepted';
  exception
    when others then
      get stacked diagnostics sqlstate_code = returned_sqlstate,
        constraint_name = constraint_name;
      if sqlstate_code <> '23514'
        or constraint_name <> 'product_catalog_gtin_check' then
        raise exception 'short GTIN raised %, %', sqlstate_code,
          constraint_name;
      end if;
  end;

  begin
    insert into public.product_catalog (gtin, canonical_name, source)
    values ('00036000291452', '중복 표준 GTIN', 'contract-test');
    raise exception 'canonical GTIN duplicate was accepted';
  exception
    when others then
      get stacked diagnostics sqlstate_code = returned_sqlstate,
        constraint_name = constraint_name;
      if sqlstate_code <> '23505'
        or constraint_name <> 'product_catalog_gtin_key' then
        raise exception 'canonical GTIN duplicate raised %, %', sqlstate_code,
          constraint_name;
      end if;
  end;
end;
$$;

-- Product store triggers need an authenticated store fixture; bypass only the
-- unrelated legacy store-scope trigger while testing this catalog FK.
alter table public.products disable trigger fill_products_store_id;

insert into public.products (id, name, category, store_id, catalog_id)
values (
  '84000000-0000-0000-0000-000000000002',
  '연결 테스트 상품',
  '기타',
  '00000000-0000-0000-0000-000000000001',
  '84000000-0000-0000-0000-000000000001'
);

do $$
declare
  sqlstate_code text;
  constraint_name text;
begin
  begin
    insert into public.products (name, category, store_id, catalog_id)
    values ('없는 카탈로그 상품', '기타',
      '00000000-0000-0000-0000-000000000001',
      '84000000-0000-0000-0000-000000000099');
    raise exception 'missing catalog foreign key was accepted';
  exception
    when others then
      get stacked diagnostics sqlstate_code = returned_sqlstate,
        constraint_name = constraint_name;
      if sqlstate_code <> '23503'
        or constraint_name <> 'products_catalog_id_fkey' then
        raise exception 'missing catalog foreign key raised %, %', sqlstate_code,
          constraint_name;
      end if;
  end;
end;
$$;

insert into public.products (id, name, category, store_id)
values ('84000000-0000-0000-0000-000000000003', '기존 호환 상품', '기타', '00000000-0000-0000-0000-000000000001');

alter table public.products enable trigger fill_products_store_id;

delete from public.product_catalog
where id = '84000000-0000-0000-0000-000000000001';

do $$
declare
  linked_catalog_id uuid;
  legacy_catalog_id uuid;
  legacy_brand text;
  legacy_image_url text;
  legacy_confirmed_at timestamptz;
begin
  select catalog_id into linked_catalog_id from public.products
  where id = '84000000-0000-0000-0000-000000000002';
  if linked_catalog_id is not null then
    raise exception 'catalog foreign key was not cleared on delete';
  end if;

  select catalog_id, brand, image_url, catalog_confirmed_at
    into legacy_catalog_id, legacy_brand, legacy_image_url, legacy_confirmed_at
  from public.products where id = '84000000-0000-0000-0000-000000000003';
  if legacy_catalog_id is not null or legacy_brand is not null
    or legacy_image_url is not null or legacy_confirmed_at is not null then
    raise exception 'legacy product catalog fields must default to null';
  end if;
end;
$$;

do $$
declare
  foreign_key_action "char";
begin
  if to_regclass('public.product_catalog') is null then
    raise exception 'product_catalog table is missing';
  end if;

  if not public.is_valid_gtin14('00036000291452')
    or public.is_valid_gtin14('00036000291453')
    or public.is_valid_gtin14('8801234567890') then
    raise exception 'GTIN validation does not match the approved fixtures';
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.product_catalog'::regclass
      and conname = 'product_catalog_gtin_check'
      and pg_get_constraintdef(oid) like '%is_valid_gtin14%'
  ) then
    raise exception 'GTIN validation constraint is missing';
  end if;

  select confdeltype into foreign_key_action
  from pg_constraint
  where conrelid = 'public.products'::regclass
    and conname = 'products_catalog_id_fkey';
  if foreign_key_action is distinct from 'n' then
    raise exception 'products.catalog_id must use ON DELETE SET NULL';
  end if;

  if exists (
    select 1
    from pg_attribute
    where attrelid = 'public.products'::regclass
      and attname in ('catalog_id', 'brand', 'image_url', 'catalog_confirmed_at')
      and attnotnull
  ) then
    raise exception 'new products columns must remain nullable for legacy rows';
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'product_catalog'
      and policyname = 'Authenticated users can read product catalog'
      and roles = array['authenticated']::name[]
      and cmd = 'SELECT'
  ) then
    raise exception 'authenticated catalog read policy is missing';
  end if;

  if not exists (
    select 1
    from pg_class
    where oid = 'public.product_catalog'::regclass
      and relrowsecurity
  ) then
    raise exception 'product_catalog row level security is disabled';
  end if;

  if not has_table_privilege('authenticated', 'public.product_catalog', 'SELECT')
    or has_table_privilege('anon', 'public.product_catalog', 'SELECT') then
    raise exception 'catalog read privileges are not protected';
  end if;

  if has_table_privilege('public', 'public.product_catalog', 'INSERT')
    or has_table_privilege('anon', 'public.product_catalog', 'INSERT')
    or has_table_privilege('authenticated', 'public.product_catalog', 'INSERT')
    or has_table_privilege('authenticated', 'public.product_catalog', 'UPDATE')
    or has_table_privilege('authenticated', 'public.product_catalog', 'DELETE') then
    raise exception 'ordinary roles can write product_catalog directly';
  end if;

  if has_function_privilege('public', 'public.is_valid_gtin14(text)', 'EXECUTE')
    or has_function_privilege('anon', 'public.is_valid_gtin14(text)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.is_valid_gtin14(text)', 'EXECUTE') then
    raise exception 'GTIN helper is publicly executable';
  end if;
end;
$$;

reset role;
insert into public.product_catalog (id, gtin, canonical_name, source)
values ('84000000-0000-0000-0000-000000000004', '00036000291452', '읽기 테스트 상품', 'contract-test');

set role authenticated;
select set_config('request.jwt.claims', '{"sub":"84000000-0000-0000-0000-000000000010","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '84000000-0000-0000-0000-000000000010', true);

do $$
declare
  visible_count integer;
begin
  select count(*) into visible_count from public.product_catalog;
  if visible_count <> 1 then raise exception 'authenticated user cannot read product catalog'; end if;
end;
$$;

do $$
begin
  begin
    insert into public.product_catalog (gtin, canonical_name, source)
    values ('00036000291469', '인증 사용자 쓰기', 'contract-test');
    raise exception 'authenticated user can insert product catalog rows';
  exception when insufficient_privilege then null;
    when others then raise;
  end;
  begin
    update public.product_catalog set canonical_name = '인증 사용자 수정';
    raise exception 'authenticated user can update product catalog rows';
  exception when insufficient_privilege then null;
    when others then raise;
  end;
  begin
    delete from public.product_catalog;
    raise exception 'authenticated user can delete product catalog rows';
  exception when insufficient_privilege then null;
    when others then raise;
  end;
end;
$$;

select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '', true);
do $$
declare
  visible_count integer;
begin
  select count(*) into visible_count from public.product_catalog;
  if visible_count <> 0 then raise exception 'authenticated user without UID can read product catalog'; end if;
end;
$$;

reset role;
set role anon;
select set_config('request.jwt.claims', '{}', true);
select set_config('request.jwt.claim.sub', '', true);
do $$
declare
  visible_count integer;
  sqlstate_code text;
begin
  begin
    select count(*) into visible_count from public.product_catalog;
    raise exception 'anon user can read product catalog';
  exception when others then
    get stacked diagnostics sqlstate_code = returned_sqlstate;
    if sqlstate_code <> '42501' then
      raise exception 'anonymous catalog read raised unexpected SQLSTATE %', sqlstate_code;
    end if;
  end;
end;
$$;

do $$
begin
  begin
    insert into public.product_catalog (gtin, canonical_name, source)
    values ('00036000291476', '익명 사용자 쓰기', 'contract-test');
    raise exception 'anon user can insert product catalog rows';
  exception when insufficient_privilege then null;
    when others then raise;
  end;
  begin
    update public.product_catalog set canonical_name = '익명 사용자 수정';
    raise exception 'anon user can update product catalog rows';
  exception when insufficient_privilege then null;
    when others then raise;
  end;
  begin
    delete from public.product_catalog;
    raise exception 'anon user can delete product catalog rows';
  exception when insufficient_privilege then null;
    when others then raise;
  end;
end;
$$;

reset role;
rollback;
