-- Shared, database-backed daily budget for authenticated external catalog lookups.
create table public.product_lookup_quota (
  id boolean primary key default true check (id),
  window_started_at timestamptz not null default (date_trunc('day', now() at time zone 'utc') at time zone 'utc'),
  consumed integer not null default 0 check (consumed >= 0),
  quota_limit integer not null default 1000 check (quota_limit > 0),
  updated_at timestamptz not null default now()
);

insert into public.product_lookup_quota (id)
values (true)
on conflict (id) do nothing;

alter table public.product_lookup_quota enable row level security;
revoke all on public.product_lookup_quota from public, anon, authenticated;

create or replace function public.consume_product_lookup_quota(actor_id uuid)
returns table (allowed boolean, remaining integer, retry_after_seconds integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  quota_row public.product_lookup_quota%rowtype;
  current_window timestamptz := date_trunc('day', clock_timestamp() at time zone 'utc') at time zone 'utc';
begin
  if actor_id is null then
    raise exception '로그인이 필요합니다.';
  end if;

  select * into quota_row
  from public.product_lookup_quota
  where id
  for update;

  if quota_row.window_started_at < current_window then
    update public.product_lookup_quota
    set window_started_at = current_window, consumed = 0, updated_at = clock_timestamp()
    where id
    returning * into quota_row;
  end if;

  if quota_row.consumed >= quota_row.quota_limit then
    return query select false, 0,
      greatest(1, ceil(extract(epoch from (quota_row.window_started_at + interval '1 day' - clock_timestamp())))::integer);
    return;
  end if;

  update public.product_lookup_quota
  set consumed = consumed + 1, updated_at = clock_timestamp()
  where id
  returning * into quota_row;

  return query select true, quota_row.quota_limit - quota_row.consumed, 0;
end;
$$;

revoke all on function public.consume_product_lookup_quota(uuid) from public, anon, authenticated;
grant execute on function public.consume_product_lookup_quota(uuid) to service_role;

notify pgrst, 'reload schema';
