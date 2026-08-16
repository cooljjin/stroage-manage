-- Run with a local Supabase database after migrations are applied.
-- This contract test intentionally uses only catalog and privilege checks so it
-- does not mutate application data or require a signed-in fixture user.

begin;

do $$
begin
  if to_regclass('public.mobile_inventory_sessions') is null then
    raise exception 'mobile_inventory_sessions table is missing';
  end if;
  if to_regclass('public.mobile_inventory_session_events') is null then
    raise exception 'mobile_inventory_session_events table is missing';
  end if;
  if to_regprocedure('public.apply_mobile_inventory_change(uuid,uuid,text,text,text,numeric,numeric,timestamptz,uuid,text)') is null then
    raise exception 'apply_mobile_inventory_change RPC is missing';
  end if;
  if to_regprocedure('public.finalize_mobile_inventory_session(uuid,text)') is null then
    raise exception 'finalize_mobile_inventory_session RPC is missing';
  end if;
  if to_regprocedure('public.recover_mobile_inventory_sessions(uuid)') is null then
    raise exception 'recover_mobile_inventory_sessions RPC is missing';
  end if;
  if to_regprocedure('public.restore_inventory_to_mobile_session(uuid,numeric,numeric)') is null then
    raise exception 'restore_inventory_to_mobile_session RPC is missing';
  end if;
  if not exists (
    select 1
    from pg_class
    where oid = 'public.mobile_inventory_sessions'::regclass
      and relrowsecurity
  ) then
    raise exception 'mobile_inventory_sessions RLS is disabled';
  end if;
  if not exists (
    select 1
    from pg_class
    where oid = 'public.mobile_inventory_session_events'::regclass
      and relrowsecurity
  ) then
    raise exception 'mobile_inventory_session_events RLS is disabled';
  end if;
  if has_table_privilege('authenticated', 'public.mobile_inventory_sessions', 'INSERT')
    or has_table_privilege('authenticated', 'public.mobile_inventory_sessions', 'UPDATE')
    or has_table_privilege('authenticated', 'public.mobile_inventory_sessions', 'DELETE') then
    raise exception 'authenticated clients can write mobile_inventory_sessions directly';
  end if;
  if has_table_privilege('authenticated', 'public.mobile_inventory_session_events', 'INSERT')
    or has_table_privilege('authenticated', 'public.mobile_inventory_session_events', 'UPDATE')
    or has_table_privilege('authenticated', 'public.mobile_inventory_session_events', 'DELETE') then
    raise exception 'authenticated clients can write mobile_inventory_session_events directly';
  end if;
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'inventory_logs'
      and column_name = 'mobile_session_id'
  ) or not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'inventory_logs'
      and column_name = 'mobile_session_sequence'
  ) then
    raise exception 'inventory_logs mobile session columns are missing';
  end if;
end;
$$;

rollback;
