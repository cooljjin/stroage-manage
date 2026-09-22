-- Run only after a clean disposable local migration reset. All fixtures roll back.
begin;

insert into public.stores (id, name) values
  ('13000000-0000-0000-0000-000000000001', '근태 계약 매장'),
  ('13000000-0000-0000-0000-000000000002', '다른 매장');

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
('00000000-0000-0000-0000-000000000000', '23000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'attendance-admin@example.invalid', '', clock_timestamp(), '{"provider":"email","providers":["email"]}', '{}', clock_timestamp(), clock_timestamp()),
('00000000-0000-0000-0000-000000000000', '23000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'attendance-staff@example.invalid', '', clock_timestamp(), '{"provider":"email","providers":["email"]}', '{}', clock_timestamp(), clock_timestamp()),
('00000000-0000-0000-0000-000000000000', '23000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'attendance-manager@example.invalid', '', clock_timestamp(), '{"provider":"email","providers":["email"]}', '{}', clock_timestamp(), clock_timestamp()),
('00000000-0000-0000-0000-000000000000', '23000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'other-staff@example.invalid', '', clock_timestamp(), '{"provider":"email","providers":["email"]}', '{}', clock_timestamp(), clock_timestamp());

insert into public.profiles (id, email, display_name, store_id, role) values
('23000000-0000-0000-0000-000000000001', 'attendance-admin@example.invalid', '근태 관리자', '13000000-0000-0000-0000-000000000001', 'store_admin'),
('23000000-0000-0000-0000-000000000002', 'attendance-staff@example.invalid', '근태 직원', '13000000-0000-0000-0000-000000000001', 'staff'),
('23000000-0000-0000-0000-000000000003', 'attendance-manager@example.invalid', '근태 매니저', '13000000-0000-0000-0000-000000000001', 'staff'),
('23000000-0000-0000-0000-000000000004', 'other-staff@example.invalid', '다른 직원', '13000000-0000-0000-0000-000000000002', 'staff');

insert into public.staff_permissions (store_id, user_id, permission_key, granted_by) values
('13000000-0000-0000-0000-000000000001', '23000000-0000-0000-0000-000000000003', 'attendance_management', '23000000-0000-0000-0000-000000000001');

-- The store trigger must provision rules for stores created after migration replay.
do $$
begin
  if not exists (select 1 from public.attendance_payroll_rules where store_id = '13000000-0000-0000-0000-000000000002') then
    raise exception 'new store did not receive default payroll rules';
  end if;
end;
$$;

update public.attendance_payroll_rules
set effective_from = date '2026-09-01', weekly_threshold_minutes = 1
where store_id = '13000000-0000-0000-0000-000000000001';

set role authenticated;
select set_config('request.jwt.claims', '{"sub":"23000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
create temporary table attendance_contract_state (token text, old_token text, tag_id uuid, check_in_event uuid, shift_id uuid);
insert into attendance_contract_state (token) select public.create_attendance_tag('카운터 NFC')->>'token';
update attendance_contract_state state set old_token = token,
  tag_id = (select id from public.attendance_tags where name = '카운터 NFC' limit 1);

select set_config('request.jwt.claims', '{"sub":"23000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
do $$
declare
  first_result jsonb;
  duplicate_result jsonb;
  replay_result jsonb;
  event_id uuid;
  entered_time time;
  saved_shift jsonb;
  abnormal_event jsonb;
  abnormal_time time;
  visible_count integer;
  caught_sqlstate text;
begin
  select public.begin_attendance_punch(token, '33000000-0000-0000-0000-000000000001') into first_result from attendance_contract_state;
  select public.begin_attendance_punch(token, '33000000-0000-0000-0000-000000000001') into duplicate_result from attendance_contract_state;
  if first_result is distinct from duplicate_result then raise exception 'duplicate begin did not replay identical prompt JSON'; end if;
  if not (first_result ?& array['scheduled_time', 'suggested_time', 'tag_name', 'open_check_in_at']) then raise exception 'punch prompt shape is incomplete'; end if;

  event_id := (first_result->>'id')::uuid;
  entered_time := ((first_result->>'tagged_at')::timestamptz at time zone 'Asia/Seoul')::time;
  update attendance_contract_state set check_in_event = event_id;
  saved_shift := public.finalize_attendance_punch(event_id, entered_time, '33000000-0000-0000-0000-000000000002');
  replay_result := public.finalize_attendance_punch(event_id, entered_time, '33000000-0000-0000-0000-000000000002');
  if saved_shift->>'id' is distinct from replay_result->>'id' then raise exception 'completed finalize replay was not idempotent'; end if;
  update attendance_contract_state set shift_id = (saved_shift->>'id')::uuid;

  begin
    perform public.finalize_attendance_punch(event_id, entered_time, '33000000-0000-0000-0000-000000000099');
    raise exception 'different finalize request unexpectedly changed a completed event';
  exception when others then
    get stacked diagnostics caught_sqlstate = returned_sqlstate;
    if caught_sqlstate <> '22023' then raise exception 'wrong SQLSTATE for completed replay: %', caught_sqlstate; end if;
  end;

  select public.begin_attendance_punch(token, '33000000-0000-0000-0000-000000000005')
  into abnormal_event from attendance_contract_state;
  abnormal_time := (((abnormal_event->>'tagged_at')::timestamptz at time zone 'Asia/Seoul') + interval '13 hours')::time;
  begin
    perform public.finalize_attendance_punch(
      (abnormal_event->>'id')::uuid, abnormal_time, '33000000-0000-0000-0000-000000000006'
    );
    raise exception 'abnormal entered time was saved';
  exception when others then
    get stacked diagnostics caught_sqlstate = returned_sqlstate;
    if caught_sqlstate <> '22023' then raise exception 'wrong SQLSTATE for abnormal entered time: %', caught_sqlstate; end if;
  end;
  select public.begin_attendance_punch(token, '33000000-0000-0000-0000-000000000005')
  into abnormal_event from attendance_contract_state;
  if abnormal_event->>'status' <> 'pending' then raise exception 'abnormal entered time mutated the punch'; end if;

  begin
    perform public.recalculate_attendance_segments((select shift_id from attendance_contract_state));
    raise exception 'ordinary staff recalculated attendance segments';
  exception when others then
    get stacked diagnostics caught_sqlstate = returned_sqlstate;
    if caught_sqlstate <> '42501' then raise exception 'wrong SQLSTATE for staff recalculation: %', caught_sqlstate; end if;
  end;

  begin
    insert into public.attendance_schedule_overrides
      (store_id, user_id, work_date, is_day_off, created_by)
    values
      ('13000000-0000-0000-0000-000000000001', auth.uid(), current_date, true, auth.uid());
    raise exception 'ordinary staff directly wrote an attendance management table';
  exception when others then
    get stacked diagnostics caught_sqlstate = returned_sqlstate;
    if caught_sqlstate <> '42501' then raise exception 'wrong SQLSTATE for direct management write: %', caught_sqlstate; end if;
  end;

  select count(*) into visible_count from public.attendance_shifts;
  if visible_count <> 0 then raise exception 'ordinary staff read protected attendance shifts'; end if;
end;
$$;

-- Rotation invalidates the old token immediately and returns a one-time replacement value.
select set_config('request.jwt.claims', '{"sub":"23000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
do $$
declare replacement jsonb; caught_sqlstate text;
begin
  replacement := public.rotate_attendance_tag((select tag_id from attendance_contract_state), '분실 태그 재발급');
  if replacement->>'token' is null or replacement->>'url' not like '/attendance/tag/%' then raise exception 'rotation did not return a replacement credential'; end if;
  begin
    perform public.begin_attendance_punch((select old_token from attendance_contract_state), '33000000-0000-0000-0000-000000000007');
    raise exception 'old tag token remained valid after rotation';
  exception when others then
    get stacked diagnostics caught_sqlstate = returned_sqlstate;
    if caught_sqlstate <> '42501' then raise exception 'wrong SQLSTATE for rotated token: %', caught_sqlstate; end if;
  end;
  update attendance_contract_state set token = replacement->>'token';
end;
$$;

-- Expiry must persist without producing a shift.
reset role;
update public.attendance_punch_events
set status = 'cancelled'
where user_id = '23000000-0000-0000-0000-000000000002' and status = 'pending';
insert into public.attendance_punch_events
  (id, store_id, user_id, tag_id, punch_type, tagged_at, expires_at, status, request_id)
select
  '43000000-0000-0000-0000-000000000001', store_id, '23000000-0000-0000-0000-000000000002', id,
  'check_out', clock_timestamp() - interval '20 minutes', clock_timestamp() - interval '5 minutes', 'pending',
  '33000000-0000-0000-0000-000000000003'
from public.attendance_tags where store_id = '13000000-0000-0000-0000-000000000001' limit 1;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"23000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
do $$
declare result jsonb;
begin
  result := public.finalize_attendance_punch(
    '43000000-0000-0000-0000-000000000001', time '12:00', '33000000-0000-0000-0000-000000000004'
  );
  if result->>'status' <> 'expired' then raise exception 'expired pending event was not reported expired'; end if;
end;
$$;
reset role;
do $$ begin
  if (select status from public.attendance_punch_events where id = '43000000-0000-0000-0000-000000000001') <> 'expired' then
    raise exception 'expired pending event status was not persisted';
  end if;
end $$;
set role authenticated;

select set_config('request.jwt.claims', '{"sub":"23000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
do $$
declare visible_count integer; caught_sqlstate text;
begin
  select count(*) into visible_count from public.attendance_shifts;
  if visible_count <> 1 then raise exception 'attendance manager could not read store shifts'; end if;
  if (select confirmed_at = entered_at from public.attendance_punch_events
      where id = (select check_in_event from attendance_contract_state)) then
    raise exception 'confirmed_at reused employee entered time';
  end if;

  begin
    perform public.save_attendance_work_schedule(
      '23000000-0000-0000-0000-000000000004', 1::smallint, time '09:00', time '18:00', 60,
      current_date, null, 'cross-store contract'
    );
    raise exception 'manager saved a cross-store schedule';
  exception when others then
    get stacked diagnostics caught_sqlstate = returned_sqlstate;
    if caught_sqlstate <> '23503' then raise exception 'wrong SQLSTATE for cross-store schedule: %', caught_sqlstate; end if;
  end;

  begin
    perform public.recalculate_attendance_segments((select shift_id from attendance_contract_state));
  exception when others then
    get stacked diagnostics caught_sqlstate = returned_sqlstate;
    raise exception 'manager recalculation failed with SQLSTATE %', caught_sqlstate;
  end;
end;
$$;

select set_config('request.jwt.claims', '{"sub":"23000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
do $$
declare changed public.attendance_shifts; allowance public.attendance_weekly_allowances;
begin
  perform public.save_attendance_payroll_rules(
    current_date, null, 0.5, 0.5, 0.5, 1, 2400, 'half_up', 1, true, '계약 테스트 기준'
  );
  perform public.save_attendance_pay_rate(
    '23000000-0000-0000-0000-000000000002', 12000, 1200, date '2026-09-21', null, '계약 테스트 시급'
  );
  select result.* into changed
  from attendance_contract_state state
  cross join lateral public.manage_attendance_shift(
    state.shift_id, timestamptz '2026-09-22 09:00:00+09', timestamptz '2026-09-22 18:00:00+09', 60, 'approved', '계약 테스트 승인'
  ) result;
  if changed.status <> 'approved' then raise exception 'administrator could not approve attendance shift'; end if;
  if not exists (select 1 from public.attendance_shift_audit where shift_id = changed.id) then raise exception 'shift edit did not create audit history'; end if;
  if not exists (select 1 from public.attendance_management_audit where entity_type = 'shift_segment_reset' and entity_id = changed.id) then raise exception 'segment reset was not audited'; end if;
  select * into allowance from public.confirm_attendance_weekly_allowance(
    '23000000-0000-0000-0000-000000000002', date '2026-09-21', true, '개근 확인', '계약 테스트 주휴 확정'
  );
  if allowance.allowance_amount <> 48000 then raise exception 'weekly allowance was not server-derived: %', allowance.allowance_amount; end if;
  if to_regprocedure('public.confirm_attendance_weekly_allowance(uuid,date,boolean,bigint,text,text)') is not null then
    raise exception 'arbitrary weekly allowance signature remains callable';
  end if;
end;
$$;

reset role;
rollback;