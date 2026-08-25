-- Edge-case contract for reversible aliases. All fixtures are rolled back.

begin;

insert into public.stores (id, name)
values ('13000000-0000-0000-0000-000000000001', '병합 보호 테스트 매장');

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
  '23000000-0000-0000-0000-000000000001',
  'authenticated',
  'authenticated',
  'alias-guard@example.invalid',
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
  '23000000-0000-0000-0000-000000000001',
  'alias-guard@example.invalid',
  '병합 보호 테스트 직원',
  '13000000-0000-0000-0000-000000000001',
  'staff'
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
    '33000000-0000-0000-0000-000000000001',
    '13000000-0000-0000-0000-000000000001',
    'ALIAS-GUARD-CANONICAL',
    '병합 보호 대표 상품',
    '기타',
    '개',
    true
  ),
  (
    '33000000-0000-0000-0000-000000000002',
    '13000000-0000-0000-0000-000000000001',
    'ALIAS-GUARD-SOURCE-A',
    '병합 보호 원본 A',
    '기타',
    '개',
    true
  ),
  (
    '33000000-0000-0000-0000-000000000003',
    '13000000-0000-0000-0000-000000000001',
    'ALIAS-GUARD-SOURCE-B',
    '병합 보호 원본 B',
    '기타',
    '개',
    true
  ),
  (
    '33000000-0000-0000-0000-000000000004',
    '13000000-0000-0000-0000-000000000001',
    'ALIAS-GUARD-NESTED-TARGET',
    '병합 보호 중첩 대상',
    '기타',
    '개',
    true
  ),
  (
    '33000000-0000-0000-0000-000000000005',
    '13000000-0000-0000-0000-000000000001',
    'ALIAS-GUARD-CONFLICT-PRODUCT',
    '병합 보호 충돌 상품',
    '기타',
    '개',
    true
  );

insert into public.inventory (
  product_id,
  store_id,
  warehouse_qty,
  store_qty
) values
  (
    '33000000-0000-0000-0000-000000000001',
    '13000000-0000-0000-0000-000000000001',
    4,
    4
  ),
  (
    '33000000-0000-0000-0000-000000000002',
    '13000000-0000-0000-0000-000000000001',
    1,
    2
  ),
  (
    '33000000-0000-0000-0000-000000000003',
    '13000000-0000-0000-0000-000000000001',
    3,
    1
  ),
  (
    '33000000-0000-0000-0000-000000000004',
    '13000000-0000-0000-0000-000000000001',
    0,
    0
  ),
  (
    '33000000-0000-0000-0000-000000000005',
    '13000000-0000-0000-0000-000000000001',
    0,
    0
  );

insert into public.product_barcodes (
  id,
  product_id,
  store_id,
  barcode
) values
  (
    '43000000-0000-0000-0000-000000000001',
    '33000000-0000-0000-0000-000000000002',
    '13000000-0000-0000-0000-000000000001',
    'ALIAS-GUARD-SOURCE-A-SECONDARY'
  ),
  (
    '43000000-0000-0000-0000-000000000002',
    '33000000-0000-0000-0000-000000000003',
    '13000000-0000-0000-0000-000000000001',
    'ALIAS-GUARD-SOURCE-B-SECONDARY'
  ),
  (
    '43000000-0000-0000-0000-000000000003',
    '33000000-0000-0000-0000-000000000005',
    '13000000-0000-0000-0000-000000000001',
    'ALIAS-GUARD-SOURCE-A'
  );

insert into public.mobile_inventory_sessions (
  id,
  store_id,
  product_id,
  user_id,
  entry_source,
  status,
  warehouse_qty_started,
  store_qty_started,
  warehouse_qty_current,
  store_qty_current,
  inventory_updated_at
) select
  '53000000-0000-0000-0000-000000000001',
  inventory.store_id,
  inventory.product_id,
  '23000000-0000-0000-0000-000000000001',
  'operation',
  'open',
  inventory.warehouse_qty,
  inventory.store_qty,
  inventory.warehouse_qty,
  inventory.store_qty,
  inventory.updated_at
from public.inventory inventory
where inventory.product_id = '33000000-0000-0000-0000-000000000001';

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"23000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);

