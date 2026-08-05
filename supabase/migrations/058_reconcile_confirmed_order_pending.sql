-- 확정 이력과 입고 이력이 어긋난 기존 상품의 진행 상태를 복구한다.
-- 마지막 컨펌 이후 입고가 없을 때만 컨펌 진행 중으로 유지한다.
update public.products as product
set confirmed_order_pending = exists (
  select 1
  from public.confirmed_order_items as confirmed
  where confirmed.store_id = product.store_id
    and confirmed.product_id = product.id
    and confirmed.confirmed_at = (
      select max(latest_confirmed.confirmed_at)
      from public.confirmed_order_items as latest_confirmed
      where latest_confirmed.store_id = product.store_id
        and latest_confirmed.product_id = product.id
    )
    and confirmed.confirmed_at > coalesce(
      (
        select max(receipt.created_at)
        from public.inventory_logs as receipt
        where receipt.store_id = product.store_id
          and receipt.product_id = product.id
          and receipt.action = '입고'
          and receipt.reverted_at is null
      ),
      '-infinity'::timestamptz
    )
)
where product.is_active = true;

notify pgrst, 'reload schema';
