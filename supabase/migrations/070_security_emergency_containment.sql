-- Emergency containment for legacy SECURITY DEFINER entry points.
-- This migration keeps the installed client contract intact while closing
-- anonymous execution, cross-store access, and store-closure scope leaks.

-- Helper functions that accept a user UUID may only reveal another user's
-- store/role to a master. Policies continue to call them with auth.uid().
create or replace function public.current_store_id(user_id uuid)
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select target.store_id
  from public.profiles target
  where target.id = user_id
    and auth.uid() is not null
    and (
      target.id = auth.uid()
      or exists (
        select 1
        from public.profiles requester
        where requester.id = auth.uid()
          and requester.role = 'master'
      )
    )
$$;

create or replace function public.current_role(user_id uuid)
returns public.profile_role
language sql
security definer
stable
set search_path = public
as $$
  select target.role
  from public.profiles target
  where target.id = user_id
    and auth.uid() is not null
    and (
      target.id = auth.uid()
      or exists (
        select 1
        from public.profiles requester
        where requester.id = auth.uid()
          and requester.role = 'master'
      )
    )
$$;

create or replace function public.is_master(user_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles target
    where target.id = user_id
      and target.role = 'master'
      and auth.uid() is not null
      and (
        target.id = auth.uid()
        or exists (
          select 1
          from public.profiles requester
          where requester.id = auth.uid()
            and requester.role = 'master'
        )
      )
  )
$$;

create or replace function public.is_store_admin(user_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles target
    where target.id = user_id
      and target.role in ('master', 'store_admin')
      and auth.uid() is not null
      and (
        target.id = auth.uid()
        or exists (
          select 1
          from public.profiles requester
          where requester.id = auth.uid()
            and requester.role = 'master'
        )
      )
  )
$$;

