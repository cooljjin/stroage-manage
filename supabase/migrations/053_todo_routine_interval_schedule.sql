alter table public.todo_routines
add column if not exists interval_days integer;

alter table public.todo_routines
drop constraint if exists todo_routines_interval_days_check;

alter table public.todo_routines
add constraint todo_routines_interval_days_check check (interval_days is null or interval_days >= 1);

alter table public.todo_routines
drop constraint if exists todo_routines_schedule_check;

alter table public.todo_routines
add constraint todo_routines_schedule_check check (
  (schedule_type = 'once' and target_date is not null and weekday is null and month_day is null and interval_days is null)
  or (schedule_type = 'daily' and target_date is null and weekday is null and month_day is null and interval_days is null)
  or (schedule_type = 'weekly' and target_date is null and weekday is not null and month_day is null and interval_days is null)
  or (schedule_type = 'monthly' and target_date is null and weekday is null and month_day is not null and interval_days is null)
  or (schedule_type = 'interval' and target_date is null and weekday is null and month_day is null and interval_days is not null)
);

notify pgrst, 'reload schema';
