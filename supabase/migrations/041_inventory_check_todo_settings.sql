create table if not exists public.inventory_check_todo_settings (
  store_id uuid primary key references public.stores(id) on delete cascade,
  is_enabled boolean not null default false,
  threshold_days integer not null default 30 check (threshold_days between 1 and 3650),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.dashboard_todos
add column if not exists stale_inventory_product_id uuid references public.products(id) on delete set null;

create unique index if not exists dashboard_todos_store_date_stale_inventory_product_idx
on public.dashboard_todos (store_id, task_date, stale_inventory_product_id)
where stale_inventory_product_id is not null;

create index if not exists inventory_logs_store_product_action_created_idx
on public.inventory_logs (store_id, product_id, action, created_at desc);

alter table public.inventory_check_todo_settings enable row level security;

drop policy if exists "Users can read inventory check todo settings in their store" on public.inventory_check_todo_settings;
create policy "Users can read inventory check todo settings in their store"
on public.inventory_check_todo_settings for select to authenticated
using (public.can_access_store(store_id));

drop policy if exists "Users can create inventory check todo settings in their store" on public.inventory_check_todo_settings;
create policy "Users can create inventory check todo settings in their store"
on public.inventory_check_todo_settings for insert to authenticated
with check (public.can_access_store(store_id));

drop policy if exists "Users can update inventory check todo settings in their store" on public.inventory_check_todo_settings;
create policy "Users can update inventory check todo settings in their store"
on public.inventory_check_todo_settings for update to authenticated
using (public.can_access_store(store_id))
with check (public.can_access_store(store_id));

grant select, insert, update on public.inventory_check_todo_settings to authenticated;

notify pgrst, 'reload schema';
