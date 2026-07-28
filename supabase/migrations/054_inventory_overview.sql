alter table public.products
add column if not exists is_important boolean not null default false;

create table if not exists public.inventory_overview_settings (
  store_id uuid primary key references public.stores(id) on delete cascade,
  abundant_multiplier numeric(8, 3) not null default 1.5 check (abundant_multiplier > 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.prevent_non_admin_important_product_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.is_important is distinct from old.is_important
    and not public.can_admin_store(old.store_id) then
    raise exception '중요 품목은 관리자만 변경할 수 있습니다.';
  end if;

  return new;
end;
$$;

drop trigger if exists prevent_non_admin_important_product_change on public.products;
create trigger prevent_non_admin_important_product_change
before update on public.products
for each row execute function public.prevent_non_admin_important_product_change();

alter table public.inventory_overview_settings enable row level security;

drop policy if exists "Users can read inventory overview settings in their store" on public.inventory_overview_settings;
create policy "Users can read inventory overview settings in their store"
on public.inventory_overview_settings for select to authenticated
using (public.can_access_store(store_id));

drop policy if exists "Admins can create inventory overview settings in their store" on public.inventory_overview_settings;
create policy "Admins can create inventory overview settings in their store"
on public.inventory_overview_settings for insert to authenticated
with check (public.can_admin_store(store_id));

drop policy if exists "Admins can update inventory overview settings in their store" on public.inventory_overview_settings;
create policy "Admins can update inventory overview settings in their store"
on public.inventory_overview_settings for update to authenticated
using (public.can_admin_store(store_id))
with check (public.can_admin_store(store_id));

grant select, insert, update on public.inventory_overview_settings to authenticated;

notify pgrst, 'reload schema';
