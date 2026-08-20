-- Run after a clean local migration reset. All fixtures are rolled back.

begin;

insert into public.stores (id, name) values
  ('12000000-0000-0000-0000-000000000001', '프로필 테스트 매장 A'),
  ('12000000-0000-0000-0000-000000000002', '프로필 테스트 매장 B');

insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
) values
  (
    '00000000-0000-0000-0000-000000000000',
    '22000000-0000-0000-0000-000000000001',
    'authenticated',
    'authenticated',
    'profile-admin-a@example.invalid',
    '',
    clock_timestamp(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    clock_timestamp(),
    clock_timestamp()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '22000000-0000-0000-0000-000000000002',
    'authenticated',
    'authenticated',
    'profile-staff-a@example.invalid',
    '',
    clock_timestamp(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    clock_timestamp(),
    clock_timestamp()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '22000000-0000-0000-0000-000000000003',
    'authenticated',
    'authenticated',
    'profile-admin-b@example.invalid',
    '',
    clock_timestamp(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    clock_timestamp(),
    clock_timestamp()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '22000000-0000-0000-0000-000000000004',
    'authenticated',
    'authenticated',
    'profile-master@example.invalid',
    '',
    clock_timestamp(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    clock_timestamp(),
    clock_timestamp()
  );

insert into public.profiles (
  id,
  email,
  display_name,
  store_id,
  role
) values
  (
    '22000000-0000-0000-0000-000000000001',
    'profile-admin-a@example.invalid',
    '프로필 테스트 관리자 A',
    '12000000-0000-0000-0000-000000000001',
    'store_admin'
  ),
  (
    '22000000-0000-0000-0000-000000000002',
    'spoofed-email@example.invalid',
    '프로필 테스트 직원 A',
    '12000000-0000-0000-0000-000000000001',
    'staff'
  ),
  (
    '22000000-0000-0000-0000-000000000003',
    'profile-admin-b@example.invalid',
    '프로필 테스트 관리자 B',
    '12000000-0000-0000-0000-000000000002',
    'store_admin'
  ),
  (
    '22000000-0000-0000-0000-000000000004',
    'profile-master@example.invalid',
    '프로필 테스트 master',
    '12000000-0000-0000-0000-000000000001',
    'master'
  );

set role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"22000000-0000-0000-0000-000000000002","role":"authenticated"}',
  true
);

do $$
declare
  directory_count integer;
  visible_peer_count integer;
  synced_email text;
begin
  select count(*) into directory_count
  from public.list_store_staff_directory();

  if directory_count <> 3 then
    raise exception 'staff directory did not stay within the requester store';
  end if;

  select count(*) into visible_peer_count
  from public.profiles profile
  where profile.id <> auth.uid();

  if visible_peer_count <> 0 then
    raise exception 'staff can read another full profile row';
  end if;

  select (public.sync_my_profile_email()).email into synced_email;
  if synced_email <> 'profile-staff-a@example.invalid' then
    raise exception 'profile email was not synchronized from auth.users';
  end if;

  if (public.get_my_profile()).email <> 'profile-staff-a@example.invalid' then
    raise exception 'user cannot read their own synchronized profile';
  end if;

  begin
    perform public.list_store_staff_admin();
    raise exception 'staff unexpectedly read the administrative directory';
  exception
    when others then
      if sqlerrm = 'staff unexpectedly read the administrative directory' then
        raise;
      end if;
  end;

  begin
    perform public.update_store_staff_display_name(
      '22000000-0000-0000-0000-000000000002',
      '허용되면 안 되는 변경'
    );
    raise exception 'staff unexpectedly changed a profile through the admin API';
  exception
    when others then
      if sqlerrm = 'staff unexpectedly changed a profile through the admin API' then
        raise;
      end if;
  end;

  begin
    perform public.update_staff_profile_admin(
      '22000000-0000-0000-0000-000000000002',
      '허용되면 안 되는 변경',
      '12000000-0000-0000-0000-000000000002'
    );
    raise exception 'staff unexpectedly called the master profile API';
  exception
    when others then
      if sqlerrm = 'staff unexpectedly called the master profile API' then
        raise;
      end if;
  end;
end;
$$;

select set_config(
  'request.jwt.claims',
  '{"sub":"22000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);

do $$
declare
  admin_directory_count integer;
  updated_name text;
begin
  select count(*) into admin_directory_count
  from public.list_store_staff_admin();

  if admin_directory_count <> 3 then
    raise exception 'store admin directory crossed the store boundary';
  end if;

  select (public.update_store_staff_display_name(
    '22000000-0000-0000-0000-000000000002',
    '  수정된 직원 이름  '
  )).display_name into updated_name;

  if updated_name <> '수정된 직원 이름' then
    raise exception 'store admin display-name update was not normalized';
  end if;

  begin
    perform public.update_store_staff_display_name(
      '22000000-0000-0000-0000-000000000003',
      '다른 매장 변경 시도'
    );
    raise exception 'store admin unexpectedly changed another store profile';
  exception
    when others then
      if sqlerrm = 'store admin unexpectedly changed another store profile' then
        raise;
      end if;
  end;

  begin
    perform public.update_store_staff_display_name(
      '22000000-0000-0000-0000-000000000004',
      'master 변경 시도'
    );
    raise exception 'store admin unexpectedly changed a master profile';
  exception
    when others then
      if sqlerrm = 'store admin unexpectedly changed a master profile' then
        raise;
      end if;
  end;
end;
$$;

select set_config(
  'request.jwt.claims',
  '{"sub":"22000000-0000-0000-0000-000000000004","role":"authenticated"}',
  true
);

do $$
declare
  all_profile_count integer;
  moved_store_id uuid;
begin
  select count(*) into all_profile_count
  from public.list_store_staff_admin();

  if all_profile_count <> 4 then
    raise exception 'master did not receive the complete administrative directory';
  end if;

  select (public.update_staff_profile_admin(
    '22000000-0000-0000-0000-000000000002',
    'master가 수정한 직원',
    '12000000-0000-0000-0000-000000000002'
  )).store_id into moved_store_id;

  if moved_store_id <> '12000000-0000-0000-0000-000000000002' then
    raise exception 'master profile assignment update failed';
  end if;
end;
$$;

reset role;

rollback;
