-- Mobile inventory controls keep the live quantity durable while grouping
-- repeated gestures into one user-visible inventory operation.

create table if not exists public.mobile_inventory_sessions (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete restrict,
  entry_source text not null check (entry_source in ('operation', 'scan_audit')),
  status text not null default 'open' check (status in ('open', 'finalized', 'recovered')),
  warehouse_qty_started numeric(12, 4) not null check (warehouse_qty_started >= 0),
  store_qty_started numeric(12, 4) not null check (store_qty_started >= 0),
  warehouse_qty_current numeric(12, 4) not null check (warehouse_qty_current >= 0),
  store_qty_current numeric(12, 4) not null check (store_qty_current >= 0),
  inventory_updated_at timestamptz not null,
  started_at timestamptz not null default clock_timestamp(),
  last_activity_at timestamptz not null default clock_timestamp(),
  finalized_at timestamptz
);

create table if not exists public.mobile_inventory_session_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.mobile_inventory_sessions(id) on delete cascade,
  sequence integer not null check (sequence > 0),
  request_id uuid not null unique,
  mode text not null check (mode in ('auto', 'move', 'audit')),
  target_location text check (target_location in ('창고', '매장') or target_location is null),
  move_direction text check (move_direction in ('warehouse-to-store', 'store-to-warehouse') or move_direction is null),
  warehouse_qty_before numeric(12, 4) not null check (warehouse_qty_before >= 0),
  store_qty_before numeric(12, 4) not null check (store_qty_before >= 0),
  warehouse_qty_after numeric(12, 4) not null check (warehouse_qty_after >= 0),
  store_qty_after numeric(12, 4) not null check (store_qty_after >= 0),
  occurred_at timestamptz not null default clock_timestamp(),
  unique (session_id, sequence)
);

alter table public.inventory_logs
  add column if not exists mobile_session_id uuid references public.mobile_inventory_sessions(id) on delete set null,
  add column if not exists mobile_session_sequence integer;

create index if not exists mobile_inventory_sessions_product_status_idx
on public.mobile_inventory_sessions (product_id, status, last_activity_at desc);

create index if not exists mobile_inventory_sessions_store_status_idx
on public.mobile_inventory_sessions (store_id, status, last_activity_at desc);

create index if not exists mobile_inventory_session_events_session_idx
on public.mobile_inventory_session_events (session_id, sequence);

create index if not exists inventory_logs_mobile_session_idx
on public.inventory_logs (mobile_session_id, mobile_session_sequence);

alter table public.mobile_inventory_sessions enable row level security;
alter table public.mobile_inventory_session_events enable row level security;

drop policy if exists "Users can read mobile inventory sessions in their store" on public.mobile_inventory_sessions;
create policy "Users can read mobile inventory sessions in their store"
on public.mobile_inventory_sessions for select to authenticated
using (public.can_access_store(store_id));

drop policy if exists "Users can read mobile inventory events in their store" on public.mobile_inventory_session_events;
create policy "Users can read mobile inventory events in their store"
on public.mobile_inventory_session_events for select to authenticated
using (
  exists (
    select 1
    from public.mobile_inventory_sessions session_row
    where session_row.id = session_id
      and public.can_access_store(session_row.store_id)
  )
);

revoke all on public.mobile_inventory_sessions from public, anon, authenticated;
revoke all on public.mobile_inventory_session_events from public, anon, authenticated;
grant select on public.mobile_inventory_sessions to authenticated;
grant select on public.mobile_inventory_session_events to authenticated;

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

  select coalesce(max(sequence), 0) + 1 into next_sequence
  from public.mobile_inventory_session_events
  where session_id = next_session_id;

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

