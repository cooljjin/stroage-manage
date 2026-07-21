alter table public.dashboard_todos
add column if not exists deleted_at timestamptz,
add column if not exists deleted_by uuid references auth.users(id) on delete set null;

create index if not exists dashboard_todos_store_date_active_idx
on public.dashboard_todos (store_id, task_date, created_at)
where deleted_at is null;

notify pgrst, 'reload schema';
