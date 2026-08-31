-- 기존 다중 매장 미래 날짜 삭제 정책을 제거하고 작성자 전용 삭제만 남긴다.
drop policy if exists "Users can delete future handover notes in their store" on public.handover_notes;
drop policy if exists "Authenticated users can delete future handover notes" on public.handover_notes;
drop policy if exists "Authors can delete handover notes" on public.handover_notes;
create policy "Authors can delete handover notes"
on public.handover_notes for delete
to authenticated
using (created_by = auth.uid());

notify pgrst, 'reload schema';
