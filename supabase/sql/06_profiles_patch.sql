create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text not null,
  is_admin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.is_admin(user_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as 'select exists (select 1 from public.profiles where id = user_id and is_admin = true)';

insert into public.profiles (id, email, display_name, is_admin)
values ('dbe00a19-300b-4677-9339-225e52f2909b', 'jich980611@gmail.com', 'jinkim', true)
on conflict (id) do update
set email = excluded.email,
    display_name = coalesce(nullif(public.profiles.display_name, ''''), excluded.display_name),
    is_admin = true,
    updated_at = now();

alter table public.profiles enable row level security;

drop policy if exists "Authenticated users can read profiles" on public.profiles;
create policy "Authenticated users can read profiles"
on public.profiles for select
to authenticated
using (true);

drop policy if exists "Users can insert own profile" on public.profiles;
create policy "Users can insert own profile"
on public.profiles for insert
to authenticated
with check (id = auth.uid());

drop policy if exists "Admins can update profiles" on public.profiles;
create policy "Admins can update profiles"
on public.profiles for update
to authenticated
using (public.is_admin(auth.uid()))
with check (public.is_admin(auth.uid()));

grant select, insert, update on public.profiles to authenticated;
grant execute on function public.is_admin(uuid) to authenticated;

notify pgrst, 'reload schema';
