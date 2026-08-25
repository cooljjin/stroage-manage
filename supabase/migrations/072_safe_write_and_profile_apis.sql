-- Safe write APIs and profile views. Table-write revocation is deliberately
-- staged in supabase/sql/ after the new native clients are verified.

create or replace function public.ensure_inventory_row(
  target_product_id uuid
)
returns public.inventory
language plpgsql
security definer
set search_path = public
as $$
declare
  product_row public.products%rowtype;
  inventory_row public.inventory%rowtype;
  canonical_product_id uuid;
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.';
  end if;

  canonical_product_id := public.resolve_canonical_product_id(target_product_id);

  select * into product_row
  from public.products product
  where product.id = canonical_product_id
  for update;

  if not found or not public.can_access_store(product_row.store_id) then
    raise exception '해당 상품에 접근할 권한이 없습니다.';
  end if;

  insert into public.inventory (product_id, store_id)
  values (product_row.id, product_row.store_id)
  on conflict (product_id) do nothing;

  select * into inventory_row
  from public.inventory inventory
  where inventory.product_id = product_row.id;

  return inventory_row;
end;
$$;

create or replace function public.create_product_with_inventory(
  product_store_id uuid,
  product_data jsonb
)
returns public.products
language plpgsql
security definer
set search_path = public
as $$
declare
  payload public.products%rowtype;
  created_product public.products%rowtype;
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.';
  end if;
  if product_store_id is null or not public.can_access_store(product_store_id) then
    raise exception '매장에 접근할 수 없습니다.';
  end if;
  if product_data is null or jsonb_typeof(product_data) <> 'object' then
    raise exception '상품 정보를 확인해 주세요.';
  end if;

  payload := jsonb_populate_record(null::public.products, product_data);

  if nullif(trim(payload.name), '') is null then
    raise exception '상품명은 비워둘 수 없습니다.';
  end if;
  if payload.minimum_stock is not null and payload.minimum_stock < 0 then
    raise exception '최소재고는 0 이상이어야 합니다.';
  end if;
  if nullif(trim(payload.barcode), '') is not null and exists (
    select 1
    from public.product_barcodes barcode
    where barcode.store_id = product_store_id
      and barcode.barcode = trim(payload.barcode)
  ) then
    raise exception '이미 같은 바코드로 등록된 품목이 있습니다.';
  end if;

  insert into public.products (
    store_id,
    name,
    barcode,
    category,
    supplier_name,
    storage_type,
    default_location,
    unit_name,
    unit_weight_enabled,
    unit_weight,
    unit_weight_unit,
    processing_required,
    processed_unit_weight,
    processed_unit_weight_unit,
    minimum_stock,
    receipt_check_only,
    status_enabled,
    stock_status,
    product_url
  ) values (
    product_store_id,
    trim(payload.name),
    nullif(trim(payload.barcode), ''),
    coalesce(nullif(trim(payload.category), ''), '기타'),
    nullif(trim(payload.supplier_name), ''),
    nullif(trim(payload.storage_type), ''),
    coalesce(payload.default_location, '창고'),
    nullif(trim(payload.unit_name), ''),
    coalesce(payload.unit_weight_enabled, false),
    payload.unit_weight,
    payload.unit_weight_unit,
    coalesce(payload.processing_required, false),
    payload.processed_unit_weight,
    payload.processed_unit_weight_unit,
    coalesce(payload.minimum_stock, 0),
    coalesce(payload.receipt_check_only, false),
    coalesce(payload.status_enabled, false),
    payload.stock_status,
    nullif(trim(payload.product_url), '')
  ) returning * into created_product;

  insert into public.inventory (product_id, store_id)
  values (created_product.id, created_product.store_id);

  return created_product;
exception
  when unique_violation then
    raise exception '이미 같은 바코드로 등록된 품목이 있습니다.';
end;
$$;

