-- Edge Functions use the service-role JWT, which bypasses RLS but still needs
-- ordinary SQL privileges. Keep this list limited to tables directly touched
-- by the server-only functions instead of restoring broad public-schema DML.

grant usage on schema public to service_role;

grant select, update on table public.recipe_import_jobs
to service_role;

grant select, insert, delete on table public.recipe_import_segments
to service_role;

grant select, insert, delete on table public.recipe_import_menus
to service_role;

grant insert on table public.recipe_import_ingredients
to service_role;

grant select on table public.products
to service_role;

grant select on table public.recipe_product_aliases
to service_role;

grant select on table public.staff_permissions
to service_role;

grant select, update, delete on table public.stores
to service_role;

grant select, update, delete on table public.profiles
to service_role;

grant select, insert, update, delete on table public.retention_job_runs
to service_role;

notify pgrst, 'reload schema';
