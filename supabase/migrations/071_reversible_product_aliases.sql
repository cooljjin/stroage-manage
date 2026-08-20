-- Reversible product aliases. Existing rows in product_merge_history remain
-- legacy, read-only history and are intentionally not converted.

create table public.product_alias_links (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  canonical_product_id uuid not null references public.products(id) on delete cascade,
  alias_product_id uuid not null references public.products(id) on delete cascade,
  merged_by uuid references auth.users(id) on delete set null,
  merged_at timestamptz not null default clock_timestamp(),
  merge_request_id uuid not null,
  product_snapshot jsonb not null,
  barcode_snapshot jsonb not null,
  merge_inventory_snapshot jsonb not null,
  unmerged_by uuid references auth.users(id) on delete set null,
  unmerged_at timestamptz,
  unmerge_request_id uuid,
  unmerge_inventory_snapshot jsonb,
  check (canonical_product_id <> alias_product_id),
  check (
    (unmerged_at is null and unmerged_by is null and unmerge_request_id is null)
    or (unmerged_at is not null and unmerge_request_id is not null)
  ),
  unique (store_id, merged_by, merge_request_id)
);

create unique index product_alias_links_active_alias_unique
on public.product_alias_links (alias_product_id)
where unmerged_at is null;

create index product_alias_links_active_canonical_idx
on public.product_alias_links (canonical_product_id, merged_at)
where unmerged_at is null;

create index product_alias_links_store_history_idx
on public.product_alias_links (store_id, merged_at desc);

alter table public.product_alias_links enable row level security;
revoke all on public.product_alias_links from public, anon, authenticated;
grant select on public.product_alias_links to authenticated;

create policy "Users can read product alias history in their store"
on public.product_alias_links for select to authenticated
using (public.can_access_store(store_id));

comment on table public.product_alias_links is
'Reversible merges created after migration 071. product_merge_history remains legacy and cannot be unmerged.';

alter table public.inventory_logs
drop constraint if exists inventory_logs_action_check;

alter table public.inventory_logs
add constraint inventory_logs_action_check
check (action in (
  '입고', '출고', '이동', '조정', '메모',
  '프랩 제조', '프랩 소진', '프랩 폐기',
  '상품 병합', '상품 병합 해제'
));

create or replace function public.resolve_canonical_product_id(
  target_product_id uuid
)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  target_store_id uuid;
  resolved_product_id uuid;
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.';
  end if;

  select product.store_id
  into target_store_id
  from public.products product
  where product.id = target_product_id;

  if target_store_id is null or not public.can_access_store(target_store_id) then
    raise exception '해당 상품에 접근할 권한이 없습니다.';
  end if;

  select coalesce(link.canonical_product_id, target_product_id)
  into resolved_product_id
  from (select 1) seed
  left join public.product_alias_links link
    on link.alias_product_id = target_product_id
   and link.unmerged_at is null;

  return resolved_product_id;
end;
$$;

create or replace function public.resolve_product_by_barcode(
  target_store_id uuid,
  target_barcode text
)
returns setof public.products
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.';
  end if;
  if not public.can_access_store(target_store_id) then
    raise exception '해당 매장의 상품을 조회할 권한이 없습니다.';
  end if;
  if nullif(trim(target_barcode), '') is null then
    return;
  end if;

  return query
  with candidates as (
    select product.id as matched_product_id, 0 as match_rank
    from public.products product
    where product.store_id = target_store_id
      and product.is_active = true
      and product.barcode = trim(target_barcode)

    union all

    select barcode.product_id, 1
    from public.product_barcodes barcode
    where barcode.store_id = target_store_id
      and barcode.barcode = trim(target_barcode)

    union all

    select alias_product.id, 2
    from public.products alias_product
    join public.product_alias_links link
      on link.alias_product_id = alias_product.id
     and link.unmerged_at is null
    where alias_product.store_id = target_store_id
      and alias_product.barcode = trim(target_barcode)
  ), resolved as (
    select
      coalesce(link.canonical_product_id, candidates.matched_product_id) as product_id,
      min(candidates.match_rank) as match_rank
    from candidates
    left join public.product_alias_links link
      on link.alias_product_id = candidates.matched_product_id
     and link.unmerged_at is null
    group by coalesce(link.canonical_product_id, candidates.matched_product_id)
  )
  select product.*
  from resolved
  join public.products product on product.id = resolved.product_id
  where product.store_id = target_store_id
    and product.is_active = true
  order by resolved.match_rank, product.id
  limit 1;
end;
$$;

