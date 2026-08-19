-- Record an explicit inventory audit even when the counted quantity matches
-- the current quantity. This intentionally does not update inventory, so an
-- audit log cannot overwrite or invalidate another location's quantity.

create or replace function public.record_inventory_check(
  target_product_id uuid,
  target_location text,
  expected_warehouse_version bigint,
  expected_store_version bigint,
  request_id uuid
)
returns table (
  log_id uuid,
  checked_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  target_product public.products%rowtype;
  current_inventory public.inventory%rowtype;
  request_row public.mutation_requests%rowtype;
  created_log_id uuid;
  created_at_value timestamptz;
  checked_quantity numeric(12, 4);
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.';
  end if;
  if target_location not in ('창고', '매장') then
    raise exception '재고 위치를 확인해 주세요.';
  end if;
  if request_id is null then
    raise exception '재고 저장 요청 식별자가 필요합니다.';
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

  request_row := public.claim_mutation_request(
    target_product.store_id,
    'record_inventory_check',
    request_id
  );
  if request_row.completed_at is not null then
    log_id := (request_row.result_json->>'log_id')::uuid;
    checked_at := (request_row.result_json->>'checked_at')::timestamptz;
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

  if target_location = '창고' then
    if expected_warehouse_version is null
      or current_inventory.warehouse_version is distinct from expected_warehouse_version then
      raise exception '다른 직원이 같은 위치의 재고를 먼저 변경했습니다. 최신 창고 수량을 확인한 뒤 다시 저장해 주세요.';
    end if;
    checked_quantity := current_inventory.warehouse_qty;
  elsif expected_store_version is null
    or current_inventory.store_version is distinct from expected_store_version then
    raise exception '다른 직원이 같은 위치의 재고를 먼저 변경했습니다. 최신 매장 수량을 확인한 뒤 다시 저장해 주세요.';
  else
    checked_quantity := current_inventory.store_qty;
  end if;

  insert into public.inventory_logs (
    store_id, product_id, user_id, action, source_location,
    previous_quantity, new_quantity, quantity, note,
    warehouse_qty_before, store_qty_before, warehouse_qty_after, store_qty_after
  ) values (
    target_product.store_id, target_product.id, auth.uid(), '조정', target_location,
    checked_quantity, checked_quantity, 0, '수량 확인',
    current_inventory.warehouse_qty, current_inventory.store_qty,
    current_inventory.warehouse_qty, current_inventory.store_qty
  ) returning id, created_at into created_log_id, created_at_value;

  perform public.complete_mutation_request(request_row.id, jsonb_build_object(
    'log_id', created_log_id,
    'checked_at', created_at_value
  ));

  log_id := created_log_id;
  checked_at := created_at_value;
  return next;
end;
$$;

revoke all on function public.record_inventory_check(uuid, text, bigint, bigint, uuid) from public, anon;
grant execute on function public.record_inventory_check(uuid, text, bigint, bigint, uuid) to authenticated;

notify pgrst, 'reload schema';
