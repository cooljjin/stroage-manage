-- Qualify the event session_id lookup so it cannot collide with the
-- session_id column returned by apply_mobile_inventory_change.

create or replace function public.apply_mobile_inventory_change(
  target_session_id uuid,
  target_product_id uuid,
  operation_mode text,
  target_location text,
  move_direction text,
  requested_warehouse_qty numeric,
  requested_store_qty numeric,
  expected_inventory_updated_at timestamptz,
  request_id uuid,
  entry_source text
)
returns table (
  session_id uuid,
  warehouse_qty numeric,
  store_qty numeric,
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
  changed_at timestamptz := clock_timestamp();
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.';
  end if;
  if operation_mode not in ('auto', 'move', 'audit') then
    raise exception '모바일 재고 작업 모드를 확인해 주세요.';
  end if;
  if entry_source not in ('operation', 'scan_audit') then
    raise exception '모바일 재고 작업 진입 경로를 확인해 주세요.';
  end if;
  if request_id is null then
    raise exception '재고 저장 요청 식별자가 필요합니다.';
  end if;
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

  -- The request id is checked before the optimistic timestamp so a retry after
  -- a lost response remains idempotent even though the first request updated it.
  select * into existing_event
  from public.mobile_inventory_session_events event_row
  where event_row.request_id = apply_mobile_inventory_change.request_id;

  if found then
    select
      session.id,
      session.warehouse_qty_current,
      session.store_qty_current,
      session.inventory_updated_at,
      session.last_activity_at
    into session_id, warehouse_qty, store_qty, inventory_updated_at, last_activity_at
    from public.mobile_inventory_sessions session
    where session.id = existing_event.session_id
      and session.user_id = auth.uid()
      and public.can_access_store(session.store_id);
    if session_id is null then
      raise exception '모바일 재고 작업 세션을 찾을 수 없습니다.';
    end if;
    return next;
    return;
  end if;

  if target_location is not null and target_location not in ('창고', '매장') then
    raise exception '재고 위치를 확인해 주세요.';
  end if;
  if move_direction is not null and move_direction not in ('warehouse-to-store', 'store-to-warehouse') then
    raise exception '이동 방향을 확인해 주세요.';
  end if;

  select * into current_inventory
  from public.inventory
  where product_id = target_product_id
    and store_id = target_product.store_id
  for update;

  if not found then
    insert into public.inventory (product_id, store_id)
    values (target_product.id, target_product.store_id)
    on conflict (product_id) do nothing;

    select * into current_inventory
    from public.inventory
    where product_id = target_product_id
      and store_id = target_product.store_id
    for update;
  end if;

  if expected_inventory_updated_at is null
    or current_inventory.updated_at is distinct from expected_inventory_updated_at then
    raise exception '다른 직원이 먼저 재고를 변경했습니다. 최신 수량을 불러온 뒤 다시 저장해 주세요.';
  end if;

  if target_session_id is not null then
    select * into current_session
    from public.mobile_inventory_sessions
    where id = target_session_id
      and product_id = target_product.id
      and store_id = target_product.store_id
      and user_id = auth.uid()
      and status = 'open'
    for update;

    if not found then
      raise exception '모바일 재고 작업 세션을 찾을 수 없습니다.';
    end if;
    next_session_id := current_session.id;
  else
    insert into public.mobile_inventory_sessions (
      store_id, product_id, user_id, entry_source,
      warehouse_qty_started, store_qty_started,
      warehouse_qty_current, store_qty_current,
      inventory_updated_at, started_at, last_activity_at
    ) values (
      target_product.store_id, target_product.id, auth.uid(), entry_source,
      current_inventory.warehouse_qty, current_inventory.store_qty,
      current_inventory.warehouse_qty, current_inventory.store_qty,
      current_inventory.updated_at, changed_at, changed_at
    ) returning id into next_session_id;
  end if;

  if operation_mode in ('auto', 'audit') then
    if target_location is null then
      raise exception '재고 위치를 선택해 주세요.';
    end if;
    if target_location = '창고'
      and requested_store_qty is distinct from current_inventory.store_qty then
      raise exception '한 번의 모바일 작업에서는 한 위치만 변경할 수 있습니다.';
    end if;
    if target_location = '매장'
      and requested_warehouse_qty is distinct from current_inventory.warehouse_qty then
      raise exception '한 번의 모바일 작업에서는 한 위치만 변경할 수 있습니다.';
    end if;
    if move_direction is not null then
      raise exception '실사·자동 작업에는 이동 방향을 사용할 수 없습니다.';
    end if;
  elsif operation_mode = 'move' then
    if move_direction is null or target_location is null then
      raise exception '이동 방향과 출발 위치를 확인해 주세요.';
    end if;
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
  end if;

  update public.inventory
  set warehouse_qty = requested_warehouse_qty,
      store_qty = requested_store_qty
  where id = current_inventory.id
  returning * into updated_inventory;

  select coalesce(max(event_row.sequence), 0) + 1 into next_sequence
  from public.mobile_inventory_session_events event_row
  where event_row.session_id = next_session_id;

  insert into public.mobile_inventory_session_events (
    session_id, sequence, request_id, mode, target_location, move_direction,
    warehouse_qty_before, store_qty_before, warehouse_qty_after, store_qty_after, occurred_at
  ) values (
    next_session_id, next_sequence, apply_mobile_inventory_change.request_id,
    operation_mode, target_location, move_direction,
    current_inventory.warehouse_qty, current_inventory.store_qty,
    updated_inventory.warehouse_qty, updated_inventory.store_qty, changed_at
  );

  update public.mobile_inventory_sessions
  set warehouse_qty_current = updated_inventory.warehouse_qty,
      store_qty_current = updated_inventory.store_qty,
      inventory_updated_at = updated_inventory.updated_at,
      last_activity_at = changed_at
  where id = next_session_id;

  session_id := next_session_id;
  warehouse_qty := updated_inventory.warehouse_qty;
  store_qty := updated_inventory.store_qty;
  inventory_updated_at := updated_inventory.updated_at;
  last_activity_at := changed_at;
  return next;
end;
$$;

revoke all on function public.apply_mobile_inventory_change(uuid, uuid, text, text, text, numeric, numeric, timestamptz, uuid, text) from public, anon;
grant execute on function public.apply_mobile_inventory_change(uuid, uuid, text, text, text, numeric, numeric, timestamptz, uuid, text) to authenticated;
