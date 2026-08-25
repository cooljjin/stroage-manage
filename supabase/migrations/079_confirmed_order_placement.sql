-- 확정 발주 품목별로 실제 발주 완료 여부와 처리자를 보관합니다.
alter table public.confirmed_order_items
add column if not exists order_placed_at timestamptz,
add column if not exists order_placed_by uuid references auth.users(id) on delete set null;

create or replace function public.add_confirmed_order_item(
  target_store_id uuid,
  target_order_date date,
  target_product_id uuid,
  required_quantity_value numeric default null
)
returns public.confirmed_order_items
language plpgsql
security definer
set search_path = public
as $$
declare
  target_product public.products%rowtype;
  target_inventory public.inventory%rowtype;
  reference_item public.confirmed_order_items%rowtype;
  created_item public.confirmed_order_items%rowtype;
  is_order_candidate boolean;
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다.'; end if;
  if not public.can_manage_store_task(target_store_id, 'order_confirmation') then
    raise exception '발주 품목을 수정할 권한이 없습니다.';
  end if;
  if required_quantity_value is not null and required_quantity_value < 0 then
    raise exception '필요 개수는 음수가 될 수 없습니다.';
  end if;

  select * into target_product from public.products
  where id = target_product_id and store_id = target_store_id and is_active
  for update;
  if not found then raise exception '추가할 상품을 찾을 수 없습니다.'; end if;

  select * into target_inventory from public.inventory where product_id = target_product.id;
  is_order_candidate := target_product.fresh_order_selected
    or target_product.urgent_order_requested
    or (
      not target_product.receipt_check_only
      and case when target_product.status_enabled
        then target_product.stock_status = '발주 필요'
        else coalesce(target_inventory.warehouse_qty, 0) + coalesce(target_inventory.store_qty, 0) <= target_product.minimum_stock
      end
    );

  if not is_order_candidate and not public.can_admin_store(target_store_id) then
    raise exception '관리자만 컨펌되지 않은 품목을 임의로 추가할 수 있습니다.';
  end if;

  select * into reference_item from public.confirmed_order_items
  where store_id = target_store_id and order_date = target_order_date
  order by confirmed_at desc limit 1;

  insert into public.confirmed_order_items (
    store_id, order_date, product_id, product_name, category, supplier_name,
    total_stock, minimum_stock, required_quantity, is_low_stock,
    fresh_order_selected, urgent_order_requested, urgent_order_quantity,
    order_completed, confirmation_note, confirmed_by, confirmed_at
  ) values (
    target_store_id, target_order_date, target_product.id, target_product.name,
    coalesce(target_product.category, '기타'), target_product.supplier_name,
    case when target_product.receipt_check_only then null else coalesce(target_inventory.warehouse_qty, 0) + coalesce(target_inventory.store_qty, 0) end,
    case when target_product.receipt_check_only then null else target_product.minimum_stock end,
    required_quantity_value,
    not target_product.receipt_check_only and case when target_product.status_enabled
      then target_product.stock_status = '발주 필요'
      else coalesce(target_inventory.warehouse_qty, 0) + coalesce(target_inventory.store_qty, 0) <= target_product.minimum_stock end,
    target_product.fresh_order_selected, target_product.urgent_order_requested,
    target_product.urgent_order_quantity, true, reference_item.confirmation_note,
    coalesce(reference_item.confirmed_by, auth.uid()),
    coalesce(reference_item.confirmed_at, clock_timestamp())
  ) returning * into created_item;

  update public.products
  set order_completed = true,
      confirmed_order_pending = true,
      fresh_order_selected = false,
      fresh_order_selected_at = null
  where id = target_product.id;

  return created_item;
end;
$$;

create or replace function public.set_confirmed_order_item_order_placed(
  target_store_id uuid,
  target_confirmed_item_id uuid,
  is_order_placed boolean
)
returns public.confirmed_order_items
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_item public.confirmed_order_items%rowtype;
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다.'; end if;
  if not public.can_manage_store_task(target_store_id, 'order_confirmation') then
    raise exception '발주 완료 상태를 변경할 권한이 없습니다.';
  end if;

  update public.confirmed_order_items
  set order_placed_at = case when is_order_placed then clock_timestamp() else null end,
      order_placed_by = case when is_order_placed then auth.uid() else null end
  where id = target_confirmed_item_id and store_id = target_store_id
  returning * into updated_item;

  if not found then raise exception '확정 품목을 찾을 수 없습니다.'; end if;
  return updated_item;
end;
$$;

create or replace function public.set_confirmed_order_item_order_placed_idempotent(
  target_store_id uuid,
  target_confirmed_item_id uuid,
  is_order_placed boolean,
  request_id uuid
)
returns public.confirmed_order_items
language plpgsql
security definer
set search_path = public
as $$
declare
  request_row public.mutation_requests%rowtype;
  result_item public.confirmed_order_items%rowtype;
begin
  request_row := public.claim_mutation_request(target_store_id, 'set_confirmed_order_item_order_placed', request_id);
  if request_row.completed_at is not null then
    select * into result_item
    from jsonb_populate_record(null::public.confirmed_order_items, request_row.result_json);
    return result_item;
  end if;

  result_item := public.set_confirmed_order_item_order_placed(
    target_store_id,
    target_confirmed_item_id,
    is_order_placed
  );
  perform public.complete_mutation_request(request_row.id, to_jsonb(result_item));
  return result_item;
end;
$$;

revoke all on function public.set_confirmed_order_item_order_placed(uuid, uuid, boolean) from public, anon;
revoke all on function public.set_confirmed_order_item_order_placed_idempotent(uuid, uuid, boolean, uuid) from public, anon;
grant execute on function public.set_confirmed_order_item_order_placed(uuid, uuid, boolean) to authenticated;
grant execute on function public.set_confirmed_order_item_order_placed_idempotent(uuid, uuid, boolean, uuid) to authenticated;

notify pgrst, 'reload schema';