create or replace function public.search_products_resolved(
  target_store_id uuid,
  keyword text,
  result_limit integer default 50
)
returns setof public.products
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  normalized_keyword text := trim(coalesce(keyword, ''));
  safe_limit integer := least(greatest(coalesce(result_limit, 50), 1), 500);
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.';
  end if;
  if not public.can_access_store(target_store_id) then
    raise exception '해당 매장의 상품을 조회할 권한이 없습니다.';
  end if;

  return query
  with matches as (
    select product.id as canonical_product_id, 0 as match_rank
    from public.products product
    where product.store_id = target_store_id
      and product.is_active = true
      and (
        normalized_keyword = ''
        or product.name ilike '%' || normalized_keyword || '%'
        or coalesce(product.barcode, '') ilike '%' || normalized_keyword || '%'
        or coalesce(product.supplier_name, '') ilike '%' || normalized_keyword || '%'
      )

    union all

    select barcode.product_id, 1
    from public.product_barcodes barcode
    join public.products product on product.id = barcode.product_id
    where barcode.store_id = target_store_id
      and product.is_active = true
      and normalized_keyword <> ''
      and barcode.barcode ilike '%' || normalized_keyword || '%'

    union all

    select link.canonical_product_id, 2
    from public.product_alias_links link
    join public.products alias_product on alias_product.id = link.alias_product_id
    where link.store_id = target_store_id
      and link.unmerged_at is null
      and normalized_keyword <> ''
      and (
        alias_product.name ilike '%' || normalized_keyword || '%'
        or coalesce(alias_product.barcode, '') ilike '%' || normalized_keyword || '%'
      )
  ), ranked as (
    select matches.canonical_product_id, min(matches.match_rank) as match_rank
    from matches
    group by matches.canonical_product_id
  )
  select product.*
  from ranked
  join public.products product on product.id = ranked.canonical_product_id
  where product.store_id = target_store_id
    and product.is_active = true
  order by ranked.match_rank, product.name, product.id
  limit safe_limit;
end;
$$;

