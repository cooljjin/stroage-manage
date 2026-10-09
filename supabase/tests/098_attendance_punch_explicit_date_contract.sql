-- Run only after a clean disposable local migration reset. All fixtures roll back.
begin;

insert into public.stores (id, name) values
  ('13000000-0000-0000-0000-000000000001', '근태 계약 매장'),
  ('13000000-0000-0000-0000-000000000002', '다른 매장');

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
('00000000-0000-0000-0000-000000000000', '23000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'attendance-admin@example.invalid', '', clock_timestamp(), '{"provider":"email","providers":["email"]}', '{}', clock_timestamp(), clock_timestamp()),
('00000000-0000-0000-0000-000000000000', '23000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'attendance-staff@example.invalid', '', clock_timestamp(), '{"provider":"email","providers":["email"]}', '{}', clock_timestamp(), clock_timestamp()),
('00000000-0000-0000-0000-000000000000', '23000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'other-staff@example.invalid', '', clock_timestamp(), '{"provider":"email","providers":["email"]}', '{}', clock_timestamp(), clock_timestamp());

insert into public.profiles (id, email, display_name, store_id, role) values
('23000000-0000-0000-0000-000000000001', 'attendance-admin@example.invalid', '근태 관리자', '13000000-0000-0000-0000-000000000001', 'store_admin'),
('23000000-0000-0000-0000-000000000002', 'attendance-staff@example.invalid', '근태 직원', '13000000-0000-0000-0000-000000000001', 'staff'),
('23000000-0000-0000-0000-000000000004', 'other-staff@example.invalid', '다른 직원', '13000000-0000-0000-0000-000000000002', 'staff');

set role authenticated;
select set_config('request.jwt.claims', '{"sub":"23000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
create temporary table attendance_date_contract_state (token text, tag_id uuid, same_day_shift uuid, overnight_shift uuid);
insert into attendance_date_contract_state (token) select public.create_attendance_tag('근태 날짜 계약 태그')->>'token';
update attendance_date_contract_state set tag_id = (select id from public.attendance_tags where name = '근태 날짜 계약 태그' limit 1);
reset role;

insert into public.attendance_punch_events (id, store_id, user_id, tag_id, punch_type, tagged_at, expires_at, status, request_id) values
('48000000-0000-0000-0000-000000000001', '13000000-0000-0000-0000-000000000001', '23000000-0000-0000-0000-000000000002', (select tag_id from attendance_date_contract_state), 'check_in',  timestamptz '2026-10-07 09:00:00+09', clock_timestamp() + interval '1 day', 'cancelled', '58000000-0000-0000-0000-000000000001'),
('48000000-0000-0000-0000-000000000002', '13000000-0000-0000-0000-000000000001', '23000000-0000-0000-0000-000000000002', (select tag_id from attendance_date_contract_state), 'check_out', timestamptz '2026-10-07 17:00:00+09', clock_timestamp() + interval '1 day', 'cancelled', '58000000-0000-0000-0000-000000000002'),
('48000000-0000-0000-0000-000000000003', '13000000-0000-0000-0000-000000000001', '23000000-0000-0000-0000-000000000002', (select tag_id from attendance_date_contract_state), 'check_in',  timestamptz '2026-10-07 22:00:00+09', clock_timestamp() + interval '1 day', 'cancelled', '58000000-0000-0000-0000-000000000003'),
('48000000-0000-0000-0000-000000000004', '13000000-0000-0000-0000-000000000001', '23000000-0000-0000-0000-000000000002', (select tag_id from attendance_date_contract_state), 'check_out', timestamptz '2026-10-07 23:00:00+09', clock_timestamp() + interval '1 day', 'cancelled', '58000000-0000-0000-0000-000000000004'),
('48000000-0000-0000-0000-000000000005', '13000000-0000-0000-0000-000000000001', '23000000-0000-0000-0000-000000000002', (select tag_id from attendance_date_contract_state), 'check_out', timestamptz '2026-10-07 23:00:00+09', clock_timestamp() + interval '1 day', 'cancelled', '58000000-0000-0000-0000-000000000005'),
('48000000-0000-0000-0000-000000000006', '13000000-0000-0000-0000-000000000001', '23000000-0000-0000-0000-000000000002', (select tag_id from attendance_date_contract_state), 'check_in',  timestamptz '2026-10-07 09:00:00+09', clock_timestamp() + interval '1 day', 'cancelled', '58000000-0000-0000-0000-000000000006'),
('48000000-0000-0000-0000-000000000007', '13000000-0000-0000-0000-000000000001', '23000000-0000-0000-0000-000000000002', (select tag_id from attendance_date_contract_state), 'check_in',  timestamptz '2026-10-07 09:00:00+09', clock_timestamp() + interval '1 day', 'cancelled', '58000000-0000-0000-0000-000000000007'),
('48000000-0000-0000-0000-000000000008', '13000000-0000-0000-0000-000000000001', '23000000-0000-0000-0000-000000000002', (select tag_id from attendance_date_contract_state), 'check_in',  timestamptz '2026-10-07 09:00:00+09', clock_timestamp() + interval '1 day', 'cancelled', '58000000-0000-0000-0000-000000000008'),
('48000000-0000-0000-0000-000000000009', '13000000-0000-0000-0000-000000000001', '23000000-0000-0000-0000-000000000002', (select tag_id from attendance_date_contract_state), 'check_in',  timestamptz '2026-10-07 12:00:00+09', clock_timestamp() + interval '1 day', 'cancelled', '58000000-0000-0000-0000-000000000009'),
('48000000-0000-0000-0000-000000000010', '13000000-0000-0000-0000-000000000001', '23000000-0000-0000-0000-000000000002', (select tag_id from attendance_date_contract_state), 'check_in',  clock_timestamp() - interval '20 minutes', clock_timestamp() - interval '5 minutes', 'cancelled', '58000000-0000-0000-0000-000000000010'),
('48000000-0000-0000-0000-000000000011', '13000000-0000-0000-0000-000000000001', '23000000-0000-0000-0000-000000000002', (select tag_id from attendance_date_contract_state), 'check_in',  date_trunc('second', clock_timestamp()), clock_timestamp() + interval '1 day', 'cancelled', '58000000-0000-0000-0000-000000000011');

create function pg_temp.activate_attendance_date_fixture(event_id uuid) returns void
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
begin
  update public.attendance_punch_events set status = 'cancelled'
  where user_id = '23000000-0000-0000-0000-000000000002' and status = 'pending';
  update public.attendance_punch_events set status = 'pending'
  where id = event_id and status = 'cancelled';
end;
$$;
revoke all on function pg_temp.activate_attendance_date_fixture(uuid) from public;
grant execute on function pg_temp.activate_attendance_date_fixture(uuid) to authenticated;

set role authenticated;
select set_config('request.jwt.claims', '{"sub":"23000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
do $$
declare
  result jsonb;
  replay jsonb;
  caught_sqlstate text;
  tag_before uuid;
  tag_after uuid;
  legacy_time time;
begin
  perform pg_temp.activate_attendance_date_fixture('48000000-0000-0000-0000-000000000001');
  result := public.finalize_attendance_punch('48000000-0000-0000-0000-000000000001', date '2026-10-07', time '09:00', '68000000-0000-0000-0000-000000000001');
  if (result->>'id') is null then raise exception 'same-day check-in did not create a shift'; end if;
  update attendance_date_contract_state set same_day_shift = (result->>'id')::uuid;
  perform pg_temp.activate_attendance_date_fixture('48000000-0000-0000-0000-000000000002');
  result := public.finalize_attendance_punch('48000000-0000-0000-0000-000000000002', date '2026-10-07', time '17:00', '68000000-0000-0000-0000-000000000002');
  if (result->>'status') is distinct from 'closed'
     or ((result->>'entered_check_out_at')::timestamptz at time zone 'Asia/Seoul')::date is distinct from date '2026-10-07' then
    raise exception 'same-day selected date was not preserved';
  end if;
  select tag_id into tag_before from public.attendance_punch_events where id = '48000000-0000-0000-0000-000000000001';
  perform pg_temp.activate_attendance_date_fixture('48000000-0000-0000-0000-000000000001');
  replay := public.finalize_attendance_punch('48000000-0000-0000-0000-000000000001', date '2026-10-07', time '09:00', '68000000-0000-0000-0000-000000000001');
  select tag_id into tag_after from public.attendance_punch_events where id = '48000000-0000-0000-0000-000000000001';
  if replay->>'id' is distinct from (select same_day_shift::text from attendance_date_contract_state) or tag_before is distinct from tag_after then
    raise exception 'same-request replay changed result or tag assignment';
  end if;

  perform pg_temp.activate_attendance_date_fixture('48000000-0000-0000-0000-000000000003');

  result := public.finalize_attendance_punch('48000000-0000-0000-0000-000000000003', date '2026-10-07', time '22:00', '68000000-0000-0000-0000-000000000003');
  update attendance_date_contract_state set overnight_shift = (result->>'id')::uuid;
  begin
    perform pg_temp.activate_attendance_date_fixture('48000000-0000-0000-0000-000000000004');
    perform public.finalize_attendance_punch('48000000-0000-0000-0000-000000000004', date '2026-10-07', time '21:59', '68000000-0000-0000-0000-000000000004');
    raise exception 'checkout at/before check-in was accepted';
  exception when others then
    get stacked diagnostics caught_sqlstate = returned_sqlstate;
    if caught_sqlstate <> '22023' then raise exception 'wrong SQLSTATE for checkout at/before check-in: %', caught_sqlstate; end if;
  end;
  perform pg_temp.activate_attendance_date_fixture('48000000-0000-0000-0000-000000000005');
  result := public.finalize_attendance_punch('48000000-0000-0000-0000-000000000005', date '2026-10-08', time '02:00', '68000000-0000-0000-0000-000000000005');
  if ((result->>'confirmed_check_out_at')::timestamptz at time zone 'Asia/Seoul')::date is distinct from date '2026-10-08' then
    raise exception 'overnight checkout did not preserve the selected next-day date';
  end if;

  begin
    perform pg_temp.activate_attendance_date_fixture('48000000-0000-0000-0000-000000000006');
    perform public.finalize_attendance_punch('48000000-0000-0000-0000-000000000006', date '2026-10-07', time '22:01', '68000000-0000-0000-0000-000000000006');
    raise exception 'time more than 12 hours from tag was accepted';
  exception when others then
    get stacked diagnostics caught_sqlstate = returned_sqlstate;
    if caught_sqlstate <> '22023' then raise exception 'wrong SQLSTATE for 12-hour limit: %', caught_sqlstate; end if;
  end;
  begin
    perform pg_temp.activate_attendance_date_fixture('48000000-0000-0000-0000-000000000007');
    perform public.finalize_attendance_punch('48000000-0000-0000-0000-000000000007', null::date, time '09:00', '68000000-0000-0000-0000-000000000007');
    raise exception 'null selected date was accepted';
  exception when others then
    get stacked diagnostics caught_sqlstate = returned_sqlstate;
    if caught_sqlstate <> '22023' then raise exception 'wrong SQLSTATE for null date: %', caught_sqlstate; end if;
  end;
  begin
    perform pg_temp.activate_attendance_date_fixture('48000000-0000-0000-0000-000000000008');
    perform public.finalize_attendance_punch('48000000-0000-0000-0000-000000000008', date 'infinity', time '09:00', '68000000-0000-0000-0000-000000000008');
    raise exception 'infinite selected date was accepted';
  exception when others then
    get stacked diagnostics caught_sqlstate = returned_sqlstate;
    if caught_sqlstate <> '22023' then raise exception 'wrong SQLSTATE for infinite date: %', caught_sqlstate; end if;
  end;
end;
$$;

select set_config('request.jwt.claims', '{"sub":"23000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
do $$
declare caught_sqlstate text;
begin
  begin
    perform pg_temp.activate_attendance_date_fixture('48000000-0000-0000-0000-000000000009');
    perform public.finalize_attendance_punch('48000000-0000-0000-0000-000000000009', date '2026-10-07', time '12:00', '68000000-0000-0000-0000-000000000009');
    raise exception 'wrong user finalized another user event';
  exception when others then
    get stacked diagnostics caught_sqlstate = returned_sqlstate;
    if caught_sqlstate <> 'P0002' then raise exception 'wrong SQLSTATE for wrong user: %', caught_sqlstate; end if;
  end;
end;
$$;

select set_config('request.jwt.claims', '{"sub":"23000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
do $$
declare result jsonb; legacy_time time;
begin
  perform pg_temp.activate_attendance_date_fixture('48000000-0000-0000-0000-000000000010');
  result := public.finalize_attendance_punch('48000000-0000-0000-0000-000000000010', date '2026-10-07', time '20:00', '68000000-0000-0000-0000-000000000010');
  if result->>'status' is distinct from 'expired' then raise exception 'expired event was not reported as expired'; end if;
  if to_regprocedure('public.finalize_attendance_punch(uuid,time,uuid)') is null then raise exception 'legacy three-argument overload is missing'; end if;
  legacy_time := (clock_timestamp() at time zone 'Asia/Seoul')::time;
  perform pg_temp.activate_attendance_date_fixture('48000000-0000-0000-0000-000000000011');
  result := public.finalize_attendance_punch('48000000-0000-0000-0000-000000000011', legacy_time, '68000000-0000-0000-0000-000000000011');
  if result->>'id' is null then raise exception 'legacy three-argument overload did not resolve and execute'; end if;
end;
$$;
reset role;
do $$
begin
  if (select tagged_at from public.attendance_punch_events where id = '48000000-0000-0000-0000-000000000001')
    is distinct from timestamptz '2026-10-07 09:00:00+09' then raise exception 'audit tag timestamp changed'; end if;
  if (select count(*) from public.attendance_shifts where check_in_event_id = '48000000-0000-0000-0000-000000000001')
    is distinct from 1::bigint then raise exception 'idempotent replay duplicated shift'; end if;
end;
$$;
rollback;