do $$
begin
  begin
    perform public.merge_products_reversible(
      '33000000-0000-0000-0000-000000000001',
      '33000000-0000-0000-0000-000000000002',
      0,
      0,
      0,
      0,
      '73000000-0000-0000-0000-000000000001'
    );
    raise exception 'merge unexpectedly ignored an open mobile session';
  exception
    when others then
      if sqlerrm = 'merge unexpectedly ignored an open mobile session'
        or position('열린 모바일 재고 세션' in sqlerrm) = 0 then
        raise;
      end if;
  end;
end;
$$;

reset role;
update public.mobile_inventory_sessions
set status = 'finalized',
    finalized_at = clock_timestamp()
where id = '53000000-0000-0000-0000-000000000001';

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"23000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);

do $$
begin
  begin
    perform public.merge_products_reversible(
      '33000000-0000-0000-0000-000000000001',
      '33000000-0000-0000-0000-000000000002',
      99,
      0,
      0,
      0,
      '73000000-0000-0000-0000-000000000002'
    );
    raise exception 'merge unexpectedly accepted stale inventory versions';
  exception
    when others then
      if sqlerrm = 'merge unexpectedly accepted stale inventory versions'
        or position('다른 직원이 재고를 먼저 변경했습니다' in sqlerrm) = 0 then
        raise;
      end if;
  end;

  begin
    perform public.merge_products_reversible(
      '33000000-0000-0000-0000-000000000001',
      '33000000-0000-0000-0000-000000000002',
      0,
      0,
      0,
      0,
      '73000000-0000-0000-0000-000000000003'
    );
    raise exception 'merge unexpectedly accepted a conflicting barcode';
  exception
    when others then
      if sqlerrm = 'merge unexpectedly accepted a conflicting barcode'
        or position('바코드가 다른 상품과 충돌' in sqlerrm) = 0 then
        raise;
      end if;
  end;
end;
$$;

reset role;
update public.product_barcodes
set barcode = 'ALIAS-GUARD-CONFLICT-RESOLVED'
where id = '43000000-0000-0000-0000-000000000003';

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"23000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);

create temporary table alias_guard_links (
  alias_name text primary key,
  link_id uuid not null
) on commit drop;

insert into alias_guard_links (alias_name, link_id)
select 'A', (public.merge_products_reversible(
  '33000000-0000-0000-0000-000000000001',
  '33000000-0000-0000-0000-000000000002',
  canonical_inventory.warehouse_version,
  canonical_inventory.store_version,
  alias_inventory.warehouse_version,
  alias_inventory.store_version,
  '73000000-0000-0000-0000-000000000004'
)).id
from public.inventory canonical_inventory
cross join public.inventory alias_inventory
where canonical_inventory.product_id = '33000000-0000-0000-0000-000000000001'
  and alias_inventory.product_id = '33000000-0000-0000-0000-000000000002';

insert into alias_guard_links (alias_name, link_id)
select 'B', (public.merge_products_reversible(
  '33000000-0000-0000-0000-000000000001',
  '33000000-0000-0000-0000-000000000003',
  canonical_inventory.warehouse_version,
  canonical_inventory.store_version,
  alias_inventory.warehouse_version,
  alias_inventory.store_version,
  '73000000-0000-0000-0000-000000000005'
)).id
from public.inventory canonical_inventory
cross join public.inventory alias_inventory
where canonical_inventory.product_id = '33000000-0000-0000-0000-000000000001'
  and alias_inventory.product_id = '33000000-0000-0000-0000-000000000003';

do $$
declare
  active_alias_count integer;
begin
  select count(*) into active_alias_count
  from public.product_alias_links link
  where link.canonical_product_id = '33000000-0000-0000-0000-000000000001'
    and link.unmerged_at is null;

  if active_alias_count <> 2 then
    raise exception 'canonical product did not retain two independent aliases';
  end if;

  if (select warehouse_qty from public.inventory
      where product_id = '33000000-0000-0000-0000-000000000001') <> 8
    or (select store_qty from public.inventory
        where product_id = '33000000-0000-0000-0000-000000000001') <> 7 then
    raise exception 'multi-alias merge did not preserve location totals';
  end if;

  begin
    perform public.merge_products_reversible(
      '33000000-0000-0000-0000-000000000004',
      '33000000-0000-0000-0000-000000000001',
      0,
      0,
      (select warehouse_version from public.inventory
       where product_id = '33000000-0000-0000-0000-000000000001'),
      (select store_version from public.inventory
       where product_id = '33000000-0000-0000-0000-000000000001'),
      '73000000-0000-0000-0000-000000000006'
    );
    raise exception 'nested merge unexpectedly succeeded';
  exception
    when others then
      if sqlerrm = 'nested merge unexpectedly succeeded'
        or position('다른 원본을 가진 대표 상품' in sqlerrm) = 0 then
        raise;
      end if;
  end;