create or replace function public.list_product_aliases(
  target_product_id uuid
)
returns table (
  alias_link_id uuid,
  canonical_product_id uuid,
  alias_product_id uuid,
  alias_name text,
  merged_at timestamptz,
  merged_by uuid,
  merge_kind text,
  merge_status text,
  can_unmerge boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  target_store_id uuid;
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.';
  end if;

  select product.store_id into target_store_id
  from public.products product
  where product.id = target_product_id;

  if target_store_id is null or not public.can_access_store(target_store_id) then
    raise exception '해당 상품에 접근할 권한이 없습니다.';
  end if;

  return query
  select
    link.id,
    link.canonical_product_id,
    link.alias_product_id,
    alias_product.name,
    link.merged_at,
    link.merged_by,
    'reversible'::text,
    case when link.unmerged_at is null then 'active'::text else 'unmerged'::text end,
    link.unmerged_at is null
  from public.product_alias_links link
  join public.products alias_product on alias_product.id = link.alias_product_id
  where link.store_id = target_store_id
    and link.canonical_product_id = target_product_id

  union all

  select
    null::uuid,
    history.target_product_id,
    history.source_product_id,
    source_product.name,
    history.merged_at,
    history.merged_by,
    'legacy'::text,
    'legacy'::text,
    false
  from public.product_merge_history history
  join public.products source_product on source_product.id = history.source_product_id
  where history.store_id = target_store_id
    and history.target_product_id = target_product_id

  order by merged_at desc, alias_product_id;
end;
$$;

create or replace function public.merge_products_reversible(
  target_product_id uuid,
  source_product_id uuid,
  expected_target_warehouse_version bigint,
  expected_target_store_version bigint,
  expected_source_warehouse_version bigint,
  expected_source_store_version bigint,
  request_id uuid
)
returns public.product_alias_links
language plpgsql
security definer
set search_path = public
as $$
declare
  target_product public.products%rowtype;
  source_product public.products%rowtype;
  target_inventory public.inventory%rowtype;
  source_inventory public.inventory%rowtype;
  updated_target_inventory public.inventory%rowtype;
  updated_source_inventory public.inventory%rowtype;
  request_row public.mutation_requests%rowtype;
  link_row public.product_alias_links%rowtype;
  source_barcodes text[];
  barcode_snapshot jsonb;
  canonical_group_ids uuid[];
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.';
  end if;
  if target_product_id is null or source_product_id is null
    or target_product_id = source_product_id then
    raise exception '병합할 두 상품을 확인해 주세요.';
  end if;
  if request_id is null then
    raise exception '병합 요청 식별자가 필요합니다.';
  end if;

  perform product.id
  from public.products product
  where product.id in (target_product_id, source_product_id)
  order by product.id
  for update;

  select * into target_product
  from public.products product
  where product.id = target_product_id;

  select * into source_product
  from public.products product
  where product.id = source_product_id;

  if target_product.id is null or source_product.id is null then
    raise exception '병합할 상품을 찾을 수 없습니다.';
  end if;
  if target_product.store_id <> source_product.store_id then
    raise exception '다른 매장의 상품은 병합할 수 없습니다.';
  end if;
  if not public.can_access_store(target_product.store_id) then
    raise exception '해당 매장의 상품을 병합할 권한이 없습니다.';
  end if;

  request_row := public.claim_mutation_request(
    target_product.store_id,
    'merge_products_reversible',
    request_id
  );

  if request_row.completed_at is not null then
    select * into link_row
    from public.product_alias_links link
    where link.id = (request_row.result_json->>'alias_link_id')::uuid;
    return link_row;
  end if;

  if not target_product.is_active or not source_product.is_active then
    raise exception '활성 상품만 병합할 수 있습니다.';
  end if;
  if exists (
    select 1 from public.product_alias_links link
    where link.alias_product_id = target_product_id
      and link.unmerged_at is null
  ) then
    raise exception '병합된 원본 상품을 대표 상품으로 사용할 수 없습니다.';
  end if;
  if exists (
    select 1 from public.product_alias_links link
    where link.alias_product_id = source_product_id
      and link.unmerged_at is null
  ) then
    raise exception '이미 병합된 원본 상품입니다.';
  end if;
  if exists (
    select 1 from public.product_alias_links link
    where link.canonical_product_id = source_product_id
      and link.unmerged_at is null
  ) then
    raise exception '다른 원본을 가진 대표 상품은 원본으로 병합할 수 없습니다.';
  end if;

  if exists (
    select 1
    from public.mobile_inventory_sessions session
    where session.product_id in (target_product_id, source_product_id)
      and session.status = 'open'
  ) then
    raise exception '열린 모바일 재고 세션을 먼저 완료해 주세요.';
  end if;

  insert into public.inventory (product_id, store_id)
  values
    (target_product_id, target_product.store_id),
    (source_product_id, source_product.store_id)
  on conflict (product_id) do nothing;

  perform inventory.product_id
  from public.inventory inventory
  where inventory.product_id in (target_product_id, source_product_id)
  order by inventory.product_id
  for update;

  select * into target_inventory
  from public.inventory inventory
  where inventory.product_id = target_product_id;

  select * into source_inventory
  from public.inventory inventory
  where inventory.product_id = source_product_id;

  if expected_target_warehouse_version is null
    or expected_target_store_version is null
    or expected_source_warehouse_version is null
    or expected_source_store_version is null
    or target_inventory.warehouse_version is distinct from expected_target_warehouse_version
    or target_inventory.store_version is distinct from expected_target_store_version
    or source_inventory.warehouse_version is distinct from expected_source_warehouse_version
    or source_inventory.store_version is distinct from expected_source_store_version then
    raise exception '다른 직원이 재고를 먼저 변경했습니다. 최신 수량을 확인한 뒤 다시 병합해 주세요.';
  end if;

  select array_agg(group_product_id order by group_product_id)
  into canonical_group_ids
  from (
    select target_product_id as group_product_id
    union
    select link.alias_product_id
    from public.product_alias_links link
    where link.canonical_product_id = target_product_id
      and link.unmerged_at is null
  ) group_products;

  if exists (
    select 1
    from public.prep_items source_prep
    join public.prep_items group_prep
      on group_prep.product_id = any(canonical_group_ids)
    where source_prep.product_id = source_product_id
  ) then
    raise exception '대표 그룹과 원본이 모두 프랩 품목으로 등록되어 있습니다. 프랩 연결을 먼저 정리해 주세요.';
  end if;

  if exists (
    select 1
    from public.prep_item_ingredients source_ingredient
    join public.prep_item_ingredients group_ingredient
      on group_ingredient.prep_item_id = source_ingredient.prep_item_id
     and group_ingredient.ingredient_product_id = any(canonical_group_ids)
    where source_ingredient.ingredient_product_id = source_product_id
  ) then
    raise exception '같은 프랩 레시피에 대표 그룹과 원본이 함께 있습니다. 레시피를 먼저 정리해 주세요.';
  end if;

  if exists (
    select 1
    from public.group_order_recipe_ingredients source_ingredient
    join public.group_order_recipe_ingredients group_ingredient
      on group_ingredient.menu_id = source_ingredient.menu_id
     and group_ingredient.product_id = any(canonical_group_ids)
    where source_ingredient.product_id = source_product_id
  ) then
    raise exception '같은 단체주문 레시피에 대표 그룹과 원본이 함께 있습니다. 레시피를 먼저 정리해 주세요.';
  end if;

  select coalesce(array_agg(distinct barcode_value order by barcode_value), array[]::text[])
  into source_barcodes
  from (
    select nullif(trim(source_product.barcode), '') as barcode_value
    union all
    select nullif(trim(barcode.barcode), '')
    from public.product_barcodes barcode
    where barcode.product_id = source_product_id
      and barcode.store_id = source_product.store_id
  ) barcode_values
  where barcode_value is not null;

  if exists (
    select 1
    from public.products product
    where product.store_id = source_product.store_id
      and product.id not in (target_product_id, source_product_id)
      and product.is_active = true
      and product.barcode = any(source_barcodes)
  ) or exists (
    select 1
    from public.product_barcodes barcode
    where barcode.store_id = source_product.store_id
      and barcode.product_id not in (target_product_id, source_product_id)
      and barcode.barcode = any(source_barcodes)
  ) then
    raise exception '원본 바코드가 다른 상품과 충돌합니다. 바코드를 먼저 정리해 주세요.';
  end if;

  select jsonb_build_object(
    'primary_barcode', source_product.barcode,
    'all_barcodes', to_jsonb(source_barcodes),
    'rows', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', barcode.id,
          'barcode', barcode.barcode,
          'product_id', barcode.product_id,
          'created_at', barcode.created_at
        ) order by barcode.id
      )
      from public.product_barcodes barcode
      where barcode.product_id = source_product_id
        and barcode.store_id = source_product.store_id
    ), '[]'::jsonb)
  ) into barcode_snapshot;

  insert into public.product_alias_links (
    store_id,
    canonical_product_id,
    alias_product_id,
    merged_by,
    merge_request_id,
    product_snapshot,
    barcode_snapshot,
    merge_inventory_snapshot
  ) values (
    target_product.store_id,
    target_product_id,
    source_product_id,
    auth.uid(),
    request_id,
    to_jsonb(source_product),
    barcode_snapshot,
    jsonb_build_object(
      'canonical_before', jsonb_build_object(
        'warehouse_qty', target_inventory.warehouse_qty,
        'store_qty', target_inventory.store_qty,
        'warehouse_version', target_inventory.warehouse_version,
        'store_version', target_inventory.store_version
      ),
      'alias_before', jsonb_build_object(
        'warehouse_qty', source_inventory.warehouse_qty,
        'store_qty', source_inventory.store_qty,
        'warehouse_version', source_inventory.warehouse_version,
        'store_version', source_inventory.store_version
      ),
      'canonical_after', jsonb_build_object(
        'warehouse_qty', target_inventory.warehouse_qty + source_inventory.warehouse_qty,
        'store_qty', target_inventory.store_qty + source_inventory.store_qty
      ),
      'alias_after', jsonb_build_object('warehouse_qty', 0, 'store_qty', 0)
    )
  ) returning * into link_row;

  perform set_config('app.product_alias_mutation', 'on', true);

  update public.inventory inventory
  set warehouse_qty = target_inventory.warehouse_qty + source_inventory.warehouse_qty,
      store_qty = target_inventory.store_qty + source_inventory.store_qty
  where inventory.id = target_inventory.id
  returning * into updated_target_inventory;

  update public.inventory inventory
  set warehouse_qty = 0,
      store_qty = 0
  where inventory.id = source_inventory.id
  returning * into updated_source_inventory;

  insert into public.product_barcodes (product_id, store_id, barcode)
  select target_product_id, target_product.store_id, barcode_value
  from unnest(source_barcodes) barcode_value
  on conflict (store_id, barcode)
  do update set product_id = excluded.product_id;

  update public.products product
  set is_active = false,
      fresh_order_selected = false,
      fresh_order_selected_at = null,
      urgent_order_requested = false,
      urgent_order_quantity = null,
      order_completed = false,
      confirmed_order_pending = false
  where product.id = source_product_id;

  insert into public.inventory_logs (
    store_id, product_id, user_id, action, quantity, note,
    warehouse_qty_before, store_qty_before,
    warehouse_qty_after, store_qty_after
  ) values
  (
    target_product.store_id, target_product_id, auth.uid(), '상품 병합',
    source_inventory.warehouse_qty + source_inventory.store_qty,
    '원본 상품 ' || source_product.name || ' 병합',
    target_inventory.warehouse_qty, target_inventory.store_qty,
    updated_target_inventory.warehouse_qty, updated_target_inventory.store_qty
  ),
  (
    target_product.store_id, source_product_id, auth.uid(), '상품 병합',
    source_inventory.warehouse_qty + source_inventory.store_qty,
    '대표 상품 ' || target_product.name || '으로 병합',
    source_inventory.warehouse_qty, source_inventory.store_qty,
    updated_source_inventory.warehouse_qty, updated_source_inventory.store_qty
  );

  perform public.complete_mutation_request(
    request_row.id,
    jsonb_build_object('alias_link_id', link_row.id)
  );

  return link_row;
