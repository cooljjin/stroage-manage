alter table public.products add column if not exists order_completed boolean not null default false;

notify pgrst, 'reload schema';
