-- 창고와 매장 재고의 낙관적 잠금을 분리합니다.
-- 기존 timestamp 기반 RPC는 설치된 구버전 앱을 위해 그대로 유지합니다.

alter table public.inventory
add column if not exists warehouse_version bigint not null default 0,
add column if not exists store_version bigint not null default 0;

alter table public.mobile_inventory_sessions
add column if not exists warehouse_version bigint not null default 0,
add column if not exists store_version bigint not null default 0;

alter table public.mobile_inventory_session_events
add column if not exists warehouse_version_before bigint not null default 0,
add column if not exists store_version_before bigint not null default 0,
add column if not exists warehouse_version_after bigint not null default 0,
add column if not exists store_version_after bigint not null default 0;

create or replace function public.track_inventory_location_versions()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.warehouse_version := case
    when new.warehouse_qty is distinct from old.warehouse_qty then old.warehouse_version + 1
    else old.warehouse_version
  end;
  new.store_version := case
    when new.store_qty is distinct from old.store_qty then old.store_version + 1
    else old.store_version
  end;
  return new;
end;
$$;

drop trigger if exists inventory_track_location_versions on public.inventory;
create trigger inventory_track_location_versions
before update on public.inventory
for each row execute function public.track_inventory_location_versions();

create or replace function public.record_inventory_operation_idempotent_v2(
  target_product_id uuid,
  operation_action text,
  target_location text,
  move_direction text,
  operation_quantity numeric,
  expected_warehouse_version bigint,
  expected_store_version bigint,
  request_id uuid
)
returns table (
  log_id uuid,
  warehouse_qty numeric,
  store_qty numeric,
  warehouse_version bigint,
  store_version bigint,
  inventory_updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  target_product public.products%rowtype;
  current_inventory public.inventory%rowtype;
  updated_inventory public.inventory%rowtype;
  request_row public.mutation_requests%rowtype;
  next_warehouse_qty numeric(12, 4);
  next_store_qty numeric(12, 4);
  source_location_value text;
  destination_location_value text;
  previous_quantity_value numeric(12, 4);
  new_quantity_value numeric(12, 4);
  created_log_id uuid;
  is_no_longer_low_stock boolean;
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.';
  end if;

  select * into target_product
  from public.products
  where id = target_product_id
  for update;

  if not found or not public.can_access_store(target_product.store_id) then
    raise exception '해당 상품에 접근할 권한이 없습니다.';
  end if;
  if target_product.receipt_check_only then
    raise exception '입고여부만 확인 품목은 별도 입고 확인으로 처리해 주세요.';
  end if;
  if operation_action not in ('입고', '출고', '이동', '조정') then
    raise exception '지원하지 않는 재고 작업입니다.';
  end if;
  if target_location not in ('창고', '매장') then
    raise exception '재고 위치를 확인해 주세요.';
  end if;
  if operation_quantity is null
    or (operation_action = '조정' and operation_quantity < 0)
    or (operation_action <> '조정' and operation_quantity <= 0) then
    raise exception '재고 수량을 확인해 주세요.';
  end if;

  request_row := public.claim_mutation_request(
    target_product.store_id,
    'record_inventory_operation_v2',
    request_id
  );
  if request_row.completed_at is not null then
    log_id := (request_row.result_json->>'log_id')::uuid;
    warehouse_qty := (request_row.result_json->>'warehouse_qty')::numeric;
    store_qty := (request_row.result_json->>'store_qty')::numeric;
    warehouse_version := (request_row.result_json->>'warehouse_version')::bigint;
    store_version := (request_row.result_json->>'store_version')::bigint;
    inventory_updated_at := (request_row.result_json->>'inventory_updated_at')::timestamptz;
    return next;
    return;
  end if;

  insert into public.inventory (product_id, store_id)
  values (target_product.id, target_product.store_id)
  on conflict (product_id) do nothing;

  select * into current_inventory
  from public.inventory
  where product_id = target_product.id
    and store_id = target_product.store_id
  for update;

  if operation_action = '이동' then
    if expected_warehouse_version is null or expected_store_version is null
      or current_inventory.warehouse_version is distinct from expected_warehouse_version
      or current_inventory.store_version is distinct from expected_store_version then
      raise exception '다른 직원이 창고 또는 매장 재고를 먼저 변경했습니다. 최신 수량을 확인한 뒤 다시 저장해 주세요.';
    end if;
  elsif target_location = '창고' then
    if expected_warehouse_version is null
      or current_inventory.warehouse_version is distinct from expected_warehouse_version then
      raise exception '다른 직원이 같은 위치의 재고를 먼저 변경했습니다. 최신 창고 수량을 확인한 뒤 다시 저장해 주세요.';
    end if;
  elsif expected_store_version is null
    or current_inventory.store_version is distinct from expected_store_version then
    raise exception '다른 직원이 같은 위치의 재고를 먼저 변경했습니다. 최신 매장 수량을 확인한 뒤 다시 저장해 주세요.';
  end if;

  next_warehouse_qty := current_inventory.warehouse_qty;
  next_store_qty := current_inventory.store_qty;

  if operation_action = '입고' then
    destination_location_value := target_location;
    if target_location = '창고' then
      previous_quantity_value := current_inventory.warehouse_qty;
      next_warehouse_qty := next_warehouse_qty + operation_quantity;
      new_quantity_value := next_warehouse_qty;
    else
      previous_quantity_value := current_inventory.store_qty;
      next_store_qty := next_store_qty + operation_quantity;
      new_quantity_value := next_store_qty;
    end if;
  elsif operation_action = '출고' then
    source_location_value := target_location;
    if target_location = '창고' then
      previous_quantity_value := current_inventory.warehouse_qty;
      next_warehouse_qty := next_warehouse_qty - operation_quantity;
      new_quantity_value := next_warehouse_qty;
    else
      previous_quantity_value := current_inventory.store_qty;
      next_store_qty := next_store_qty - operation_quantity;
      new_quantity_value := next_store_qty;
    end if;
  elsif operation_action = '이동' then
    if move_direction = 'warehouse-to-store' then
      source_location_value := '창고';
      destination_location_value := '매장';
      previous_quantity_value := current_inventory.warehouse_qty;
      next_warehouse_qty := next_warehouse_qty - operation_quantity;
      next_store_qty := next_store_qty + operation_quantity;
      new_quantity_value := next_warehouse_qty;
    elsif move_direction = 'store-to-warehouse' then
      source_location_value := '매장';
      destination_location_value := '창고';
      previous_quantity_value := current_inventory.store_qty;
      next_store_qty := next_store_qty - operation_quantity;
      next_warehouse_qty := next_warehouse_qty + operation_quantity;
      new_quantity_value := next_store_qty;
    else
      raise exception '이동 방향을 확인해 주세요.';
    end if;
  else
    source_location_value := target_location;
    if target_location = '창고' then
      previous_quantity_value := current_inventory.warehouse_qty;
      next_warehouse_qty := operation_quantity;
      new_quantity_value := next_warehouse_qty;
    else
      previous_quantity_value := current_inventory.store_qty;
      next_store_qty := operation_quantity;
      new_quantity_value := next_store_qty;
    end if;
  end if;

  if next_warehouse_qty < 0 or next_store_qty < 0 then
    raise exception '재고 수량은 음수가 될 수 없습니다.';
  end if;

  if operation_action = '이동' then
    update public.inventory
    set warehouse_qty = next_warehouse_qty,
        store_qty = next_store_qty
    where id = current_inventory.id
    returning * into updated_inventory;
  elsif target_location = '창고' then
    update public.inventory
    set warehouse_qty = next_warehouse_qty
    where id = current_inventory.id
    returning * into updated_inventory;
  else
    update public.inventory
    set store_qty = next_store_qty
    where id = current_inventory.id
    returning * into updated_inventory;
  end if;

  insert into public.inventory_logs (
    store_id, product_id, user_id, action, source_location,
    destination_location, previous_quantity, new_quantity, quantity, note,
    warehouse_qty_before, store_qty_before, warehouse_qty_after, store_qty_after
  ) values (
    target_product.store_id, target_product.id, auth.uid(), operation_action,
    source_location_value, destination_location_value, previous_quantity_value,
    new_quantity_value, operation_quantity, null, current_inventory.warehouse_qty,
    current_inventory.store_qty, updated_inventory.warehouse_qty, updated_inventory.store_qty
  ) returning id into created_log_id;

  is_no_longer_low_stock := case
    when target_product.status_enabled then target_product.stock_status is distinct from '발주 필요'
    else updated_inventory.warehouse_qty + updated_inventory.store_qty > target_product.minimum_stock
  end;

  if operation_action = '입고' then
    update public.products
    set fresh_order_selected = false,
        fresh_order_selected_at = null,
        urgent_order_requested = false,
        urgent_order_quantity = null,
        order_completed = false,
        confirmed_order_pending = false
    where id = target_product.id;
  elsif operation_action = '조정'
    and target_product.confirmed_order_pending
    and is_no_longer_low_stock then
    update public.products
    set order_completed = false,
        confirmed_order_pending = false
    where id = target_product.id;
  end if;

  perform public.complete_mutation_request(request_row.id, jsonb_build_object(
    'log_id', created_log_id,
    'warehouse_qty', updated_inventory.warehouse_qty,
    'store_qty', updated_inventory.store_qty,
    'warehouse_version', updated_inventory.warehouse_version,
    'store_version', updated_inventory.store_version,
    'inventory_updated_at', updated_inventory.updated_at
  ));

  log_id := created_log_id;
  warehouse_qty := updated_inventory.warehouse_qty;
  store_qty := updated_inventory.store_qty;
  warehouse_version := updated_inventory.warehouse_version;
  store_version := updated_inventory.store_version;
  inventory_updated_at := updated_inventory.updated_at;
  return next;
end;
$$;

create or replace function public.apply_mobile_inventory_change_v2(
  target_session_id uuid,
  target_product_id uuid,
  operation_mode text,
  target_location text,
  move_direction text,
  requested_warehouse_qty numeric,
  requested_store_qty numeric,
  expected_warehouse_version bigint,
  expected_store_version bigint,
  request_id uuid,
  entry_source text
)
returns table (
  session_id uuid,
  warehouse_qty numeric,
  store_qty numeric,
  warehouse_version bigint,
  store_version bigint,
  inventory_updated_at timestamptz,
  last_activity_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  target_product public.products%rowtype;
  current_inventory public.inventory%rowtype;
  updated_inventory public.inventory%rowtype;
  current_session public.mobile_inventory_sessions%rowtype;
  existing_event public.mobile_inventory_session_events%rowtype;
  next_session_id uuid;
  next_sequence integer;
  next_warehouse_qty numeric(12, 4);
  next_store_qty numeric(12, 4);
  changed_at timestamptz := clock_timestamp();
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다.'; end if;
  if operation_mode not in ('auto', 'move', 'audit') then raise exception '모바일 재고 작업 모드를 확인해 주세요.'; end if;
  if entry_source not in ('operation', 'scan_audit') then raise exception '모바일 재고 작업 진입 경로를 확인해 주세요.'; end if;
  if request_id is null then raise exception '재고 저장 요청 식별자가 필요합니다.'; end if;
  if requested_warehouse_qty is null or requested_store_qty is null
    or requested_warehouse_qty < 0 or requested_store_qty < 0 then
    raise exception '재고 수량은 0 이상이어야 합니다.';
  end if;
  if requested_warehouse_qty > 99999999.9999 or requested_store_qty > 99999999.9999 then
    raise exception '재고 수량이 너무 큽니다.';
  end if;
  if requested_warehouse_qty <> round(requested_warehouse_qty, 4)
    or requested_store_qty <> round(requested_store_qty, 4) then
    raise exception '재고 수량은 소수점 넷째 자리까지 입력할 수 있습니다.';
  end if;

  select * into target_product from public.products where id = target_product_id for update;
  if not found or not public.can_access_store(target_product.store_id) then raise exception '해당 상품에 접근할 권한이 없습니다.'; end if;
  if target_product.receipt_check_only then raise exception '입고여부만 확인 품목은 별도 입고 확인으로 처리해 주세요.'; end if;

  select * into existing_event
  from public.mobile_inventory_session_events event_row
  where event_row.request_id = apply_mobile_inventory_change_v2.request_id;

  if found then
    select session.id, session.warehouse_qty_current, session.store_qty_current,
      session.warehouse_version, session.store_version, session.inventory_updated_at, session.last_activity_at
    into session_id, warehouse_qty, store_qty, warehouse_version, store_version, inventory_updated_at, last_activity_at
    from public.mobile_inventory_sessions session
    where session.id = existing_event.session_id
      and session.product_id = target_product.id
      and session.user_id = auth.uid()
      and public.can_access_store(session.store_id);
    if session_id is null then raise exception '모바일 재고 작업 세션을 찾을 수 없습니다.'; end if;
    return next;
    return;
  end if;

  if target_location is not null and target_location not in ('창고', '매장') then raise exception '재고 위치를 확인해 주세요.'; end if;
  if move_direction is not null and move_direction not in ('warehouse-to-store', 'store-to-warehouse') then raise exception '이동 방향을 확인해 주세요.'; end if;

  insert into public.inventory (product_id, store_id)
  values (target_product.id, target_product.store_id)
  on conflict (product_id) do nothing;

  select * into current_inventory
  from public.inventory
  where product_id = target_product.id and store_id = target_product.store_id
  for update;

  if operation_mode = 'move' then
    if expected_warehouse_version is null or expected_store_version is null
      or current_inventory.warehouse_version is distinct from expected_warehouse_version
      or current_inventory.store_version is distinct from expected_store_version then
      raise exception '다른 직원이 창고 또는 매장 재고를 먼저 변경했습니다. 최신 수량을 확인한 뒤 다시 저장해 주세요.';
    end if;
  elsif target_location = '창고' then
    if expected_warehouse_version is null or current_inventory.warehouse_version is distinct from expected_warehouse_version then
      raise exception '다른 직원이 같은 위치의 재고를 먼저 변경했습니다. 최신 창고 수량을 확인한 뒤 다시 저장해 주세요.';
    end if;
  elsif target_location = '매장' then
    if expected_store_version is null or current_inventory.store_version is distinct from expected_store_version then
      raise exception '다른 직원이 같은 위치의 재고를 먼저 변경했습니다. 최신 매장 수량을 확인한 뒤 다시 저장해 주세요.';
    end if;
  else
    raise exception '재고 위치를 선택해 주세요.';
  end if;

  if target_session_id is not null then
    select * into current_session
    from public.mobile_inventory_sessions
    where id = target_session_id and product_id = target_product.id
      and store_id = target_product.store_id and user_id = auth.uid() and status = 'open'
    for update;
    if not found then raise exception '모바일 재고 작업 세션을 찾을 수 없습니다.'; end if;
    next_session_id := current_session.id;
  else
    insert into public.mobile_inventory_sessions (
      store_id, product_id, user_id, entry_source,
      warehouse_qty_started, store_qty_started, warehouse_qty_current, store_qty_current,
      warehouse_version, store_version, inventory_updated_at, started_at, last_activity_at
    ) values (
      target_product.store_id, target_product.id, auth.uid(), entry_source,
      current_inventory.warehouse_qty, current_inventory.store_qty,
      current_inventory.warehouse_qty, current_inventory.store_qty,
      current_inventory.warehouse_version, current_inventory.store_version,
      current_inventory.updated_at, changed_at, changed_at
    ) returning id into next_session_id;
  end if;

  next_warehouse_qty := current_inventory.warehouse_qty;
  next_store_qty := current_inventory.store_qty;

  if operation_mode in ('auto', 'audit') then
    if move_direction is not null then raise exception '실사·자동 작업에는 이동 방향을 사용할 수 없습니다.'; end if;
    if target_location = '창고' then next_warehouse_qty := requested_warehouse_qty;
    else next_store_qty := requested_store_qty;
    end if;
  else
    if move_direction is null or target_location is null then raise exception '이동 방향과 출발 위치를 확인해 주세요.'; end if;
    if requested_warehouse_qty + requested_store_qty
      is distinct from current_inventory.warehouse_qty + current_inventory.store_qty then
      raise exception '이동은 총재고를 변경할 수 없습니다.';
    end if;
    if move_direction = 'warehouse-to-store'
      and (target_location <> '창고' or requested_warehouse_qty > current_inventory.warehouse_qty) then
      raise exception '창고에서 이동할 수량을 확인해 주세요.';
    end if;
    if move_direction = 'store-to-warehouse'
      and (target_location <> '매장' or requested_store_qty > current_inventory.store_qty) then
      raise exception '매장에서 이동할 수량을 확인해 주세요.';
    end if;
    next_warehouse_qty := requested_warehouse_qty;
    next_store_qty := requested_store_qty;
  end if;

  if operation_mode = 'move' then
    update public.inventory set warehouse_qty = next_warehouse_qty, store_qty = next_store_qty
    where id = current_inventory.id returning * into updated_inventory;
  elsif target_location = '창고' then
    update public.inventory set warehouse_qty = next_warehouse_qty
    where id = current_inventory.id returning * into updated_inventory;
  else
    update public.inventory set store_qty = next_store_qty
    where id = current_inventory.id returning * into updated_inventory;
  end if;

  select coalesce(max(event_row.sequence), 0) + 1 into next_sequence
  from public.mobile_inventory_session_events event_row
  where event_row.session_id = next_session_id;

  insert into public.mobile_inventory_session_events (
    session_id, sequence, request_id, mode, target_location, move_direction,
    warehouse_qty_before, store_qty_before, warehouse_qty_after, store_qty_after,
    warehouse_version_before, store_version_before, warehouse_version_after, store_version_after,
    occurred_at
  ) values (
    next_session_id, next_sequence, apply_mobile_inventory_change_v2.request_id,
    operation_mode, target_location, move_direction,
    current_inventory.warehouse_qty, current_inventory.store_qty,
    updated_inventory.warehouse_qty, updated_inventory.store_qty,
    current_inventory.warehouse_version, current_inventory.store_version,
    updated_inventory.warehouse_version, updated_inventory.store_version, changed_at
  );

  update public.mobile_inventory_sessions
  set warehouse_qty_current = updated_inventory.warehouse_qty,
      store_qty_current = updated_inventory.store_qty,
      warehouse_version = updated_inventory.warehouse_version,
      store_version = updated_inventory.store_version,
      inventory_updated_at = updated_inventory.updated_at,
      last_activity_at = changed_at
  where id = next_session_id;

  session_id := next_session_id;
  warehouse_qty := updated_inventory.warehouse_qty;
  store_qty := updated_inventory.store_qty;
  warehouse_version := updated_inventory.warehouse_version;
  store_version := updated_inventory.store_version;
  inventory_updated_at := updated_inventory.updated_at;
  last_activity_at := changed_at;
  return next;
end;
$$;

create or replace function public.restore_inventory_to_log_v2(
  target_log_id uuid,
  restored_warehouse_qty numeric,
  restored_store_qty numeric,
  expected_warehouse_version bigint,
  expected_store_version bigint,
  request_id uuid
)
returns table (
  warehouse_qty numeric,
  store_qty numeric,
  warehouse_version bigint,
  store_version bigint,
  inventory_updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  target_log public.inventory_logs%rowtype;
  current_inventory public.inventory%rowtype;
  request_row public.mutation_requests%rowtype;
begin
  select * into target_log from public.inventory_logs where id = target_log_id;
  if not found or not public.can_access_store(target_log.store_id) then raise exception '복원할 작업 기록을 찾을 수 없습니다.'; end if;

  request_row := public.claim_mutation_request(target_log.store_id, 'restore_inventory_to_log_v2', request_id);
  if request_row.completed_at is not null then
    warehouse_qty := (request_row.result_json->>'warehouse_qty')::numeric;
    store_qty := (request_row.result_json->>'store_qty')::numeric;
    warehouse_version := (request_row.result_json->>'warehouse_version')::bigint;
    store_version := (request_row.result_json->>'store_version')::bigint;
    inventory_updated_at := (request_row.result_json->>'inventory_updated_at')::timestamptz;
    return next;
    return;
  end if;

  select * into current_inventory from public.inventory
  where product_id = target_log.product_id and store_id = target_log.store_id for update;
  if not found then raise exception '재고 정보를 찾을 수 없습니다.'; end if;
  if expected_warehouse_version is null or expected_store_version is null
    or current_inventory.warehouse_version is distinct from expected_warehouse_version
    or current_inventory.store_version is distinct from expected_store_version then
    raise exception '복원 대상 이후 재고가 변경되었습니다. 최신 창고·매장 수량을 확인한 뒤 다시 시도해 주세요.';
  end if;

  perform public.restore_inventory_to_log(target_log_id, restored_warehouse_qty, restored_store_qty);
  select * into current_inventory from public.inventory where product_id = target_log.product_id and store_id = target_log.store_id;
  perform public.complete_mutation_request(request_row.id, jsonb_build_object(
    'warehouse_qty', current_inventory.warehouse_qty, 'store_qty', current_inventory.store_qty,
    'warehouse_version', current_inventory.warehouse_version, 'store_version', current_inventory.store_version,
    'inventory_updated_at', current_inventory.updated_at
  ));
  warehouse_qty := current_inventory.warehouse_qty;
  store_qty := current_inventory.store_qty;
  warehouse_version := current_inventory.warehouse_version;
  store_version := current_inventory.store_version;
  inventory_updated_at := current_inventory.updated_at;
  return next;
end;
$$;

create or replace function public.restore_inventory_to_mobile_session_v2(
  target_session_id uuid,
  restored_warehouse_qty numeric,
  restored_store_qty numeric,
  expected_warehouse_version bigint,
  expected_store_version bigint,
  request_id uuid
)
returns table (
  warehouse_qty numeric,
  store_qty numeric,
  warehouse_version bigint,
  store_version bigint,
  inventory_updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  target_session public.mobile_inventory_sessions%rowtype;
  current_inventory public.inventory%rowtype;
  request_row public.mutation_requests%rowtype;
begin
  select * into target_session from public.mobile_inventory_sessions where id = target_session_id;
  if not found or not public.can_access_store(target_session.store_id) then raise exception '복원할 모바일 재고 작업을 찾을 수 없습니다.'; end if;

  request_row := public.claim_mutation_request(target_session.store_id, 'restore_inventory_to_mobile_session_v2', request_id);
  if request_row.completed_at is not null then
    warehouse_qty := (request_row.result_json->>'warehouse_qty')::numeric;
    store_qty := (request_row.result_json->>'store_qty')::numeric;
    warehouse_version := (request_row.result_json->>'warehouse_version')::bigint;
    store_version := (request_row.result_json->>'store_version')::bigint;
    inventory_updated_at := (request_row.result_json->>'inventory_updated_at')::timestamptz;
    return next;
    return;
  end if;

  select * into current_inventory from public.inventory
  where product_id = target_session.product_id and store_id = target_session.store_id for update;
  if not found then raise exception '재고 정보를 찾을 수 없습니다.'; end if;
  if expected_warehouse_version is null or expected_store_version is null
    or current_inventory.warehouse_version is distinct from expected_warehouse_version
    or current_inventory.store_version is distinct from expected_store_version then
    raise exception '복원 대상 이후 재고가 변경되었습니다. 최신 창고·매장 수량을 확인한 뒤 다시 시도해 주세요.';
  end if;

  perform public.restore_inventory_to_mobile_session(target_session_id, restored_warehouse_qty, restored_store_qty);
  select * into current_inventory from public.inventory
  where product_id = target_session.product_id and store_id = target_session.store_id;
  perform public.complete_mutation_request(request_row.id, jsonb_build_object(
    'warehouse_qty', current_inventory.warehouse_qty, 'store_qty', current_inventory.store_qty,
    'warehouse_version', current_inventory.warehouse_version, 'store_version', current_inventory.store_version,
    'inventory_updated_at', current_inventory.updated_at
  ));
  warehouse_qty := current_inventory.warehouse_qty;
  store_qty := current_inventory.store_qty;
  warehouse_version := current_inventory.warehouse_version;
  store_version := current_inventory.store_version;
  inventory_updated_at := current_inventory.updated_at;
  return next;
end;
$$;

revoke all on function public.record_inventory_operation_idempotent_v2(uuid, text, text, text, numeric, bigint, bigint, uuid) from public, anon;
revoke all on function public.apply_mobile_inventory_change_v2(uuid, uuid, text, text, text, numeric, numeric, bigint, bigint, uuid, text) from public, anon;
revoke all on function public.restore_inventory_to_log_v2(uuid, numeric, numeric, bigint, bigint, uuid) from public, anon;
revoke all on function public.restore_inventory_to_mobile_session_v2(uuid, numeric, numeric, bigint, bigint, uuid) from public, anon;

grant execute on function public.record_inventory_operation_idempotent_v2(uuid, text, text, text, numeric, bigint, bigint, uuid) to authenticated;
grant execute on function public.apply_mobile_inventory_change_v2(uuid, uuid, text, text, text, numeric, numeric, bigint, bigint, uuid, text) to authenticated;
grant execute on function public.restore_inventory_to_log_v2(uuid, numeric, numeric, bigint, bigint, uuid) to authenticated;
grant execute on function public.restore_inventory_to_mobile_session_v2(uuid, numeric, numeric, bigint, bigint, uuid) to authenticated;

notify pgrst, 'reload schema';
