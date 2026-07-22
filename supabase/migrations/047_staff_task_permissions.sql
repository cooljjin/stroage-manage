create table if not exists public.staff_permissions (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  permission_key text not null check (permission_key in (
    'category_management',
    'supplier_management',
    'group_order_recipe_management',
    'order_confirmation'
  )),
  granted_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  unique (store_id, user_id, permission_key)
);

create index if not exists staff_permissions_store_user_idx
on public.staff_permissions (store_id, user_id);

create or replace function public.validate_staff_permission_row()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.profiles
    where id = new.user_id
      and store_id = new.store_id
      and role = 'staff'
  ) then
    raise exception '일반 직원에게만 작업 권한을 부여할 수 있습니다.';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_staff_permission_row on public.staff_permissions;
create trigger validate_staff_permission_row
before insert or update on public.staff_permissions
for each row execute function public.validate_staff_permission_row();

create or replace function public.has_staff_permission(target_store_id uuid, requested_permission text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.staff_permissions
    where store_id = target_store_id
      and user_id = auth.uid()
      and permission_key = requested_permission
  );
$$;

create or replace function public.can_manage_store_task(target_store_id uuid, requested_permission text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.can_admin_store(target_store_id)
    or public.has_staff_permission(target_store_id, requested_permission);
$$;

alter table public.staff_permissions enable row level security;

create policy "Users can read own staff permissions"
on public.staff_permissions for select to authenticated
using (user_id = auth.uid() or public.can_admin_store(store_id));

create policy "Admins can grant staff permissions"
on public.staff_permissions for insert to authenticated
with check (public.can_admin_store(store_id));

create policy "Admins can revoke staff permissions"
on public.staff_permissions for delete to authenticated
using (public.can_admin_store(store_id));

drop policy if exists "Admins can insert categories in their store" on public.categories;
drop policy if exists "Admins can update categories in their store" on public.categories;
drop policy if exists "Admins can delete inactive categories in their store" on public.categories;
create policy "Task managers can insert categories in their store" on public.categories for insert to authenticated
with check (public.can_manage_store_task(store_id, 'category_management'));
create policy "Task managers can update categories in their store" on public.categories for update to authenticated
using (public.can_manage_store_task(store_id, 'category_management'))
with check (public.can_manage_store_task(store_id, 'category_management'));
create policy "Task managers can delete inactive categories in their store" on public.categories for delete to authenticated
using (public.can_manage_store_task(store_id, 'category_management') and is_active = false);

drop policy if exists "Admins can insert suppliers in their store" on public.suppliers;
drop policy if exists "Admins can update suppliers in their store" on public.suppliers;
drop policy if exists "Admins can delete inactive suppliers in their store" on public.suppliers;
create policy "Task managers can insert suppliers in their store" on public.suppliers for insert to authenticated
with check (public.can_manage_store_task(store_id, 'supplier_management'));
create policy "Task managers can update suppliers in their store" on public.suppliers for update to authenticated
using (public.can_manage_store_task(store_id, 'supplier_management'))
with check (public.can_manage_store_task(store_id, 'supplier_management'));
create policy "Task managers can delete inactive suppliers in their store" on public.suppliers for delete to authenticated
using (public.can_manage_store_task(store_id, 'supplier_management') and is_active = false);

drop policy if exists "Admins can manage group order menus in their store" on public.group_order_menus;
create policy "Recipe managers can manage group order menus in their store" on public.group_order_menus for all to authenticated
using (public.can_manage_store_task(store_id, 'group_order_recipe_management'))
with check (public.can_manage_store_task(store_id, 'group_order_recipe_management'));

drop policy if exists "Admins can manage group order ingredients in their store" on public.group_order_recipe_ingredients;
create policy "Recipe managers can manage group order ingredients in their store" on public.group_order_recipe_ingredients for all to authenticated
using (public.can_manage_store_task(store_id, 'group_order_recipe_management'))
with check (public.can_manage_store_task(store_id, 'group_order_recipe_management'));

drop policy if exists "Admins can manage confirmed order items in their store" on public.confirmed_order_items;
create policy "Order confirmers can manage confirmed order items in their store" on public.confirmed_order_items for all to authenticated
using (public.can_manage_store_task(store_id, 'order_confirmation'))
with check (public.can_manage_store_task(store_id, 'order_confirmation'));

grant select, insert, delete on public.staff_permissions to authenticated;
grant execute on function public.has_staff_permission(uuid, text) to authenticated;
grant execute on function public.can_manage_store_task(uuid, text) to authenticated;

notify pgrst, 'reload schema';