create or replace function public.restore_product_with_inventory(
  target_product_id uuid,
  product_data jsonb
)
returns public.products
language plpgsql
security definer
set search_path = public
as $$
declare
  payload public.products%rowtype;
  target_product public.products%rowtype;
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.';
  end if;
  if product_data is null or jsonb_typeof(product_data) <> 'object' then
    raise exception '상품 정보를 확인해 주세요.';
  end if;

  select * into target_product
  from public.products product
  where product.id = target_product_id
  for update;

  if not found or not public.can_access_store(target_product.store_id) then
    raise exception '복구할 상품을 찾을 수 없습니다.';
  end if;
  if target_product.is_active then
    raise exception '이미 활성 상태인 상품입니다.';
  end if;
  if exists (
    select 1
    from public.product_alias_links link
    where link.alias_product_id = target_product.id
      and link.unmerged_at is null
  ) then
    raise exception '병합된 원본 상품은 병합 해제 후 복구할 수 있습니다.';
  end if;
  if exists (
    select 1
    from public.product_merge_history history
    where history.source_product_id = target_product.id
  ) then
    raise exception '이전 방식으로 병합된 상품은 복구할 수 없습니다.';
  end if;

  payload := jsonb_populate_record(null::public.products, product_data);
  if nullif(trim(payload.name), '') is null then
    raise exception '상품명은 비워둘 수 없습니다.';
  end if;
  if payload.minimum_stock is not null and payload.minimum_stock < 0 then
    raise exception '최소재고는 0 이상이어야 합니다.';
  end if;
  if nullif(trim(payload.barcode), '') is not null and exists (
    select 1
    from public.product_barcodes barcode
    where barcode.store_id = target_product.store_id
      and barcode.barcode = trim(payload.barcode)
      and barcode.product_id <> target_product.id
  ) then
    raise exception '이미 같은 바코드로 등록된 품목이 있습니다.';
  end if;

  update public.products product
  set name = trim(payload.name),
      barcode = nullif(trim(payload.barcode), ''),
      category = coalesce(nullif(trim(payload.category), ''), '기타'),
      supplier_name = nullif(trim(payload.supplier_name), ''),
      storage_type = nullif(trim(payload.storage_type), ''),
      default_location = coalesce(payload.default_location, '창고'),
      unit_name = nullif(trim(payload.unit_name), ''),
      unit_weight_enabled = coalesce(payload.unit_weight_enabled, false),
      unit_weight = payload.unit_weight,
      unit_weight_unit = payload.unit_weight_unit,
      processing_required = coalesce(payload.processing_required, false),
      processed_unit_weight = payload.processed_unit_weight,
      processed_unit_weight_unit = payload.processed_unit_weight_unit,
      minimum_stock = coalesce(payload.minimum_stock, 0),
      receipt_check_only = coalesce(payload.receipt_check_only, false),
      status_enabled = coalesce(payload.status_enabled, false),
      stock_status = payload.stock_status,
      product_url = nullif(trim(payload.product_url), ''),
      is_active = true
  where product.id = target_product.id
  returning * into target_product;

  insert into public.inventory (product_id, store_id)
  values (target_product.id, target_product.store_id)
  on conflict (product_id) do nothing;

  return target_product;
exception
  when unique_violation then
    raise exception '이미 같은 바코드로 등록된 품목이 있습니다.';
end;
$$;

