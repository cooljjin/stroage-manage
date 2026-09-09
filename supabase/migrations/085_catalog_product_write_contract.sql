-- Server-only catalog confirmation writes. Legacy RPC signatures remain unchanged.

alter table public.mutation_requests
  add column if not exists request_fingerprint text;

create or replace function public.clear_stale_product_catalog_link()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.barcode is distinct from old.barcode
    and coalesce(current_setting('app.catalog_write_guard', true), '') <> 'on' then
    new.catalog_id := null;
    new.brand := null;
    new.image_url := null;
    new.catalog_confirmed_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists clear_stale_product_catalog_link on public.products;
create trigger clear_stale_product_catalog_link
before update of barcode on public.products
for each row execute function public.clear_stale_product_catalog_link();

create or replace function public._catalog_product_write(
  actor_id uuid,
  target_store_id uuid,
  target_product_id uuid,
  product_data jsonb,
  catalog_data jsonb,
  request_id uuid,
  operation_type text
)
returns public.products
language plpgsql
security definer
set search_path = public
as $$
declare
  payload public.products%rowtype;
  product_row public.products%rowtype;
  catalog_row public.product_catalog%rowtype;
  request_row public.mutation_requests%rowtype;
  fingerprint text;
  target_gtin text;
  catalog_id_value uuid;
  prior_catalog_write_guard text;
  is_restore boolean := target_product_id is not null;
