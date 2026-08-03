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
  new_product_id uuid;
  target_product_id uuid;
  source_product_id uuid;
begin
  if not public.can_access_store(product_store_id) then
    raise exception '매장에 접근할 수 없습니다.';
  end if;

  if existing_product_id is null then
    raise exception '병합할 상품을 찾을 수 없습니다.';
  end if;

  if not exists (
    select 1
    from public.products
    where id = existing_product_id
      and store_id = product_store_id
      and is_active = true
  ) then
    raise exception '병합할 상품을 찾을 수 없습니다.';
  end if;

  insert into public.products (
    store_id,
    name,
    barcode,
    category,
    supplier_name,
    storage_type,
    default_location,
    unit_name,
    unit_weight_enabled,
    unit_weight,
    unit_weight_unit,
    processing_required,
    processed_unit_weight,
    processed_unit_weight_unit,
    minimum_stock,
    receipt_check_only,
    status_enabled,
    stock_status,
    product_url
  )
  values (
    product_store_id,
    nullif(product_data->>'name', ''),
    nullif(product_data->>'barcode', ''),
    coalesce(nullif(product_data->>'category', ''), '기타'),
    nullif(product_data->>'supplier_name', ''),
    nullif(product_data->>'storage_type', ''),
    coalesce(nullif(product_data->>'default_location', ''), '창고'),
    nullif(product_data->>'unit_name', ''),
    coalesce((product_data->>'unit_weight_enabled')::boolean, false),
    case when coalesce((product_data->>'unit_weight_enabled')::boolean, false) then (product_data->>'unit_weight')::numeric else null end,
    nullif(product_data->>'unit_weight_unit', ''),
    coalesce((product_data->>'processing_required')::boolean, false),
    case when coalesce((product_data->>'processing_required')::boolean, false) then (product_data->>'processed_unit_weight')::numeric else null end,
    nullif(product_data->>'processed_unit_weight_unit', ''),
    coalesce((product_data->>'minimum_stock')::numeric, 0),
    coalesce((product_data->>'receipt_check_only')::boolean, false),
    coalesce((product_data->>'status_enabled')::boolean, false),
    nullif(product_data->>'stock_status', ''),
    nullif(product_data->>'product_url', '')
  )
  returning id into new_product_id;

  insert into public.inventory (product_id, store_id)
  values (new_product_id, product_store_id)
  on conflict (product_id) do nothing;

  if keep_new_product then
    target_product_id := new_product_id;
    source_product_id := existing_product_id;
  else
    target_product_id := existing_product_id;
    source_product_id := new_product_id;
  end if;

  perform public.merge_products(target_product_id, source_product_id);
  return target_product_id;
end;
$$;

grant execute on function public.register_and_merge_product(uuid, jsonb, uuid, boolean) to authenticated;
notify pgrst, 'reload schema';
