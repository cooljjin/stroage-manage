alter table public.products add column if not exists storage_type text;
alter table public.products drop constraint if exists products_storage_type_check;
alter table public.products add constraint products_storage_type_check
check (storage_type in ('냉장', '냉동', '상온') or storage_type is null);

notify pgrst, 'reload schema';
