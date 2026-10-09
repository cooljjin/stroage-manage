-- Keep earlier schedule history while allowing each weekday to be edited.
create or replace function public.save_attendance_work_schedule(
  target_user_id uuid, target_weekday smallint, target_start_time time, target_end_time time,
  target_break_minutes integer, target_effective_from date, target_effective_to date, change_reason text
) returns public.attendance_work_schedules language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  caller_store uuid;
  existing public.attendance_work_schedules;
  shortened public.attendance_work_schedules;
  saved public.attendance_work_schedules;
  next_start date;
  resolved_end date;
begin
  select store_id into caller_store from public.profiles where id = auth.uid();
  if caller_store is null or not public.attendance_manager(caller_store) then
    raise exception using errcode = '42501', message = '근태관리 권한이 필요합니다.';
  end if;
  -- Serialize schedule edits for this employee, including first-time inserts.
  perform 1 from public.profiles where id = target_user_id and store_id = caller_store for update;
  if not found then
    raise exception using errcode = '23503', message = '같은 매장 직원을 선택해야 합니다.';
  end if;
  if nullif(btrim(change_reason), '') is null or target_weekday is null or target_weekday not between 0 and 6
    or target_start_time is null or target_end_time is null or target_break_minutes is null
    or target_break_minutes not between 0 and 720 or target_effective_from is null
    or (target_effective_to is not null and target_effective_to < target_effective_from) then
    raise exception using errcode = '22023', message = '유효한 근무 시간과 적용 시작일이 필요합니다.';
  end if;

  select min(effective_from) into next_start from public.attendance_work_schedules
  where store_id = caller_store and user_id = target_user_id and weekday = target_weekday
    and effective_from > target_effective_from;
  resolved_end := target_effective_to;
  if next_start is not null and (resolved_end is null or resolved_end >= next_start) then
    resolved_end := next_start - 1;
  end if;

  select * into existing from public.attendance_work_schedules
  where store_id = caller_store and user_id = target_user_id and weekday = target_weekday
    and effective_from <= target_effective_from
    and (effective_to is null or effective_to >= target_effective_from)
  order by effective_from desc limit 1 for update;

  if existing.id is not null and existing.effective_from < target_effective_from then
    update public.attendance_work_schedules set effective_to = target_effective_from - 1
    where id = existing.id returning * into shortened;
    perform public.audit_attendance_management(caller_store, 'work_schedule', shortened.id,
      change_reason, to_jsonb(existing), to_jsonb(shortened));
  end if;

  -- Same-start edits preserve the row ID; later-start edits create new history.
  select * into existing from public.attendance_work_schedules
  where store_id = caller_store and user_id = target_user_id and weekday = target_weekday
    and effective_from = target_effective_from for update;
  insert into public.attendance_work_schedules
    (store_id, user_id, weekday, start_time, end_time, unpaid_break_minutes, effective_from, effective_to, created_by)
  values
    (caller_store, target_user_id, target_weekday, target_start_time, target_end_time, target_break_minutes,
      target_effective_from, resolved_end, auth.uid())
  on conflict (store_id, user_id, weekday, effective_from) do update set
    start_time = excluded.start_time, end_time = excluded.end_time,
    unpaid_break_minutes = excluded.unpaid_break_minutes, effective_to = excluded.effective_to
  returning * into saved;
  perform public.audit_attendance_management(caller_store, 'work_schedule', saved.id,
    change_reason, case when existing.id is null then null else to_jsonb(existing) end, to_jsonb(saved));
  return saved;
end;
$$;

revoke all on function public.save_attendance_work_schedule(uuid, smallint, time, time, integer, date, date, text) from public, anon;
grant execute on function public.save_attendance_work_schedule(uuid, smallint, time, time, integer, date, date, text) to authenticated;
notify pgrst, 'reload schema';
