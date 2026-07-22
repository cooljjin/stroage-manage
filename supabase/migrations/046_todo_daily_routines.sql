alter table public.todo_routines
drop constraint if exists todo_routines_schedule_check;

alter table public.todo_routines
add constraint todo_routines_schedule_check check (
  (schedule_type = 'once' and target_date is not null and weekday is null and month_day is null)
  or (schedule_type = 'daily' and target_date is null and weekday is null and month_day is null)
  or (schedule_type = 'weekly' and target_date is null and weekday is not null and month_day is null)
  or (schedule_type = 'monthly' and target_date is null and weekday is null and month_day is not null)
);

notify pgrst, 'reload schema';
