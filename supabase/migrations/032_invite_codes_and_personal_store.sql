alter table public.store_invites
  alter column email drop not null,
  alter column expires_at set default (now() + interval '7 days');

alter table public.store_invites
  drop constraint if exists store_invites_email_check;

alter table public.store_invites
  add column if not exists max_uses integer not null default 1 check (max_uses > 0),
  add column if not exists used_count integer not null default 0 check (used_count >= 0),
  add column if not exists revoked_at timestamptz;

create or replace function public.generate_invite_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  code text;
  index_value integer;
begin
  code := '';
  for index_value in 1..8 loop
    code := code || substr(alphabet, floor(random() * length(alphabet) + 1)::integer, 1);
  end loop;
  return code;
end;
$$;

drop function if exists public.create_store_invite(text, public.profile_role);
drop function if exists public.create_store_invite(public.profile_role);

create or replace function public.create_store_invite(target_role public.profile_role default 'staff')
returns public.store_invites
language plpgsql
security definer
set search_path = public
as $$
declare
  requester public.profiles%rowtype;
  created_invite public.store_invites%rowtype;
  next_code text;
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.';
  end if;

  select * into requester from public.profiles where id = auth.uid();
  if not found or requester.role not in ('master', 'store_admin') then
    raise exception '초대 권한이 없습니다.';
  end if;

  if target_role not in ('store_admin', 'staff') then
    raise exception '초대할 수 없는 권한입니다.';
  end if;

  loop
    next_code := public.generate_invite_code();
    exit when not exists (select 1 from public.store_invites where token = next_code);
  end loop;

  insert into public.store_invites (store_id, email, role, token, invited_by, expires_at, max_uses, used_count)
  values (requester.store_id, null, target_role, next_code, auth.uid(), now() + interval '7 days', 1, 0)
  returning * into created_invite;

  return created_invite;
end;
$$;

drop function if exists public.accept_store_invite(text);
drop function if exists public.accept_store_invite_code(text);

create or replace function public.accept_store_invite_code(invite_code text)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  invite public.store_invites%rowtype;
  auth_email text;
  accepted_profile public.profiles%rowtype;
  normalized_code text;
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.';
  end if;

  if exists (select 1 from public.profiles where id = auth.uid()) then
    raise exception '이미 매장에 소속된 계정입니다.';
  end if;

  normalized_code := upper(regexp_replace(coalesce(invite_code, ''), '\s+', '', 'g'));

  select *
  into invite
  from public.store_invites
  where token = normalized_code
    and accepted_at is null
    and revoked_at is null
    and expires_at > now()
    and used_count < max_uses
  for update;

  if not found then
    raise exception '유효하지 않거나 만료된 초대코드입니다.';
  end if;

  select email into auth_email from auth.users where id = auth.uid();
  perform set_config('app.bypass_profile_guard', 'on', true);

  insert into public.profiles (id, store_id, email, display_name, role, invited_by)
  values (
    auth.uid(),
    invite.store_id,
    auth_email,
    coalesce(nullif(split_part(coalesce(auth_email, ''), '@', 1), ''), '직원'),
    invite.role,
    invite.invited_by
  )
  returning * into accepted_profile;

  update public.store_invites
  set used_count = used_count + 1,
      accepted_by = case when max_uses = 1 then auth.uid() else accepted_by end,
      accepted_at = case when max_uses = 1 then now() else accepted_at end
  where id = invite.id;

  return accepted_profile;
end;
$$;

drop function if exists public.create_personal_store(text);

create or replace function public.create_personal_store(store_name text)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  auth_email text;
  created_store public.stores%rowtype;
  created_profile public.profiles%rowtype;
  normalized_name text;
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.';
  end if;

  if exists (select 1 from public.profiles where id = auth.uid()) then
    raise exception '이미 매장에 소속된 계정입니다.';
  end if;

  normalized_name := trim(coalesce(store_name, ''));
  if char_length(normalized_name) = 0 then
    raise exception '매장 이름을 입력해 주세요.';
  end if;

  select email into auth_email from auth.users where id = auth.uid();

  insert into public.stores (name)
  values (normalized_name)
  returning * into created_store;

  perform set_config('app.bypass_profile_guard', 'on', true);

  insert into public.profiles (id, store_id, email, display_name, role)
  values (
    auth.uid(),
    created_store.id,
    auth_email,
    coalesce(nullif(split_part(coalesce(auth_email, ''), '@', 1), ''), '관리자'),
    'store_admin'
  )
  returning * into created_profile;

  return created_profile;
end;
$$;

revoke execute on function public.get_store_invite_public(text) from anon, authenticated;
grant execute on function public.generate_invite_code() to authenticated;
grant execute on function public.create_store_invite(public.profile_role) to authenticated;
grant execute on function public.accept_store_invite_code(text) to authenticated;
grant execute on function public.create_personal_store(text) to authenticated;

notify pgrst, 'reload schema';
