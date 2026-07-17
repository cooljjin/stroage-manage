drop index if exists public.dashboard_todos_store_date_routine_idx;

create unique index if not exists dashboard_todos_store_date_routine_idx
on public.dashboard_todos (store_id, task_date, routine_id);

notify pgrst, 'reload schema';
