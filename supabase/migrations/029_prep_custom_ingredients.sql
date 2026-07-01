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

notify pgrst, 'reload schema';