end;
$$;

do $$
declare
  link_id uuid;
  preview_row record;
begin
  select link.link_id into link_id
  from alias_guard_links link
  where link.alias_name = 'A';

  select * into preview_row
  from public.preview_product_unmerge(link_id);

  begin
    perform public.unmerge_product_alias(
      link_id,
      preview_row.current_canonical_warehouse_qty,
      preview_row.current_canonical_store_qty,
      -1,
      0,
      preview_row.canonical_warehouse_version,
      preview_row.canonical_store_version,
      preview_row.alias_warehouse_version,
      preview_row.alias_store_version,
      '73000000-0000-0000-0000-000000000007'
    );
    raise exception 'unmerge unexpectedly accepted a negative allocation';
  exception
    when others then
      if sqlerrm = 'unmerge unexpectedly accepted a negative allocation'
        or position('0 이상' in sqlerrm) = 0 then
        raise;
      end if;
  end;

  begin
    perform public.unmerge_product_alias(
      link_id,
      preview_row.current_canonical_warehouse_qty,
      preview_row.current_canonical_store_qty,
      1,
      0,
      preview_row.canonical_warehouse_version,
      preview_row.canonical_store_version,
      preview_row.alias_warehouse_version,
      preview_row.alias_store_version,
      '73000000-0000-0000-0000-000000000008'
    );
    raise exception 'unmerge unexpectedly accepted mismatched location totals';
  exception
    when others then
      if sqlerrm = 'unmerge unexpectedly accepted mismatched location totals'
        or position('위치별 배분 합계' in sqlerrm) = 0 then
        raise;
      end if;
  end;

  begin
    perform public.unmerge_product_alias(
      link_id,
      preview_row.current_canonical_warehouse_qty,
      preview_row.current_canonical_store_qty,
      0,
      0,
      preview_row.canonical_warehouse_version + 1,
      preview_row.canonical_store_version,
      preview_row.alias_warehouse_version,
      preview_row.alias_store_version,
      '73000000-0000-0000-0000-000000000009'
    );
    raise exception 'unmerge unexpectedly accepted stale inventory versions';
  exception
    when others then
      if sqlerrm = 'unmerge unexpectedly accepted stale inventory versions'
        or position('다른 직원이 재고를 먼저 변경했습니다' in sqlerrm) = 0 then
        raise;
      end if;
  end;
end;
$$;

reset role;
update public.mobile_inventory_sessions
set status = 'open',
    finalized_at = null
where id = '53000000-0000-0000-0000-000000000001';

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"23000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);

do $$
declare
  link_id uuid;
  preview_row record;
begin
  select link.link_id into link_id
  from alias_guard_links link
  where link.alias_name = 'A';
  select * into preview_row from public.preview_product_unmerge(link_id);

  if not preview_row.has_open_mobile_session then
    raise exception 'unmerge preview missed an open mobile session';
  end if;

  begin
    perform public.unmerge_product_alias(
      link_id,
      preview_row.current_canonical_warehouse_qty,
      preview_row.current_canonical_store_qty,
      0,
      0,
      preview_row.canonical_warehouse_version,
      preview_row.canonical_store_version,
      preview_row.alias_warehouse_version,
      preview_row.alias_store_version,
      '73000000-0000-0000-0000-000000000010'
    );
    raise exception 'unmerge unexpectedly ignored an open mobile session';
  exception
    when others then
      if sqlerrm = 'unmerge unexpectedly ignored an open mobile session'
        or position('열린 모바일 재고 세션' in sqlerrm) = 0 then
        raise;
      end if;
  end;
end;
$$;

reset role;
update public.mobile_inventory_sessions
set status = 'finalized',
    finalized_at = clock_timestamp()
where id = '53000000-0000-0000-0000-000000000001';

