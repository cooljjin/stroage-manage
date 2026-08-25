-- 인수인계 노출 종료일과 작성자 전용 삭제 정책을 추가한다.
alter table public.handover_notes
  add column if not exists visible_until date;

create index if not exists handover_notes_visibility_idx
on public.handover_notes (store_id, handover_date, visible_until, created_at desc);

drop policy if exists "Authenticated users can delete future handover notes" on public.handover_notes;
drop policy if exists "Authors can delete handover notes" on public.handover_notes;
create policy "Authors can delete handover notes"
on public.handover_notes for delete
to authenticated
using (created_by = auth.uid());

grant select, insert, delete on public.handover_notes to authenticated;

notify pgrst, 'reload schema';
