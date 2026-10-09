-- Run only in an approved disposable local or staging database; fixtures roll back.
begin;
-- Transaction-local removal exercises the default-deny path without changing concurrent staging sessions.
delete from stockly_private.attendance_tag_test_enabled;
insert into public.stores (id, name) values
('13000000-0000-0000-0000-000000000094', '테스트 매장'),
('13000000-0000-0000-0000-000000000095', '운영 매장');
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
('00000000-0000-0000-0000-000000000000', '23000000-0000-0000-0000-000000000094', 'authenticated', 'authenticated', 'tag-admin@example.invalid', '', '{"provider":"email","providers":["email"]}', '{}', clock_timestamp(), clock_timestamp()),
('00000000-0000-0000-0000-000000000000', '23000000-0000-0000-0000-000000000095', 'authenticated', 'authenticated', 'tag-staff@example.invalid', '', '{"provider":"email","providers":["email"]}', '{}', clock_timestamp(), clock_timestamp()),
('00000000-0000-0000-0000-000000000000', '23000000-0000-0000-0000-000000000096', 'authenticated', 'authenticated', 'other-admin@example.invalid', '', '{"provider":"email","providers":["email"]}', '{}', clock_timestamp(), clock_timestamp());
insert into public.profiles (id, email, display_name, store_id, role) values
('23000000-0000-0000-0000-000000000094', 'tag-admin@example.invalid', '테스트 관리자', '13000000-0000-0000-0000-000000000094', 'store_admin'),
('23000000-0000-0000-0000-000000000095', 'tag-staff@example.invalid', '테스트 직원', '13000000-0000-0000-0000-000000000094', 'staff'),
('23000000-0000-0000-0000-000000000096', 'other-admin@example.invalid', '운영 관리자', '13000000-0000-0000-0000-000000000095', 'store_admin');
set role authenticated;
select set_config('request.jwt.claim.sub', '23000000-0000-0000-0000-000000000094', true);
create temp table tag_test_state as select public.create_attendance_tag('출퇴근 NFC') as created;
-- Even a test-store manager cannot test before the staging-only database setting is enabled.
do $$ declare state text; begin
  begin perform public.begin_attendance_tag_test((select (created->>'id')::uuid from tag_test_state), gen_random_uuid());
  exception when others then get stacked diagnostics state = returned_sqlstate; end;
  if state is distinct from '42501' then raise exception 'test RPC was enabled without staging gate: %', state; end if;
end; $$;
reset role;
insert into stockly_private.attendance_tag_test_enabled default values;
set role authenticated;
do $$
declare test_tag_id uuid; first_result jsonb; replay jsonb; saved jsonb; state text;
begin
  test_tag_id := (select (created->>'id')::uuid from tag_test_state);
  first_result := public.begin_attendance_tag_test(test_tag_id, '33000000-0000-0000-0000-000000000094');
  replay := public.begin_attendance_tag_test(test_tag_id, '33000000-0000-0000-0000-000000000094');
  if first_result is distinct from replay or first_result->>'tag_name' <> '출퇴근 NFC' or first_result ? 'token' then
    raise exception 'tag test did not return the real idempotent prompt';
  end if;
  if not exists (select 1 from public.attendance_punch_events where id = (first_result->>'id')::uuid and attendance_punch_events.tag_id = test_tag_id and request_id = '33000000-0000-0000-0000-000000000094') then
    raise exception 'tag test did not create a real event';
  end if;
  begin
    perform public.begin_attendance_tag_test((public.create_attendance_tag('두번째 NFC')->>'id')::uuid, gen_random_uuid());
  exception when others then get stacked diagnostics state = returned_sqlstate; end;
  if state is distinct from '22023' then raise exception 'other tag reused pending event: %', state; end if;
  state := null;
  saved := public.finalize_attendance_punch((first_result->>'id')::uuid,
    ((first_result->>'tagged_at')::timestamptz at time zone 'Asia/Seoul')::time,
    '33000000-0000-0000-0000-000000000095');
  if saved->>'id' is null then raise exception 'tag test could not finalize a real shift'; end if;
  perform public.update_attendance_tag(test_tag_id, '출퇴근 NFC', false);
  begin
    perform public.begin_attendance_tag_test(test_tag_id, '33000000-0000-0000-0000-000000000096');
  exception when others then get stacked diagnostics state = returned_sqlstate; end;
  if state is distinct from '42501' then raise exception 'inactive tag was testable: %', state; end if;
end;
$$;
select set_config('request.jwt.claim.sub', '23000000-0000-0000-0000-000000000095', true);
do $$ declare state text; begin
  begin perform public.begin_attendance_tag_test((select (created->>'id')::uuid from tag_test_state), gen_random_uuid());
  exception when others then get stacked diagnostics state = returned_sqlstate; end;
  if state is distinct from '42501' then raise exception 'staff could test tags: %', state; end if;
end; $$;
select set_config('request.jwt.claim.sub', '23000000-0000-0000-0000-000000000096', true);
do $$ declare state text; begin
  begin perform public.begin_attendance_tag_test((select (created->>'id')::uuid from tag_test_state), gen_random_uuid());
  exception when others then get stacked diagnostics state = returned_sqlstate; end;
  if state is distinct from '42501' then raise exception 'other-store manager could test a tag: %', state; end if;
  state := null;
  begin perform public.begin_attendance_tag_test((public.create_attendance_tag('운영 태그')->>'id')::uuid, gen_random_uuid());
  exception when others then get stacked diagnostics state = returned_sqlstate; end;
  if state is distinct from '42501' then raise exception 'non-test store could test its own tag: %', state; end if;
end; $$;
reset role;
rollback;
select 'attendance_tag_test_contract_passed' as result;