begin
  if actor_id is null or target_store_id is null then
    raise exception '상품 저장 주체와 매장을 확인해 주세요.';
  end if;
  if not exists (
    select 1 from auth.users user_row where user_row.id = actor_id
  ) or not exists (
    select 1
    from public.profiles profile
    join public.stores store_row on store_row.id = profile.store_id
    where profile.id = actor_id
      and profile.store_id = target_store_id
      and store_row.status = 'active'
  ) then
    raise exception '활성 계정과 매장을 확인해 주세요.';
  end if;
  if product_data is null or jsonb_typeof(product_data) <> 'object' then
    raise exception '상품 정보를 확인해 주세요.';
  end if;
  if request_id is not null then
    if operation_type is null or trim(operation_type) = '' then
      raise exception '상품 저장 작업을 확인해 주세요.';
    end if;
    fingerprint := encode(extensions.digest(jsonb_build_object(
      'store_id', target_store_id,
      'product_id', target_product_id,
      'product_data', product_data,
      'catalog_data', catalog_data
    )::text, 'sha256'), 'hex');
    insert into public.mutation_requests (
      store_id, user_id, request_id, operation_type, request_fingerprint
    ) values (
      target_store_id, actor_id, request_id, operation_type, fingerprint
    ) on conflict on constraint mutation_requests_store_id_user_id_request_id_operation_typ_key do nothing
    returning * into request_row;
    if not found then
      select * into request_row
      from public.mutation_requests mr
      where mr.store_id = target_store_id
        and mr.user_id = actor_id
        and mr.request_id = $6
        and mr.operation_type = $7
      for update;
      if request_row.request_fingerprint is distinct from fingerprint then
        raise exception '같은 요청 식별자에 다른 상품 저장 내용이 사용되었습니다.';
      end if;
      if request_row.completed_at is not null then
        select * into product_row
        from jsonb_populate_record(null::public.products, request_row.result_json);
        return product_row;
      end if;
    end if;
  end if;

  if is_restore then
    select * into product_row
    from public.products product
    where product.id = target_product_id
      and product.store_id = target_store_id
    for update;
    if not found or product_row.is_active then
      raise exception '복구할 상품을 찾을 수 없습니다.';
    end if;
    if exists (
      select 1 from public.product_alias_links link
      where link.alias_product_id = product_row.id and link.unmerged_at is null
    ) or exists (
      select 1 from public.product_merge_history history
      where history.source_product_id = product_row.id
    ) then
      raise exception '병합된 원본 상품은 복구할 수 없습니다.';
    end if;
  else
    if not exists (
      select 1 from public.stores store_row
      where store_row.id = target_store_id and store_row.status = 'active'
    ) then
      raise exception '매장에 접근할 수 없습니다.';
    end if;
  end if;

  payload := jsonb_populate_record(null::public.products, product_data);
  if nullif(trim(payload.name), '') is null then
    raise exception '상품명은 비워둘 수 없습니다.';
  end if;
  if payload.minimum_stock is not null and payload.minimum_stock < 0 then
    raise exception '최소재고는 0 이상이어야 합니다.';
  end if;
  if nullif(trim(payload.barcode), '') is not null and exists (
    select 1 from public.product_barcodes barcode
    where barcode.store_id = target_store_id
      and barcode.barcode = trim(payload.barcode)
      and (not is_restore or barcode.product_id <> target_product_id)
  ) then
    raise exception '이미 같은 바코드로 등록된 품목이 있습니다.';
  end if;

  if catalog_data is not null then
    if jsonb_typeof(catalog_data) <> 'object' then
      raise exception '카탈로그 정보를 확인해 주세요.';
    end if;
    target_gtin := catalog_data->>'gtin';
    if target_gtin is null or not public.is_valid_gtin14(target_gtin)
      or nullif(trim(catalog_data->>'canonical_name'), '') is null
      or nullif(trim(catalog_data->>'source'), '') is null then
      raise exception '검증된 카탈로그 정보가 필요합니다.';
    end if;
    insert into public.product_catalog (
      gtin, canonical_name, brand, manufacturer, size, unit, quantity_text,
      image_url, source, source_url, license, image_license, confidence
    ) values (
      target_gtin, trim(catalog_data->>'canonical_name'),
      nullif(trim(catalog_data->>'brand'), ''),
      nullif(trim(catalog_data->>'manufacturer'), ''),
      (catalog_data->>'size')::numeric,
      nullif(trim(catalog_data->>'unit'), ''),
      nullif(trim(catalog_data->>'quantity_text'), ''),
      nullif(trim(catalog_data->>'image_url'), ''),
      trim(catalog_data->>'source'),
      nullif(trim(catalog_data->>'source_url'), ''),
      nullif(trim(catalog_data->>'license'), ''),
      nullif(trim(catalog_data->>'image_license'), ''),
      (catalog_data->>'confidence')::numeric
    ) on conflict (gtin) do nothing;
    select * into catalog_row from public.product_catalog where gtin = target_gtin;
    catalog_id_value := catalog_row.id;
    prior_catalog_write_guard := current_setting('app.catalog_write_guard', true);
    perform set_config('app.catalog_write_guard', 'on', true);
  end if;

  if is_restore then
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
        catalog_id = case when catalog_data is null then product.catalog_id else catalog_id_value end,
        brand = case when catalog_data is null then product.brand else nullif(trim(catalog_data->>'brand'), '') end,
        image_url = case when catalog_data is null then product.image_url else nullif(trim(catalog_data->>'image_url'), '') end,
        catalog_confirmed_at = case when catalog_data is null then product.catalog_confirmed_at else clock_timestamp() end,
        is_active = true
    where product.id = target_product_id
    returning * into product_row;
  else
    insert into public.products (
      store_id, name, barcode, category, supplier_name, storage_type,
      default_location, unit_name, unit_weight_enabled, unit_weight,
      unit_weight_unit, processing_required, processed_unit_weight,
      processed_unit_weight_unit, minimum_stock, receipt_check_only,
      status_enabled, stock_status, product_url, catalog_id, brand, image_url,
      catalog_confirmed_at
    ) values (
      target_store_id, trim(payload.name), nullif(trim(payload.barcode), ''),
      coalesce(nullif(trim(payload.category), ''), '기타'),
      nullif(trim(payload.supplier_name), ''), nullif(trim(payload.storage_type), ''),
      coalesce(payload.default_location, '창고'), nullif(trim(payload.unit_name), ''),
      coalesce(payload.unit_weight_enabled, false), payload.unit_weight,
      payload.unit_weight_unit, coalesce(payload.processing_required, false),
      payload.processed_unit_weight, payload.processed_unit_weight_unit,
      coalesce(payload.minimum_stock, 0), coalesce(payload.receipt_check_only, false),
      coalesce(payload.status_enabled, false), payload.stock_status,
      nullif(trim(payload.product_url), ''), catalog_id_value,
      case when catalog_data is null then null else nullif(trim(catalog_data->>'brand'), '') end,
      case when catalog_data is null then null else nullif(trim(catalog_data->>'image_url'), '') end,
      case when catalog_data is null then null else clock_timestamp() end
    ) returning * into product_row;
  end if;

  if catalog_data is not null then
    if prior_catalog_write_guard is null then
      execute 'set local app.catalog_write_guard to default';
    else
      perform set_config('app.catalog_write_guard', prior_catalog_write_guard, true);
    end if;
  end if;

  insert into public.inventory (product_id, store_id)
  values (product_row.id, product_row.store_id)
  on conflict (product_id) do nothing;

  if request_id is not null then
    perform public.complete_mutation_request(request_row.id, to_jsonb(product_row));
  end if;
  return product_row;
