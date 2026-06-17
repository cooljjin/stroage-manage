create or replace function public.get_store_invite_public(invite_token text)
returns table (
  email text,
  role text,
  store_name text,
  expires_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    invites.email,
    invites.role::text,
    stores.name as store_name,
    invites.expires_at
  from public.store_invites invites
  join public.stores stores on stores.id = invites.store_id
  where invites.token = invite_token
    and invites.accepted_at is null
    and invites.expires_at > now()
  limit 1;
$$;

grant execute on function public.get_store_invite_public(text) to anon, authenticated;

notify pgrst, 'reload schema';
