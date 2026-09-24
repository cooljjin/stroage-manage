-- Run only against a disposable local database after migration replay; all fixtures roll back.
begin;
insert into public.stores (id, name) values ('13000000-0000-0000-0000-000000000093', 'NFC 삭제 계약 매장');
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
('00000000-0000-0000-0000-000000000000', '23000000-0000-0000-0000-000000000093', 'authenticated', 'authenticated', 'delete-manager@example.invalid', '', '{"provider":"email","providers":["email"]}', '{}', clock_timestamp(), clock_timestamp()),
('00000000-0000-0000-0000-000000000000', '23000000-0000-0000-0000-000000000094', 'authenticated', 'authenticated', 'delete-staff@example.invalid', '', '{"provider":"email","providers":["email"]}', '{}', clock_timestamp(), clock_timestamp());
insert into public.profiles (id, email, display_name, store_id, role) values
('23000000-0000-0000-0000-000000000093', 'delete-manager@example.invalid', 'NFC 관리자', '13000000-0000-0000-0000-000000000093', 'store_admin'),
('23000000-0000-0000-0000-000000000094', 'delete-staff@example.invalid', 'NFC 직원', '13000000-0000-0000-0000-000000000093', 'staff');

set role authenticated;
select set_config('request.jwt.claim.sub', '23000000-0000-0000-0000-000000000093', true);
create temp table deleted_tag_check as select public.create_attendance_tag('삭제할 NFC') as created;
alter table deleted_tag_check add column event_id uuid;

select set_config('request.jwt.claim.sub', '23000000-0000-0000-0000-000000000094', true);
update deleted_tag_check set event_id = (public.begin_attendance_punch(created->>'token', '33000000-0000-0000-0000-000000000093')->>'id')::uuid;
select set_config('request.jwt.claim.sub', '23000000-0000-0000-0000-000000000093', true);
select public.delete_attendance_tag((created->>'id')::uuid) from deleted_tag_check;

do $$
declare s deleted_tag_check%rowtype;
begin
  select * into s from deleted_tag_check;
  if not exists (select 1 from public.attendance_tags where id = (s.created->>'id')::uuid and deleted_at is not null and not is_active) then
    raise exception 'tag was not deactivated and tombstoned';
  end if;
  if not exists (select 1 from public.attendance_punch_events where id = s.event_id and tag_id = (s.created->>'id')::uuid) then
    raise exception 'historic punch event was lost';
  end if;
  if (select count(*) from public.attendance_management_audit where entity_id = (s.created->>'id')::uuid and reason = 'NFC 태그 삭제') <> 1 then
    raise exception 'tag deletion was not audited exactly once';
  end if;
  if exists (select 1 from public.attendance_tags where id = (s.created->>'id')::uuid and deleted_at is null) then
    raise exception 'deleted tag remains visible to the active-tag filter';
  end if;
end;
$$;

select set_config('request.jwt.claim.sub', '23000000-0000-0000-0000-000000000094', true);
do $$
declare state text;
begin
  begin
    perform public.begin_attendance_punch((select created->>'token' from deleted_tag_check), '33000000-0000-0000-0000-000000000094');
  exception when others then get stacked diagnostics state = returned_sqlstate; end;
  if state is distinct from '42501' then raise exception 'deleted URL remained valid or returned wrong SQLSTATE: %', state; end if;
  state := null;
  begin
    perform public.delete_attendance_tag((select (created->>'id')::uuid from deleted_tag_check));
  exception when others then get stacked diagnostics state = returned_sqlstate; end;
  if state is distinct from '42501' then raise exception 'staff could delete a tag: %', state; end if;
end;
$$;

select set_config('request.jwt.claim.sub', '23000000-0000-0000-0000-000000000093', true);
do $$
declare state text;
begin
  begin
    perform public.rotate_attendance_tag((select (created->>'id')::uuid from deleted_tag_check), '재활성화 시도');
  exception when others then get stacked diagnostics state = returned_sqlstate; end;
  if state is distinct from '42501' then raise exception 'deleted tag was rotated: %', state; end if;
  state := null;
  begin
    perform public.delete_attendance_tag((select (created->>'id')::uuid from deleted_tag_check));
  exception when others then get stacked diagnostics state = returned_sqlstate; end;
  if state is distinct from '42501' then raise exception 'tag was deleted twice: %', state; end if;
end;
$$;
reset role;
rollback;
