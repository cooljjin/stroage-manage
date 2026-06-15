create table if not exists public.weekly_store_closures (
  weekday smallint primary key check (weekday between 0 and 6),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table if not exists public.store_closure_dates (
  closure_date date primary key,
  reason text,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  check (reason is null or char_length(trim(reason)) > 0)
);

create index if not exists store_closure_dates_date_idx
on public.store_closure_dates (closure_date);

alter table public.weekly_store_closures enable row level security;
alter table public.store_closure_dates enable row level security;

drop policy if exists "Authenticated users can manage weekly store closures" on public.weekly_store_closures;
create policy "Authenticated users can manage weekly store closures"
on public.weekly_store_closures
for all
to authenticated
using (true)
with check (created_by = auth.uid());

drop policy if exists "Authenticated users can manage store closure dates" on public.store_closure_dates;
create policy "Authenticated users can manage store closure dates"
on public.store_closure_dates
for all
to authenticated
using (true)
with check (created_by = auth.uid());

grant select, insert, delete on public.weekly_store_closures to authenticated;
grant select, insert, delete on public.store_closure_dates to authenticated;

create or replace function public.is_store_closed(target_date date)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.weekly_store_closures
    where weekday = extract(dow from target_date)::smallint
  ) or exists (
    select 1
    from public.store_closure_dates
    where closure_date = target_date
  );
$$;

create or replace function public.next_store_business_date(start_date date)
returns date
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  candidate date := start_date;
  attempt integer;
begin
  for attempt in 1..366 loop
    candidate := candidate + 1;
    if not public.is_store_closed(candidate) then
      return candidate;
    end if;
  end loop;

  raise exception '다음 영업일을 계산할 수 없습니다.';
end;
$$;

create or replace function public.move_future_dashboard_items_from_closures()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.dashboard_todos
  set task_date = public.next_store_business_date(task_date - 1)
  where task_date > (now() at time zone 'Asia/Seoul')::date
    and public.is_store_closed(task_date);

  update public.handover_notes
  set handover_date = public.next_store_business_date(handover_date - 1)
  where handover_date > (now() at time zone 'Asia/Seoul')::date
    and public.is_store_closed(handover_date);

  return new;
end;
$$;

drop trigger if exists move_dashboard_items_after_weekly_closure on public.weekly_store_closures;
create trigger move_dashboard_items_after_weekly_closure
after insert on public.weekly_store_closures
for each statement
execute function public.move_future_dashboard_items_from_closures();

drop trigger if exists move_dashboard_items_after_specific_closure on public.store_closure_dates;
create trigger move_dashboard_items_after_specific_closure
after insert on public.store_closure_dates
for each statement
execute function public.move_future_dashboard_items_from_closures();

notify pgrst, 'reload schema';
