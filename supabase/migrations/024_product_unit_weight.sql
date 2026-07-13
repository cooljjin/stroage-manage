alter table public.products
add column if not exists unit_weight_enabled boolean not null default false;

alter table public.products
add column if not exists unit_weight numeric(12, 3);

alter table public.products
add column if not exists unit_weight_unit text;

update public.products
set unit_weight = null,
    unit_weight_unit = null
where unit_weight_enabled is not true;

update public.products
set unit_weight_enabled = false,
    unit_weight = null,
    unit_weight_unit = null
where unit_weight_enabled is true
  and (unit_weight is null or unit_weight <= 0);

update public.products
set unit_weight_unit = 'g'
where unit_weight_enabled is true
  and unit_weight is not null
  and unit_weight > 0
  and (unit_weight_unit is null or unit_weight_unit not in ('g', 'kg'));

alter table public.products drop constraint if exists products_unit_weight_check;
alter table public.products add constraint products_unit_weight_check
check (
  (unit_weight_enabled = false and unit_weight is null and unit_weight_unit is null)
  or (
    unit_weight_enabled = true
    and unit_weight is not null
    and unit_weight > 0
    and unit_weight_unit in ('g', 'kg')
  )
);

notify pgrst, 'reload schema';
