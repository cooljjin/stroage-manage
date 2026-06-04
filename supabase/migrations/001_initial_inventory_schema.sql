create extension if not exists "pgcrypto";

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  barcode text unique,
  name text not null,
  category text not null check (
    category in ('원두', '우유', '시럽', '베이커리', '아이스크림', '소모품', '음료', '기타')
  ),
  minimum_stock integer not null default 0 check (minimum_stock >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.inventory (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null unique references public.products(id) on delete cascade,
  warehouse_qty integer not null default 0 check (warehouse_qty >= 0),
  store_qty integer not null default 0 check (store_qty >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.inventory_logs (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete restrict,
  action text not null check (action in ('입고', '출고', '이동', '조정')),
  source_location text check (source_location in ('창고', '매장') or source_location is null),
  destination_location text check (destination_location in ('창고', '매장') or destination_location is null),
  previous_quantity integer,
  new_quantity integer,
  quantity integer check (quantity is null or quantity >= 0),
  note text,
  created_at timestamptz not null default now()
);

create index if not exists products_name_idx on public.products using gin (to_tsvector('simple', name));
create index if not exists products_barcode_idx on public.products (barcode);
create index if not exists inventory_product_id_idx on public.inventory (product_id);
create index if not exists inventory_logs_created_at_idx on public.inventory_logs (created_at desc);
create index if not exists inventory_logs_product_id_idx on public.inventory_logs (product_id);

create or replace function public.touch_inventory_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists inventory_touch_updated_at on public.inventory;
create trigger inventory_touch_updated_at
before update on public.inventory
for each row
execute function public.touch_inventory_updated_at();

create or replace function public.create_inventory_for_product()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.inventory (product_id) values (new.id);
  return new;
end;
$$;

drop trigger if exists products_create_inventory on public.products;
create trigger products_create_inventory
after insert on public.products
for each row
execute function public.create_inventory_for_product();

create or replace function public.apply_inventory_operation(
  p_product_id uuid,
  p_action text,
  p_quantity integer,
  p_source_location text default null,
  p_destination_location text default null,
  p_adjust_location text default null,
  p_note text default null
)
returns public.inventory
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_inventory public.inventory;
  v_previous integer;
  v_new integer;
begin
  if v_user_id is null then
    raise exception '로그인이 필요합니다.';
  end if;

  if p_action not in ('입고', '출고', '이동', '조정') then
    raise exception '지원하지 않는 작업입니다.';
  end if;

  if p_quantity is null or p_quantity < 0 then
    raise exception '수량은 0 이상이어야 합니다.';
  end if;

  select *
  into v_inventory
  from public.inventory
  where product_id = p_product_id
  for update;

  if not found then
    insert into public.inventory (product_id)
    values (p_product_id)
    returning * into v_inventory;
  end if;

  if p_action = '입고' then
    if p_destination_location not in ('창고', '매장') then
      raise exception '입고 위치가 필요합니다.';
    end if;

    if p_destination_location = '창고' then
      v_previous := v_inventory.warehouse_qty;
      v_new := v_previous + p_quantity;
      update public.inventory set warehouse_qty = v_new where id = v_inventory.id returning * into v_inventory;
    else
      v_previous := v_inventory.store_qty;
      v_new := v_previous + p_quantity;
      update public.inventory set store_qty = v_new where id = v_inventory.id returning * into v_inventory;
    end if;

  elsif p_action = '출고' then
    if p_source_location not in ('창고', '매장') then
      raise exception '출고 위치가 필요합니다.';
    end if;

    if p_source_location = '창고' then
      v_previous := v_inventory.warehouse_qty;
      v_new := v_previous - p_quantity;
      if v_new < 0 then raise exception '창고 재고는 음수가 될 수 없습니다.'; end if;
      update public.inventory set warehouse_qty = v_new where id = v_inventory.id returning * into v_inventory;
    else
      v_previous := v_inventory.store_qty;
      v_new := v_previous - p_quantity;
      if v_new < 0 then raise exception '매장 재고는 음수가 될 수 없습니다.'; end if;
      update public.inventory set store_qty = v_new where id = v_inventory.id returning * into v_inventory;
    end if;

  elsif p_action = '이동' then
    if p_source_location not in ('창고', '매장') or p_destination_location not in ('창고', '매장') or p_source_location = p_destination_location then
      raise exception '이동 방향이 올바르지 않습니다.';
    end if;

    if p_source_location = '창고' then
      v_previous := v_inventory.warehouse_qty;
      if v_inventory.warehouse_qty - p_quantity < 0 then raise exception '창고 재고는 음수가 될 수 없습니다.'; end if;
      update public.inventory
      set warehouse_qty = warehouse_qty - p_quantity,
          store_qty = store_qty + p_quantity
      where id = v_inventory.id
      returning * into v_inventory;
      v_new := v_inventory.warehouse_qty;
    else
      v_previous := v_inventory.store_qty;
      if v_inventory.store_qty - p_quantity < 0 then raise exception '매장 재고는 음수가 될 수 없습니다.'; end if;
      update public.inventory
      set store_qty = store_qty - p_quantity,
          warehouse_qty = warehouse_qty + p_quantity
      where id = v_inventory.id
      returning * into v_inventory;
      v_new := v_inventory.store_qty;
    end if;

  else
    if p_adjust_location not in ('창고', '매장') then
      raise exception '조정 위치가 필요합니다.';
    end if;

    if p_adjust_location = '창고' then
      v_previous := v_inventory.warehouse_qty;
      v_new := p_quantity;
      update public.inventory set warehouse_qty = v_new where id = v_inventory.id returning * into v_inventory;
    else
      v_previous := v_inventory.store_qty;
      v_new := p_quantity;
      update public.inventory set store_qty = v_new where id = v_inventory.id returning * into v_inventory;
    end if;
  end if;

  insert into public.inventory_logs (
    product_id,
    user_id,
    action,
    source_location,
    destination_location,
    previous_quantity,
    new_quantity,
    quantity,
    note
  )
  values (
    p_product_id,
    v_user_id,
    p_action,
    coalesce(p_source_location, p_adjust_location),
    p_destination_location,
    v_previous,
    v_new,
    p_quantity,
    nullif(trim(coalesce(p_note, '')), '')
  );

  return v_inventory;
end;
$$;

alter table public.products enable row level security;
alter table public.inventory enable row level security;
alter table public.inventory_logs enable row level security;

drop policy if exists "Authenticated users can read products" on public.products;
create policy "Authenticated users can read products"
on public.products for select
to authenticated
using (true);

drop policy if exists "Authenticated users can insert products" on public.products;
create policy "Authenticated users can insert products"
on public.products for insert
to authenticated
with check (true);

drop policy if exists "Authenticated users can update products" on public.products;
create policy "Authenticated users can update products"
on public.products for update
to authenticated
using (true)
with check (true);

drop policy if exists "Authenticated users can read inventory" on public.inventory;
create policy "Authenticated users can read inventory"
on public.inventory for select
to authenticated
using (true);

drop policy if exists "Authenticated users can read logs" on public.inventory_logs;
create policy "Authenticated users can read logs"
on public.inventory_logs for select
to authenticated
using (true);

grant usage on schema public to authenticated;
grant select, insert, update on public.products to authenticated;
grant select on public.inventory to authenticated;
grant select on public.inventory_logs to authenticated;
grant execute on function public.apply_inventory_operation(uuid, text, integer, text, text, text, text) to authenticated;
