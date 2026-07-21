create index if not exists inventory_logs_store_created_at_idx
on public.inventory_logs (store_id, created_at desc);

create index if not exists dashboard_todos_store_completed_at_idx
on public.dashboard_todos (store_id, completed_at desc)
where is_completed = true and deleted_at is null;

notify pgrst, 'reload schema';
