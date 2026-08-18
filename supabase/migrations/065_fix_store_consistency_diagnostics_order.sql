-- 이미 적용된 DATA-007 진단 함수의 UNION 정렬 오류를 수정합니다.

create or replace function public.diagnose_store_consistency(target_store_id uuid)
returns table (
  product_id uuid,
  product_name text,
  issue_type text,
  expected_value jsonb,
  actual_value jsonb,
  last_changed_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.';
  end if;

  if not public.can_admin_store(target_store_id) then
    raise exception '매장 관리자 권한이 필요합니다.';
  end if;

  return query
  with latest_inventory_log as (
    select distinct on (log.product_id)
      log.product_id,
      log.warehouse_qty_after,
      log.store_qty_after,
      log.created_at
    from public.inventory_logs as log
    where log.store_id = target_store_id
      and log.reverted_at is null
      and log.warehouse_qty_after is not null
      and log.store_qty_after is not null
    order by log.product_id, log.created_at desc, log.id desc
  ),
  inventory_mismatch as (
    select
      product.id,
      product.name,
      'inventory_quantity_mismatch'::text as issue_type,
      jsonb_build_object(
        'warehouse_qty', latest.warehouse_qty_after,
        'store_qty', latest.store_qty_after
      ) as expected_value,
      jsonb_build_object(
        'warehouse_qty', coalesce(current_inventory.warehouse_qty, 0),
        'store_qty', coalesce(current_inventory.store_qty, 0)
      ) as actual_value,
      latest.created_at as last_changed_at
    from public.products as product
    join latest_inventory_log as latest on latest.product_id = product.id
    left join public.inventory as current_inventory
      on current_inventory.store_id = product.store_id
      and current_inventory.product_id = product.id
    where product.store_id = target_store_id
      and (
        coalesce(current_inventory.warehouse_qty, 0) is distinct from latest.warehouse_qty_after
        or coalesce(current_inventory.store_qty, 0) is distinct from latest.store_qty_after
      )
  ),
  latest_confirmation as (
    select distinct on (confirmed.product_id)
      confirmed.product_id,
      confirmed.confirmed_at
    from public.confirmed_order_items as confirmed
    where confirmed.store_id = target_store_id
    order by confirmed.product_id, confirmed.confirmed_at desc, confirmed.id desc
  ),
  latest_receipt as (
    select
      receipt.product_id,
      max(receipt.created_at) as last_receipt_at
    from public.inventory_logs as receipt
    where receipt.store_id = target_store_id
      and receipt.action = '입고'
      and receipt.reverted_at is null
    group by receipt.product_id
  ),
  confirmation_mismatch as (
    select
      product.id,
      product.name,
      'confirmed_order_pending_mismatch'::text as issue_type,
      jsonb_build_object(
        'confirmed_order_pending', (
          confirmation.confirmed_at is not null
          and confirmation.confirmed_at > coalesce(receipt.last_receipt_at, '-infinity'::timestamptz)
        )
      ) as expected_value,
      jsonb_build_object(
        'confirmed_order_pending', product.confirmed_order_pending
      ) as actual_value,
      greatest(
        coalesce(confirmation.confirmed_at, '-infinity'::timestamptz),
        coalesce(receipt.last_receipt_at, '-infinity'::timestamptz),
        product.created_at
      ) as last_changed_at
    from public.products as product
    left join latest_confirmation as confirmation on confirmation.product_id = product.id
    left join latest_receipt as receipt on receipt.product_id = product.id
    where product.store_id = target_store_id
      and product.confirmed_order_pending is distinct from (
        confirmation.confirmed_at is not null
        and confirmation.confirmed_at > coalesce(receipt.last_receipt_at, '-infinity'::timestamptz)
      )
  )
  select * from (
    select * from inventory_mismatch
    union all
    select * from confirmation_mismatch
  ) as mismatch_rows
  order by product_name, issue_type;
end;
$$;

revoke all on function public.diagnose_store_consistency(uuid) from public, anon;
grant execute on function public.diagnose_store_consistency(uuid) to authenticated;

notify pgrst, 'reload schema';