end;
$$;

create or replace function public.preview_product_unmerge(
  alias_link_id uuid
)
returns table (
  link_id uuid,
  canonical_product_id uuid,
  canonical_name text,
  alias_product_id uuid,
  alias_name text,
  current_canonical_warehouse_qty numeric,
  current_canonical_store_qty numeric,
  current_alias_warehouse_qty numeric,
  current_alias_store_qty numeric,
  canonical_warehouse_version bigint,
  canonical_store_version bigint,
  alias_warehouse_version bigint,
  alias_store_version bigint,
  merge_canonical_warehouse_qty numeric,
  merge_canonical_store_qty numeric,
  merge_alias_warehouse_qty numeric,
  merge_alias_store_qty numeric,
  has_open_mobile_session boolean,
  has_barcode_conflict boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  link_row public.product_alias_links%rowtype;
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.';
  end if;

  select * into link_row
  from public.product_alias_links link
  where link.id = alias_link_id;

  if not found or not public.can_access_store(link_row.store_id) then
    raise exception '병합 이력을 찾을 수 없습니다.';
  end if;
  if link_row.unmerged_at is not null then
    raise exception '이미 해제된 병합입니다.';
  end if;

  return query
  select
    link_row.id,
    link_row.canonical_product_id,
    canonical_product.name,
    link_row.alias_product_id,
    alias_product.name,
    canonical_inventory.warehouse_qty,
    canonical_inventory.store_qty,
    alias_inventory.warehouse_qty,
    alias_inventory.store_qty,
    canonical_inventory.warehouse_version,
    canonical_inventory.store_version,
    alias_inventory.warehouse_version,
    alias_inventory.store_version,
    (link_row.merge_inventory_snapshot #>> '{canonical_before,warehouse_qty}')::numeric,
    (link_row.merge_inventory_snapshot #>> '{canonical_before,store_qty}')::numeric,
    (link_row.merge_inventory_snapshot #>> '{alias_before,warehouse_qty}')::numeric,
    (link_row.merge_inventory_snapshot #>> '{alias_before,store_qty}')::numeric,
    exists (
      select 1
      from public.mobile_inventory_sessions session
      where session.product_id in (
        link_row.canonical_product_id,
        link_row.alias_product_id
      ) and session.status = 'open'
    ),
    exists (
      select 1
      from jsonb_array_elements(link_row.barcode_snapshot->'rows') snapshot_row
      left join public.product_barcodes barcode
        on barcode.id = (snapshot_row->>'id')::uuid
      where barcode.id is null
        or barcode.store_id <> link_row.store_id
        or barcode.product_id <> link_row.canonical_product_id
        or barcode.barcode <> snapshot_row->>'barcode'
    )
  from public.products canonical_product
  join public.products alias_product
    on alias_product.id = link_row.alias_product_id
  join public.inventory canonical_inventory
    on canonical_inventory.product_id = link_row.canonical_product_id
  join public.inventory alias_inventory
    on alias_inventory.product_id = link_row.alias_product_id
  where canonical_product.id = link_row.canonical_product_id;
end;
$$;

create or replace function public.unmerge_product_alias(
  alias_link_id uuid,
  canonical_warehouse_qty numeric,
  canonical_store_qty numeric,
  alias_warehouse_qty numeric,
  alias_store_qty numeric,
  expected_canonical_warehouse_version bigint,
  expected_canonical_store_version bigint,
  expected_alias_warehouse_version bigint,
  expected_alias_store_version bigint,
  request_id uuid
)
returns public.product_alias_links
language plpgsql
security definer
set search_path = public
as $$
declare
  link_row public.product_alias_links%rowtype;
  canonical_product public.products%rowtype;
  alias_product public.products%rowtype;
  canonical_inventory public.inventory%rowtype;
  alias_inventory public.inventory%rowtype;
  updated_canonical_inventory public.inventory%rowtype;
  updated_alias_inventory public.inventory%rowtype;
  request_row public.mutation_requests%rowtype;
  source_primary_barcode text;
  snapshot_flags jsonb;
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.';
  end if;
  if request_id is null then
    raise exception '병합 해제 요청 식별자가 필요합니다.';
  end if;

  select * into link_row
  from public.product_alias_links link
  where link.id = alias_link_id
  for update;

  if not found or not public.can_access_store(link_row.store_id) then
    raise exception '병합 이력을 찾을 수 없습니다.';
  end if;

  request_row := public.claim_mutation_request(
    link_row.store_id,
    'unmerge_product_alias',
    request_id
  );

  if request_row.completed_at is not null then
    select * into link_row
    from public.product_alias_links link
    where link.id = (request_row.result_json->>'alias_link_id')::uuid;
    return link_row;
  end if;

  if link_row.unmerged_at is not null then
    raise exception '이미 해제된 병합입니다.';
  end if;
  if canonical_warehouse_qty is null or canonical_store_qty is null
    or alias_warehouse_qty is null or alias_store_qty is null
    or canonical_warehouse_qty < 0 or canonical_store_qty < 0
    or alias_warehouse_qty < 0 or alias_store_qty < 0 then
    raise exception '대표와 원본의 재고 배분량은 모두 0 이상이어야 합니다.';
  end if;
  if canonical_warehouse_qty <> round(canonical_warehouse_qty, 4)
    or canonical_store_qty <> round(canonical_store_qty, 4)
    or alias_warehouse_qty <> round(alias_warehouse_qty, 4)
    or alias_store_qty <> round(alias_store_qty, 4) then
    raise exception '재고 배분량은 소수점 넷째 자리까지 입력할 수 있습니다.';
  end if;

  perform product.id
  from public.products product
  where product.id in (
    link_row.canonical_product_id,
    link_row.alias_product_id
  )
  order by product.id
  for update;

  select * into canonical_product
  from public.products product
  where product.id = link_row.canonical_product_id;

  select * into alias_product
  from public.products product
  where product.id = link_row.alias_product_id;

  if canonical_product.id is null or alias_product.id is null
    or canonical_product.store_id <> link_row.store_id
    or alias_product.store_id <> link_row.store_id then
    raise exception '병합 상품과 매장 정보가 일치하지 않습니다.';
  end if;
  if not canonical_product.is_active or alias_product.is_active then
    raise exception '병합 상품 상태가 변경되어 해제할 수 없습니다.';
  end if;

  if exists (
    select 1
    from public.mobile_inventory_sessions session
    where session.product_id in (
      link_row.canonical_product_id,
      link_row.alias_product_id
    ) and session.status = 'open'
  ) then
    raise exception '열린 모바일 재고 세션을 먼저 완료해 주세요.';
  end if;

  perform inventory.product_id
  from public.inventory inventory
  where inventory.product_id in (
    link_row.canonical_product_id,
    link_row.alias_product_id
  )
  order by inventory.product_id
  for update;

  select * into canonical_inventory
  from public.inventory inventory
  where inventory.product_id = link_row.canonical_product_id;

  select * into alias_inventory
  from public.inventory inventory
  where inventory.product_id = link_row.alias_product_id;

  if expected_canonical_warehouse_version is null
    or expected_canonical_store_version is null
    or expected_alias_warehouse_version is null
    or expected_alias_store_version is null
    or canonical_inventory.warehouse_version is distinct from expected_canonical_warehouse_version
    or canonical_inventory.store_version is distinct from expected_canonical_store_version
    or alias_inventory.warehouse_version is distinct from expected_alias_warehouse_version
    or alias_inventory.store_version is distinct from expected_alias_store_version then
    raise exception '다른 직원이 재고를 먼저 변경했습니다. 최신 수량을 확인한 뒤 다시 해제해 주세요.';
  end if;

  if canonical_warehouse_qty + alias_warehouse_qty
      <> canonical_inventory.warehouse_qty + alias_inventory.warehouse_qty
    or canonical_store_qty + alias_store_qty
      <> canonical_inventory.store_qty + alias_inventory.store_qty then
    raise exception '위치별 배분 합계가 현재 재고 합계와 일치해야 합니다.';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(link_row.barcode_snapshot->'rows') snapshot_row
    left join public.product_barcodes barcode
      on barcode.id = (snapshot_row->>'id')::uuid
    where barcode.id is null
      or barcode.store_id <> link_row.store_id
      or barcode.product_id <> link_row.canonical_product_id
      or barcode.barcode <> snapshot_row->>'barcode'
  ) then
    raise exception '병합 후 바코드 연결이 변경되어 해제할 수 없습니다. 바코드를 먼저 확인해 주세요.';
  end if;

  perform set_config('app.product_alias_mutation', 'on', true);

  update public.inventory inventory
  set warehouse_qty = canonical_warehouse_qty,
      store_qty = canonical_store_qty
  where inventory.id = canonical_inventory.id
  returning * into updated_canonical_inventory;

  update public.inventory inventory
  set warehouse_qty = alias_warehouse_qty,
      store_qty = alias_store_qty
  where inventory.id = alias_inventory.id
  returning * into updated_alias_inventory;

  update public.product_barcodes barcode
  set product_id = link_row.alias_product_id
  from jsonb_array_elements(link_row.barcode_snapshot->'rows') snapshot_row
  where barcode.id = (snapshot_row->>'id')::uuid;

  source_primary_barcode := nullif(
    trim(link_row.barcode_snapshot->>'primary_barcode'),
    ''
  );

  if source_primary_barcode is not null
    and not exists (
      select 1
      from jsonb_array_elements(link_row.barcode_snapshot->'rows') snapshot_row
      where snapshot_row->>'barcode' = source_primary_barcode
    ) then
    delete from public.product_barcodes barcode
    where barcode.store_id = link_row.store_id
      and barcode.product_id = link_row.canonical_product_id
      and barcode.barcode = source_primary_barcode;
  end if;

  snapshot_flags := link_row.product_snapshot;
  update public.products product
  set is_active = true,
      fresh_order_selected = coalesce(
        (snapshot_flags->>'fresh_order_selected')::boolean,
        false
      ),
      fresh_order_selected_at = (
        snapshot_flags->>'fresh_order_selected_at'
      )::timestamptz,
      urgent_order_requested = coalesce(
        (snapshot_flags->>'urgent_order_requested')::boolean,
        false
      ),
      urgent_order_quantity = (
        snapshot_flags->>'urgent_order_quantity'
      )::numeric,
      order_completed = coalesce(
        (snapshot_flags->>'order_completed')::boolean,
        false
      ),
      confirmed_order_pending = coalesce(
        (snapshot_flags->>'confirmed_order_pending')::boolean,
        false
      )
  where product.id = link_row.alias_product_id;

  update public.product_alias_links link
  set unmerged_by = auth.uid(),
      unmerged_at = clock_timestamp(),
      unmerge_request_id = request_id,
      unmerge_inventory_snapshot = jsonb_build_object(
        'canonical_before', jsonb_build_object(
          'warehouse_qty', canonical_inventory.warehouse_qty,
          'store_qty', canonical_inventory.store_qty,
          'warehouse_version', canonical_inventory.warehouse_version,
          'store_version', canonical_inventory.store_version
        ),
        'alias_before', jsonb_build_object(
          'warehouse_qty', alias_inventory.warehouse_qty,
          'store_qty', alias_inventory.store_qty,
          'warehouse_version', alias_inventory.warehouse_version,
          'store_version', alias_inventory.store_version
        ),
        'canonical_after', jsonb_build_object(
          'warehouse_qty', updated_canonical_inventory.warehouse_qty,
          'store_qty', updated_canonical_inventory.store_qty,
          'warehouse_version', updated_canonical_inventory.warehouse_version,
          'store_version', updated_canonical_inventory.store_version
        ),
        'alias_after', jsonb_build_object(
          'warehouse_qty', updated_alias_inventory.warehouse_qty,
          'store_qty', updated_alias_inventory.store_qty,
          'warehouse_version', updated_alias_inventory.warehouse_version,
          'store_version', updated_alias_inventory.store_version
        )
      )
  where link.id = link_row.id
  returning * into link_row;

  insert into public.inventory_logs (
    store_id, product_id, user_id, action, quantity, note,
    warehouse_qty_before, store_qty_before,
    warehouse_qty_after, store_qty_after
  ) values
  (
    link_row.store_id, link_row.canonical_product_id, auth.uid(),
    '상품 병합 해제',
    abs(canonical_inventory.warehouse_qty - canonical_warehouse_qty)
      + abs(canonical_inventory.store_qty - canonical_store_qty),
    '원본 상품 ' || alias_product.name || ' 병합 해제',
    canonical_inventory.warehouse_qty, canonical_inventory.store_qty,
    updated_canonical_inventory.warehouse_qty,
    updated_canonical_inventory.store_qty
  ),
  (
    link_row.store_id, link_row.alias_product_id, auth.uid(),
    '상품 병합 해제',
    alias_warehouse_qty + alias_store_qty,
    '대표 상품 ' || canonical_product.name || '에서 병합 해제',
    alias_inventory.warehouse_qty, alias_inventory.store_qty,
    updated_alias_inventory.warehouse_qty,
    updated_alias_inventory.store_qty
  );

  perform public.complete_mutation_request(
    request_row.id,
    jsonb_build_object('alias_link_id', link_row.id)
  );

  return link_row;
end;
$$;

-- Prevent direct edits, reactivation, deletion, or inventory changes for an
-- active alias. The RPCs use a transaction-local bypass after all validation.
create or replace function public.guard_active_product_alias()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  affected_product_id uuid := case when tg_op = 'DELETE' then old.id else new.id end;
begin
  if current_setting('app.product_alias_mutation', true) = 'on' then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if exists (
    select 1
    from public.product_alias_links link
    where link.alias_product_id = affected_product_id
      and link.unmerged_at is null
  ) then
    raise exception '병합된 원본 상품은 병합 해제 후 수정할 수 있습니다.';
  end if;

  if exists (
    select 1
    from public.product_alias_links link
    where link.canonical_product_id = affected_product_id
      and link.unmerged_at is null
  ) then
    if tg_op = 'DELETE' then
      raise exception '병합된 원본이 있는 대표 상품은 비활성화하거나 삭제할 수 없습니다.';
    elsif new.is_active = false
      or new.store_id is distinct from old.store_id then
      raise exception '병합된 원본이 있는 대표 상품은 비활성화하거나 삭제할 수 없습니다.';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists guard_active_product_alias on public.products;
create trigger guard_active_product_alias
before update or delete on public.products
for each row execute function public.guard_active_product_alias();

create or replace function public.guard_active_product_alias_inventory()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  affected_product_id uuid := case
    when tg_op = 'DELETE' then old.product_id
    else new.product_id
  end;
begin
  if current_setting('app.product_alias_mutation', true) = 'on' then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if exists (
    select 1
    from public.product_alias_links link
    where link.alias_product_id = affected_product_id
      and link.unmerged_at is null
  ) then
    raise exception '병합된 원본의 재고는 직접 변경할 수 없습니다.';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists guard_active_product_alias_inventory on public.inventory;
create trigger guard_active_product_alias_inventory
before insert or update or delete on public.inventory
for each row execute function public.guard_active_product_alias_inventory();

create or replace function public.guard_active_product_alias_barcode()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  affected_store_id uuid := case
    when tg_op = 'DELETE' then old.store_id
    else new.store_id
  end;
  affected_product_id uuid := case
    when tg_op = 'DELETE' then old.product_id
    else new.product_id
  end;
  affected_barcode text := case
    when tg_op = 'DELETE' then old.barcode
    else new.barcode
  end;
begin
  if current_setting('app.product_alias_mutation', true) = 'on' then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if exists (
    select 1
    from public.product_alias_links link
    where link.store_id = affected_store_id
      and link.unmerged_at is null
      and (
        link.alias_product_id = affected_product_id
        or link.barcode_snapshot->'all_barcodes' ? affected_barcode
      )
  ) then
    raise exception '병합된 원본의 바코드는 병합 해제 전까지 변경할 수 없습니다.';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists guard_active_product_alias_barcode on public.product_barcodes;
create trigger guard_active_product_alias_barcode
before insert or update or delete on public.product_barcodes
for each row execute function public.guard_active_product_alias_barcode();

revoke all on function public.guard_active_product_alias()
from public, anon, authenticated;
revoke all on function public.guard_active_product_alias_inventory()
from public, anon, authenticated;
revoke all on function public.guard_active_product_alias_barcode()
from public, anon, authenticated;

-- Installed clients keep the old two-argument contract, but all new merges now
-- use the reversible implementation. New clients call the versioned RPC.
create or replace function public.merge_products(
  target_product_id uuid,
  source_product_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_inventory public.inventory%rowtype;
  source_inventory public.inventory%rowtype;
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.';
  end if;

  select inventory.* into target_inventory
  from public.inventory inventory
  where inventory.product_id = target_product_id;

  select inventory.* into source_inventory
  from public.inventory inventory
  where inventory.product_id = source_product_id;

  if target_inventory.id is null or source_inventory.id is null then
    raise exception '재고 정보를 찾을 수 없습니다. 앱을 업데이트한 뒤 다시 시도해 주세요.';
  end if;

  perform public.merge_products_reversible(
    target_product_id,
    source_product_id,
    target_inventory.warehouse_version,
    target_inventory.store_version,
    source_inventory.warehouse_version,
    source_inventory.store_version,
    gen_random_uuid()
  );
end;
$$;

revoke all on function public.resolve_canonical_product_id(uuid)
from public, anon;
revoke all on function public.resolve_product_by_barcode(uuid, text)
from public, anon;
revoke all on function public.search_products_resolved(uuid, text, integer)
from public, anon;
revoke all on function public.list_product_aliases(uuid)
from public, anon;
revoke all on function public.merge_products_reversible(
  uuid, uuid, bigint, bigint, bigint, bigint, uuid
) from public, anon;
revoke all on function public.preview_product_unmerge(uuid)
from public, anon;
revoke all on function public.unmerge_product_alias(
  uuid, numeric, numeric, numeric, numeric,
  bigint, bigint, bigint, bigint, uuid
) from public, anon;
revoke all on function public.merge_products(uuid, uuid)
from public, anon;

grant execute on function public.resolve_canonical_product_id(uuid)
to authenticated;
grant execute on function public.resolve_product_by_barcode(uuid, text)
to authenticated;
grant execute on function public.search_products_resolved(uuid, text, integer)
to authenticated;
grant execute on function public.list_product_aliases(uuid)
to authenticated;
grant execute on function public.merge_products_reversible(
  uuid, uuid, bigint, bigint, bigint, bigint, uuid
) to authenticated;
grant execute on function public.preview_product_unmerge(uuid)
to authenticated;
grant execute on function public.unmerge_product_alias(
  uuid, numeric, numeric, numeric, numeric,
  bigint, bigint, bigint, bigint, uuid
) to authenticated;
grant execute on function public.merge_products(uuid, uuid)
to authenticated;

notify pgrst, 'reload schema';
