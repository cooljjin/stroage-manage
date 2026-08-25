-- Profile reads are already split by audience. Move the remaining client
-- writes behind server-owned APIs before table UPDATE is removed at the final
-- native release gate.

create or replace function public.sync_my_profile_email()
returns public.profiles
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  authoritative_email text;
  profile_row public.profiles%rowtype;
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.';
  end if;

  select auth_user.email
  into authoritative_email
  from auth.users auth_user
  where auth_user.id = auth.uid();

  if not found then
    raise exception '인증 사용자를 찾을 수 없습니다.';
  end if;

  update public.profiles profile
  set email = authoritative_email,
      updated_at = clock_timestamp()
  where profile.id = auth.uid()
  returning * into profile_row;

  if not found then
    raise exception '사용자 프로필을 찾을 수 없습니다.';
  end if;

  return profile_row;
end;
$$;

create or replace function public.update_store_staff_display_name(
  target_user_id uuid,
  target_display_name text
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  target_profile public.profiles%rowtype;
  normalized_display_name text := trim(coalesce($2, ''));
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.';
  end if;
  if char_length(normalized_display_name) not between 1 and 100 then
    raise exception '직원 이름은 1자부터 100자까지 입력해 주세요.';
  end if;

  select * into target_profile
  from public.profiles profile
  where profile.id = target_user_id
  for update;

  if not found then
    raise exception '직원 프로필을 찾을 수 없습니다.';
  end if;
  if target_profile.role = 'master'
    and not public.is_master(auth.uid()) then
    raise exception 'master 프로필은 수정할 수 없습니다.';
  end if;
  if not public.is_master(auth.uid())
    and (
      public.current_role(auth.uid()) <> 'store_admin'
      or public.current_store_id(auth.uid()) <> target_profile.store_id
    ) then
    raise exception '직원 이름을 수정할 권한이 없습니다.';
  end if;

  update public.profiles profile
  set display_name = normalized_display_name,
      updated_at = clock_timestamp()
  where profile.id = target_profile.id
  returning * into target_profile;

  return target_profile;
end;
$$;

create or replace function public.update_staff_profile_admin(
  target_user_id uuid,
  target_display_name text,
  target_store_id uuid
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  target_profile public.profiles%rowtype;
  normalized_display_name text := trim(coalesce($2, ''));
begin
  if auth.uid() is null or not public.is_master(auth.uid()) then
    raise exception 'master만 사용자 정보를 수정할 수 있습니다.';
  end if;
  if char_length(normalized_display_name) not between 1 and 100 then
    raise exception '사용자 이름은 1자부터 100자까지 입력해 주세요.';
  end if;
  if not exists (
    select 1
    from public.stores store
    where store.id = target_store_id
  ) then
    raise exception '배정할 매장을 찾을 수 없습니다.';
  end if;

  select * into target_profile
  from public.profiles profile
  where profile.id = target_user_id
  for update;

  if not found then
    raise exception '사용자 프로필을 찾을 수 없습니다.';
  end if;

  update public.profiles profile
  set display_name = normalized_display_name,
      store_id = target_store_id,
      updated_at = clock_timestamp()
  where profile.id = target_profile.id
  returning * into target_profile;

  return target_profile;
end;
$$;

revoke all on function public.sync_my_profile_email()
from public, anon;
revoke all on function public.update_store_staff_display_name(uuid, text)
from public, anon;
revoke all on function public.update_staff_profile_admin(uuid, text, uuid)
from public, anon;

grant execute on function public.sync_my_profile_email()
to authenticated;
grant execute on function public.update_store_staff_display_name(uuid, text)
to authenticated;
grant execute on function public.update_staff_profile_admin(uuid, text, uuid)
to authenticated;

notify pgrst, 'reload schema';
