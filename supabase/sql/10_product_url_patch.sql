alter table public.products add column if not exists product_url text;

notify pgrst, 'reload schema';
