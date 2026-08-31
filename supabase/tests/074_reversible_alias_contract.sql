-- Run after a clean local migration reset. All fixtures are rolled back.

begin;

do $$
begin
  if exists (
    select 1
    from pg_proc function_row
    join pg_namespace namespace_row
      on namespace_row.oid = function_row.pronamespace
    where namespace_row.nspname = 'public'
      and function_row.prosecdef
      and has_function_privilege('anon', function_row.oid, 'EXECUTE')
  ) then
    raise exception 'anon can execute a SECURITY DEFINER function';
  end if;

  if exists (
    select 1
    from pg_proc function_row
    join pg_namespace namespace_row
      on namespace_row.oid = function_row.pronamespace
    where namespace_row.nspname = 'public'
      and function_row.prosecdef
      and not exists (
        select 1
        from unnest(coalesce(function_row.proconfig, array[]::text[])) setting
        where setting like 'search_path=%'
      )
  ) then
    raise exception 'a SECURITY DEFINER function has a mutable search_path';
  end if;
end;
$$;

insert into public.stores (id, name) values
  ('10000000-0000-0000-0000-000000000001', '보안 테스트 매장 A'),
  ('10000000-0000-0000-0000-000000000002', '보안 테스트 매장 B');

insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  '20000000-0000-0000-0000-000000000001',
  'authenticated',
  'authenticated',
  'security-test-a@example.invalid',
  '',
  clock_timestamp(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,
  clock_timestamp(),
  clock_timestamp()
);

insert into public.profiles (
  id,
  email,
  display_name,
  store_id,
  role
) values (
  '20000000-0000-0000-0000-000000000001',
  'security-test-a@example.invalid',
  '보안 테스트 관리자',
  '10000000-0000-0000-0000-000000000001',
  'store_admin'
);

insert into public.products (
  id,
  store_id,
  barcode,
  name,
  category,
  unit_name,
  is_active
) values
  (
    '30000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    'SECURITY-CANONICAL',
    '보안 테스트 대표 상품',
    '기타',
    '개',
    true
  ),
  (
    '30000000-0000-0000-0000-000000000002',
    '10000000-0000-0000-0000-000000000001',
    'SECURITY-ALIAS',
    '보안 테스트 원본 상품',
    '기타',
    '개',
    true
  ),
  (
    '30000000-0000-0000-0000-000000000003',
    '10000000-0000-0000-0000-000000000001',
    null,
    '보안 테스트 프랩 상품',
    '기타',
    '개',
    false
  ),
  (
    '30000000-0000-0000-0000-000000000004',
    '10000000-0000-0000-0000-000000000002',
    'SECURITY-OTHER-STORE',
    '보안 테스트 다른 매장 상품',
    '기타',
    '개',
    true
  );

insert into public.product_barcodes (
  id,
  product_id,
  store_id,
  barcode
) values (
  '40000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000002',
  '10000000-0000-0000-0000-000000000001',
  'SECURITY-ALIAS-SECONDARY'
);

insert into public.inventory (
  product_id,
  store_id,
  warehouse_qty,
  store_qty
) values
  (
    '30000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    10,
    5
  ),
  (
    '30000000-0000-0000-0000-000000000002',
    '10000000-0000-0000-0000-000000000001',
    3,
    2
  ),
  (
    '30000000-0000-0000-0000-000000000003',
    '10000000-0000-0000-0000-000000000001',
    0,
    0
  ),
  (
    '30000000-0000-0000-0000-000000000004',
    '10000000-0000-0000-0000-000000000002',
    1,
    1
  );

insert into public.prep_items (
  id,
  store_id,
  product_id,
  name,
  shelf_life_enabled,
  shelf_life_days,
  is_active
) values (
  '50000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000003',
  '보안 테스트 프랩',
  false,
  1,
  true
);

insert into public.prep_item_ingredients (
  id,
  store_id,
  prep_item_id,
  ingredient_product_id,
  quantity_per_unit,
  sort_order
) values (
  '50000000-0000-0000-0000-000000000002',
  '10000000-0000-0000-0000-000000000001',
  '50000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000002',
  2,
  1
);

