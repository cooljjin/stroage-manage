create or replace function public.delete_prep_item(target_prep_item_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  prep_item public.prep_items%rowtype;
  remaining_stock numeric(12, 2);
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.';
  end if;

  select *
  into prep_item
  from public.prep_items
  where id = target_prep_item_id
  for update;

  if not found then
    raise exception '삭제할 프랩 품목을 찾을 수 없습니다.';
  end if;

  if not public.can_admin_store(prep_item.store_id) then
    raise exception '프랩 품목을 삭제할 권한이 없습니다.';
  end if;

  select coalesce(sum(coalesce(warehouse_qty, 0) + coalesce(store_qty, 0)), 0)
  into remaining_stock
  from public.inventory
  where product_id = prep_item.product_id
    and store_id = prep_item.store_id;

  if remaining_stock > 0 then
    raise exception '프랩 재고가 남아 있어 삭제할 수 없습니다. 현재 수량 %', remaining_stock;
  end if;

  if exists (
    select 1
    from public.prep_batches
    where prep_item_id = prep_item.id
      and store_id = prep_item.store_id
      and quantity_remaining > 0
  ) then
    raise exception '남은 제조 단위가 있어 삭제할 수 없습니다.';
  end if;

  delete from public.prep_items
  where id = prep_item.id;

  update public.products
  set is_active = false
  where id = prep_item.product_id
    and store_id = prep_item.store_id;
end;
$$;

grant execute on function public.delete_prep_item(uuid) to authenticated;

notify pgrst, 'reload schema';
