drop policy if exists "Masters can delete profiles" on public.profiles;
create policy "Masters can delete profiles"
on public.profiles for delete
to authenticated
using (public.is_master(auth.uid()) and id <> auth.uid());

grant delete on public.profiles to authenticated;

notify pgrst, 'reload schema';
