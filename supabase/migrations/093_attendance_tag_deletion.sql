alter table public.attendance_tags add column deleted_at timestamptz;
alter table public.attendance_tags add constraint attendance_tags_deleted_inactive check (deleted_at is null or not is_active);

create or replace function public.prevent_deleted_attendance_tag_mutation()
returns trigger language plpgsql set search_path = pg_catalog, public, pg_temp as $$
begin
  if old.deleted_at is not null then
    raise exception using errcode = '42501', message = '삭제된 NFC 태그는 변경할 수 없습니다.';
  end if;
  return new;
end;
$$;

create trigger attendance_tag_deleted_immutable
before update on public.attendance_tags
for each row execute function public.prevent_deleted_attendance_tag_mutation();

create or replace function public.delete_attendance_tag(target_tag_id uuid)
returns public.attendance_tags language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare before_row public.attendance_tags; changed public.attendance_tags;
begin
  select * into before_row from public.attendance_tags where id = target_tag_id for update;
  if before_row.id is null or before_row.deleted_at is not null or not public.attendance_manager(before_row.store_id) then
    raise exception using errcode = '42501', message = '태그를 찾을 수 없거나 권한이 없습니다.';
  end if;
  update public.attendance_tags set is_active = false, deleted_at = clock_timestamp(), updated_at = clock_timestamp()
  where id = target_tag_id returning * into changed;
  perform public.audit_attendance_management(changed.store_id, 'tag', changed.id, 'NFC 태그 삭제', to_jsonb(before_row), to_jsonb(changed));
  return changed;
end;
$$;

revoke all on function public.prevent_deleted_attendance_tag_mutation() from public, anon, authenticated;
revoke all on function public.delete_attendance_tag(uuid) from public, anon;
grant execute on function public.delete_attendance_tag(uuid) to authenticated;

notify pgrst, 'reload schema';