select set_config('app.product_alias_mutation', 'on', true);
update public.product_barcodes
set barcode = 'ALIAS-GUARD-SOURCE-A-CHANGED'
where id = '43000000-0000-0000-0000-000000000001';
select set_config('app.product_alias_mutation', 'off', true);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"23000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);

do $$
declare
  link_id uuid;
  preview_row record;
begin
  select link.link_id into link_id
  from alias_guard_links link
  where link.alias_name = 'A';
  select * into preview_row from public.preview_product_unmerge(link_id);

  if not preview_row.has_barcode_conflict then
    raise exception 'unmerge preview missed a changed barcode mapping';
  end if;

  begin
    perform public.unmerge_product_alias(
      link_id,
      preview_row.current_canonical_warehouse_qty,
      preview_row.current_canonical_store_qty,
      0,
      0,
      preview_row.canonical_warehouse_version,
      preview_row.canonical_store_version,
      preview_row.alias_warehouse_version,
      preview_row.alias_store_version,
      '73000000-0000-0000-0000-000000000011'
    );
    raise exception 'unmerge unexpectedly ignored a changed barcode mapping';
  exception
    when others then
      if sqlerrm = 'unmerge unexpectedly ignored a changed barcode mapping'
        or position('바코드 연결이 변경' in sqlerrm) = 0 then
        raise;
      end if;
  end;
end;
$$;

reset role;
select set_config('app.product_alias_mutation', 'on', true);
update public.product_barcodes
set barcode = 'ALIAS-GUARD-SOURCE-A-SECONDARY'
where id = '43000000-0000-0000-0000-000000000001';
select set_config('app.product_alias_mutation', 'off', true);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"23000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);

do $$
declare
  link_id uuid;
  preview_row record;
begin
  select link.link_id into link_id
  from alias_guard_links link
  where link.alias_name = 'A';
  select * into preview_row from public.preview_product_unmerge(link_id);

  perform public.unmerge_product_alias(
    link_id,
    7,
    5,
    1,
    2,
    preview_row.canonical_warehouse_version,
    preview_row.canonical_store_version,
    preview_row.alias_warehouse_version,
    preview_row.alias_store_version,
    '73000000-0000-0000-0000-000000000012'
  );

  if not (select is_active from public.products
          where id = '33000000-0000-0000-0000-000000000002') then
    raise exception 'first alias was not reactivated';
  end if;
  if (select is_active from public.products
      where id = '33000000-0000-0000-0000-000000000003') then
    raise exception 'second alias was unexpectedly reactivated';
  end if;
  if not exists (
    select 1
    from public.product_alias_links link
    where link.alias_product_id = '33000000-0000-0000-0000-000000000003'
      and link.unmerged_at is null
  ) then
    raise exception 'unmerging one alias removed another active alias';
  end if;
end;
$$;

do $$
declare
  link_id uuid;
  preview_row record;
begin
  select link.link_id into link_id
  from alias_guard_links link
  where link.alias_name = 'B';
  select * into preview_row from public.preview_product_unmerge(link_id);

  perform public.unmerge_product_alias(
    link_id,
    4,
    4,
    3,
    1,
    preview_row.canonical_warehouse_version,
    preview_row.canonical_store_version,
    preview_row.alias_warehouse_version,
    preview_row.alias_store_version,
    '73000000-0000-0000-0000-000000000013'
  );

  if exists (
    select 1
    from public.product_alias_links link
    where link.canonical_product_id = '33000000-0000-0000-0000-000000000001'
      and link.unmerged_at is null
  ) then
    raise exception 'an active alias remained after individual unmerges';
  end if;

  if (select warehouse_qty from public.inventory
      where product_id = '33000000-0000-0000-0000-000000000001') <> 4
    or (select store_qty from public.inventory
        where product_id = '33000000-0000-0000-0000-000000000001') <> 4
    or (select warehouse_qty from public.inventory
        where product_id = '33000000-0000-0000-0000-000000000002') <> 1
    or (select store_qty from public.inventory
        where product_id = '33000000-0000-0000-0000-000000000002') <> 2
    or (select warehouse_qty from public.inventory
        where product_id = '33000000-0000-0000-0000-000000000003') <> 3
    or (select store_qty from public.inventory
        where product_id = '33000000-0000-0000-0000-000000000003') <> 1 then
    raise exception 'individual unmerges did not preserve all location totals';
  end if;
end;
$$;

reset role;

rollback;
