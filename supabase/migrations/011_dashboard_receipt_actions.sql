create table if not exists public.dashboard_receipt_deletions (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  log_ids uuid[] not null,
  warehouse_quantity numeric(12, 2) not null default 0,
  store_quantity numeric(12, 2) not null default 0,
  deleted_by uuid not null references auth.users(id) on delete restrict,
  deleted_at timestamptz not null default now(),
  restored_by uuid references auth.users(id) on delete set null,
  restored_at timestamptz
);

create index if not exists dashboard_receipt_deletions_active_idx
on public.dashboard_receipt_deletions (deleted_at desc)
where restored_at is null;

alter table public.dashboard_receipt_deletions enable row level security;

drop policy if exists "Authenticated users can read receipt deletions" on public.dashboard_receipt_deletions;
create policy "Authenticated users can read receipt deletions"
on public.dashboard_receipt_deletions for select
to authenticated
using (true);

grant select on public.dashboard_receipt_deletions to authenticated;

create or replace function public.delete_today_product_receipts(target_product_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  current_inventory public.inventory%rowtype;
  target_log_ids uuid[];
  warehouse_received numeric(12, 2);
  store_received numeric(12, 2);
  deletion_id uuid;
  changed_at timestamptz := clock_timestamp();
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.';
  end if;

  select *
  into current_inventory
  from public.inventory
  where product_id = target_product_id
  for update;

  if not found then
    raise exception '재고 정보를 찾을 수 없습니다.';
  end if;

  select
    array_agg(id order by created_at, id),
    coalesce(sum(quantity) filter (where destination_location = '창고'), 0),
    coalesce(sum(quantity) filter (where destination_location = '매장'), 0)
  into target_log_ids, warehouse_received, store_received
  from public.inventory_logs
  where product_id = target_product_id
    and action = '입고'
    and reverted_at is null
    and (created_at at time zone 'Asia/Seoul')::date = (changed_at at time zone 'Asia/Seoul')::date;

  if target_log_ids is null or array_length(target_log_ids, 1) is null then
    raise exception '삭제할 금일 입고 기록이 없습니다.';
  end if;

  if current_inventory.warehouse_qty < warehouse_received
    or current_inventory.store_qty < store_received then
    raise exception '입고 후 사용된 재고가 있어 삭제할 수 없습니다.';
  end if;

  update public.inventory
  set warehouse_qty = warehouse_qty - warehouse_received,
      store_qty = store_qty - store_received,
      updated_at = changed_at
  where id = current_inventory.id;

  update public.inventory_logs
  set reverted_at = changed_at,
      reverted_by = auth.uid()
  where id = any(target_log_ids);

  insert into public.dashboard_receipt_deletions (
    product_id,
    log_ids,
    warehouse_quantity,
    store_quantity,
    deleted_by,
    deleted_at
  )
  values (
    target_product_id,
    target_log_ids,
    warehouse_received,
    store_received,
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
  deletion public.dashboard_receipt_deletions%rowtype;
  current_inventory public.inventory%rowtype;
  changed_at timestamptz := clock_timestamp();
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.';
  end if;

  select *
  into deletion
  from public.dashboard_receipt_deletions
  where restored_at is null
    and (deleted_at at time zone 'Asia/Seoul')::date = (changed_at at time zone 'Asia/Seoul')::date
  order by deleted_at desc
  limit 1
  for update skip locked;

  if not found then
    raise exception '되돌릴 입고 삭제 기록이 없습니다.';
  end if;

  select *
  into current_inventory
  from public.inventory
  where product_id = deletion.product_id
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
