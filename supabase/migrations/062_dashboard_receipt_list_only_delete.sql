-- 금일 입고품목 삭제는 재고와 입고 로그를 변경하지 않고 대시보드 목록에서만 숨깁니다.
-- 기존 011 migration으로 이미 재고를 되돌린 삭제 기록은 되돌리기 동작을 유지합니다.

alter table public.dashboard_receipt_deletions
  add column if not exists inventory_reverted boolean not null default false;

update public.dashboard_receipt_deletions as deletion
set inventory_reverted = true
where deletion.inventory_reverted = false
  and not exists (
    select 1
    from public.inventory_logs as log
    where log.id = any(deletion.log_ids)
      and log.reverted_at is null
  );

create index if not exists dashboard_receipt_deletions_store_date_idx
on public.dashboard_receipt_deletions (store_id, deleted_at desc)
where restored_at is null;

create or replace function public.delete_today_product_receipts(target_product_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target_store_id uuid;
  target_log_ids uuid[];
  warehouse_received numeric(12, 2);
  store_received numeric(12, 2);
  deletion_id uuid;
  changed_at timestamptz := clock_timestamp();
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.';
  end if;

  target_store_id := public.current_store_id(auth.uid());
  if target_store_id is null then
    raise exception '매장 정보가 필요합니다.';
  end if;

  select
    array_agg(id order by created_at, id),
    coalesce(sum(quantity) filter (where destination_location = '창고'), 0),
    coalesce(sum(quantity) filter (where destination_location = '매장'), 0)
  into target_log_ids, warehouse_received, store_received
  from public.inventory_logs
  where store_id = target_store_id
    and product_id = target_product_id
    and action = '입고'
    and reverted_at is null
    and (created_at at time zone 'Asia/Seoul')::date = (changed_at at time zone 'Asia/Seoul')::date;

  if target_log_ids is null or array_length(target_log_ids, 1) is null then
    raise exception '삭제할 금일 입고 기록이 없습니다.';
  end if;

  insert into public.dashboard_receipt_deletions (
    product_id,
    store_id,
    log_ids,
    warehouse_quantity,
    store_quantity,
    inventory_reverted,
    deleted_by,
    deleted_at
  )
  values (
    target_product_id,
    target_store_id,
    target_log_ids,
    warehouse_received,
    store_received,
    false,
    auth.uid(),
    changed_at
  )
  returning id into deletion_id;

  return deletion_id;
end;
$$;

create or replace function public.restore_latest_dashboard_receipt_deletion()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target_store_id uuid;
  deletion public.dashboard_receipt_deletions%rowtype;
  current_inventory public.inventory%rowtype;
  changed_at timestamptz := clock_timestamp();
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.';
  end if;

  target_store_id := public.current_store_id(auth.uid());
  if target_store_id is null then
    raise exception '매장 정보가 필요합니다.';
  end if;

  select *
  into deletion
  from public.dashboard_receipt_deletions
  where store_id = target_store_id
    and restored_at is null
    and (deleted_at at time zone 'Asia/Seoul')::date = (changed_at at time zone 'Asia/Seoul')::date
  order by deleted_at desc
  limit 1
  for update skip locked;

  if not found then
    raise exception '되돌릴 금일 입고 삭제 기록이 없습니다.';
  end if;

  -- 011 migration으로 생성된 과거 삭제 기록만 기존 방식으로 복원합니다.
  if deletion.inventory_reverted then
    select *
    into current_inventory
    from public.inventory
    where store_id = target_store_id
      and product_id = deletion.product_id
    for update;

    if not found then
      raise exception '재고 정보를 찾을 수 없습니다.';
    end if;

    update public.inventory
    set warehouse_qty = warehouse_qty + deletion.warehouse_quantity,
        store_qty = store_qty + deletion.store_quantity,
        updated_at = changed_at
    where id = current_inventory.id;

    update public.inventory_logs
    set reverted_at = null,
        reverted_by = null
    where id = any(deletion.log_ids);
  end if;

  update public.dashboard_receipt_deletions
  set restored_by = auth.uid(),
      restored_at = changed_at
  where id = deletion.id;

  return deletion.id;
end;
$$;

grant execute on function public.delete_today_product_receipts(uuid) to authenticated;
grant execute on function public.restore_latest_dashboard_receipt_deletion() to authenticated;

notify pgrst, 'reload schema';
