-- A personal-store owner may still be referenced by server-created audit or
-- mobile-session rows with ON DELETE RESTRICT. The scheduler removes only the
-- expiring store's copies immediately before deleting the Auth user.

grant select, delete on table public.mobile_inventory_sessions
to service_role;

grant select, delete on table public.recipe_import_usage_grants
to service_role;

grant select, delete on table public.recipe_import_cost_approvals
to service_role;

notify pgrst, 'reload schema';
