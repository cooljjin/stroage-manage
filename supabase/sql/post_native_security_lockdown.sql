-- FINAL RELEASE GATE — this is deliberately not a migration.
-- Run only after the matching web build and new iOS/Android builds have been
-- installed and verified on real devices. Old installed clients rely on some
-- of these direct grants and legacy RPCs.

begin;

revoke insert, update on table public.inventory from authenticated;
revoke insert, update on table public.inventory_logs from authenticated;
revoke update (note) on table public.inventory_logs from authenticated;
revoke insert, update, delete on table public.confirmed_order_items from authenticated;
revoke insert, update, delete on table public.product_barcodes from authenticated;
revoke insert, update, delete on table public.profiles from authenticated;

revoke execute on function public.merge_products(uuid, uuid)
from authenticated;
revoke execute on function public.register_and_merge_product(uuid, jsonb, uuid, boolean)
from authenticated;
revoke execute on function public.restore_inventory_to_log(uuid, numeric, numeric)
from authenticated;

-- Full profile rows contain email. Updated clients use get_my_profile and the
-- two scoped directory RPCs instead of table reads.
revoke select on table public.profiles from authenticated;

commit;

-- Post-run audit. Both queries must return zero rows. Review the documented
-- authenticated allowlist separately; an empty authenticated list is not the
-- target because signed-in clients use RPCs.
select namespace.nspname, procedure.proname,
       pg_get_function_identity_arguments(procedure.oid) as arguments
from pg_proc procedure
join pg_namespace namespace on namespace.oid = procedure.pronamespace
where namespace.nspname = 'public'
  and procedure.prosecdef
  and (
    has_function_privilege('anon', procedure.oid, 'EXECUTE')
    or has_function_privilege('public', procedure.oid, 'EXECUTE')
  );

select table_name, privilege_type
from information_schema.role_table_grants
where grantee = 'authenticated'
  and table_schema = 'public'
  and (
    (table_name = 'inventory' and privilege_type in ('INSERT', 'UPDATE'))
    or (table_name = 'inventory_logs' and privilege_type in ('INSERT', 'UPDATE'))
    or (table_name = 'confirmed_order_items' and privilege_type in ('INSERT', 'UPDATE', 'DELETE'))
    or (table_name = 'product_barcodes' and privilege_type in ('INSERT', 'UPDATE', 'DELETE'))
    or (table_name = 'profiles' and privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE'))
  );
