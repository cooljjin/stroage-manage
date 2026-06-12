create table if not exists public.dashboard_todos (
  id uuid primary key default gen_random_uuid(),
  task_date date not null,
  content text not null check (char_length(trim(content)) > 0),
  is_completed boolean not null default false,
  completed_at timestamptz,
  completed_by uuid references auth.users(id) on delete set null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table if not exists public.handover_notes (
  id uuid primary key default gen_random_uuid(),
  handover_date date not null,
  content text not null check (char_length(trim(content)) > 0),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index if not exists dashboard_todos_task_date_idx
on public.dashboard_todos (task_date, created_at);

create index if not exists handover_notes_handover_date_idx
on public.handover_notes (handover_date desc, created_at desc);

alter table public.dashboard_todos enable row level security;
alter table public.handover_notes enable row level security;

drop policy if exists "Authenticated users can read dashboard todos" on public.dashboard_todos;
create policy "Authenticated users can read dashboard todos"
on public.dashboard_todos for select
to authenticated
using (true);

drop policy if exists "Authenticated users can create dashboard todos" on public.dashboard_todos;
create policy "Authenticated users can create dashboard todos"
on public.dashboard_todos for insert
to authenticated
with check (created_by = auth.uid());

drop policy if exists "Authenticated users can update dashboard todos" on public.dashboard_todos;
create policy "Authenticated users can update dashboard todos"
on public.dashboard_todos for update
to authenticated
using (true)
with check (completed_by is null or completed_by = auth.uid());

drop policy if exists "Authenticated users can read handover notes" on public.handover_notes;
create policy "Authenticated users can read handover notes"
on public.handover_notes for select
to authenticated
using (true);

drop policy if exists "Authenticated users can create handover notes" on public.handover_notes;
create policy "Authenticated users can create handover notes"
on public.handover_notes for insert
to authenticated
with check (created_by = auth.uid());

grant select, insert, update on public.dashboard_todos to authenticated;
grant select, insert on public.handover_notes to authenticated;

notify pgrst, 'reload schema';
