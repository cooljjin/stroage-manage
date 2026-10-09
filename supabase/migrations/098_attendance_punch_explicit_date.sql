create or replace function public.finalize_attendance_punch(
  target_event_id uuid, entered_date date, entered_time time, request_id uuid
)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  event public.attendance_punch_events;
  open_shift public.attendance_shifts;
  saved_shift public.attendance_shifts;
  local_date date;
  entered_timestamp timestamptz;
  schedule_start time;
  schedule_end time;
  break_minutes integer := 0;
  finalization_time timestamptz := clock_timestamp();
  override_day_off boolean;
begin
  if request_id is null or entered_date is null or not isfinite(entered_date) or entered_time is null then
    raise exception using errcode = '22023', message = '유효하지 않은 출퇴근 확정 요청입니다.';
  end if;
  select * into event from public.attendance_punch_events where id = target_event_id and user_id = auth.uid() for update;
  if event.id is null then raise exception using errcode = 'P0002', message = '입력 대기 중인 태그 기록을 찾을 수 없습니다.'; end if;

  if event.status = 'completed' then
    if event.finalize_request_id is distinct from finalize_attendance_punch.request_id then
      raise exception using errcode = '22023', message = '이미 다른 요청으로 확정된 출퇴근 기록입니다.';
    end if;
    select * into saved_shift from public.attendance_shifts
    where store_id = event.store_id and (check_in_event_id = event.id or check_out_event_id = event.id);
    return to_jsonb(saved_shift);
  end if;
  if event.status <> 'pending' then raise exception using errcode = '55000', message = '확정할 수 없는 태그 기록입니다.'; end if;
  if event.expires_at <= finalization_time then
    update public.attendance_punch_events set status = 'expired' where id = event.id;
    return jsonb_build_object('id', event.id, 'status', 'expired');
  end if;

  local_date := entered_date;
  entered_timestamp := (local_date + entered_time) at time zone 'Asia/Seoul';
  select * into open_shift from public.attendance_shifts
  where user_id = auth.uid() and store_id = event.store_id and confirmed_check_out_at is null for update;
  if event.punch_type = 'check_out' and open_shift.id is not null and entered_timestamp <= open_shift.confirmed_check_in_at then
    raise exception using errcode = '22023', message = '퇴근 시각은 출근 시각보다 뒤여야 합니다.';
  end if;
  if abs(extract(epoch from (entered_timestamp - event.tagged_at))) > 43200 then
    raise exception using errcode = '22023', message = 'NFC 태그 시각에서 12시간을 벗어난 시간은 저장할 수 없습니다.';
  end if;

  if event.punch_type = 'check_in' then
    select override.is_day_off,
      case when override.is_day_off then null else coalesce(override.start_time, weekly.start_time) end,
      case when override.is_day_off then null else coalesce(override.end_time, weekly.end_time) end,
      case when override.is_day_off then 0 else coalesce(override.unpaid_break_minutes, weekly.unpaid_break_minutes, 0) end
    into override_day_off, schedule_start, schedule_end, break_minutes
    from (select 1) seed
    left join lateral (
      select is_day_off, start_time, end_time, unpaid_break_minutes from public.attendance_schedule_overrides
      where store_id = event.store_id and user_id = auth.uid() and work_date = local_date limit 1
    ) override on true
    left join lateral (
      select start_time, end_time, unpaid_break_minutes from public.attendance_work_schedules
      where store_id = event.store_id and user_id = auth.uid()
        and weekday = extract(dow from local_date)::integer and effective_from <= local_date
        and (effective_to is null or effective_to >= local_date)
      order by effective_from desc limit 1
    ) weekly on true;

    insert into public.attendance_shifts (
      store_id, user_id, check_in_event_id, scheduled_start_at, scheduled_end_at,
      entered_check_in_at, confirmed_check_in_at, unpaid_break_minutes, status
    ) values (
      event.store_id, auth.uid(), event.id,
      case when schedule_start is null then null else (local_date + schedule_start) at time zone 'Asia/Seoul' end,
      case when schedule_end is null then null else ((local_date + schedule_end) at time zone 'Asia/Seoul') + case when schedule_end <= schedule_start then interval '1 day' else interval '0' end end,
      entered_timestamp, entered_timestamp, break_minutes, 'open'
    ) returning * into saved_shift;
  else
    if open_shift.id is null then raise exception using errcode = '55000', message = '퇴근 처리할 열린 근무 기록이 없습니다.'; end if;
    update public.attendance_shifts set
      check_out_event_id = event.id, entered_check_out_at = entered_timestamp, confirmed_check_out_at = entered_timestamp,
      status = 'closed', updated_at = finalization_time
    where id = open_shift.id returning * into saved_shift;
  end if;

  update public.attendance_punch_events
  set entered_at = entered_timestamp, confirmed_at = clock_timestamp(), status = 'completed',
      finalize_request_id = finalize_attendance_punch.request_id, needs_review = false
  where id = event.id;

  if event.punch_type = 'check_out' then perform public.refresh_attendance_segments(saved_shift.id); end if;
  return to_jsonb(saved_shift);
exception when unique_violation then
  select * into event from public.attendance_punch_events where id = target_event_id and user_id = auth.uid();
  if event.status = 'completed' and event.finalize_request_id = finalize_attendance_punch.request_id then
    select * into saved_shift from public.attendance_shifts
    where store_id = event.store_id and (check_in_event_id = event.id or check_out_event_id = event.id);
    return to_jsonb(saved_shift);
  end if;
  raise;
end;
$$;

revoke all on function public.finalize_attendance_punch(uuid, date, time, uuid) from public, anon;
grant execute on function public.finalize_attendance_punch(uuid, date, time, uuid) to authenticated;
