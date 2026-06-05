alter table public.products enable row level security;
alter table public.categories enable row level security;
alter table public.profiles enable row level security;
alter table public.suppliers enable row level security;
alter table public.inventory enable row level security;
alter table public.inventory_logs enable row level security;

drop policy if exists "Authenticated users can read products" on public.products;
create policy "Authenticated users can read products"
on public.products for select
to authenticated
using (true);

drop policy if exists "Authenticated users can insert products" on public.products;
create policy "Authenticated users can insert products"
on public.products for insert
to authenticated
with check (true);

drop policy if exists "Authenticated users can update products" on public.products;
create policy "Authenticated users can update products"
on public.products for update
to authenticated
using (true)
with check (true);

drop policy if exists "Authenticated users can delete inactive products" on public.products;
create policy "Authenticated users can delete inactive products"
on public.products for delete
to authenticated
using (is_active = false);

drop policy if exists "Authenticated users can read categories" on public.categories;
create policy "Authenticated users can read categories"
on public.categories for select
to authenticated
using (true);

drop policy if exists "Authenticated users can insert categories" on public.categories;
create policy "Authenticated users can insert categories"
on public.categories for insert
to authenticated
with check (true);

drop policy if exists "Authenticated users can update categories" on public.categories;
create policy "Authenticated users can update categories"
on public.categories for update
to authenticated
using (true)
with check (true);

drop policy if exists "Authenticated users can delete inactive categories" on public.categories;
create policy "Authenticated users can delete inactive categories"
on public.categories for delete
to authenticated
using (is_active = false);

drop policy if exists "Authenticated users can read suppliers" on public.suppliers;
create policy "Authenticated users can read suppliers"
on public.suppliers for select
to authenticated
using (true);

drop policy if exists "Authenticated users can insert suppliers" on public.suppliers;
create policy "Authenticated users can insert suppliers"
on public.suppliers for insert
to authenticated
with check (true);

drop policy if exists "Authenticated users can update suppliers" on public.suppliers;
create policy "Authenticated users can update suppliers"
on public.suppliers for update
to authenticated
using (true)
with check (true);

drop policy if exists "Authenticated users can delete inactive suppliers" on public.suppliers;
create policy "Authenticated users can delete inactive suppliers"
on public.suppliers for delete
to authenticated
using (is_active = false);

drop policy if exists "Authenticated users can read profiles" on public.profiles;
create policy "Authenticated users can read profiles"
on public.profiles for select
to authenticated
using (true);

drop policy if exists "Users can insert own profile" on public.profiles;
create policy "Users can insert own profile"
on public.profiles for insert
to authenticated
with check (id = auth.uid());

drop policy if exists "Admins can update profiles" on public.profiles;
create policy "Admins can update profiles"
on public.profiles for update
to authenticated
using (public.is_admin(auth.uid()))
with check (public.is_admin(auth.uid()));

drop policy if exists "Authenticated users can read inventory" on public.inventory;
create policy "Authenticated users can read inventory"
on public.inventory for select
to authenticated
using (true);

drop policy if exists "Authenticated users can insert inventory" on public.inventory;
create policy "Authenticated users can insert inventory"
on public.inventory for insert
to authenticated
with check (true);

drop policy if exists "Authenticated users can update inventory" on public.inventory;
create policy "Authenticated users can update inventory"
on public.inventory for update
to authenticated
using (true)
with check (warehouse_qty >= 0 and store_qty >= 0);

drop policy if exists "Authenticated users can read logs" on public.inventory_logs;
create policy "Authenticated users can read logs"
on public.inventory_logs for select
to authenticated
using (true);

drop policy if exists "Authenticated users can insert own logs" on public.inventory_logs;
create policy "Authenticated users can insert own logs"
on public.inventory_logs for insert
to authenticated
with check (user_id = auth.uid());

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.products to authenticated;
grant select, insert, update, delete on public.categories to authenticated;
grant select, insert, update, delete on public.suppliers to authenticated;
grant select, insert, update on public.profiles to authenticated;
grant select, insert, update on public.inventory to authenticated;
grant select, insert on public.inventory_logs to authenticated;
grant execute on function public.is_admin(uuid) to authenticated;
