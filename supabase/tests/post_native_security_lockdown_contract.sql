-- Run only after supabase/sql/post_native_security_lockdown.sql on an isolated
-- local database. This gate is intentionally not part of normal migrations.

begin;

do $$
begin
  if has_table_privilege('authenticated', 'public.inventory', 'INSERT')
    or has_table_privilege('authenticated', 'public.inventory', 'UPDATE')
    or has_table_privilege('authenticated', 'public.inventory_logs', 'INSERT')
    or has_table_privilege('authenticated', 'public.inventory_logs', 'UPDATE')
    or has_table_privilege('authenticated', 'public.confirmed_order_items', 'INSERT')
    or has_table_privilege('authenticated', 'public.confirmed_order_items', 'UPDATE')
    or has_table_privilege('authenticated', 'public.confirmed_order_items', 'DELETE')
    or has_table_privilege('authenticated', 'public.product_barcodes', 'INSERT')
    or has_table_privilege('authenticated', 'public.product_barcodes', 'UPDATE')
    or has_table_privilege('authenticated', 'public.product_barcodes', 'DELETE')
    or has_table_privilege('authenticated', 'public.profiles', 'SELECT')
    or has_table_privilege('authenticated', 'public.profiles', 'INSERT')
    or has_table_privilege('authenticated', 'public.profiles', 'UPDATE')
    or has_table_privilege('authenticated', 'public.profiles', 'DELETE') then
    raise exception 'a protected direct table privilege survived final lockdown';
  end if;

  if has_function_privilege(
    'authenticated',
    'public.merge_products(uuid,uuid)',
    'EXECUTE'
  ) or has_function_privilege(
    'authenticated',
    'public.register_and_merge_product(uuid,jsonb,uuid,boolean)',
    'EXECUTE'
  ) or has_function_privilege(
    'authenticated',
    'public.restore_inventory_to_log(uuid,numeric,numeric)',
    'EXECUTE'
  ) then
    raise exception 'a legacy mutation RPC survived final lockdown';
  end if;

  if not has_function_privilege(
    'authenticated',
    'public.merge_products_reversible(uuid,uuid,bigint,bigint,bigint,bigint,uuid)',
    'EXECUTE'
  ) or not has_function_privilege(
    'authenticated',
    'public.restore_inventory_to_log_v2(uuid,numeric,numeric,bigint,bigint,uuid)',
    'EXECUTE'
  ) or not has_function_privilege(
    'authenticated',
    'public.get_my_profile()',
    'EXECUTE'
  ) or not has_function_privilege(
    'authenticated',
    'public.list_store_staff_directory()',
    'EXECUTE'
  ) then
    raise exception 'a required replacement RPC was removed by final lockdown';
  end if;

  if exists (
    select 1
    from pg_proc procedure
    join pg_namespace namespace_row
      on namespace_row.oid = procedure.pronamespace
    where namespace_row.nspname = 'public'
      and procedure.prosecdef
      and (
        has_function_privilege('anon', procedure.oid, 'EXECUTE')
        or has_function_privilege('public', procedure.oid, 'EXECUTE')
      )
  ) then
    raise exception 'anonymous SECURITY DEFINER execution survived final lockdown';
  end if;
end;
$$;

rollback;
