create table if not exists public.product_barcodes (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  barcode text not null unique,
  created_at timestamptz not null default now()
);

create index if not exists product_barcodes_product_id_idx on public.product_barcodes (product_id);
create index if not exists product_barcodes_barcode_idx on public.product_barcodes (barcode);

create or replace function public.merge_products(target_product_id uuid, source_product_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_barcode text;
  source_barcode text;
  source_warehouse_qty numeric(12, 2);
  source_store_qty numeric(12, 2);
begin
  if target_product_id = source_product_id then
    raise exception '같은 상품은 병합할 수 없습니다.';
  end if;

  select barcode into target_barcode from public.products where id = target_product_id;
  if not found then
    raise exception '남길 상품을 찾을 수 없습니다.';
  end if;

  select barcode into source_barcode from public.products where id = source_product_id;
  if not found then
    raise exception '병합할 상품을 찾을 수 없습니다.';
  end if;

  insert into public.inventory (product_id)
  values (target_product_id), (source_product_id)
  on conflict (product_id) do nothing;

  insert into public.product_barcodes (product_id, barcode)
  select target_product_id, target_barcode
  where target_barcode is not null and target_barcode <> ''
  on conflict (barcode) do update set product_id = excluded.product_id;

  insert into public.product_barcodes (product_id, barcode)
  select target_product_id, source_barcode
  where source_barcode is not null and source_barcode <> ''
  on conflict (barcode) do update set product_id = excluded.product_id;

  update public.product_barcodes
  set product_id = target_product_id
  where product_id = source_product_id;

  select warehouse_qty, store_qty
  into source_warehouse_qty, source_store_qty
  from public.inventory
  where product_id = source_product_id;

  update public.inventory
  set warehouse_qty = warehouse_qty + coalesce(source_warehouse_qty, 0),
      store_qty = store_qty + coalesce(source_store_qty, 0)
  where product_id = target_product_id;

  update public.inventory_logs
  set product_id = target_product_id
  where product_id = source_product_id;

  delete from public.inventory
  where product_id = source_product_id;

  update public.products
  set is_active = false,
      barcode = null
  where id = source_product_id;
end;
$$;

alter table public.product_barcodes enable row level security;

drop policy if exists "Authenticated users can read product barcodes" on public.product_barcodes;
create policy "Authenticated users can read product barcodes"
on public.product_barcodes for select
to authenticated
using (true);

drop policy if exists "Authenticated users can insert product barcodes" on public.product_barcodes;
create policy "Authenticated users can insert product barcodes"
on public.product_barcodes for insert
to authenticated
with check (true);

drop policy if exists "Authenticated users can update product barcodes" on public.product_barcodes;
create policy "Authenticated users can update product barcodes"
on public.product_barcodes for update
to authenticated
using (true)
with check (true);

grant select, insert, update, delete on public.product_barcodes to authenticated;
grant execute on function public.merge_products(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