create or replace function public.is_admin(user_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select public.is_store_admin(user_id)
$$;

-- Keep the exact legacy signatures for older clients, but put an authenticated,
-- store-scoped, row-locking guard in front of the existing implementation.
alter function public.merge_products(uuid, uuid)
rename to merge_products_legacy_internal_070;

revoke all on function public.merge_products_legacy_internal_070(uuid, uuid)
from public, anon, authenticated;

create or replace function public.merge_products(
  target_product_id uuid,
  source_product_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_product public.products%rowtype;
  source_product public.products%rowtype;
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.';
  end if;
  if target_product_id is null or source_product_id is null
    or target_product_id = source_product_id then
    raise exception '병합할 두 상품을 확인해 주세요.';
  end if;

  -- Every merge path uses the same deterministic lock order.
  perform product.id
  from public.products product
  where product.id in (target_product_id, source_product_id)
  order by product.id
  for update;

  select * into target_product
  from public.products
  where id = target_product_id;

  select * into source_product
  from public.products
  where id = source_product_id;

  if target_product.id is null or source_product.id is null then
    raise exception '병합할 상품을 찾을 수 없습니다.';
  end if;
  if target_product.store_id <> source_product.store_id then
    raise exception '다른 매장의 상품은 병합할 수 없습니다.';
  end if;
  if not public.can_access_store(target_product.store_id) then
    raise exception '해당 매장의 상품을 병합할 권한이 없습니다.';
  end if;
  if not target_product.is_active or not source_product.is_active then
    raise exception '활성 상품만 병합할 수 있습니다.';
  end if;

  perform public.merge_products_legacy_internal_070(
    target_product_id,
    source_product_id
  );
end;
$$;

grant execute on function public.merge_products(uuid, uuid) to authenticated;
revoke all on function public.merge_products(uuid, uuid) from public, anon;

alter function public.register_and_merge_product(uuid, jsonb, uuid, boolean)
rename to register_and_merge_product_legacy_internal_070;

revoke all on function public.register_and_merge_product_legacy_internal_070(uuid, jsonb, uuid, boolean)
from public, anon, authenticated;

create or replace function public.register_and_merge_product(
  product_store_id uuid,
  product_data jsonb,
  existing_product_id uuid,
  keep_new_product boolean
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  merged_product_id uuid;
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.';
  end if;
  if product_store_id is null or not public.can_access_store(product_store_id) then
    raise exception '매장에 접근할 수 없습니다.';
  end if;
  if existing_product_id is null then
    raise exception '병합할 상품을 찾을 수 없습니다.';
  end if;

  perform 1
  from public.products
  where id = existing_product_id
    and store_id = product_store_id
    and is_active = true
  for update;

  if not found then
    raise exception '병합할 활성 상품을 찾을 수 없습니다.';
  end if;

  select public.register_and_merge_product_legacy_internal_070(
    product_store_id,
    product_data,
    existing_product_id,
    keep_new_product
  ) into merged_product_id;

  return merged_product_id;
end;
$$;

grant execute on function public.register_and_merge_product(uuid, jsonb, uuid, boolean)
to authenticated;
revoke all on function public.register_and_merge_product(uuid, jsonb, uuid, boolean)
from public, anon;

alter function public.restore_inventory_to_log(uuid, numeric, numeric)
rename to restore_inventory_to_log_legacy_internal_070;

revoke all on function public.restore_inventory_to_log_legacy_internal_070(uuid, numeric, numeric)
from public, anon, authenticated;

create or replace function public.restore_inventory_to_log(
  target_log_id uuid,
  restored_warehouse_qty numeric,
  restored_store_qty numeric
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_log public.inventory_logs%rowtype;
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.';
  end if;
  if restored_warehouse_qty is null or restored_store_qty is null
    or restored_warehouse_qty < 0 or restored_store_qty < 0 then
    raise exception '재고 수량은 0 이상이어야 합니다.';
  end if;

  select * into target_log
  from public.inventory_logs
  where id = target_log_id
    and reverted_at is null
  for update;

  if not found then
    raise exception '복원할 작업 기록을 찾을 수 없습니다.';
  end if;
  if not public.can_access_store(target_log.store_id) then
    raise exception '해당 작업 기록을 복원할 권한이 없습니다.';
  end if;
  if not exists (
    select 1
    from public.products product
    where product.id = target_log.product_id
      and product.store_id = target_log.store_id
  ) then
    raise exception '작업 기록과 상품의 매장 정보가 일치하지 않습니다.';
  end if;

  perform public.restore_inventory_to_log_legacy_internal_070(
    target_log_id,
    restored_warehouse_qty,
    restored_store_qty
  );
end;
$$;

grant execute on function public.restore_inventory_to_log(uuid, numeric, numeric)
to authenticated;
revoke all on function public.restore_inventory_to_log(uuid, numeric, numeric)
from public, anon;

-- Store closures are evaluated and moved only inside NEW.store_id.
drop trigger if exists move_dashboard_items_after_weekly_closure
on public.weekly_store_closures;
drop trigger if exists move_dashboard_items_after_specific_closure
on public.store_closure_dates;

create or replace function public.is_store_closed(
  target_store_id uuid,
  target_date date
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when auth.uid() is null or not public.can_access_store(target_store_id) then false
    else exists (
      select 1
      from public.weekly_store_closures closure
      where closure.store_id = target_store_id
        and closure.weekday = extract(dow from target_date)::smallint
    ) or exists (
      select 1
      from public.store_closure_dates closure
      where closure.store_id = target_store_id
        and closure.closure_date = target_date
    )
  end
$$;

create or replace function public.next_store_business_date(
  target_store_id uuid,
  start_date date
)
returns date
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  candidate date := start_date;
  attempt integer;
begin
  if auth.uid() is null or not public.can_access_store(target_store_id) then
    raise exception '해당 매장의 영업일을 조회할 권한이 없습니다.';
  end if;

  for attempt in 1..366 loop
    candidate := candidate + 1;
    if not public.is_store_closed(target_store_id, candidate) then
      return candidate;
    end if;
  end loop;

  raise exception '다음 영업일을 계산할 수 없습니다.';
end;
$$;

create or replace function public.move_future_dashboard_items_from_closures()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.store_id is null then
    raise exception '휴무 매장 정보가 필요합니다.';
  end if;
  if auth.uid() is null or not public.can_admin_store(new.store_id) then
    raise exception '휴무 일정을 변경할 권한이 없습니다.';
  end if;

  update public.dashboard_todos todo
  set task_date = public.next_store_business_date(new.store_id, todo.task_date - 1)
  where todo.store_id = new.store_id
    and todo.task_date > (now() at time zone 'Asia/Seoul')::date
    and public.is_store_closed(new.store_id, todo.task_date);

  update public.handover_notes note
  set handover_date = public.next_store_business_date(new.store_id, note.handover_date - 1)
  where note.store_id = new.store_id
    and note.handover_date > (now() at time zone 'Asia/Seoul')::date
    and public.is_store_closed(new.store_id, note.handover_date);

  return new;
end;
$$;

create trigger move_dashboard_items_after_weekly_closure
after insert on public.weekly_store_closures
for each row
execute function public.move_future_dashboard_items_from_closures();

create trigger move_dashboard_items_after_specific_closure
after insert on public.store_closure_dates
for each row
execute function public.move_future_dashboard_items_from_closures();

drop function if exists public.is_store_closed(date);
drop function if exists public.next_store_business_date(date);

drop policy if exists "Admins can manage weekly store closures in their store"
on public.weekly_store_closures;
create policy "Admins can manage weekly store closures in their store"
on public.weekly_store_closures
for all to authenticated
using (public.can_admin_store(store_id))
with check (public.can_admin_store(store_id) and created_by = auth.uid());

drop policy if exists "Admins can manage store closure dates in their store"
on public.store_closure_dates;
create policy "Admins can manage store closure dates in their store"
on public.store_closure_dates
for all to authenticated
using (public.can_admin_store(store_id))
with check (public.can_admin_store(store_id) and created_by = auth.uid());

-- Fix every mutable search_path warning known at this migration boundary.
alter function public.touch_recipe_import_updated_at() set search_path = public;
alter function public.touch_prep_item_updated_at() set search_path = public;
alter function public.touch_group_order_menu_updated_at() set search_path = public;
alter function public.touch_group_order_event_updated_at() set search_path = public;
alter function public.touch_inventory_updated_at() set search_path = public;

-- PostgreSQL grants new functions to PUBLIC by default. Remove that default and
-- strip anonymous/PUBLIC execution from every existing public-schema function.
alter default privileges for role postgres in schema public
revoke execute on functions from public;

do $$
declare
  function_signature regprocedure;
begin
  for function_signature in
    select procedure.oid::regprocedure
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
  loop
    execute format(
      'revoke all on function %s from public, anon',
      function_signature
    );
  end loop;
end
$$;

-- Policy helpers must remain executable by signed-in users; their bodies now
-- enforce self/master semantics and never expose another staff member to staff.
grant execute on function public.current_store_id(uuid) to authenticated;
grant execute on function public.current_role(uuid) to authenticated;
grant execute on function public.is_master(uuid) to authenticated;
grant execute on function public.is_store_admin(uuid) to authenticated;
grant execute on function public.is_admin(uuid) to authenticated;
grant execute on function public.can_access_store(uuid) to authenticated;
grant execute on function public.can_admin_store(uuid) to authenticated;
grant execute on function public.is_store_closed(uuid, date) to authenticated;
grant execute on function public.next_store_business_date(uuid, date) to authenticated;
grant execute on function public.merge_products(uuid, uuid) to authenticated;
grant execute on function public.register_and_merge_product(uuid, jsonb, uuid, boolean)
to authenticated;
grant execute on function public.restore_inventory_to_log(uuid, numeric, numeric)
to authenticated;

notify pgrst, 'reload schema';
