alter table public.products drop constraint if exists products_unit_weight_check;
alter table public.products add constraint products_unit_weight_check
check (
  (unit_weight_enabled = false and unit_weight is null and unit_weight_unit is null)
  or (
    unit_weight_enabled = true
    and unit_weight is not null
    and unit_weight > 0
    and unit_weight_unit in ('g', 'kg', 'ml', 'L')
  )
);

alter table public.products drop constraint if exists products_processed_unit_weight_check;
alter table public.products add constraint products_processed_unit_weight_check
check (
  (processing_required = false and processed_unit_weight is null and processed_unit_weight_unit is null)
  or (
    unit_weight_enabled = true
    and processing_required = true
    and processed_unit_weight is not null
    and processed_unit_weight > 0
    and processed_unit_weight_unit in ('g', 'kg', 'ml', 'L')
  )
);

notify pgrst, 'reload schema';
