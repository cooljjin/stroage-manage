-- Contract for the shared product lookup budget.
begin;

do $$
declare
  quota_limit integer;
  first_result record;
  second_result record;
  denied_result record;
  reset_result record;
begin
  if to_regclass('public.product_lookup_quota') is null then
    raise exception 'product lookup quota table is missing';
  end if;
  if not has_function_privilege('service_role', 'public.consume_product_lookup_quota(uuid)', 'EXECUTE') then
    raise exception 'service role quota RPC grant is missing';
  end if;
  if has_table_privilege('authenticated', 'public.product_lookup_quota', 'SELECT') then
    raise exception 'authenticated users can read quota state directly';
  end if;
  select q.quota_limit into quota_limit from public.product_lookup_quota as q where q.id;
  if quota_limit <= 0 then raise exception 'quota limit must be positive'; end if;

  update public.product_lookup_quota
  set quota_limit = 2, consumed = 0, window_started_at = date_trunc('day', clock_timestamp() at time zone 'utc') at time zone 'utc';
  select * into first_result from public.consume_product_lookup_quota('22000000-0000-0000-0000-000000000001');
  select * into second_result from public.consume_product_lookup_quota('22000000-0000-0000-0000-000000000002');
  select * into denied_result from public.consume_product_lookup_quota('22000000-0000-0000-0000-000000000003');
  if first_result.allowed is not true or first_result.remaining is distinct from 1
    or second_result.allowed is not true or second_result.remaining is distinct from 0
    or denied_result.allowed is not false then
    raise exception 'quota consumption or ceiling denial is incorrect';
  end if;

  update public.product_lookup_quota
  set window_started_at = (date_trunc('day', clock_timestamp() at time zone 'utc') - interval '1 day') at time zone 'utc';
  select * into reset_result from public.consume_product_lookup_quota('22000000-0000-0000-0000-000000000004');
  if reset_result.allowed is not true or reset_result.remaining is distinct from 1 then
    raise exception 'daily quota reset is incorrect';
  end if;

end $$;

rollback;
