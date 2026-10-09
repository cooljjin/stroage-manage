-- Disposable local database only. Fixtures and changes roll back.
begin;
insert into public.stores (id, name) values
('14000000-0000-0000-0000-000000000094', '근태 삭제 테스트 매장'),
('14000000-0000-0000-0000-000000000095', '다른 테스트 매장');
insert into auth.users (id, email) values
('24000000-0000-0000-0000-000000000094', 'shift-manager@example.invalid'),
('24000000-0000-0000-0000-000000000095', 'shift-staff@example.invalid');
insert into public.profiles (id, email, display_name, store_id, role) values
('24000000-0000-0000-0000-000000000094', 'shift-manager@example.invalid', '테스트 관리자', '14000000-0000-0000-0000-000000000094', 'store_admin'),
('24000000-0000-0000-0000-000000000095', 'shift-staff@example.invalid', '테스트 직원', '14000000-0000-0000-0000-000000000094', 'staff');
insert into public.attendance_tags (id, store_id, name, token_hash, created_by) values
('34000000-0000-0000-0000-000000000094', '14000000-0000-0000-0000-000000000094', '테스트 태그', repeat('a', 64), '24000000-0000-0000-0000-000000000094');
insert into public.attendance_punch_events (id, store_id, user_id, tag_id, punch_type, status, request_id) values
('44000000-0000-0000-0000-000000000094', '14000000-0000-0000-0000-000000000094', '24000000-0000-0000-0000-000000000095', '34000000-0000-0000-0000-000000000094', 'check_in', 'completed', '44000000-0000-0000-0000-000000000094'),
('44000000-0000-0000-0000-000000000095', '14000000-0000-0000-0000-000000000094', '24000000-0000-0000-0000-000000000095', '34000000-0000-0000-0000-000000000094', 'check_in', 'completed', '44000000-0000-0000-0000-000000000095');
insert into public.attendance_shifts (id, store_id, user_id, check_in_event_id, entered_check_in_at, confirmed_check_in_at, confirmed_check_out_at, status) values
('54000000-0000-0000-0000-000000000094', '14000000-0000-0000-0000-000000000094', '24000000-0000-0000-0000-000000000095', '44000000-0000-0000-0000-000000000094', '2026-10-07 21:00+09', '2026-10-07 21:00+09', '2026-10-08 10:30+09', 'closed'),
('54000000-0000-0000-0000-000000000095', '14000000-0000-0000-0000-000000000094', '24000000-0000-0000-0000-000000000095', '44000000-0000-0000-0000-000000000095', '2026-10-12 09:00+09', '2026-10-12 09:00+09', null, 'open');
insert into public.attendance_shift_segments (shift_id, store_id, segment_type, starts_at, ends_at) values
('54000000-0000-0000-0000-000000000094', '14000000-0000-0000-0000-000000000094', 'night', '2026-10-07 22:00+09', '2026-10-08 06:00+09');
insert into public.attendance_shift_audit (shift_id, store_id, changed_by, reason, before_values, after_values) values
('54000000-0000-0000-0000-000000000094', '14000000-0000-0000-0000-000000000094', '24000000-0000-0000-0000-000000000094', '기존 수정 이력', '{}', '{}');
insert into public.attendance_weekly_allowances (store_id, user_id, week_start, eligible, allowance_amount, confirmed_by) values
('14000000-0000-0000-0000-000000000094', '24000000-0000-0000-0000-000000000095', '2026-10-05', true, 80000, '24000000-0000-0000-0000-000000000094'),
('14000000-0000-0000-0000-000000000094', '24000000-0000-0000-0000-000000000095', '2026-10-12', true, 80000, '24000000-0000-0000-0000-000000000094');

set role authenticated;
select set_config('request.jwt.claim.sub', '24000000-0000-0000-0000-000000000095', true);
do $$
declare state text;
begin
  begin
    perform public.delete_attendance_shift('54000000-0000-0000-0000-000000000094', '14000000-0000-0000-0000-000000000094', '직원 삭제 시도');
  exception when others then get stacked diagnostics state = returned_sqlstate; end;
  if state is distinct from '42501' then raise exception 'unauthorized deletion: %', state; end if;
end;
$$;
select set_config('request.jwt.claim.sub', '24000000-0000-0000-0000-000000000094', true);
do $$
declare state text; reason text;
begin
  begin
    perform public.delete_attendance_shift('54000000-0000-0000-0000-000000000094', '14000000-0000-0000-0000-000000000095', '다른 매장 삭제 시도');
  exception when others then get stacked diagnostics state = returned_sqlstate; end;
  if state is distinct from '42501' then raise exception 'cross-store deletion: %', state; end if;
  foreach reason in array array[' ', repeat('a', 501)] loop
    state := null;
    begin
      perform public.delete_attendance_shift('54000000-0000-0000-0000-000000000094', '14000000-0000-0000-0000-000000000094', reason);
    exception when others then get stacked diagnostics state = returned_sqlstate; end;
    if state is distinct from '22023' then raise exception 'invalid reason: %', state; end if;
  end loop;
  if (select count(*) from public.attendance_shifts) <> 2 then raise exception 'rejected deletion changed shifts'; end if;
  if has_function_privilege('anon', 'public.delete_attendance_shift(uuid,uuid,text)', 'execute') then raise exception 'anon can execute'; end if;
end;
$$;
select public.delete_attendance_shift('54000000-0000-0000-0000-000000000094', '14000000-0000-0000-0000-000000000094', '잘못된 근태 삭제');
do $$
declare snapshot jsonb; state text;
begin
  if exists (select 1 from public.attendance_shifts where id = '54000000-0000-0000-0000-000000000094') then raise exception 'deleted shift remains'; end if;
  if exists (select 1 from public.attendance_shift_segments) then raise exception 'deleted segments remain'; end if;
  select before_values into snapshot from public.attendance_management_audit where entity_type = 'shift_delete' and entity_id = '54000000-0000-0000-0000-000000000094';
  if snapshot->'shift'->>'id' is distinct from '54000000-0000-0000-0000-000000000094'
    or jsonb_array_length(snapshot->'segments') <> 1 or jsonb_array_length(snapshot->'shift_audit') <> 1 then raise exception 'deletion lost history'; end if;
  if (select count(*) from public.attendance_punch_events where status = 'completed') <> 2 then raise exception 'raw NFC events changed'; end if;
  if exists (select 1 from public.attendance_weekly_allowances where week_start = '2026-10-05') then raise exception 'stale weekly allowance remains'; end if;
  if not exists (select 1 from public.attendance_weekly_allowances where week_start = '2026-10-12') then raise exception 'unrelated weekly allowance deleted'; end if;
  if not exists (select 1 from public.attendance_management_audit where entity_type = 'weekly_allowance_reset' and before_values->>'allowance_amount' = '80000') then raise exception 'weekly allowance reset not audited'; end if;
  begin
    perform public.delete_attendance_shift('54000000-0000-0000-0000-000000000094', '14000000-0000-0000-0000-000000000094', '재삭제');
  exception when others then get stacked diagnostics state = returned_sqlstate; end;
  if state is distinct from 'P0002' then raise exception 'repeated deletion: %', state; end if;
end;
$$;
select public.delete_attendance_shift('54000000-0000-0000-0000-000000000095', '14000000-0000-0000-0000-000000000094', '열린 근태 삭제');
do $$
begin
  if exists (select 1 from public.attendance_shifts) then raise exception 'open shift remains'; end if;
  if (select count(*) from public.attendance_management_audit where entity_type = 'shift_delete') <> 2 then raise exception 'delete audit count'; end if;
end;
$$;
reset role;
rollback;
