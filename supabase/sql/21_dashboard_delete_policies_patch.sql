drop policy if exists "Authenticated users can delete future dashboard todos" on public.dashboard_todos;
create policy "Authenticated users can delete future dashboard todos"
on public.dashboard_todos for delete
to authenticated
using (task_date > (now() at time zone 'Asia/Seoul')::date);

drop policy if exists "Authenticated users can delete future handover notes" on public.handover_notes;
create policy "Authenticated users can delete future handover notes"
on public.handover_notes for delete
to authenticated
using (handover_date > (now() at time zone 'Asia/Seoul')::date);

grant delete on public.dashboard_todos to authenticated;
grant delete on public.handover_notes to authenticated;

notify pgrst, 'reload schema';
