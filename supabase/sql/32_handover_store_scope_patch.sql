alter table public.handover_notes
  add column if not exists store_id uuid references public.stores(id) on delete restrict;

update public.handover_notes as handover_notes
set store_id = profiles.store_id
from public.profiles as profiles
where handover_notes.created_by = profiles.id
  and profiles.store_id is not null
  and handover_notes.store_id is distinct from profiles.store_id;

update public.handover_notes
set store_id = '00000000-0000-0000-0000-000000000001'
where store_id is null;

alter table public.handover_notes
  alter column store_id set not null;

create index if not exists handover_notes_store_date_idx
on public.handover_notes (store_id, handover_date desc, created_at desc);

drop trigger if exists fill_handover_notes_store_id on public.handover_notes;
create trigger fill_handover_notes_store_id before insert on public.handover_notes
for each row execute function public.fill_current_store_id();

drop policy if exists "Authenticated users can read handover notes" on public.handover_notes;
drop policy if exists "Authenticated users can create handover notes" on public.handover_notes;
drop policy if exists "Authenticated users can delete future handover notes" on public.handover_notes;
drop policy if exists "Users can read handover notes in their store" on public.handover_notes;
drop policy if exists "Users can create handover notes in their store" on public.handover_notes;
drop policy if exists "Users can delete future handover notes in their store" on public.handover_notes;

create policy "Users can read handover notes in their store"
on public.handover_notes for select to authenticated
using (public.can_access_store(store_id));

create policy "Users can create handover notes in their store"
on public.handover_notes for insert to authenticated
with check (public.can_access_store(store_id) and created_by = auth.uid());

create policy "Users can delete future handover notes in their store"
on public.handover_notes for delete to authenticated
using (public.can_access_store(store_id) and handover_date > (now() at time zone 'Asia/Seoul')::date);

grant select, insert, delete on public.handover_notes to authenticated;

notify pgrst, 'reload schema';
