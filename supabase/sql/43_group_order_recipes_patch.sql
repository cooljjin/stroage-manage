create table if not exists public.group_order_menus (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete restrict,
  name text not null check (char_length(trim(name)) > 0),
  sort_order integer not null default 1000,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.group_order_recipe_ingredients (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete restrict,
  menu_id uuid not null references public.group_order_menus(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  quantity_per_item numeric(12, 3) not null check (quantity_per_item > 0),
  quantity_unit text not null check (quantity_unit in ('g', 'kg', 'ml', 'L', '개')),
  sort_order integer not null default 1000,
  created_at timestamptz not null default now()
);

create table if not exists public.group_order_events (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete restrict,
  order_date date not null,
  organization_name text not null check (char_length(trim(organization_name)) > 0),
  customer_contact text,
  requested_time time not null,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.group_order_event_items (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete restrict,
  event_id uuid not null references public.group_order_events(id) on delete cascade,
  menu_id uuid not null references public.group_order_menus(id) on delete restrict,
  quantity numeric(12, 3) not null check (quantity > 0),
  created_at timestamptz not null default now()
);

create unique index if not exists group_order_menus_store_name_unique
on public.group_order_menus (store_id, name);

create unique index if not exists group_order_recipe_ingredients_menu_product_unique
on public.group_order_recipe_ingredients (menu_id, product_id);

create index if not exists group_order_menus_store_sort_idx
on public.group_order_menus (store_id, sort_order, name);

create index if not exists group_order_recipe_ingredients_menu_sort_idx
on public.group_order_recipe_ingredients (menu_id, sort_order);

create index if not exists group_order_recipe_ingredients_product_idx
on public.group_order_recipe_ingredients (product_id);

create index if not exists group_order_events_store_date_idx
on public.group_order_events (store_id, order_date, requested_time);

create unique index if not exists group_order_event_items_event_menu_unique
on public.group_order_event_items (event_id, menu_id);

create index if not exists group_order_event_items_store_event_idx
on public.group_order_event_items (store_id, event_id);

create or replace function public.touch_group_order_menu_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists group_order_menus_touch_updated_at on public.group_order_menus;
create trigger group_order_menus_touch_updated_at
before update on public.group_order_menus
for each row
execute function public.touch_group_order_menu_updated_at();

create or replace function public.touch_group_order_event_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists group_order_events_touch_updated_at on public.group_order_events;
create trigger group_order_events_touch_updated_at
before update on public.group_order_events
for each row
execute function public.touch_group_order_event_updated_at();

drop trigger if exists fill_group_order_menus_store_id on public.group_order_menus;
create trigger fill_group_order_menus_store_id before insert on public.group_order_menus
for each row execute function public.fill_current_store_id();

drop trigger if exists fill_group_order_recipe_ingredients_store_id on public.group_order_recipe_ingredients;
create trigger fill_group_order_recipe_ingredients_store_id before insert on public.group_order_recipe_ingredients
for each row execute function public.fill_current_store_id();

drop trigger if exists fill_group_order_events_store_id on public.group_order_events;
create trigger fill_group_order_events_store_id before insert on public.group_order_events
for each row execute function public.fill_current_store_id();

drop trigger if exists fill_group_order_event_items_store_id on public.group_order_event_items;
create trigger fill_group_order_event_items_store_id before insert on public.group_order_event_items
for each row execute function public.fill_current_store_id();

create or replace function public.validate_group_order_recipe_ingredient()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  menu_store_id uuid;
  product_store_id uuid;
begin
  select store_id
  into menu_store_id
  from public.group_order_menus
  where id = new.menu_id;

  if menu_store_id is null then
    raise exception '메뉴 레시피를 찾을 수 없습니다.';
  end if;

  select store_id
  into product_store_id
  from public.products
  where id = new.product_id
    and is_active = true;

  if product_store_id is null then
    raise exception '재료 품목을 찾을 수 없습니다.';
  end if;

  if new.store_id is null then
    new.store_id := menu_store_id;
  end if;

  if new.store_id <> menu_store_id or new.store_id <> product_store_id then
    raise exception '같은 매장의 메뉴와 재료만 등록할 수 있습니다.';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_group_order_recipe_ingredient_row on public.group_order_recipe_ingredients;
create trigger validate_group_order_recipe_ingredient_row
before insert or update on public.group_order_recipe_ingredients
for each row
execute function public.validate_group_order_recipe_ingredient();

create or replace function public.validate_group_order_event_item()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  event_store_id uuid;
  menu_store_id uuid;
begin
  select store_id
  into event_store_id
  from public.group_order_events
  where id = new.event_id;

  if event_store_id is null then
    raise exception '단체주문 일정을 찾을 수 없습니다.';
  end if;

  select store_id
  into menu_store_id
  from public.group_order_menus
  where id = new.menu_id
    and is_active = true;

  if menu_store_id is null then
    raise exception '메뉴 레시피를 찾을 수 없습니다.';
  end if;

  if new.store_id is null then
    new.store_id := event_store_id;
  end if;

  if new.store_id <> event_store_id or new.store_id <> menu_store_id then
    raise exception '같은 매장의 일정과 메뉴만 등록할 수 있습니다.';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_group_order_event_item_row on public.group_order_event_items;
create trigger validate_group_order_event_item_row
before insert or update on public.group_order_event_items
for each row
execute function public.validate_group_order_event_item();

alter table public.group_order_menus enable row level security;
alter table public.group_order_recipe_ingredients enable row level security;
alter table public.group_order_events enable row level security;
alter table public.group_order_event_items enable row level security;

drop policy if exists "Users can read group order menus in their store" on public.group_order_menus;
create policy "Users can read group order menus in their store"
on public.group_order_menus for select to authenticated
using (public.can_access_store(store_id));

drop policy if exists "Admins can manage group order menus in their store" on public.group_order_menus;
create policy "Admins can manage group order menus in their store"
on public.group_order_menus for all to authenticated
using (public.can_admin_store(store_id))
with check (public.can_admin_store(store_id));

drop policy if exists "Users can read group order ingredients in their store" on public.group_order_recipe_ingredients;
create policy "Users can read group order ingredients in their store"
on public.group_order_recipe_ingredients for select to authenticated
using (public.can_access_store(store_id));

drop policy if exists "Admins can manage group order ingredients in their store" on public.group_order_recipe_ingredients;
create policy "Admins can manage group order ingredients in their store"
on public.group_order_recipe_ingredients for all to authenticated
using (public.can_admin_store(store_id))
with check (public.can_admin_store(store_id));

drop policy if exists "Users can read group order events in their store" on public.group_order_events;
create policy "Users can read group order events in their store"
on public.group_order_events for select to authenticated
using (public.can_access_store(store_id));

drop policy if exists "Users can manage group order events in their store" on public.group_order_events;
create policy "Users can manage group order events in their store"
on public.group_order_events for all to authenticated
using (public.can_access_store(store_id))
with check (public.can_access_store(store_id));

drop policy if exists "Users can read group order event items in their store" on public.group_order_event_items;
create policy "Users can read group order event items in their store"
on public.group_order_event_items for select to authenticated
using (public.can_access_store(store_id));

drop policy if exists "Users can manage group order event items in their store" on public.group_order_event_items;
create policy "Users can manage group order event items in their store"
on public.group_order_event_items for all to authenticated
using (public.can_access_store(store_id))
with check (public.can_access_store(store_id));

grant select, insert, update, delete on public.group_order_menus to authenticated;
grant select, insert, update, delete on public.group_order_recipe_ingredients to authenticated;
grant select, insert, update, delete on public.group_order_events to authenticated;
grant select, insert, update, delete on public.group_order_event_items to authenticated;

notify pgrst, 'reload schema';
