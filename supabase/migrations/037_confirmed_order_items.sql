create table if not exists public.confirmed_order_items (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  order_date date not null,
  product_id uuid not null references public.products(id) on delete cascade,
  product_name text not null,
  category text not null default '기타',
  supplier_name text,
  total_stock numeric(12, 4),
  minimum_stock integer,
  is_low_stock boolean not null default false,
  fresh_order_selected boolean not null default false,
  urgent_order_requested boolean not null default false,
  urgent_order_quantity numeric(12, 2),
  order_completed boolean not null default false,
  confirmed_by uuid references auth.users(id) on delete set null,
  confirmed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (store_id, order_date, product_id)
);

create index if not exists confirmed_order_items_store_date_idx
on public.confirmed_order_items (store_id, order_date, confirmed_at desc);

alter table public.confirmed_order_items enable row level security;

drop policy if exists "Users can read confirmed order items in their store" on public.confirmed_order_items;
create policy "Users can read confirmed order items in their store"
on public.confirmed_order_items for select to authenticated
using (public.can_access_store(store_id));

drop policy if exists "Admins can manage confirmed order items in their store" on public.confirmed_order_items;
create policy "Admins can manage confirmed order items in their store"
on public.confirmed_order_items for all to authenticated
using (public.can_admin_store(store_id))
with check (public.can_admin_store(store_id));

grant select, insert, update, delete on public.confirmed_order_items to authenticated;

notify pgrst, 'reload schema';
