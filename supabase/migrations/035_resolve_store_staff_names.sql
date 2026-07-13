create or replace function public.resolve_store_staff_names(target_store_id uuid, user_ids uuid[])
returns table(user_id uuid, display_name text)
language sql
security definer
stable
set search_path = public, auth
as $$
  with requested_users as (
    select distinct unnest(user_ids) as user_id
  ),
  auth_emails as (
    select requested_users.user_id, lower(auth_users.email) as email
    from requested_users
    left join auth.users auth_users
      on auth_users.id = requested_users.user_id
  )
  select
    requested_users.user_id,
    coalesce(
      nullif(profile_by_id.display_name, ''),
      nullif(profile_by_email.display_name, ''),
      nullif(split_part(auth_emails.email, '@', 1), ''),
      '직원'
    ) as display_name
  from requested_users
  left join public.profiles profile_by_id
    on profile_by_id.id = requested_users.user_id
   and profile_by_id.store_id = target_store_id
  left join auth_emails
    on auth_emails.user_id = requested_users.user_id
  left join public.profiles profile_by_email
    on auth_emails.email is not null
   and lower(profile_by_email.email) = auth_emails.email
   and profile_by_email.store_id = target_store_id
  where target_store_id = public.current_store_id(auth.uid())
     or public.is_master(auth.uid());
$$;

grant execute on function public.resolve_store_staff_names(uuid, uuid[]) to authenticated;

