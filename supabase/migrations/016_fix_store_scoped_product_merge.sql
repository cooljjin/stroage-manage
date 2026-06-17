create or replace function public.merge_products(target_product_id uuid, source_product_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_barcode text;
  source_barcode text;
  target_store_id uuid;
  source_store_id uuid;
  source_warehouse_qty numeric(12, 2);
  source_store_qty numeric(12, 2);
begin
  if target_product_id = source_product_id then
    raise exception '같은 상품은 병합할 수 없습니다.';
  end if;

  select barcode, store_id
  into target_barcode, target_store_id
  from public.products
  where id = target_product_id;

  if not found then
    raise exception '남길 상품을 찾을 수 없습니다.';
  end if;

  select barcode, store_id
  into source_barcode, source_store_id
  from public.products
  where id = source_product_id;

  if not found then
    raise exception '병합할 상품을 찾을 수 없습니다.';
  end if;

  if target_store_id <> source_store_id then
    raise exception '다른 매장의 상품은 병합할 수 없습니다.';
  end if;

  insert into public.inventory (product_id, store_id)
  values (target_product_id, target_store_id), (source_product_id, source_store_id)
  on conflict (product_id) do nothing;

  insert into public.product_barcodes (product_id, store_id, barcode)
  select target_product_id, target_store_id, target_barcode
  where target_barcode is not null and target_barcode <> ''
  on conflict (store_id, barcode) do update set product_id = excluded.product_id;

  insert into public.product_barcodes (product_id, store_id, barcode)
  select target_product_id, target_store_id, source_barcode
  where source_barcode is not null and source_barcode <> ''
  on conflict (store_id, barcode) do update set product_id = excluded.product_id;

  update public.product_barcodes
  set product_id = target_product_id
  where product_id = source_product_id
    and store_id = target_store_id;

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
  where product_id = source_product_id
    and store_id = target_store_id;

  delete from public.inventory
  where product_id = source_product_id;

  update public.products
  set is_active = false,
      barcode = null
  where id = source_product_id
    and store_id = target_store_id;
end;
$$;

grant execute on function public.merge_products(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
