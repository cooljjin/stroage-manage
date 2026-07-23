-- 메모는 작성자 본인만 수정할 수 있도록 허용한다.
grant update (note) on table public.inventory_logs to authenticated;

drop policy if exists "Users can update own memo logs in their store" on public.inventory_logs;
create policy "Users can update own memo logs in their store"
on public.inventory_logs for update
to authenticated
using (
  store_id = public.current_store_id(auth.uid())
  and user_id = auth.uid()
  and action = '메모'
)
with check (
  store_id = public.current_store_id(auth.uid())
  and user_id = auth.uid()
  and action = '메모'
);
