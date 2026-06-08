alter table public.products drop constraint if exists products_storage_type_check;

notify pgrst, 'reload schema';
