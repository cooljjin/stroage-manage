alter table public.products
add column if not exists processing_required boolean not null default false;

alter table public.products
add column if not exists processed_unit_weight numeric(12, 3);

alter table public.products
add column if not exists processed_unit_weight_unit text;

update public.products
set processing_required = false,
    processed_unit_weight = null,
    processed_unit_weight_unit = null
where unit_weight_enabled = false;

update public.products
set processed_unit_weight = null,
    processed_unit_weight_unit = null
where processing_required = false;

update public.products
set processing_required = false,
    processed_unit_weight = null,
    processed_unit_weight_unit = null
where processing_required = true
  and (
    unit_weight_enabled = false
    or processed_unit_weight is null
    or processed_unit_weight <= 0
  );

update public.products
set processed_unit_weight_unit = 'g'
where processing_required = true
  and processed_unit_weight is not null
  and processed_unit_weight > 0
  and (processed_unit_weight_unit is null or processed_unit_weight_unit not in ('g', 'kg', 'ml', 'L'));

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