create or replace function public.finalize_mobile_inventory_session(
  target_session_id uuid,
  finalization_reason text default 'navigation'
)
returns setof uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target_session public.mobile_inventory_sessions%rowtype;
  target_product public.products%rowtype;
  segment record;
  created_log_id uuid;
  sequence_value integer := 0;
  has_receipt boolean := false;
  is_no_longer_low_stock boolean;
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.';
  end if;

  select * into target_session
  from public.mobile_inventory_sessions
  where id = target_session_id
    and user_id = auth.uid()
  for update;

  if not found then
    raise exception '모바일 재고 작업 세션을 찾을 수 없습니다.';
  end if;

  if target_session.status <> 'open' then
    return query
    select id from public.inventory_logs
    where mobile_session_id = target_session.id
    order by mobile_session_sequence;
    return;
  end if;

  select * into target_product
  from public.products
  where id = target_session.product_id
  for update;

  for segment in
    with ordered_events as (
      select
        event_row.*,
        lag(event_row.mode) over (order by event_row.sequence) as previous_mode,
        lag(event_row.target_location) over (order by event_row.sequence) as previous_target_location,
        lag(event_row.move_direction) over (order by event_row.sequence) as previous_move_direction
      from public.mobile_inventory_session_events event_row
      where event_row.session_id = target_session.id
    ), segmented_events as (
      select
        ordered_events.*,
        sum(
          case
            when previous_mode is null
              or previous_mode is distinct from mode
              or previous_target_location is distinct from target_location
              or previous_move_direction is distinct from move_direction
            then 1
            else 0
          end
        ) over (order by sequence) as segment_number
      from ordered_events
    )
    select
      segmented_events.mode,
      segmented_events.target_location,
      segmented_events.move_direction,
      (array_agg(segmented_events.warehouse_qty_before order by segmented_events.sequence))[1] as warehouse_before,
      (array_agg(segmented_events.store_qty_before order by segmented_events.sequence))[1] as store_before,
      (array_agg(segmented_events.warehouse_qty_after order by segmented_events.sequence desc))[1] as warehouse_after,
      (array_agg(segmented_events.store_qty_after order by segmented_events.sequence desc))[1] as store_after,
      max(segmented_events.occurred_at) as occurred_at
    from segmented_events
    group by segmented_events.segment_number, segmented_events.mode, segmented_events.target_location, segmented_events.move_direction
    order by min(segmented_events.sequence)
  loop
    if segment.warehouse_before = segment.warehouse_after
      and segment.store_before = segment.store_after then
      continue;
    end if;

    sequence_value := sequence_value + 1;

    if segment.mode = 'move' then
      insert into public.inventory_logs (
        store_id, product_id, user_id, action, source_location, destination_location,
        previous_quantity, new_quantity, quantity, note,
        warehouse_qty_before, store_qty_before, warehouse_qty_after, store_qty_after,
        mobile_session_id, mobile_session_sequence, created_at
      ) values (
        target_session.store_id, target_session.product_id, target_session.user_id, '이동',
        case when segment.move_direction = 'warehouse-to-store' then '창고' else '매장' end,
        case when segment.move_direction = 'warehouse-to-store' then '매장' else '창고' end,
        case when segment.move_direction = 'warehouse-to-store' then segment.warehouse_before else segment.store_before end,
        case when segment.move_direction = 'warehouse-to-store' then segment.warehouse_after else segment.store_after end,
        abs((case when segment.move_direction = 'warehouse-to-store' then segment.warehouse_after - segment.warehouse_before else segment.store_after - segment.store_before end)),
        null,
        segment.warehouse_before, segment.store_before, segment.warehouse_after, segment.store_after,
        target_session.id, sequence_value, segment.occurred_at
      ) returning id into created_log_id;
    elsif segment.mode = 'audit' then
      insert into public.inventory_logs (
        store_id, product_id, user_id, action, source_location, destination_location,
        previous_quantity, new_quantity, quantity, note,
        warehouse_qty_before, store_qty_before, warehouse_qty_after, store_qty_after,
        mobile_session_id, mobile_session_sequence, created_at
      ) values (
        target_session.store_id, target_session.product_id, target_session.user_id, '조정',
        segment.target_location, null,
        case when segment.target_location = '창고' then segment.warehouse_before else segment.store_before end,
        case when segment.target_location = '창고' then segment.warehouse_after else segment.store_after end,
        abs(case when segment.target_location = '창고' then segment.warehouse_after - segment.warehouse_before else segment.store_after - segment.store_before end),
        null,
        segment.warehouse_before, segment.store_before, segment.warehouse_after, segment.store_after,
        target_session.id, sequence_value, segment.occurred_at
      ) returning id into created_log_id;
    else
      insert into public.inventory_logs (
        store_id, product_id, user_id, action, source_location, destination_location,
        previous_quantity, new_quantity, quantity, note,
        warehouse_qty_before, store_qty_before, warehouse_qty_after, store_qty_after,
        mobile_session_id, mobile_session_sequence, created_at
      ) values (
        target_session.store_id, target_session.product_id, target_session.user_id,
        case when segment.target_location = '창고' and segment.warehouse_after > segment.warehouse_before
          or segment.target_location = '매장' and segment.store_after > segment.store_before then '입고' else '출고' end,
        case when segment.target_location = '창고' and segment.warehouse_after < segment.warehouse_before
          or segment.target_location = '매장' and segment.store_after < segment.store_before then segment.target_location else null end,
        case when segment.target_location = '창고' and segment.warehouse_after > segment.warehouse_before
          or segment.target_location = '매장' and segment.store_after > segment.store_before then segment.target_location else null end,
        case when segment.target_location = '창고' then segment.warehouse_before else segment.store_before end,
        case when segment.target_location = '창고' then segment.warehouse_after else segment.store_after end,
        abs(case when segment.target_location = '창고' then segment.warehouse_after - segment.warehouse_before else segment.store_after - segment.store_before end),
        null,
        segment.warehouse_before, segment.store_before, segment.warehouse_after, segment.store_after,
        target_session.id, sequence_value, segment.occurred_at
      ) returning id into created_log_id;
    end if;

    if (select action from public.inventory_logs where id = created_log_id) = '입고' then
      has_receipt := true;
    end if;
    return next created_log_id;
  end loop;

  if has_receipt then
    update public.products
    set fresh_order_selected = false,
        fresh_order_selected_at = null,
        urgent_order_requested = false,
        urgent_order_quantity = null,
        order_completed = false,
        confirmed_order_pending = false
    where id = target_session.product_id;
  else
    is_no_longer_low_stock := case
      when target_product.status_enabled then target_product.stock_status is distinct from '발주 필요'
      else target_session.warehouse_qty_current + target_session.store_qty_current > target_product.minimum_stock
    end;

    if target_product.confirmed_order_pending and is_no_longer_low_stock then
      update public.products
      set order_completed = false,
          confirmed_order_pending = false
      where id = target_session.product_id;
    end if;
  end if;

  update public.dashboard_todos
  set is_completed = true,
      completed_at = clock_timestamp(),
      completed_by = auth.uid()
  where store_id = target_session.store_id
    and task_date = (clock_timestamp() at time zone 'Asia/Seoul')::date
    and stale_inventory_product_id = target_session.product_id
    and is_completed = false;

  update public.mobile_inventory_sessions
  set status = case when finalization_reason = 'recovery' then 'recovered' else 'finalized' end,
      finalized_at = clock_timestamp()
  where id = target_session.id;
