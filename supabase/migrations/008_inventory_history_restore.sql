alter table public.inventory_logs
add column if not exists warehouse_qty_before numeric(12, 2),
add column if not exists store_qty_before numeric(12, 2),
add column if not exists warehouse_qty_after numeric(12, 2),
add column if not exists store_qty_after numeric(12, 2),
add column if not exists reverted_at timestamptz,
add column if not exists reverted_by uuid references auth.users(id) on delete set null,
add column if not exists restored_to_log_id uuid references public.inventory_logs(id) on delete set null;

create index if not exists inventory_logs_active_product_created_idx
on public.inventory_logs (product_id, created_at desc)
where reverted_at is null;

create or replace function public.restore_inventory_to_log(
  target_log_id uuid,
  restored_warehouse_qty numeric,
  restored_store_qty numeric
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_log public.inventory_logs%rowtype;
  current_inventory public.inventory%rowtype;
  restored_at timestamptz := clock_timestamp();
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.';
  end if;

  if restored_warehouse_qty < 0 or restored_store_qty < 0 then
    raise exception '재고 수량은 음수가 될 수 없습니다.';
  end if;

  select *
  into target_log
  from public.inventory_logs
  where id = target_log_id
    and reverted_at is null;

  if not found then
    raise exception '복원할 작업 기록을 찾을 수 없습니다.';
  end if;

  select *
  into current_inventory
  from public.inventory
  where product_id = target_log.product_id
  for update;

  if not found then
    raise exception '재고 정보를 찾을 수 없습니다.';
  end if;

  update public.inventory_logs
  set reverted_at = restored_at,
      reverted_by = auth.uid()
  where product_id = target_log.product_id
    and reverted_at is null
    and (
      created_at > target_log.created_at
      or (created_at = target_log.created_at and id::text > target_log.id::text)
    );

  update public.inventory
  set warehouse_qty = restored_warehouse_qty,
      store_qty = restored_store_qty,
      updated_at = restored_at
  where id = current_inventory.id;

  insert into public.inventory_logs (
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
  )
  values (
    target_log.product_id,
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

grant execute on function public.restore_inventory_to_log(uuid, numeric, numeric) to authenticated;

notify pgrst, 'reload schema';
