-- 확정품목 확인 화면에서 관리자 메모를 사후에 추가·수정할 수 있도록 한다.
alter table public.confirmed_order_items
  add column if not exists confirmation_note_by uuid references auth.users(id) on delete set null,
  add column if not exists confirmation_note_at timestamptz;

create or replace function public.update_confirmed_order_note(
  target_store_id uuid,
  target_order_date date,
  confirmation_note text
)
returns setof public.confirmed_order_items
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_note text := nullif(trim(coalesce(confirmation_note, '')), '');
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.';
  end if;
  if not public.can_admin_store(target_store_id) then
    raise exception '관리자만 확정품목 메모를 수정할 수 있습니다.';
  end if;
  if not exists (
    select 1
    from public.confirmed_order_items
    where store_id = target_store_id
      and order_date = target_order_date
  ) then
    raise exception '확정 품목을 찾을 수 없습니다.';
  end if;

  return query
  update public.confirmed_order_items
  set confirmation_note = normalized_note,
      confirmation_note_by = case when normalized_note is null then null else auth.uid() end,
      confirmation_note_at = case when normalized_note is null then null else clock_timestamp() end
  where store_id = target_store_id
    and order_date = target_order_date
  returning *;
end;
$$;

create or replace function public.update_confirmed_order_note_idempotent(
  target_store_id uuid,
  target_order_date date,
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
  request_row := public.claim_mutation_request(target_store_id, 'update_confirmed_order_note', request_id);
  if request_row.completed_at is not null then
    return query
    select *
    from jsonb_populate_recordset(null::public.confirmed_order_items, request_row.result_json);
    return;
  end if;

  select coalesce(jsonb_agg(to_jsonb(item_row)), '[]'::jsonb)
  into result_json
  from public.update_confirmed_order_note(
    target_store_id,
    target_order_date,
    confirmation_note
  ) as item_row;

  perform public.complete_mutation_request(request_row.id, result_json);
  return query
  select *
  from jsonb_populate_recordset(null::public.confirmed_order_items, result_json);
end;
$$;

revoke all on function public.update_confirmed_order_note(uuid, date, text) from public, anon;
revoke all on function public.update_confirmed_order_note_idempotent(uuid, date, text, uuid) from public, anon;
grant execute on function public.update_confirmed_order_note(uuid, date, text) to authenticated;
grant execute on function public.update_confirmed_order_note_idempotent(uuid, date, text, uuid) to authenticated;

notify pgrst, 'reload schema';
