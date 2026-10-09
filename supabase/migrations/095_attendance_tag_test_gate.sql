-- Forward-only correction: the hosted DB role cannot ALTER DATABASE to set a custom GUC.
-- Empty in every DB by default; insert one row ONLY into approved staging.
create schema if not exists stockly_private;
create table if not exists stockly_private.attendance_tag_test_enabled (enabled boolean primary key default true check (enabled));
revoke all on schema stockly_private from public, anon, authenticated;
revoke all on stockly_private.attendance_tag_test_enabled from public, anon, authenticated;

create or replace function public.begin_attendance_tag_test(target_tag_id uuid, request_id uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  caller_profile public.profiles;
  matched_tag public.attendance_tags;
  pending public.attendance_punch_events;
  kind text;
begin
  if target_tag_id is null or request_id is null then
    raise exception using errcode = '22023', message = '유효하지 않은 테스트 요청입니다.';
  end if;
  select * into caller_profile from public.profiles where id = auth.uid();
  if not exists (select 1 from stockly_private.attendance_tag_test_enabled)
     or caller_profile.id is null or not public.attendance_manager(caller_profile.store_id)
     or not exists (select 1 from public.stores where id = caller_profile.store_id and name in ('테스트 매장', '테스트점')) then
    raise exception using errcode = '42501', message = '테스트 매장 관리자만 태그를 테스트할 수 있습니다.';
  end if;
  select * into matched_tag from public.attendance_tags
  where id = target_tag_id and store_id = caller_profile.store_id and is_active and deleted_at is null;
  if matched_tag.id is null then
    raise exception using errcode = '42501', message = '이 매장에 등록된 활성 NFC 태그가 아닙니다.';
  end if;

  update public.attendance_punch_events set status = 'expired'
  where user_id = auth.uid() and status = 'pending' and expires_at <= clock_timestamp();
  select * into pending from public.attendance_punch_events
  where user_id = auth.uid() and attendance_punch_events.request_id = begin_attendance_tag_test.request_id;
  if pending.id is not null and pending.tag_id <> matched_tag.id then
    raise exception using errcode = '22023', message = '다른 태그의 테스트 요청과 중복됩니다.';
  end if;
  if pending.id is not null then return public.attendance_punch_prompt(pending.id); end if;
  select * into pending from public.attendance_punch_events
  where user_id = auth.uid() and status = 'pending' order by created_at desc limit 1;
  if pending.id is not null then
    if pending.tag_id <> matched_tag.id then
      raise exception using errcode = '22023', message = '이전 태그의 출퇴근 입력을 먼저 완료해 주세요.';
    end if;
    return public.get_my_pending_attendance_punch();
  end if;

  if exists (select 1 from public.attendance_shifts
    where user_id = auth.uid() and store_id = caller_profile.store_id and confirmed_check_out_at is null)
  then kind := 'check_out'; else kind := 'check_in'; end if;
  insert into public.attendance_punch_events (store_id, user_id, tag_id, punch_type, request_id)
  values (matched_tag.store_id, auth.uid(), matched_tag.id, kind, request_id);
  return public.get_my_pending_attendance_punch();
exception when unique_violation then
  select * into pending from public.attendance_punch_events
  where user_id = auth.uid() and attendance_punch_events.request_id = begin_attendance_tag_test.request_id;
  return coalesce(public.attendance_punch_prompt(pending.id), public.get_my_pending_attendance_punch());
end;
$$;
revoke all on function public.begin_attendance_tag_test(uuid, uuid) from public, anon;
grant execute on function public.begin_attendance_tag_test(uuid, uuid) to authenticated;
