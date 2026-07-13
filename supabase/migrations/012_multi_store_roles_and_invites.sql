do $$
begin
  create type public.profile_role as enum ('master', 'store_admin', 'staff');
exception
  when duplicate_object then null;
end $$;

create table if not exists public.stores (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) > 0),
  business_name text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.stores (id, name)
values ('00000000-0000-0000-0000-000000000001', '기본 매장')
on conflict (id) do nothing;

alter table public.profiles
  add column if not exists store_id uuid references public.stores(id) on delete restrict,
  add column if not exists role public.profile_role not null default 'staff',
  add column if not exists invited_by uuid references auth.users(id) on delete set null;

update public.profiles
set store_id = '00000000-0000-0000-0000-000000000001'
where store_id is null;

update public.profiles
set role = case
  when is_admin = true then 'store_admin'::public.profile_role
  else role
end;

alter table public.profiles alter column store_id set not null;

alter table public.products add column if not exists store_id uuid references public.stores(id) on delete restrict;
alter table public.categories add column if not exists store_id uuid references public.stores(id) on delete restrict;
alter table public.suppliers add column if not exists store_id uuid references public.stores(id) on delete restrict;
alter table public.product_barcodes add column if not exists store_id uuid references public.stores(id) on delete restrict;
alter table public.inventory add column if not exists store_id uuid references public.stores(id) on delete restrict;
alter table public.inventory_logs add column if not exists store_id uuid references public.stores(id) on delete restrict;
alter table public.dashboard_todos add column if not exists store_id uuid references public.stores(id) on delete restrict;
alter table public.handover_notes add column if not exists store_id uuid references public.stores(id) on delete restrict;
alter table public.weekly_store_closures add column if not exists store_id uuid references public.stores(id) on delete restrict;
alter table public.store_closure_dates add column if not exists store_id uuid references public.stores(id) on delete restrict;
alter table public.dashboard_receipt_deletions add column if not exists store_id uuid references public.stores(id) on delete restrict;

update public.products set store_id = '00000000-0000-0000-0000-000000000001' where store_id is null;
update public.categories set store_id = '00000000-0000-0000-0000-000000000001' where store_id is null;
update public.suppliers set store_id = '00000000-0000-0000-0000-000000000001' where store_id is null;
update public.product_barcodes set store_id = '00000000-0000-0000-0000-000000000001' where store_id is null;
update public.inventory set store_id = '00000000-0000-0000-0000-000000000001' where store_id is null;
update public.inventory_logs set store_id = '00000000-0000-0000-0000-000000000001' where store_id is null;
update public.dashboard_todos set store_id = '00000000-0000-0000-0000-000000000001' where store_id is null;
update public.handover_notes set store_id = '00000000-0000-0000-0000-000000000001' where store_id is null;
update public.weekly_store_closures set store_id = '00000000-0000-0000-0000-000000000001' where store_id is null;
update public.store_closure_dates set store_id = '00000000-0000-0000-0000-000000000001' where store_id is null;
update public.dashboard_receipt_deletions set store_id = '00000000-0000-0000-0000-000000000001' where store_id is null;

alter table public.products alter column store_id set not null;
alter table public.categories alter column store_id set not null;
alter table public.suppliers alter column store_id set not null;
alter table public.product_barcodes alter column store_id set not null;
alter table public.inventory alter column store_id set not null;
alter table public.inventory_logs alter column store_id set not null;
alter table public.dashboard_todos alter column store_id set not null;
alter table public.handover_notes alter column store_id set not null;
alter table public.weekly_store_closures alter column store_id set not null;
alter table public.store_closure_dates alter column store_id set not null;
alter table public.dashboard_receipt_deletions alter column store_id set not null;

