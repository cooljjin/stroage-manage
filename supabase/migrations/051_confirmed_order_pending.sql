alter table public.products
add column if not exists confirmed_order_pending boolean not null default false;

-- 기존 확정 기록 중 아직 입고 처리되지 않은 품목만 진행 중 상태로 이관한다.
update public.products as product
set confirmed_order_pending = true
where product.order_completed = true
  and exists (
    select 1
    from public.confirmed_order_items as confirmed
    where confirmed.store_id = product.store_id
      and confirmed.product_id = product.id
      and confirmed.confirmed_at > coalesce(
        (
          select max(receipt.created_at)
          from public.inventory_logs as receipt
          where receipt.store_id = product.store_id
            and receipt.product_id = product.id
            and receipt.action = '입고'
        ),
        '-infinity'::timestamptz
      )
  );

notify pgrst, 'reload schema';
