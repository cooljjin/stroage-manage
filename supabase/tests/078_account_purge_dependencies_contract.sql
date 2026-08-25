-- Keep account-purge preparation aligned with every store-scoped public table
-- that can block deletion of an Auth user.

begin;

do $$
begin
  if not has_table_privilege(
    'service_role',
    'public.mobile_inventory_sessions',
    'SELECT, DELETE'
  ) or not has_table_privilege(
    'service_role',
    'public.recipe_import_usage_grants',
    'SELECT, DELETE'
  ) or not has_table_privilege(
    'service_role',
    'public.recipe_import_cost_approvals',
    'SELECT, DELETE'
  ) then
    raise exception 'service_role cannot clear an Auth deletion dependency';
  end if;

  if exists (
    select 1
    from pg_constraint constraint_row
    join pg_namespace namespace_row
      on namespace_row.oid = constraint_row.connamespace
    where constraint_row.contype = 'f'
      and constraint_row.confrelid = 'auth.users'::regclass
      and constraint_row.confdeltype = 'r'
      and namespace_row.nspname = 'public'
      and constraint_row.conrelid not in (
        'public.mobile_inventory_sessions'::regclass,
        'public.recipe_import_usage_grants'::regclass,
        'public.recipe_import_cost_approvals'::regclass
      )
  ) then
    raise exception 'a new Auth RESTRICT dependency is missing from account purge';
  end if;
end;
$$;

rollback;