create or replace function public.register_and_merge_product_reversible(
  product_store_id uuid,
  product_data jsonb,
  existing_product_id uuid,
  keep_new_product boolean,
  expected_existing_warehouse_version bigint,
  expected_existing_store_version bigint,
  request_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  existing_product public.products%rowtype;
  existing_inventory public.inventory%rowtype;
  created_product public.products%rowtype;
  request_row public.mutation_requests%rowtype;
  result_product_id uuid;
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.';
  end if;
  if request_id is null then
    raise exception '상품 등록·병합 요청 식별자가 필요합니다.';
  end if;
  if product_store_id is null or not public.can_access_store(product_store_id) then
    raise exception '매장에 접근할 수 없습니다.';
  end if;

  request_row := public.claim_mutation_request(
    product_store_id,
    'register_and_merge_product_reversible',
    request_id
  );
  if request_row.completed_at is not null then
    return (request_row.result_json->>'product_id')::uuid;
  end if;

  select * into existing_product
  from public.products product
  where product.id = existing_product_id
    and product.store_id = product_store_id
    and product.is_active = true
  for update;

  if not found then
    raise exception '병합할 활성 상품을 찾을 수 없습니다.';
  end if;

  existing_inventory := public.ensure_inventory_row(existing_product.id);
  if existing_inventory.warehouse_version is distinct from expected_existing_warehouse_version
    or existing_inventory.store_version is distinct from expected_existing_store_version then
    raise exception '다른 직원이 재고를 먼저 변경했습니다. 최신 수량을 확인한 뒤 다시 병합해 주세요.';
  end if;

  created_product := public.create_product_with_inventory(
    product_store_id,
    product_data
  );

  if keep_new_product then
    perform public.merge_products_reversible(
      created_product.id,
      existing_product.id,
      0,
      0,
      existing_inventory.warehouse_version,
      existing_inventory.store_version,
      request_id
    );
    result_product_id := created_product.id;
  else
    perform public.merge_products_reversible(
      existing_product.id,
      created_product.id,
      existing_inventory.warehouse_version,
      existing_inventory.store_version,
      0,
      0,
      request_id
    );
    result_product_id := existing_product.id;
  end if;

  perform public.complete_mutation_request(
    request_row.id,
    jsonb_build_object('product_id', result_product_id)
  );

  return result_product_id;
end;
$$;

create or replace function public.record_inventory_memo(
  target_product_id uuid,
  memo_text text,
  request_id uuid
)
returns public.inventory_logs
language plpgsql
security definer
set search_path = public
as $$
declare
  canonical_product_id uuid;
  target_product public.products%rowtype;
  current_inventory public.inventory%rowtype;
  request_row public.mutation_requests%rowtype;
  log_row public.inventory_logs%rowtype;
  normalized_memo text := trim(coalesce(memo_text, ''));
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.';
  end if;
  if request_id is null then
    raise exception '메모 저장 요청 식별자가 필요합니다.';
  end if;
  if normalized_memo = '' then
    raise exception '메모 내용을 입력해 주세요.';
  end if;
  if char_length(normalized_memo) > 2000 then
    raise exception '메모는 2,000자 이하로 입력해 주세요.';
  end if;

  canonical_product_id := public.resolve_canonical_product_id(target_product_id);

  select * into target_product
  from public.products product
  where product.id = canonical_product_id
  for update;

  if not found or not public.can_access_store(target_product.store_id) then
    raise exception '해당 상품에 접근할 권한이 없습니다.';
  end if;

  request_row := public.claim_mutation_request(
    target_product.store_id,
    'record_inventory_memo',
    request_id
  );

  if request_row.completed_at is not null then
    select * into log_row
    from public.inventory_logs log
    where log.id = (request_row.result_json->>'log_id')::uuid;
    return log_row;
  end if;

  current_inventory := public.ensure_inventory_row(target_product.id);

  insert into public.inventory_logs (
    store_id,
    product_id,
    user_id,
    action,
    note,
    warehouse_qty_before,
    store_qty_before,
    warehouse_qty_after,
    store_qty_after
  ) values (
    target_product.store_id,
    target_product.id,
    auth.uid(),
    '메모',
    normalized_memo,
    current_inventory.warehouse_qty,
    current_inventory.store_qty,
    current_inventory.warehouse_qty,
    current_inventory.store_qty
  ) returning * into log_row;

  perform public.complete_mutation_request(
    request_row.id,
    jsonb_build_object('log_id', log_row.id)
  );

  return log_row;
end;
$$;

create or replace function public.update_inventory_memo(
  target_log_id uuid,
  memo_text text
)
returns public.inventory_logs
language plpgsql
security definer
set search_path = public
as $$
declare
  log_row public.inventory_logs%rowtype;
  normalized_memo text := trim(coalesce(memo_text, ''));
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.';
  end if;
  if normalized_memo = '' then
    raise exception '메모 내용을 입력해 주세요.';
  end if;
  if char_length(normalized_memo) > 2000 then
    raise exception '메모는 2,000자 이하로 입력해 주세요.';
  end if;

  select * into log_row
  from public.inventory_logs log
  where log.id = target_log_id
  for update;

  if not found
    or log_row.action <> '메모'
    or log_row.user_id <> auth.uid()
    or not public.can_access_store(log_row.store_id) then
    raise exception '본인이 작성한 메모만 수정할 수 있습니다.';
  end if;

  update public.inventory_logs log
  set note = normalized_memo
  where log.id = log_row.id
  returning * into log_row;

  return log_row;
end;
$$;

create or replace function public.get_my_profile()
returns public.profiles
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  profile_row public.profiles%rowtype;
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.';
  end if;

  select * into profile_row
  from public.profiles profile
  where profile.id = auth.uid();

  return profile_row;
end;
$$;

create or replace function public.list_store_staff_directory()
returns table (
  id uuid,
  display_name text,
  role public.profile_role
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  requester_store_id uuid;
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.';
  end if;

  requester_store_id := public.current_store_id(auth.uid());
  if requester_store_id is null then
    raise exception '매장 정보를 찾을 수 없습니다.';
  end if;

  return query
  select profile.id, profile.display_name, profile.role
  from public.profiles profile
  where profile.store_id = requester_store_id
  order by profile.display_name, profile.id;
end;
$$;

create or replace function public.list_store_staff_admin()
returns setof public.profiles
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  requester_role public.profile_role;
  requester_store_id uuid;
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.';
  end if;

  requester_role := public.current_role(auth.uid());
  requester_store_id := public.current_store_id(auth.uid());

  if requester_role = 'master' then
    return query
    select profile.*
    from public.profiles profile
    order by profile.created_at, profile.id;
    return;
  end if;

  if requester_role <> 'store_admin' or requester_store_id is null then
    raise exception '직원 개인정보를 조회할 권한이 없습니다.';
  end if;

  return query
  select profile.*
  from public.profiles profile
  where profile.store_id = requester_store_id
  order by profile.display_name, profile.id;
end;
$$;

create or replace function public.resolve_product_references(
  target_product_ids uuid[]
)
returns table (
  requested_product_id uuid,
  canonical_product_id uuid,
  canonical_name text,
  is_active_alias boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.';
  end if;
  if target_product_ids is null then
    return;
  end if;
  if exists (
    select 1
    from public.products product
    where product.id = any(target_product_ids)
      and not public.can_access_store(product.store_id)
  ) then
    raise exception '다른 매장의 상품을 조회할 수 없습니다.';
  end if;

  return query
  select
    requested.id,
    coalesce(link.canonical_product_id, requested.id),
    canonical.name,
    link.id is not null
  from public.products requested
  left join public.product_alias_links link
    on link.alias_product_id = requested.id
   and link.unmerged_at is null
  join public.products canonical
    on canonical.id = coalesce(link.canonical_product_id, requested.id)
  where requested.id = any(target_product_ids)
    and public.can_access_store(requested.store_id);
end;
$$;

-- Staff can no longer read another staff member's full profile row (including
-- email) through the table. Directory names/roles come from the RPC above.
drop policy if exists "Users can read profiles in their store" on public.profiles;
drop policy if exists "Users can read profiles in their scope" on public.profiles;
create policy "Users can read permitted profiles"
on public.profiles for select to authenticated
using (
  id = auth.uid()
  or public.is_master(auth.uid())
  or (
    public.current_role(auth.uid()) = 'store_admin'
    and store_id = public.current_store_id(auth.uid())
  )
);

revoke all on function public.ensure_inventory_row(uuid) from public, anon;
revoke all on function public.create_product_with_inventory(uuid, jsonb)
from public, anon;
revoke all on function public.restore_product_with_inventory(uuid, jsonb)
from public, anon;
revoke all on function public.register_and_merge_product_reversible(
  uuid, jsonb, uuid, boolean, bigint, bigint, uuid
) from public, anon;
revoke all on function public.record_inventory_memo(uuid, text, uuid)
from public, anon;
revoke all on function public.update_inventory_memo(uuid, text)
from public, anon;
revoke all on function public.get_my_profile() from public, anon;
revoke all on function public.list_store_staff_directory() from public, anon;
revoke all on function public.list_store_staff_admin() from public, anon;
revoke all on function public.resolve_product_references(uuid[])
from public, anon;

grant execute on function public.ensure_inventory_row(uuid) to authenticated;
grant execute on function public.create_product_with_inventory(uuid, jsonb)
to authenticated;
grant execute on function public.restore_product_with_inventory(uuid, jsonb)
to authenticated;
grant execute on function public.register_and_merge_product_reversible(
  uuid, jsonb, uuid, boolean, bigint, bigint, uuid
) to authenticated;
grant execute on function public.record_inventory_memo(uuid, text, uuid)
to authenticated;
grant execute on function public.update_inventory_memo(uuid, text)
to authenticated;
grant execute on function public.get_my_profile() to authenticated;
grant execute on function public.list_store_staff_directory() to authenticated;
grant execute on function public.list_store_staff_admin() to authenticated;
grant execute on function public.resolve_product_references(uuid[])
to authenticated;

notify pgrst, 'reload schema';
