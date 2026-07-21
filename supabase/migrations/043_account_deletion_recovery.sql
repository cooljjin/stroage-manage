-- Self-service account deletion: a sole-owner store is retained for 30 days,
-- while a shared store must be handed to another administrator first.
alter table public.stores
  add column if not exists created_by uuid references auth.users(id) on delete set null,
  add column if not exists deletion_requested_at timestamptz,
  add column if not exists purge_after timestamptz;

alter table public.profiles
  add column if not exists deletion_requested_at timestamptz;

alter table public.stores drop constraint if exists stores_status_check;
alter table public.stores
  add constraint stores_status_check
  check (status in ('active', 'inactive', 'pending_deletion'));

-- Old stores have no explicit creator. A store with exactly one member can be
-- safely treated as that member's personal store.
update public.stores stores
set created_by = members.id
from (
  select store_id, (array_agg(id))[1] as id
  from public.profiles
  group by store_id
  having count(*) = 1
) members
where stores.id = members.store_id
  and stores.created_by is null;

-- A final personal-store purge deletes the store and its scoped data. Make all
-- direct store references cascade so future store-scoped tables are not left
-- behind by a deleted store.
do $$
declare
  item record;
  definition text;
begin
  for item in
    select oid, conrelid::regclass as table_name, conname
    from pg_constraint
    where contype = 'f'
      and confrelid = 'public.stores'::regclass
  loop
    definition := pg_get_constraintdef(item.oid);
    definition := regexp_replace(definition, ' ON DELETE (RESTRICT|NO ACTION|SET NULL|SET DEFAULT)', ' ON DELETE CASCADE', 'i');
    if definition !~* ' ON DELETE ' then
      definition := definition || ' ON DELETE CASCADE';
    end if;
    execute format('alter table %s drop constraint %I, add constraint %I %s', item.table_name, item.conname, item.conname, definition);
  end loop;
end $$;

-- Audit rows remain after an account is deleted, with the actor anonymized.
-- The profile primary key is intentionally excluded because it must still
-- cascade when its auth user is removed.
do $$
declare
  item record;
  definition text;
begin
  for item in
    select c.oid, c.conrelid::regclass as table_name, c.conname, a.attname
    from pg_constraint c
    join pg_class rel on rel.oid = c.conrelid
    join pg_namespace schema on schema.oid = rel.relnamespace
    join unnest(c.conkey) as keys(attnum) on true
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = keys.attnum
    where c.contype = 'f'
      and c.confrelid = 'auth.users'::regclass
      and schema.nspname = 'public'
      and not (c.conrelid = 'public.profiles'::regclass and a.attname = 'id')
  loop
    execute format('alter table %s alter column %I drop not null', item.table_name, item.attname);
    definition := pg_get_constraintdef(item.oid);
    definition := regexp_replace(definition, ' ON DELETE (RESTRICT|NO ACTION|CASCADE|SET DEFAULT)', ' ON DELETE SET NULL', 'i');
    if definition !~* ' ON DELETE ' then
      definition := definition || ' ON DELETE SET NULL';
    end if;
    execute format('alter table %s drop constraint %I, add constraint %I %s', item.table_name, item.conname, item.conname, definition);
  end loop;
end $$;

create index if not exists stores_pending_deletion_purge_after_idx
on public.stores (purge_after)
where status = 'pending_deletion';

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

  insert into public.stores (name, created_by)
  values (normalized_name, auth.uid())
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

notify pgrst, 'reload schema';
