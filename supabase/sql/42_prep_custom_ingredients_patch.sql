alter table public.prep_item_ingredients
add column if not exists ingredient_name text;

alter table public.prep_item_ingredients
add column if not exists ingredient_unit text;

alter table public.prep_item_ingredients
alter column ingredient_product_id drop not null;

alter table public.prep_item_ingredients drop constraint if exists prep_item_ingredients_has_ingredient_check;
alter table public.prep_item_ingredients add constraint prep_item_ingredients_has_ingredient_check
check (ingredient_product_id is not null or nullif(trim(ingredient_name), '') is not null);

alter table public.prep_item_ingredients drop constraint if exists prep_item_ingredients_unit_check;
alter table public.prep_item_ingredients add constraint prep_item_ingredients_unit_check
check (ingredient_unit is null or ingredient_unit in ('g', 'kg', 'ml', 'L', '개'));

create or replace function public.save_prep_item(
  target_prep_item_id uuid,
  item_name text,
  item_shelf_life_days integer,
  item_sort_order integer,
  ingredient_rows jsonb,
  item_is_active boolean default true
)
returns public.prep_items
language plpgsql
security definer
set search_path = public
as $$
declare
  requester_store_id uuid;
  saved_item public.prep_items%rowtype;
  target_product_id uuid;
  ingredient jsonb;
  ingredient_index integer := 0;
  v_ingredient_product_id uuid;
  v_ingredient_name text;
  v_ingredient_unit text;
  v_ingredient_quantity numeric(12, 4);
  v_ingredient_sort_order integer;
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.';
  end if;

  requester_store_id := public.current_store_id(auth.uid());
  if requester_store_id is null or not public.can_admin_store(requester_store_id) then
    raise exception '프랩 품목 관리 권한이 없습니다.';
  end if;

  if item_name is null or char_length(trim(item_name)) = 0 then
    raise exception '프랩 품목명은 비워둘 수 없습니다.';
  end if;

  if item_shelf_life_days is null or item_shelf_life_days < 1 then
    raise exception '유통기한은 1일 이상이어야 합니다.';
  end if;

  if ingredient_rows is null or jsonb_typeof(ingredient_rows) <> 'array' or jsonb_array_length(ingredient_rows) = 0 then
    raise exception '사용 재료를 1개 이상 등록해 주세요.';
  end if;

  if target_prep_item_id is null then
    insert into public.products (
      store_id,
      name,
      category,
      unit_name,
      minimum_stock,
      is_active
    )
    values (
      requester_store_id,
      trim(item_name),
      '기타',
      '개',
      0,
      false
    )
    returning id into target_product_id;

    insert into public.inventory (product_id, store_id)
    values (target_product_id, requester_store_id)
    on conflict (product_id) do nothing;

    insert into public.prep_items (
      store_id,
      product_id,
      name,
      shelf_life_days,
      sort_order,
      is_active
    )
    values (
      requester_store_id,
      target_product_id,
      trim(item_name),
      item_shelf_life_days,
      coalesce(item_sort_order, 1000),
      coalesce(item_is_active, true)
    )
    returning * into saved_item;
  else
    select *
    into saved_item
    from public.prep_items
    where id = target_prep_item_id
    for update;

    if not found then
      raise exception '프랩 품목을 찾을 수 없습니다.';
    end if;

    if not public.can_admin_store(saved_item.store_id) then
      raise exception '프랩 품목 관리 권한이 없습니다.';
    end if;

    requester_store_id := saved_item.store_id;
    target_product_id := saved_item.product_id;

    update public.products
    set name = trim(item_name),
        category = '기타',
        unit_name = '개',
        is_active = false
    where id = target_product_id
      and store_id = requester_store_id;

    update public.prep_items
    set name = trim(item_name),
        shelf_life_days = item_shelf_life_days,
        sort_order = coalesce(item_sort_order, sort_order),
        is_active = coalesce(item_is_active, is_active)
    where id = saved_item.id
    returning * into saved_item;

    delete from public.prep_item_ingredients
    where prep_item_id = saved_item.id;
  end if;

  for ingredient in
    select value from jsonb_array_elements(ingredient_rows)
  loop
    ingredient_index := ingredient_index + 1;
    v_ingredient_product_id := nullif(ingredient ->> 'product_id', '')::uuid;
    v_ingredient_name := nullif(trim(coalesce(ingredient ->> 'ingredient_name', '')), '');
    v_ingredient_unit := nullif(ingredient ->> 'ingredient_unit', '');
    v_ingredient_quantity := nullif(ingredient ->> 'quantity_per_unit', '')::numeric(12, 4);
    v_ingredient_sort_order := coalesce(nullif(ingredient ->> 'sort_order', '')::integer, ingredient_index);

    if v_ingredient_product_id is null and v_ingredient_name is null then
      raise exception '재료 품목을 선택하거나 임의 재료명을 입력해 주세요.';
    end if;

    if v_ingredient_product_id is not null and v_ingredient_product_id = target_product_id then
      raise exception '프랩 품목 자체는 재료로 등록할 수 없습니다.';
    end if;

    if v_ingredient_unit is not null and v_ingredient_unit not in ('g', 'kg', 'ml', 'L', '개') then
      raise exception '임의 재료 단위를 선택해 주세요.';
    end if;

    if v_ingredient_quantity is null or v_ingredient_quantity <= 0 then
      raise exception '재료 사용량은 0보다 커야 합니다.';
    end if;

    if v_ingredient_product_id is not null then
      perform 1
      from public.products
      where id = v_ingredient_product_id
        and store_id = requester_store_id
        and is_active = true;

      if not found then
        raise exception '재료 품목을 찾을 수 없습니다.';
      end if;
    end if;

    insert into public.prep_item_ingredients (
      store_id,
      prep_item_id,
      ingredient_product_id,
      ingredient_name,
      ingredient_unit,
      quantity_per_unit,
      sort_order
    )
    values (
      requester_store_id,
      saved_item.id,
      v_ingredient_product_id,
      v_ingredient_name,
      v_ingredient_unit,
      v_ingredient_quantity,
      v_ingredient_sort_order
    );
  end loop;

  return saved_item;
end;
$$;

grant execute on function public.save_prep_item(uuid, text, integer, integer, jsonb, boolean) to authenticated;

notify pgrst, 'reload schema';
