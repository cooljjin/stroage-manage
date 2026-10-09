-- Preserve the deleted record and its cascading audit/segment rows in the
-- independent management audit. Raw NFC events remain immutable and completed.
create or replace function public.delete_attendance_shift(
  target_shift_id uuid, target_store_id uuid, change_reason text
) returns void language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  before_row public.attendance_shifts;
  before_segments jsonb;
  before_audit jsonb;
  allowance public.attendance_weekly_allowances;
  affected_week date;
begin
  if not public.attendance_manager(target_store_id) then
    raise exception using errcode = '42501', message = '근태관리 권한이 필요합니다.';
  end if;
  if nullif(btrim(change_reason), '') is null or char_length(btrim(change_reason)) > 500 then
    raise exception using errcode = '22023', message = '삭제 사유를 1~500자로 입력해 주세요.';
  end if;
  select * into before_row from public.attendance_shifts
  where id = target_shift_id and store_id = target_store_id for update;
  if before_row.id is null then
    raise exception using errcode = 'P0002', message = '삭제할 근태 기록을 찾을 수 없습니다. 새로고침해 주세요.';
  end if;

  select coalesce(jsonb_agg(to_jsonb(segment)), '[]'::jsonb) into before_segments
  from public.attendance_shift_segments segment where shift_id = before_row.id;
  select coalesce(jsonb_agg(to_jsonb(audit)), '[]'::jsonb) into before_audit
  from public.attendance_shift_audit audit where shift_id = before_row.id;
  perform public.audit_attendance_management(before_row.store_id, 'shift_delete', before_row.id,
    btrim(change_reason), jsonb_build_object('shift', to_jsonb(before_row),
      'segments', before_segments, 'shift_audit', before_audit), null);

  affected_week := date_trunc('week', before_row.confirmed_check_in_at at time zone 'Asia/Seoul')::date;
  delete from public.attendance_weekly_allowances
  where store_id = before_row.store_id and user_id = before_row.user_id and week_start = affected_week
  returning * into allowance;
  if allowance.id is not null then
    perform public.audit_attendance_management(before_row.store_id, 'weekly_allowance_reset', allowance.id,
      btrim(change_reason), to_jsonb(allowance), null);
  end if;
  delete from public.attendance_shifts where id = before_row.id and store_id = target_store_id;
end;
$$;

revoke all on function public.delete_attendance_shift(uuid, uuid, text) from public, anon;
grant execute on function public.delete_attendance_shift(uuid, uuid, text) to authenticated;

notify pgrst, 'reload schema';
