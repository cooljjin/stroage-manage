alter table public.confirmed_order_items
add column if not exists receipt_expected_deleted_at timestamptz,
add column if not exists receipt_expected_deleted_by uuid references auth.users(id) on delete set null;

create index if not exists confirmed_order_items_active_receipt_idx
on public.confirmed_order_items (store_id, order_date, confirmed_at desc)
where receipt_expected_deleted_at is null;

create or replace function public.delete_dashboard_expected_receipt(
  target_product_id uuid,
  target_order_dates date[]
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  target_store_id uuid;
  deleted_count integer;
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.';
  end if;

  if target_order_dates is null or array_length(target_order_dates, 1) is null then
    raise exception '삭제할 입고예정 품목이 없습니다.';
  end if;

  select store_id
  into target_store_id
  from public.products
  where id = target_product_id;

  if target_store_id is null or not public.can_access_store(target_store_id) then
    raise exception '해당 매장에 접근할 권한이 없습니다.';
  end if;

  update public.confirmed_order_items
  set receipt_expected_deleted_at = clock_timestamp(),
      receipt_expected_deleted_by = auth.uid()
  where store_id = target_store_id
    and product_id = target_product_id
    and order_date = any(target_order_dates)
    and order_date < (now() at time zone 'Asia/Seoul')::date
    and receipt_expected_deleted_at is null;

  get diagnostics deleted_count = row_count;

  if deleted_count = 0 then
    raise exception '삭제할 입고예정 품목이 없습니다.';
  end if;

  return deleted_count;
end;
$$;

grant execute on function public.delete_dashboard_expected_receipt(uuid, date[]) to authenticated;

notify pgrst, 'reload schema';
