-- 네트워크 재시도와 중복 탭에서 같은 작업이 한 번만 반영되도록 요청 결과를 보관합니다.
-- 기존 RPC는 호환성을 위해 유지하고, 새 클라이언트는 *_idempotent RPC를 사용합니다.

create table if not exists public.mutation_requests (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  operation_type text not null,
  result_json jsonb,
  created_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  unique (store_id, user_id, request_id, operation_type)
);

create index if not exists mutation_requests_created_at_idx
on public.mutation_requests (created_at desc);

alter table public.mutation_requests enable row level security;
revoke all on public.mutation_requests from public, anon, authenticated;

create or replace function public.claim_mutation_request(
  target_store_id uuid,
  target_operation_type text,
  target_request_id uuid
)
returns public.mutation_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  request_row public.mutation_requests%rowtype;
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.';
  end if;
  if target_store_id is null or target_operation_type is null or trim(target_operation_type) = '' then
    raise exception '중복 저장 방지용 작업 정보가 필요합니다.';
  end if;
  if target_request_id is null then
    raise exception '저장 요청 식별자가 필요합니다.';
  end if;

  insert into public.mutation_requests (store_id, user_id, request_id, operation_type)
  values (target_store_id, auth.uid(), target_request_id, target_operation_type)
  on conflict (store_id, user_id, request_id, operation_type) do nothing
  returning * into request_row;

  if not found then
    select * into request_row
    from public.mutation_requests
    where store_id = target_store_id
      and user_id = auth.uid()
      and request_id = target_request_id
      and operation_type = target_operation_type
    for update;
  end if;

  return request_row;
end;
$$;

