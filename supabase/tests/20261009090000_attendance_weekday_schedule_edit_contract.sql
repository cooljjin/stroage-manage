-- Disposable local database only. All fixtures and changes roll back.
begin;
insert into public.stores (id, name) values
('15000000-0000-0000-0000-000000000001', '요일 일정 테스트 매장'),
('15000000-0000-0000-0000-000000000002', '다른 테스트 매장');
insert into auth.users (id, email) values
('25000000-0000-0000-0000-000000000001', 'weekday-manager@example.invalid'),
('25000000-0000-0000-0000-000000000002', 'weekday-staff@example.invalid'),
('25000000-0000-0000-0000-000000000003', 'weekday-other@example.invalid');
insert into public.profiles (id, email, display_name, store_id, role) values
('25000000-0000-0000-0000-000000000001', 'weekday-manager@example.invalid', '테스트 관리자', '15000000-0000-0000-0000-000000000001', 'store_admin'),
('25000000-0000-0000-0000-000000000002', 'weekday-staff@example.invalid', '테스트 직원', '15000000-0000-0000-0000-000000000001', 'staff'),
('25000000-0000-0000-0000-000000000003', 'weekday-other@example.invalid', '다른 직원', '15000000-0000-0000-0000-000000000002', 'staff');
set role authenticated;
select set_config('request.jwt.claim.sub', '25000000-0000-0000-0000-000000000001', true);
do $$
declare
  employee constant uuid := '25000000-0000-0000-0000-000000000002';
  first_row public.attendance_work_schedules;
  edited public.attendance_work_schedules;
  later public.attendance_work_schedules;
  earlier public.attendance_work_schedules;
  state text;
begin
  first_row := public.save_attendance_work_schedule(employee, 1::smallint, '09:00', '18:00', 60, '2026-10-01', null, '월요일 등록');
  edited := public.save_attendance_work_schedule(employee, 1::smallint, '10:00', '19:00', 30, '2026-10-01', null, '월요일 수정');
  if edited.id <> first_row.id or edited.start_time <> '10:00'::time or edited.unpaid_break_minutes <> 30 then
    raise exception 'same-start edit did not update existing row';
  end if;
  later := public.save_attendance_work_schedule(employee, 1::smallint, '11:00', '20:00', 45, '2026-11-01', null, '다음 달 변경');
  if later.id = first_row.id or (select effective_to from public.attendance_work_schedules where id = first_row.id) <> '2026-10-31'::date then
    raise exception 'later edit did not preserve previous date range';
  end if;
  earlier := public.save_attendance_work_schedule(employee, 1::smallint, '08:00', '17:00', 60, '2026-09-01', null, '이전 기간 등록');
  if earlier.effective_to <> '2026-09-30'::date or later.start_time <> '11:00'::time then
    raise exception 'future schedule was overwritten';
  end if;
  perform public.save_attendance_work_schedule(employee, 0::smallint, '22:00', '06:00', 0, '2026-10-01', null, '일요일 야간');
  if (select count(*) from public.attendance_work_schedules where user_id = employee and weekday = 1) <> 3 then
    raise exception 'weekday schedules are not independent';
  end if;
  if not exists (select 1 from public.attendance_management_audit where entity_id = first_row.id and before_values->>'start_time' = '09:00:00' and after_values->>'start_time' = '10:00:00') then
    raise exception 'edit audit missing';
  end if;
  begin
    perform public.save_attendance_work_schedule('25000000-0000-0000-0000-000000000003', 1::smallint, '09:00', '18:00', 60, '2026-10-01', null, '다른 매장');
  exception when others then get stacked diagnostics state = returned_sqlstate; end;
  if state is distinct from '23503' then raise exception 'cross-store edit allowed: %', state; end if;
  state := null;
  begin
    perform public.save_attendance_work_schedule(employee, 7::smallint, '09:00', '18:00', 60, '2026-10-01', null, '잘못된 요일');
  exception when others then get stacked diagnostics state = returned_sqlstate; end;
  if state is distinct from '22023' then raise exception 'invalid weekday allowed: %', state; end if;
end;
$$;
select set_config('request.jwt.claim.sub', '25000000-0000-0000-0000-000000000002', true);
do $$
declare state text;
begin
  begin
    perform public.save_attendance_work_schedule('25000000-0000-0000-0000-000000000002', 1::smallint, '09:00', '18:00', 60, '2026-10-01', null, '권한 없는 직원');
  exception when others then get stacked diagnostics state = returned_sqlstate; end;
  if state is distinct from '42501' then raise exception 'unauthorized edit allowed: %', state; end if;
  if has_function_privilege('anon', 'public.save_attendance_work_schedule(uuid,smallint,time,time,integer,date,date,text)', 'execute') then
    raise exception 'anonymous schedule edits allowed';
  end if;
end;
$$;
reset role;
rollback;
