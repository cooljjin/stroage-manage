drop policy if exists "Users can read profiles in their scope" on public.profiles;

create policy "Users can read profiles in their store" on public.profiles
for select to authenticated
using (
  id = auth.uid()
  or public.is_master(auth.uid())
  or store_id = public.current_store_id(auth.uid())
);