create or replace function public.complete_mutation_request(
  target_request_row_id uuid,
  target_result_json jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.mutation_requests
  set result_json = target_result_json,
      completed_at = clock_timestamp()
  where id = target_request_row_id;
end;
$$;

create or replace function public.record_inventory_operation_idempotent(
  target_product_id uuid,
  operation_action text,
  target_location text,
  move_direction text,
  operation_quantity numeric,
  expected_inventory_updated_at timestamptz,
  request_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target_store_id uuid;
  request_row public.mutation_requests%rowtype;
  created_log_id uuid;
begin
  select store_id into target_store_id from public.products where id = target_product_id;
  if target_store_id is null then
    raise exception '해당 상품을 찾을 수 없습니다.';
  end if;

  request_row := public.claim_mutation_request(target_store_id, 'record_inventory_operation', request_id);
  if request_row.completed_at is not null then
    return (request_row.result_json #>> '{}')::uuid;
  end if;

  created_log_id := public.record_inventory_operation(
    target_product_id,
    operation_action,
    target_location,
    move_direction,
    operation_quantity,
    expected_inventory_updated_at
  );
  perform public.complete_mutation_request(request_row.id, to_jsonb(created_log_id));
  return created_log_id;
end;
$$;

create or replace function public.record_receipt_check_idempotent(
  target_product_id uuid,
  receipt_quantity numeric,
  receipt_note text,
  request_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target_store_id uuid;
  request_row public.mutation_requests%rowtype;
  created_log_id uuid;
begin
  select store_id into target_store_id from public.products where id = target_product_id;
  if target_store_id is null then
    raise exception '해당 상품을 찾을 수 없습니다.';
  end if;

  request_row := public.claim_mutation_request(target_store_id, 'record_receipt_check', request_id);
  if request_row.completed_at is not null then
    return (request_row.result_json #>> '{}')::uuid;
  end if;

  created_log_id := public.record_receipt_check(target_product_id, receipt_quantity, receipt_note);
  perform public.complete_mutation_request(request_row.id, to_jsonb(created_log_id));
  return created_log_id;
end;
$$;

create or replace function public.replace_confirmed_order_items_idempotent(
  target_store_id uuid,
  target_order_date date,
  item_rows jsonb,
  confirmation_note text,
  request_id uuid
)
returns setof public.confirmed_order_items
language plpgsql
security definer
set search_path = public
as $$
declare
  request_row public.mutation_requests%rowtype;
  result_json jsonb;
begin
  request_row := public.claim_mutation_request(target_store_id, 'replace_confirmed_order_items', request_id);
  if request_row.completed_at is not null then
    return query
    select * from jsonb_populate_recordset(null::public.confirmed_order_items, request_row.result_json);
    return;
  end if;

  select coalesce(jsonb_agg(to_jsonb(item_row)), '[]'::jsonb)
  into result_json
  from public.replace_confirmed_order_items(
    target_store_id,
    target_order_date,
    item_rows,
    confirmation_note
  ) as item_row;

  perform public.complete_mutation_request(request_row.id, result_json);
  return query
  select * from jsonb_populate_recordset(null::public.confirmed_order_items, result_json);
end;
$$;

create or replace function public.add_confirmed_order_item_idempotent(
  target_store_id uuid,
  target_order_date date,
  target_product_id uuid,
  required_quantity_value numeric,
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
  request_row := public.claim_mutation_request(target_store_id, 'add_confirmed_order_item', request_id);
  if request_row.completed_at is not null then
    select * into result_item
    from jsonb_populate_record(null::public.confirmed_order_items, request_row.result_json);
    return result_item;
  end if;

  select * into result_item
  from public.add_confirmed_order_item(
    target_store_id,
    target_order_date,
    target_product_id,
    required_quantity_value
  );
  perform public.complete_mutation_request(request_row.id, to_jsonb(result_item));
  return result_item;
end;
$$;

create or replace function public.remove_confirmed_order_item_idempotent(
  target_store_id uuid,
  target_confirmed_item_id uuid,
  request_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  request_row public.mutation_requests%rowtype;
  product_id uuid;
begin
  request_row := public.claim_mutation_request(target_store_id, 'remove_confirmed_order_item', request_id);
  if request_row.completed_at is not null then
    return (request_row.result_json #>> '{}')::uuid;
  end if;

  product_id := public.remove_confirmed_order_item(target_store_id, target_confirmed_item_id);
  perform public.complete_mutation_request(request_row.id, to_jsonb(product_id));
  return product_id;
end;
$$;

create or replace function public.cancel_confirmed_order_idempotent(
  target_store_id uuid,
  target_order_date date,
  request_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  request_row public.mutation_requests%rowtype;
  cancelled_count integer;
begin
  request_row := public.claim_mutation_request(target_store_id, 'cancel_confirmed_order', request_id);
  if request_row.completed_at is not null then
    return (request_row.result_json #>> '{}')::integer;
  end if;

  cancelled_count := public.cancel_confirmed_order(target_store_id, target_order_date);
  perform public.complete_mutation_request(request_row.id, to_jsonb(cancelled_count));
  return cancelled_count;
end;
$$;

create or replace function public.delete_today_product_receipts_idempotent(
  target_product_id uuid,
  request_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target_store_id uuid;
  request_row public.mutation_requests%rowtype;
  deletion_id uuid;
begin
  select store_id into target_store_id from public.products where id = target_product_id;
  if target_store_id is null then
    raise exception '해당 상품을 찾을 수 없습니다.';
  end if;

  request_row := public.claim_mutation_request(target_store_id, 'delete_today_product_receipts', request_id);
  if request_row.completed_at is not null then
    return (request_row.result_json #>> '{}')::uuid;
  end if;

  deletion_id := public.delete_today_product_receipts(target_product_id);
  perform public.complete_mutation_request(request_row.id, to_jsonb(deletion_id));
  return deletion_id;
end;
$$;

create or replace function public.restore_latest_dashboard_receipt_deletion_idempotent(
  request_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target_store_id uuid;
  request_row public.mutation_requests%rowtype;
  deletion_id uuid;
begin
  target_store_id := public.current_store_id(auth.uid());
  if target_store_id is null then
    raise exception '매장 정보가 필요합니다.';
  end if;

  request_row := public.claim_mutation_request(target_store_id, 'restore_latest_dashboard_receipt_deletion', request_id);
  if request_row.completed_at is not null then
    return (request_row.result_json #>> '{}')::uuid;
  end if;

  deletion_id := public.restore_latest_dashboard_receipt_deletion();
  perform public.complete_mutation_request(request_row.id, to_jsonb(deletion_id));
  return deletion_id;
end;
$$;

create or replace function public.delete_dashboard_expected_receipt_idempotent(
  target_product_id uuid,
  target_order_dates date[],
  request_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  target_store_id uuid;
  request_row public.mutation_requests%rowtype;
  deleted_count integer;
begin
  select store_id into target_store_id from public.products where id = target_product_id;
  if target_store_id is null then
    raise exception '해당 상품을 찾을 수 없습니다.';
  end if;

  request_row := public.claim_mutation_request(target_store_id, 'delete_dashboard_expected_receipt', request_id);
  if request_row.completed_at is not null then
    return (request_row.result_json #>> '{}')::integer;
  end if;

  deleted_count := public.delete_dashboard_expected_receipt(target_product_id, target_order_dates);
  perform public.complete_mutation_request(request_row.id, to_jsonb(deleted_count));
  return deleted_count;
end;
$$;

revoke all on function public.claim_mutation_request(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.complete_mutation_request(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.record_inventory_operation_idempotent(uuid, text, text, text, numeric, timestamptz, uuid) from public, anon;
revoke all on function public.record_receipt_check_idempotent(uuid, numeric, text, uuid) from public, anon;
revoke all on function public.replace_confirmed_order_items_idempotent(uuid, date, jsonb, text, uuid) from public, anon;
revoke all on function public.add_confirmed_order_item_idempotent(uuid, date, uuid, numeric, uuid) from public, anon;
revoke all on function public.remove_confirmed_order_item_idempotent(uuid, uuid, uuid) from public, anon;
revoke all on function public.cancel_confirmed_order_idempotent(uuid, date, uuid) from public, anon;
revoke all on function public.delete_today_product_receipts_idempotent(uuid, uuid) from public, anon;
revoke all on function public.restore_latest_dashboard_receipt_deletion_idempotent(uuid) from public, anon;
revoke all on function public.delete_dashboard_expected_receipt_idempotent(uuid, date[], uuid) from public, anon;

grant execute on function public.record_inventory_operation_idempotent(uuid, text, text, text, numeric, timestamptz, uuid) to authenticated;
grant execute on function public.record_receipt_check_idempotent(uuid, numeric, text, uuid) to authenticated;
grant execute on function public.replace_confirmed_order_items_idempotent(uuid, date, jsonb, text, uuid) to authenticated;
grant execute on function public.add_confirmed_order_item_idempotent(uuid, date, uuid, numeric, uuid) to authenticated;
grant execute on function public.remove_confirmed_order_item_idempotent(uuid, uuid, uuid) to authenticated;
grant execute on function public.cancel_confirmed_order_idempotent(uuid, date, uuid) to authenticated;
grant execute on function public.delete_today_product_receipts_idempotent(uuid, uuid) to authenticated;
grant execute on function public.restore_latest_dashboard_receipt_deletion_idempotent(uuid) to authenticated;
grant execute on function public.delete_dashboard_expected_receipt_idempotent(uuid, date[], uuid) to authenticated;

notify pgrst, 'reload schema';
