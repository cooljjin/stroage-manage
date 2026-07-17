create table if not exists public.todo_routines (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete restrict,
  content text not null check (char_length(trim(content)) > 0),
  schedule_type text not null check (schedule_type in ('once', 'weekly', 'monthly')),
  target_date date,
  weekday integer check (weekday between 0 and 6),
  month_day integer check (month_day between 1 and 31),
  starts_on date not null default (now() at time zone 'Asia/Seoul')::date,
  ends_on date,
  is_active boolean not null default true,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint todo_routines_schedule_check check (
    (schedule_type = 'once' and target_date is not null and weekday is null and month_day is null)
    or (schedule_type = 'weekly' and target_date is null and weekday is not null and month_day is null)
    or (schedule_type = 'monthly' and target_date is null and weekday is null and month_day is not null)
  ),
  constraint todo_routines_date_range_check check (ends_on is null or ends_on >= starts_on)
);

alter table public.dashboard_todos
add column if not exists routine_id uuid references public.todo_routines(id) on delete set null;

create unique index if not exists dashboard_todos_store_date_routine_idx
on public.dashboard_todos (store_id, task_date, routine_id)
where routine_id is not null;

create index if not exists todo_routines_store_active_idx
on public.todo_routines (store_id, is_active, schedule_type);

alter table public.todo_routines enable row level security;

drop policy if exists "Users can read todo routines in their store" on public.todo_routines;
create policy "Users can read todo routines in their store"
on public.todo_routines for select to authenticated
using (public.can_access_store(store_id));

drop policy if exists "Users can create todo routines in their store" on public.todo_routines;
create policy "Users can create todo routines in their store"
on public.todo_routines for insert to authenticated
with check (public.can_access_store(store_id) and created_by = auth.uid());

drop policy if exists "Users can update todo routines in their store" on public.todo_routines;
create policy "Users can update todo routines in their store"
on public.todo_routines for update to authenticated
using (public.can_access_store(store_id))
with check (public.can_access_store(store_id));

drop policy if exists "Users can delete todo routines in their store" on public.todo_routines;
create policy "Users can delete todo routines in their store"
on public.todo_routines for delete to authenticated
using (public.can_access_store(store_id));

grant select, insert, update, delete on public.todo_routines to authenticated;

notify pgrst, 'reload schema';