insert into public.group_order_menus (
  id,
  store_id,
  name,
  sort_order,
  is_active
) values
  (
    '60000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    '보안 테스트 기존 메뉴',
    1,
    true
  ),
  (
    '60000000-0000-0000-0000-000000000002',
    '10000000-0000-0000-0000-000000000001',
    '보안 테스트 새 메뉴',
    2,
    true
  );

insert into public.group_order_recipe_ingredients (
  id,
  store_id,
  menu_id,
  product_id,
  quantity_per_item,
  quantity_unit,
  sort_order
) values (
  '60000000-0000-0000-0000-000000000003',
  '10000000-0000-0000-0000-000000000001',
  '60000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000002',
  1,
  '개',
  1
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"20000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);

do $$
begin
  begin
    perform public.merge_products_reversible(
      '30000000-0000-0000-0000-000000000001',
      '30000000-0000-0000-0000-000000000004',
      0,
      0,
      0,
      0,
      '70000000-0000-0000-0000-000000000001'
    );
    raise exception 'cross-store merge unexpectedly succeeded';
  exception
    when others then
      if sqlerrm = 'cross-store merge unexpectedly succeeded' then
        raise;
      end if;
  end;
end;
$$;

create temporary table alias_test_link on commit drop as
select (public.merge_products_reversible(
  '30000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000002',
  0,
  0,
  0,
  0,
  '70000000-0000-0000-0000-000000000002'
)).id as id;

do $$
declare
  first_link_id uuid;
  repeated_link_id uuid;
begin
  select id into first_link_id from alias_test_link;
  select (public.merge_products_reversible(
    '30000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000002',
    0,
    0,
    0,
    0,
    '70000000-0000-0000-0000-000000000002'
  )).id into repeated_link_id;

  if repeated_link_id is distinct from first_link_id then
    raise exception 'repeated merge request did not return the same link';
  end if;
end;
$$;

do $$
declare
  canonical_inventory public.inventory%rowtype;
  alias_inventory public.inventory%rowtype;
  resolved_id uuid;
begin
  select * into canonical_inventory
  from public.inventory
  where product_id = '30000000-0000-0000-0000-000000000001';

  select * into alias_inventory
  from public.inventory
  where product_id = '30000000-0000-0000-0000-000000000002';

  if canonical_inventory.warehouse_qty <> 13
    or canonical_inventory.store_qty <> 7
    or alias_inventory.warehouse_qty <> 0
    or alias_inventory.store_qty <> 0 then
    raise exception 'merge did not preserve location totals';
  end if;

  if (select is_active from public.products
      where id = '30000000-0000-0000-0000-000000000002') then
    raise exception 'alias product remained active after merge';
  end if;

  select product.id into resolved_id
  from public.resolve_product_by_barcode(
    '10000000-0000-0000-0000-000000000001',
    'SECURITY-ALIAS-SECONDARY'
  ) product;
  if resolved_id is distinct from '30000000-0000-0000-0000-000000000001' then
    raise exception 'alias barcode did not resolve to the canonical product';
  end if;

  select product.id into resolved_id
  from public.search_products_resolved(
    '10000000-0000-0000-0000-000000000001',
    '원본 상품',
    10
  ) product;
  if resolved_id is distinct from '30000000-0000-0000-0000-000000000001' then
    raise exception 'alias name did not resolve to the canonical product';
  end if;

  if (select ingredient_product_id
      from public.prep_item_ingredients
      where id = '50000000-0000-0000-0000-000000000002')
      is distinct from '30000000-0000-0000-0000-000000000002' then
    raise exception 'historical prep reference was rewritten during merge';
  end if;

  if (select product_id
      from public.group_order_recipe_ingredients
      where id = '60000000-0000-0000-0000-000000000003')
      is distinct from '30000000-0000-0000-0000-000000000002' then
    raise exception 'historical group-order reference was rewritten during merge';
  end if;
end;
$$;

select public.record_prep_operation(
  '50000000-0000-0000-0000-000000000001',
  '제조',
  1
);

insert into public.group_order_recipe_ingredients (
  id,
  store_id,
  menu_id,
  product_id,
  quantity_per_item,
  quantity_unit,
  sort_order
) values (
  '60000000-0000-0000-0000-000000000004',
  '10000000-0000-0000-0000-000000000001',
  '60000000-0000-0000-0000-000000000002',
  '30000000-0000-0000-0000-000000000002',
  1,
  '개',
  1
);

do $$
begin
  if (select store_qty from public.inventory
      where product_id = '30000000-0000-0000-0000-000000000001') <> 5 then
    raise exception 'prep operation did not consume canonical inventory';
  end if;
  if (select store_qty from public.inventory
      where product_id = '30000000-0000-0000-0000-000000000003') <> 1 then
    raise exception 'prep output inventory was not increased';
  end if;
  if not exists (
    select 1
    from public.inventory_logs
    where product_id = '30000000-0000-0000-0000-000000000001'
      and note like '[프랩 제조]%'
  ) then
    raise exception 'prep consumption log was not written to canonical product';
  end if;
  if (select product_id
      from public.group_order_recipe_ingredients
      where id = '60000000-0000-0000-0000-000000000004')
      is distinct from '30000000-0000-0000-0000-000000000001' then
    raise exception 'new group-order reference was not canonicalized';
  end if;
end;
$$;

do $$
declare
  link_id uuid;
  preview_row record;
  first_unmerge_id uuid;
  repeated_unmerge_id uuid;
begin
  select id into link_id from alias_test_link;
  select * into preview_row
  from public.preview_product_unmerge(link_id);

  select (public.unmerge_product_alias(
    link_id,
    preview_row.current_canonical_warehouse_qty - 1,
    preview_row.current_canonical_store_qty - 1,
    preview_row.current_alias_warehouse_qty + 1,
    preview_row.current_alias_store_qty + 1,
    preview_row.canonical_warehouse_version,
    preview_row.canonical_store_version,
    preview_row.alias_warehouse_version,
    preview_row.alias_store_version,
    '70000000-0000-0000-0000-000000000003'
  )).id into first_unmerge_id;

  select (public.unmerge_product_alias(
    link_id,
    preview_row.current_canonical_warehouse_qty - 1,
    preview_row.current_canonical_store_qty - 1,
    preview_row.current_alias_warehouse_qty + 1,
    preview_row.current_alias_store_qty + 1,
    preview_row.canonical_warehouse_version,
    preview_row.canonical_store_version,
    preview_row.alias_warehouse_version,
    preview_row.alias_store_version,
    '70000000-0000-0000-0000-000000000003'
  )).id into repeated_unmerge_id;

  if repeated_unmerge_id is distinct from first_unmerge_id then
    raise exception 'repeated unmerge request did not return the same link';
  end if;
end;
$$;

do $$
declare
  resolved_id uuid;
begin
  if not (select is_active from public.products
          where id = '30000000-0000-0000-0000-000000000002') then
    raise exception 'alias product was not reactivated after unmerge';
  end if;
  if (select warehouse_qty from public.inventory
      where product_id = '30000000-0000-0000-0000-000000000001') <> 12
    or (select warehouse_qty from public.inventory
        where product_id = '30000000-0000-0000-0000-000000000002') <> 1
    or (select store_qty from public.inventory
        where product_id = '30000000-0000-0000-0000-000000000001') <> 4
    or (select store_qty from public.inventory
        where product_id = '30000000-0000-0000-0000-000000000002') <> 1 then
    raise exception 'unmerge allocation did not preserve location totals';
  end if;

  select product.id into resolved_id
  from public.resolve_product_by_barcode(
    '10000000-0000-0000-0000-000000000001',
    'SECURITY-ALIAS-SECONDARY'
  ) product;
  if resolved_id is distinct from '30000000-0000-0000-0000-000000000002' then
    raise exception 'alias barcode was not restored after unmerge';
  end if;

  if (select ingredient_product_id
      from public.prep_item_ingredients
      where id = '50000000-0000-0000-0000-000000000002')
      is distinct from '30000000-0000-0000-0000-000000000002' then
    raise exception 'historical prep reference changed during unmerge';
  end if;
  if (select product_id
      from public.group_order_recipe_ingredients
      where id = '60000000-0000-0000-0000-000000000004')
      is distinct from '30000000-0000-0000-0000-000000000001' then
    raise exception 'connection created during merge moved during unmerge';
  end if;
end;
$$;

reset role;
rollback;