create index if not exists profiles_store_id_idx on public.profiles (store_id);
create index if not exists products_store_id_idx on public.products (store_id);
create index if not exists categories_store_id_idx on public.categories (store_id);
create index if not exists suppliers_store_id_idx on public.suppliers (store_id);
create index if not exists inventory_store_id_idx on public.inventory (store_id);
create index if not exists inventory_logs_store_id_idx on public.inventory_logs (store_id);
create index if not exists dashboard_todos_store_date_idx on public.dashboard_todos (store_id, task_date, created_at);
create index if not exists handover_notes_store_date_idx on public.handover_notes (store_id, handover_date desc, created_at desc);
create index if not exists weekly_store_closures_store_weekday_idx on public.weekly_store_closures (store_id, weekday);
create index if not exists store_closure_dates_store_date_idx on public.store_closure_dates (store_id, closure_date);

alter table public.products drop constraint if exists products_barcode_key;
alter table public.categories drop constraint if exists categories_name_key;
alter table public.suppliers drop constraint if exists suppliers_name_key;
alter table public.product_barcodes drop constraint if exists product_barcodes_barcode_key;
alter table public.weekly_store_closures drop constraint if exists weekly_store_closures_pkey;
alter table public.store_closure_dates drop constraint if exists store_closure_dates_pkey;

create unique index if not exists products_store_barcode_unique
on public.products (store_id, barcode)
where barcode is not null;

create unique index if not exists categories_store_name_unique
on public.categories (store_id, name);

create unique index if not exists suppliers_store_name_unique
on public.suppliers (store_id, name);

create unique index if not exists product_barcodes_store_barcode_unique
on public.product_barcodes (store_id, barcode);

create unique index if not exists weekly_store_closures_store_weekday_unique
on public.weekly_store_closures (store_id, weekday);

create unique index if not exists store_closure_dates_store_date_unique
on public.store_closure_dates (store_id, closure_date);

create table if not exists public.store_invites (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  email text not null,
  role public.profile_role not null default 'staff' check (role in ('store_admin', 'staff')),
  token text not null unique default encode(gen_random_bytes(32), 'hex'),
  invited_by uuid not null references auth.users(id) on delete restrict,
  accepted_by uuid references auth.users(id) on delete set null,
  accepted_at timestamptz,
  expires_at timestamptz not null default (now() + interval '14 days'),
  created_at timestamptz not null default now(),
  check (char_length(trim(email)) > 0)
);

create index if not exists store_invites_store_id_idx on public.store_invites (store_id);
create index if not exists store_invites_token_idx on public.store_invites (token);

create or replace function public.current_store_id(user_id uuid)
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select store_id from public.profiles where id = user_id
$$;

create or replace function public.current_role(user_id uuid)
returns public.profile_role
language sql
security definer
stable
set search_path = public
as $$
  select role from public.profiles where id = user_id
$$;

