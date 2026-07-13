update public.products
set unit_weight_unit = 'g'
where unit_weight_enabled = true
  and unit_weight > 0
  and (unit_weight_unit is null or unit_weight_unit not in ('g', 'kg', 'ml', 'L', '개'));

update public.products
set processing_required = false,
    processed_unit_weight = null,
    processed_unit_weight_unit = null
where unit_weight_unit = '개';

update public.products
set processed_unit_weight_unit = 'g'
where processing_required = true
  and processed_unit_weight > 0
  and (processed_unit_weight_unit is null or processed_unit_weight_unit not in ('g', 'kg', 'ml', 'L'));

alter table public.products drop constraint if exists products_unit_weight_check;
alter table public.products add constraint products_unit_weight_check
check (
  (unit_weight_enabled = false and unit_weight is null and unit_weight_unit is null)
  or (
    unit_weight_enabled = true
    and unit_weight is not null
    and unit_weight > 0
    and unit_weight_unit in ('g', 'kg', 'ml', 'L', '개')
  )
);

alter table public.products drop constraint if exists products_processed_unit_weight_check;
alter table public.products add constraint products_processed_unit_weight_check
check (
  (processing_required = false and processed_unit_weight is null and processed_unit_weight_unit is null)
  or (
    unit_weight_enabled = true
    and unit_weight_unit <> '개'
    and processing_required = true
    and processed_unit_weight is not null
    and processed_unit_weight > 0
    and processed_unit_weight_unit in ('g', 'kg', 'ml', 'L')
  )
);

notify pgrst, 'reload schema';