exception
  when others then
    if catalog_data is not null then
      if prior_catalog_write_guard is null then
        execute 'set local app.catalog_write_guard to default';
      else
        perform set_config('app.catalog_write_guard', prior_catalog_write_guard, true);
      end if;
    end if;
    raise;
end;
$$;

create or replace function public.create_product_with_inventory(
  product_store_id uuid,
  product_data jsonb
)
returns public.products
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다.'; end if;
  return public._catalog_product_write(auth.uid(), product_store_id, null, product_data, null, null, null);
end;
$$;

create or replace function public.restore_product_with_inventory(
  target_product_id uuid,
  product_data jsonb
)
returns public.products
language plpgsql security definer set search_path = public
as $$
declare target_store_id uuid;
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다.'; end if;
  select store_id into target_store_id from public.products where id = target_product_id;
  return public._catalog_product_write(auth.uid(), target_store_id, target_product_id, product_data, null, null, null);
end;
$$;

create or replace function public.create_product_with_catalog(
  actor_id uuid,
  product_store_id uuid,
  product_data jsonb,
  catalog_data jsonb,
  request_id uuid
)
returns public.products
language plpgsql security definer set search_path = public
as $$
begin
  if current_setting('request.jwt.claim.role', true) <> 'service_role' then
    raise exception '서버 전용 상품 저장 API입니다.';
  end if;
  if request_id is null then
    raise exception '상품 저장 요청 식별자가 필요합니다.';
  end if;
  return public._catalog_product_write(actor_id, product_store_id, null, product_data, catalog_data, request_id, 'create_product_with_catalog');
end;
$$;

create or replace function public.restore_product_with_catalog(
  actor_id uuid,
  target_product_id uuid,
  product_data jsonb,
  catalog_data jsonb,
  request_id uuid
)
returns public.products
language plpgsql security definer set search_path = public
as $$
declare target_store_id uuid;
begin
  if current_setting('request.jwt.claim.role', true) <> 'service_role' then
    raise exception '서버 전용 상품 저장 API입니다.';
  end if;
  if request_id is null then
    raise exception '상품 저장 요청 식별자가 필요합니다.';
  end if;
  select store_id into target_store_id from public.products where id = target_product_id;
  return public._catalog_product_write(actor_id, target_store_id, target_product_id, product_data, catalog_data, request_id, 'restore_product_with_catalog');
end;
$$;

revoke all on function public._catalog_product_write(uuid, uuid, uuid, jsonb, jsonb, uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.clear_stale_product_catalog_link() from public, anon, authenticated, service_role;
revoke all on function public.create_product_with_catalog(uuid, uuid, jsonb, jsonb, uuid) from public, anon, authenticated;
revoke all on function public.restore_product_with_catalog(uuid, uuid, jsonb, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.create_product_with_catalog(uuid, uuid, jsonb, jsonb, uuid) to service_role;
grant execute on function public.restore_product_with_catalog(uuid, uuid, jsonb, jsonb, uuid) to service_role;

notify pgrst, 'reload schema';