create or replace function public.is_master(user_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (select 1 from public.profiles where id = user_id and role = 'master')
$$;

create or replace function public.is_store_admin(user_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (select 1 from public.profiles where id = user_id and role in ('master', 'store_admin'))
$$;

create or replace function public.can_access_store(target_store_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select public.is_master(auth.uid()) or target_store_id = public.current_store_id(auth.uid())
$$;

create or replace function public.can_admin_store(target_store_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select public.is_master(auth.uid())
    or (target_store_id = public.current_store_id(auth.uid()) and public.current_role(auth.uid()) = 'store_admin')
$$;

create or replace function public.fill_current_store_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.store_id is null then
    new.store_id := public.current_store_id(auth.uid());
  end if;

  if new.store_id is null then
    raise exception '매장 정보가 필요합니다.';
  end if;

  return new;
end;
$$;

drop trigger if exists fill_products_store_id on public.products;
create trigger fill_products_store_id before insert on public.products
for each row execute function public.fill_current_store_id();

drop trigger if exists fill_categories_store_id on public.categories;
create trigger fill_categories_store_id before insert on public.categories
for each row execute function public.fill_current_store_id();

drop trigger if exists fill_suppliers_store_id on public.suppliers;
create trigger fill_suppliers_store_id before insert on public.suppliers
for each row execute function public.fill_current_store_id();

drop trigger if exists fill_product_barcodes_store_id on public.product_barcodes;
create trigger fill_product_barcodes_store_id before insert on public.product_barcodes
for each row execute function public.fill_current_store_id();

drop trigger if exists fill_inventory_store_id on public.inventory;
create trigger fill_inventory_store_id before insert on public.inventory
for each row execute function public.fill_current_store_id();

drop trigger if exists fill_inventory_logs_store_id on public.inventory_logs;
create trigger fill_inventory_logs_store_id before insert on public.inventory_logs
for each row execute function public.fill_current_store_id();

drop trigger if exists fill_dashboard_todos_store_id on public.dashboard_todos;
create trigger fill_dashboard_todos_store_id before insert on public.dashboard_todos
for each row execute function public.fill_current_store_id();

drop trigger if exists fill_handover_notes_store_id on public.handover_notes;
create trigger fill_handover_notes_store_id before insert on public.handover_notes
for each row execute function public.fill_current_store_id();

drop trigger if exists fill_weekly_store_closures_store_id on public.weekly_store_closures;
create trigger fill_weekly_store_closures_store_id before insert on public.weekly_store_closures
for each row execute function public.fill_current_store_id();

drop trigger if exists fill_store_closure_dates_store_id on public.store_closure_dates;
create trigger fill_store_closure_dates_store_id before insert on public.store_closure_dates
for each row execute function public.fill_current_store_id();

drop trigger if exists fill_dashboard_receipt_deletions_store_id on public.dashboard_receipt_deletions;
create trigger fill_dashboard_receipt_deletions_store_id before insert on public.dashboard_receipt_deletions
for each row execute function public.fill_current_store_id();

create or replace function public.is_admin(user_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (select 1 from public.profiles where id = user_id and role in ('master', 'store_admin'))
$$;

create or replace function public.guard_profile_privilege_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_setting('app.bypass_profile_guard', true) = 'on' then
    return new;
  end if;

  if auth.uid() is not null and not public.is_master(auth.uid()) then
    new.store_id := old.store_id;
    new.role := old.role;
    new.invited_by := old.invited_by;
    new.is_admin := old.is_admin;
  end if;

  return new;
end;
$$;

drop trigger if exists guard_profile_privilege_fields on public.profiles;
create trigger guard_profile_privilege_fields
before update on public.profiles
for each row
execute function public.guard_profile_privilege_fields();

create or replace function public.create_store_invite(target_email text, target_role public.profile_role default 'staff')
returns public.store_invites
language plpgsql
security definer
set search_path = public
as $$
declare
  requester public.profiles%rowtype;
  created_invite public.store_invites%rowtype;
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

  update public.store_invites
  set accepted_at = now()
  where store_id = requester.store_id
    and lower(email) = lower(trim(target_email))
    and accepted_at is null;

  insert into public.store_invites (store_id, email, role, invited_by)
  values (requester.store_id, lower(trim(target_email)), target_role, auth.uid())
  returning * into created_invite;

  return created_invite;
end;
$$;

create or replace function public.accept_store_invite(invite_token text)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  invite public.store_invites%rowtype;
  auth_email text;
  accepted_profile public.profiles%rowtype;
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.';
  end if;

  select email into auth_email from auth.users where id = auth.uid();

  select *
  into invite
  from public.store_invites
  where token = invite_token
    and accepted_at is null
    and expires_at > now()
  for update;

  if not found then
    raise exception '유효하지 않거나 만료된 초대입니다.';
  end if;

  if lower(coalesce(auth_email, '')) <> lower(invite.email) then
    raise exception '초대받은 이메일 계정으로 로그인해야 합니다.';
  end if;

  perform set_config('app.bypass_profile_guard', 'on', true);

  insert into public.profiles (id, store_id, email, display_name, role, invited_by)
  values (auth.uid(), invite.store_id, auth_email, split_part(auth_email, '@', 1), invite.role, invite.invited_by)
  on conflict (id) do update set
    store_id = excluded.store_id,
    email = excluded.email,
    role = excluded.role,
    invited_by = excluded.invited_by,
    updated_at = now()
  returning * into accepted_profile;

  update public.store_invites
  set accepted_by = auth.uid(),
      accepted_at = now()
  where id = invite.id;

  return accepted_profile;
end;
$$;

alter table public.stores enable row level security;
alter table public.store_invites enable row level security;

drop policy if exists "Users can read accessible stores" on public.stores;
create policy "Users can read accessible stores" on public.stores for select to authenticated
using (public.is_master(auth.uid()) or id = public.current_store_id(auth.uid()));

drop policy if exists "Masters can manage stores" on public.stores;
create policy "Masters can manage stores" on public.stores for all to authenticated
using (public.is_master(auth.uid()))
with check (public.is_master(auth.uid()));

drop policy if exists "Admins can read invites in their store" on public.store_invites;
create policy "Admins can read invites in their store" on public.store_invites for select to authenticated
using (public.can_admin_store(store_id) or accepted_by = auth.uid());

drop policy if exists "Admins can create invites in their store" on public.store_invites;
create policy "Admins can create invites in their store" on public.store_invites for insert to authenticated
with check (public.can_admin_store(store_id) and invited_by = auth.uid());

drop policy if exists "Admins can revoke invites in their store" on public.store_invites;
create policy "Admins can revoke invites in their store" on public.store_invites for delete to authenticated
using (public.can_admin_store(store_id) and accepted_at is null);

drop policy if exists "Authenticated users can read products" on public.products;
drop policy if exists "Authenticated users can insert products" on public.products;
drop policy if exists "Authenticated users can update products" on public.products;
drop policy if exists "Authenticated users can delete inactive products" on public.products;
drop policy if exists "Users can read products in their store" on public.products;
drop policy if exists "Users can insert products in their store" on public.products;
drop policy if exists "Users can update products in their store" on public.products;
drop policy if exists "Users can delete inactive products in their store" on public.products;
create policy "Users can read products in their store" on public.products for select to authenticated using (public.can_access_store(store_id));
create policy "Users can insert products in their store" on public.products for insert to authenticated with check (public.can_access_store(store_id));
create policy "Users can update products in their store" on public.products for update to authenticated using (public.can_access_store(store_id)) with check (public.can_access_store(store_id));
create policy "Users can delete inactive products in their store" on public.products for delete to authenticated using (public.can_access_store(store_id) and is_active = false);

drop policy if exists "Authenticated users can read categories" on public.categories;
drop policy if exists "Authenticated users can insert categories" on public.categories;
drop policy if exists "Authenticated users can update categories" on public.categories;
drop policy if exists "Authenticated users can delete inactive categories" on public.categories;
drop policy if exists "Users can read categories in their store" on public.categories;
drop policy if exists "Admins can insert categories in their store" on public.categories;
drop policy if exists "Admins can update categories in their store" on public.categories;
drop policy if exists "Admins can delete inactive categories in their store" on public.categories;
create policy "Users can read categories in their store" on public.categories for select to authenticated using (public.can_access_store(store_id));
create policy "Admins can insert categories in their store" on public.categories for insert to authenticated with check (public.can_admin_store(store_id));
create policy "Admins can update categories in their store" on public.categories for update to authenticated using (public.can_admin_store(store_id)) with check (public.can_admin_store(store_id));
create policy "Admins can delete inactive categories in their store" on public.categories for delete to authenticated using (public.can_admin_store(store_id) and is_active = false);

drop policy if exists "Authenticated users can read suppliers" on public.suppliers;
drop policy if exists "Authenticated users can insert suppliers" on public.suppliers;
drop policy if exists "Authenticated users can update suppliers" on public.suppliers;
drop policy if exists "Authenticated users can delete inactive suppliers" on public.suppliers;
drop policy if exists "Users can read suppliers in their store" on public.suppliers;
drop policy if exists "Admins can insert suppliers in their store" on public.suppliers;
drop policy if exists "Admins can update suppliers in their store" on public.suppliers;
drop policy if exists "Admins can delete inactive suppliers in their store" on public.suppliers;
create policy "Users can read suppliers in their store" on public.suppliers for select to authenticated using (public.can_access_store(store_id));
create policy "Admins can insert suppliers in their store" on public.suppliers for insert to authenticated with check (public.can_admin_store(store_id));
create policy "Admins can update suppliers in their store" on public.suppliers for update to authenticated using (public.can_admin_store(store_id)) with check (public.can_admin_store(store_id));
create policy "Admins can delete inactive suppliers in their store" on public.suppliers for delete to authenticated using (public.can_admin_store(store_id) and is_active = false);

drop policy if exists "Authenticated users can read product barcodes" on public.product_barcodes;
drop policy if exists "Authenticated users can insert product barcodes" on public.product_barcodes;
drop policy if exists "Authenticated users can update product barcodes" on public.product_barcodes;
drop policy if exists "Users can read product barcodes in their store" on public.product_barcodes;
drop policy if exists "Users can insert product barcodes in their store" on public.product_barcodes;
drop policy if exists "Users can update product barcodes in their store" on public.product_barcodes;
create policy "Users can read product barcodes in their store" on public.product_barcodes for select to authenticated using (public.can_access_store(store_id));
create policy "Users can insert product barcodes in their store" on public.product_barcodes for insert to authenticated with check (public.can_access_store(store_id));
create policy "Users can update product barcodes in their store" on public.product_barcodes for update to authenticated using (public.can_access_store(store_id)) with check (public.can_access_store(store_id));

drop policy if exists "Authenticated users can read inventory" on public.inventory;
drop policy if exists "Authenticated users can insert inventory" on public.inventory;
drop policy if exists "Authenticated users can update inventory" on public.inventory;
drop policy if exists "Users can read inventory in their store" on public.inventory;
drop policy if exists "Users can insert inventory in their store" on public.inventory;
drop policy if exists "Users can update inventory in their store" on public.inventory;
create policy "Users can read inventory in their store" on public.inventory for select to authenticated using (public.can_access_store(store_id));
create policy "Users can insert inventory in their store" on public.inventory for insert to authenticated with check (public.can_access_store(store_id));
create policy "Users can update inventory in their store" on public.inventory for update to authenticated using (public.can_access_store(store_id)) with check (public.can_access_store(store_id) and warehouse_qty >= 0 and store_qty >= 0);

drop policy if exists "Authenticated users can read logs" on public.inventory_logs;
drop policy if exists "Authenticated users can insert own logs" on public.inventory_logs;
drop policy if exists "Users can read logs in their store" on public.inventory_logs;
drop policy if exists "Users can insert own logs in their store" on public.inventory_logs;
create policy "Users can read logs in their store" on public.inventory_logs for select to authenticated using (public.can_access_store(store_id));
create policy "Users can insert own logs in their store" on public.inventory_logs for insert to authenticated with check (public.can_access_store(store_id) and user_id = auth.uid());

drop policy if exists "Authenticated users can read profiles" on public.profiles;
drop policy if exists "Users can insert own profile" on public.profiles;
drop policy if exists "Admins can update profiles" on public.profiles;
drop policy if exists "Users can read profiles in their scope" on public.profiles;
drop policy if exists "Only invite RPC can insert profiles" on public.profiles;
drop policy if exists "Admins can update profiles in their scope" on public.profiles;
create policy "Users can read profiles in their scope" on public.profiles for select to authenticated using (
  id = auth.uid() or public.is_master(auth.uid()) or public.can_admin_store(store_id)
);
create policy "Only invite RPC can insert profiles" on public.profiles for insert to authenticated with check (false);
create policy "Admins can update profiles in their scope" on public.profiles for update to authenticated using (
  public.is_master(auth.uid()) or public.can_admin_store(store_id)
) with check (
  public.is_master(auth.uid()) or public.can_admin_store(store_id)
);

drop policy if exists "Authenticated users can read dashboard todos" on public.dashboard_todos;
drop policy if exists "Authenticated users can create dashboard todos" on public.dashboard_todos;
drop policy if exists "Authenticated users can update dashboard todos" on public.dashboard_todos;
drop policy if exists "Authenticated users can delete future dashboard todos" on public.dashboard_todos;
drop policy if exists "Users can read dashboard todos in their store" on public.dashboard_todos;
drop policy if exists "Users can create dashboard todos in their store" on public.dashboard_todos;
drop policy if exists "Users can update dashboard todos in their store" on public.dashboard_todos;
drop policy if exists "Users can delete future dashboard todos in their store" on public.dashboard_todos;
create policy "Users can read dashboard todos in their store" on public.dashboard_todos for select to authenticated using (public.can_access_store(store_id));
create policy "Users can create dashboard todos in their store" on public.dashboard_todos for insert to authenticated with check (public.can_access_store(store_id) and created_by = auth.uid());
create policy "Users can update dashboard todos in their store" on public.dashboard_todos for update to authenticated using (public.can_access_store(store_id)) with check (public.can_access_store(store_id) and (completed_by is null or completed_by = auth.uid()));
create policy "Users can delete future dashboard todos in their store" on public.dashboard_todos for delete to authenticated using (public.can_access_store(store_id) and task_date > (now() at time zone 'Asia/Seoul')::date);

drop policy if exists "Authenticated users can read handover notes" on public.handover_notes;
drop policy if exists "Authenticated users can create handover notes" on public.handover_notes;
drop policy if exists "Authenticated users can delete future handover notes" on public.handover_notes;
drop policy if exists "Users can read handover notes in their store" on public.handover_notes;
drop policy if exists "Users can create handover notes in their store" on public.handover_notes;
drop policy if exists "Users can delete future handover notes in their store" on public.handover_notes;
create policy "Users can read handover notes in their store" on public.handover_notes for select to authenticated using (public.can_access_store(store_id));
create policy "Users can create handover notes in their store" on public.handover_notes for insert to authenticated with check (public.can_access_store(store_id) and created_by = auth.uid());
create policy "Users can delete future handover notes in their store" on public.handover_notes for delete to authenticated using (public.can_access_store(store_id) and handover_date > (now() at time zone 'Asia/Seoul')::date);

drop policy if exists "Authenticated users can manage weekly store closures" on public.weekly_store_closures;
drop policy if exists "Admins can manage weekly store closures in their store" on public.weekly_store_closures;
create policy "Admins can manage weekly store closures in their store" on public.weekly_store_closures for all to authenticated
using (public.can_admin_store(store_id))
with check (public.can_admin_store(store_id) and created_by = auth.uid());

drop policy if exists "Authenticated users can manage store closure dates" on public.store_closure_dates;
drop policy if exists "Admins can manage store closure dates in their store" on public.store_closure_dates;
create policy "Admins can manage store closure dates in their store" on public.store_closure_dates for all to authenticated
using (public.can_admin_store(store_id))
with check (public.can_admin_store(store_id) and created_by = auth.uid());

drop policy if exists "Authenticated users can read receipt deletions" on public.dashboard_receipt_deletions;
drop policy if exists "Users can read receipt deletions in their store" on public.dashboard_receipt_deletions;
create policy "Users can read receipt deletions in their store" on public.dashboard_receipt_deletions for select to authenticated
using (public.can_access_store(store_id));

grant select, insert, update on public.stores to authenticated;
grant select, insert, delete on public.store_invites to authenticated;
grant execute on function public.current_store_id(uuid) to authenticated;
grant execute on function public.current_role(uuid) to authenticated;
grant execute on function public.is_master(uuid) to authenticated;
grant execute on function public.is_store_admin(uuid) to authenticated;
grant execute on function public.can_access_store(uuid) to authenticated;
grant execute on function public.can_admin_store(uuid) to authenticated;
grant execute on function public.create_store_invite(text, public.profile_role) to authenticated;
grant execute on function public.accept_store_invite(text) to authenticated;

notify pgrst, 'reload schema';
