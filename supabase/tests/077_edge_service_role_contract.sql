-- Server-only Edge Functions need explicit SQL privileges even though the
-- service-role JWT bypasses RLS. Keep the grant list narrow and testable.

begin;

do $$
declare
  privilege_check record;
begin
  for privilege_check in
    select *
    from (values
      ('recipe_import_jobs', 'SELECT'),
      ('recipe_import_jobs', 'UPDATE'),
      ('recipe_import_segments', 'SELECT'),
      ('recipe_import_segments', 'INSERT'),
      ('recipe_import_segments', 'DELETE'),
      ('recipe_import_menus', 'SELECT'),
      ('recipe_import_menus', 'INSERT'),
      ('recipe_import_menus', 'DELETE'),
      ('recipe_import_ingredients', 'INSERT'),
      ('products', 'SELECT'),
      ('recipe_product_aliases', 'SELECT'),
      ('staff_permissions', 'SELECT'),
      ('stores', 'SELECT'),
      ('stores', 'UPDATE'),
      ('stores', 'DELETE'),
      ('profiles', 'SELECT'),
      ('profiles', 'UPDATE'),
      ('profiles', 'DELETE'),
      ('retention_job_runs', 'SELECT'),
      ('retention_job_runs', 'INSERT'),
      ('retention_job_runs', 'UPDATE'),
      ('retention_job_runs', 'DELETE')
    ) as expected(table_name, privilege_name)
  loop
    if not has_table_privilege(
      'service_role',
      'public.' || privilege_check.table_name,
      privilege_check.privilege_name
    ) then
      raise exception 'service_role lacks % on %',
        privilege_check.privilege_name,
        privilege_check.table_name;
    end if;
  end loop;

  if has_table_privilege('service_role', 'public.inventory', 'UPDATE')
    or has_table_privilege('service_role', 'public.inventory_logs', 'INSERT')
    or has_table_privilege('service_role', 'public.product_barcodes', 'UPDATE') then
    raise exception 'service_role Edge grant expanded into protected inventory tables';
  end if;

  if not has_function_privilege(
    'service_role',
    'public.claim_recipe_import_processing(uuid,uuid)',
    'EXECUTE'
  ) or not has_function_privilege(
    'service_role',
    'public.start_recipe_import_gemini(uuid,uuid,bigint,text)',
    'EXECUTE'
  ) then
    raise exception 'service_role lacks a required recipe-import RPC';
  end if;

  if has_function_privilege(
    'anon',
    'public.claim_recipe_import_processing(uuid,uuid)',
    'EXECUTE'
  ) or has_function_privilege(
    'authenticated',
    'public.start_recipe_import_gemini(uuid,uuid,bigint,text)',
    'EXECUTE'
  ) then
    raise exception 'server-only recipe-import RPC leaked to a client role';
  end if;
end;
$$;

rollback;