end;
$$;

create or replace function public.recover_mobile_inventory_sessions(active_session_id uuid default null)
returns setof uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  session_row public.mobile_inventory_sessions%rowtype;
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.';
  end if;

  for session_row in
    select *
    from public.mobile_inventory_sessions
    where user_id = auth.uid()
      and status = 'open'
      and (active_session_id is null or id <> active_session_id)
    order by last_activity_at
  loop
    perform public.finalize_mobile_inventory_session(session_row.id, 'recovery');
    return next session_row.id;
  end loop;
end;
$$;

create or replace function public.restore_inventory_to_mobile_session(
  target_session_id uuid,
  restored_warehouse_qty numeric,
  restored_store_qty numeric
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_session public.mobile_inventory_sessions%rowtype;
  target_log public.inventory_logs%rowtype;
  current_inventory public.inventory%rowtype;
  restored_at timestamptz := clock_timestamp();
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.';
  end if;
  if restored_warehouse_qty is null or restored_store_qty is null
    or restored_warehouse_qty < 0 or restored_store_qty < 0
    or restored_warehouse_qty > 99999999.9999 or restored_store_qty > 99999999.9999 then
    raise exception '재고 수량은 음수가 될 수 없습니다.';
  end if;
  if restored_warehouse_qty <> round(restored_warehouse_qty, 4)
    or restored_store_qty <> round(restored_store_qty, 4) then
    raise exception '재고 수량은 소수점 넷째 자리까지 입력할 수 있습니다.';
  end if;

  select * into target_session
  from public.mobile_inventory_sessions
  where id = target_session_id
    and public.can_access_store(store_id)
    and status <> 'open'
  for update;

  if not found then
    raise exception '복원할 모바일 재고 작업을 찾을 수 없습니다.';
  end if;

  select * into target_log
  from public.inventory_logs
  where mobile_session_id = target_session.id
    and action <> '메모'
    and reverted_at is null
  order by mobile_session_sequence desc, created_at desc, id desc
  limit 1;

  if not found then
    raise exception '복원할 모바일 작업 기록이 없습니다.';
  end if;

  select * into current_inventory
  from public.inventory
  where product_id = target_session.product_id
    and store_id = target_session.store_id
  for update;

  if not found then
    raise exception '재고 정보를 찾을 수 없습니다.';
  end if;

  -- A mobile session is one history point. Revert all child logs together,
  -- then keep the existing point-restoration log contract.
  update public.inventory_logs
  set reverted_at = restored_at,
      reverted_by = auth.uid()
  where store_id = target_session.store_id
    and product_id = target_session.product_id
    and action <> '메모'
    and reverted_at is null
    and (
      mobile_session_id = target_session.id
      or created_at > target_log.created_at
      or (created_at = target_log.created_at and id::text > target_log.id::text)
    );

  update public.inventory
  set warehouse_qty = restored_warehouse_qty,
      store_qty = restored_store_qty,
      updated_at = restored_at
  where id = current_inventory.id;

  insert into public.inventory_logs (
    store_id,
    product_id,
    user_id,
    action,
    source_location,
    destination_location,
    previous_quantity,
    new_quantity,
    quantity,
    note,
    warehouse_qty_before,
    store_qty_before,
    warehouse_qty_after,
    store_qty_after,
    restored_to_log_id,
    created_at
  ) values (
    target_session.store_id,
    target_session.product_id,
    auth.uid(),
    '조정',
    null,
    null,
    current_inventory.warehouse_qty + current_inventory.store_qty,
    restored_warehouse_qty + restored_store_qty,
    abs(
      (current_inventory.warehouse_qty + current_inventory.store_qty)
      - (restored_warehouse_qty + restored_store_qty)
    ),
    '[시점 복원] ' || to_char(target_log.created_at at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI'),
    current_inventory.warehouse_qty,
    current_inventory.store_qty,
    restored_warehouse_qty,
    restored_store_qty,
    target_log.id,
    restored_at
  );
end;
$$;

revoke all on function public.apply_mobile_inventory_change(uuid, uuid, text, text, text, numeric, numeric, timestamptz, uuid, text) from public, anon;
revoke all on function public.finalize_mobile_inventory_session(uuid, text) from public, anon;
revoke all on function public.recover_mobile_inventory_sessions(uuid) from public, anon;
revoke all on function public.restore_inventory_to_mobile_session(uuid, numeric, numeric) from public, anon;

grant execute on function public.apply_mobile_inventory_change(uuid, uuid, text, text, text, numeric, numeric, timestamptz, uuid, text) to authenticated;
grant execute on function public.finalize_mobile_inventory_session(uuid, text) to authenticated;
grant execute on function public.recover_mobile_inventory_sessions(uuid) to authenticated;
grant execute on function public.restore_inventory_to_mobile_session(uuid, numeric, numeric) to authenticated;

notify pgrst, 'reload schema';
