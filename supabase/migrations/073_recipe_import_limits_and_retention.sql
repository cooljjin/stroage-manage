-- Server-enforced recipe-import quotas, cost approvals, atomic processing
-- claims, and retention audit metadata.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

alter table public.recipe_import_jobs
  add column if not exists processing_started_at timestamptz,
  add column if not exists processing_claimed_by uuid references auth.users(id) on delete set null,
  add column if not exists gemini_started_at timestamptz,
  add column if not exists verified_file_size bigint,
  add column if not exists verified_mime_type text;

alter table public.stores
  add column if not exists purge_started_at timestamptz,
  add column if not exists purge_owner_id uuid;

create index if not exists recipe_import_jobs_processing_user_idx
on public.recipe_import_jobs (processing_claimed_by, processing_started_at)
where status = 'processing';

create index if not exists recipe_import_jobs_processing_store_idx
on public.recipe_import_jobs (store_id, processing_started_at)
where status = 'processing';

create table public.recipe_import_usage (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null unique references public.recipe_import_jobs(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  week_start date not null,
  started_at timestamptz not null default clock_timestamp(),
  check (extract(isodow from week_start) = 1)
);

create index recipe_import_usage_user_week_idx
on public.recipe_import_usage (user_id, week_start, started_at);

create index recipe_import_usage_store_processing_idx
on public.recipe_import_usage (store_id, started_at);

create table public.recipe_import_extra_use_requests (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  week_start date not null,
  requested_uses integer not null check (requested_uses between 1 and 20),
  reason text not null check (char_length(trim(reason)) between 1 and 500),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  review_reason text,
  created_at timestamptz not null default clock_timestamp(),
  check (extract(isodow from week_start) = 1)
);

create index recipe_import_extra_use_requests_status_idx
on public.recipe_import_extra_use_requests (status, created_at);

create table public.recipe_import_usage_grants (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  week_start date not null,
  additional_uses integer not null check (additional_uses between 1 and 20),
  approved_by uuid not null references auth.users(id) on delete restrict,
  reason text not null check (char_length(trim(reason)) between 1 and 500),
  request_id uuid references public.recipe_import_extra_use_requests(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  check (extract(isodow from week_start) = 1)
);

create index recipe_import_usage_grants_user_week_idx
on public.recipe_import_usage_grants (user_id, week_start, created_at);

create table public.recipe_import_cost_approvals (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.recipe_import_jobs(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  approved_cost_usd numeric(12, 6) not null
    check (approved_cost_usd > 0.50 and approved_cost_usd <= 5.00),
  approved_by uuid not null references auth.users(id) on delete restrict,
  reason text not null check (char_length(trim(reason)) between 1 and 500),
  created_at timestamptz not null default clock_timestamp()
);

create index recipe_import_cost_approvals_job_created_idx
on public.recipe_import_cost_approvals (job_id, created_at desc);

create table public.retention_job_runs (
  id uuid primary key default gen_random_uuid(),
  job_type text not null
    check (job_type in ('recipe_source_cleanup', 'account_purge')),
  dry_run boolean not null,
  candidate_count integer not null default 0 check (candidate_count >= 0),
  success_count integer not null default 0 check (success_count >= 0),
  failure_count integer not null default 0 check (failure_count >= 0),
  error_codes jsonb not null default '[]'::jsonb
    check (jsonb_typeof(error_codes) = 'array'),
  started_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz
);

create index retention_job_runs_type_started_idx
on public.retention_job_runs (job_type, started_at desc);

alter table public.recipe_import_usage enable row level security;
alter table public.recipe_import_extra_use_requests enable row level security;
alter table public.recipe_import_usage_grants enable row level security;
alter table public.recipe_import_cost_approvals enable row level security;
alter table public.retention_job_runs enable row level security;

revoke all on public.recipe_import_usage from public, anon, authenticated;
revoke all on public.recipe_import_extra_use_requests from public, anon, authenticated;
revoke all on public.recipe_import_usage_grants from public, anon, authenticated;
revoke all on public.recipe_import_cost_approvals from public, anon, authenticated;
revoke all on public.retention_job_runs from public, anon, authenticated;

grant select on public.recipe_import_usage to authenticated;
grant select on public.recipe_import_extra_use_requests to authenticated;
grant select on public.recipe_import_usage_grants to authenticated;
grant select on public.recipe_import_cost_approvals to authenticated;
grant select on public.retention_job_runs to authenticated;

create policy "Users can read own recipe usage"
on public.recipe_import_usage for select to authenticated
using (user_id = auth.uid() or public.is_master(auth.uid()));

create policy "Users can read permitted extra-use requests"
on public.recipe_import_extra_use_requests for select to authenticated
using (user_id = auth.uid() or public.is_master(auth.uid()));

create policy "Users can read permitted recipe grants"
on public.recipe_import_usage_grants for select to authenticated
using (user_id = auth.uid() or public.is_master(auth.uid()));

create policy "Users can read permitted cost approvals"
on public.recipe_import_cost_approvals for select to authenticated
using (user_id = auth.uid() or public.is_master(auth.uid()));

create policy "Masters can read retention job runs"
on public.retention_job_runs for select to authenticated
using (public.is_master(auth.uid()));

create or replace function public.recipe_import_week_start(
  target_time timestamptz default clock_timestamp()
)
returns date
language sql
stable
set search_path = public
as $$
  select date_trunc('week', target_time at time zone 'Asia/Seoul')::date
$$;

create or replace function public.create_recipe_import_job(
  target_store_id uuid,
  target_source_type text,
  target_file_name text,
  target_file_size bigint,
  target_file_hash text,
  target_estimated_cost_usd numeric
)
returns public.recipe_import_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  created_job public.recipe_import_jobs%rowtype;
  safe_file_name text := regexp_replace(
    trim(coalesce(target_file_name, 'recipe-source')),
    '[^A-Za-z0-9_.-]+',
    '_',
    'g'
  );
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.';
  end if;
  if not public.can_manage_store_task(
    target_store_id,
    'group_order_recipe_management'
  ) then
    raise exception '메뉴 레시피 등록 권한이 없습니다.';
  end if;
  if target_source_type not in ('xlsx', 'xls', 'csv', 'pdf') then
    raise exception '지원하지 않는 파일 형식입니다.';
  end if;
  if target_file_size is null
    or target_file_size <= 0
    or target_file_size > 52428800 then
    raise exception '파일은 50MB 이하만 가져올 수 있습니다.';
  end if;
  if target_estimated_cost_usd is null
    or target_estimated_cost_usd < 0
    or target_estimated_cost_usd > 5.00 then
    raise exception '예상 비용은 건당 5달러 이하여야 합니다.';
  end if;
  if char_length(trim(coalesce(target_file_hash, ''))) < 32 then
    raise exception '파일 식별자가 올바르지 않습니다.';
  end if;
  if safe_file_name = '' then
    safe_file_name := 'recipe-source';
  end if;

  insert into public.recipe_import_jobs (
    store_id,
    created_by,
    source_type,
    file_name,
    file_size,
    file_hash,
    storage_path,
    status,
    estimated_cost_usd,
    source_expires_at
  ) values (
    target_store_id,
    auth.uid(),
    target_source_type,
    safe_file_name,
    target_file_size,
    trim(target_file_hash),
    target_store_id::text || '/' || auth.uid()::text || '/'
      || gen_random_uuid()::text || '/' || safe_file_name,
    case
      when target_estimated_cost_usd > 0.50 then 'awaiting_cost_approval'
      else 'awaiting_approval'
    end,
    target_estimated_cost_usd,
    clock_timestamp() + interval '7 days'
  ) returning * into created_job;

  return created_job;
end;
$$;

create or replace function public.approve_recipe_import_job(
  target_job_id uuid,
  target_approved_cost_usd numeric
)
returns public.recipe_import_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  target_job public.recipe_import_jobs%rowtype;
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.';
  end if;

  select * into target_job
  from public.recipe_import_jobs job
  where job.id = target_job_id
  for update;

  if not found or not public.can_manage_store_task(
    target_job.store_id,
    'group_order_recipe_management'
  ) then
    raise exception '가져오기 작업에 접근할 권한이 없습니다.';
  end if;
  if target_job.status not in (
    'awaiting_approval',
    'awaiting_cost_approval',
    'failed'
  ) then
    raise exception '현재 상태에서는 비용 승인을 변경할 수 없습니다.';
  end if;
  if target_approved_cost_usd is null
    or target_approved_cost_usd < target_job.estimated_cost_usd then
    raise exception '예상 비용 이상을 승인해 주세요.';
  end if;
  if target_approved_cost_usd > 0.50 then
    raise exception '0.50달러 초과 작업은 master의 건별 승인이 필요합니다.';
  end if;

  update public.recipe_import_jobs job
  set approved_cost_usd = target_approved_cost_usd,
      status = 'queued',
      processing_started_at = null,
      processing_claimed_by = null,
      error_message = null
  where job.id = target_job.id
  returning * into target_job;

  return target_job;
end;
$$;

create or replace function public.request_recipe_import_extra_uses(
  requested_uses integer,
  reason text
)
returns public.recipe_import_extra_use_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  requester_store_id uuid;
  request_row public.recipe_import_extra_use_requests%rowtype;
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.';
  end if;
  if requested_uses is null or requested_uses not between 1 and 20 then
    raise exception '추가 요청 횟수는 1회부터 20회까지입니다.';
  end if;
  if char_length(trim(coalesce(reason, ''))) not between 1 and 500 then
    raise exception '요청 사유는 1자부터 500자까지 입력해 주세요.';
  end if;

  requester_store_id := public.current_store_id(auth.uid());
  if requester_store_id is null then
    raise exception '매장 정보를 찾을 수 없습니다.';
  end if;

  if exists (
    select 1
    from public.recipe_import_extra_use_requests request
    where request.user_id = auth.uid()
      and request.week_start = public.recipe_import_week_start()
      and request.status = 'pending'
  ) then
    raise exception '이번 주에 검토 중인 추가 이용 요청이 있습니다.';
  end if;

  insert into public.recipe_import_extra_use_requests (
    store_id,
    user_id,
    week_start,
    requested_uses,
    reason
  ) values (
    requester_store_id,
    auth.uid(),
    public.recipe_import_week_start(),
    requested_uses,
    trim(reason)
  ) returning * into request_row;

  return request_row;
end;
$$;

create or replace function public.grant_recipe_import_extra_uses(
  target_user_id uuid,
  target_week_start date,
  additional_uses integer,
  reason text,
  target_request_id uuid default null
)
returns public.recipe_import_usage_grants
language plpgsql
security definer
set search_path = public
as $$
declare
  target_profile public.profiles%rowtype;
  normalized_week_start date;
  already_granted integer;
  grant_row public.recipe_import_usage_grants%rowtype;
  normalized_reason text := trim(coalesce($4, ''));
begin
  if auth.uid() is null or not public.is_master(auth.uid()) then
    raise exception 'master만 추가 이용 횟수를 승인할 수 있습니다.';
  end if;
  if additional_uses is null or additional_uses not between 1 and 20 then
    raise exception '추가 승인 횟수는 1회부터 20회까지입니다.';
  end if;
  if char_length(normalized_reason) not between 1 and 500 then
    raise exception '승인 사유는 1자부터 500자까지 입력해 주세요.';
  end if;

  normalized_week_start := date_trunc(
    'week',
    coalesce(target_week_start, public.recipe_import_week_start())::timestamp
  )::date;

  select * into target_profile
  from public.profiles profile
  where profile.id = target_user_id;

  if not found then
    raise exception '승인할 사용자를 찾을 수 없습니다.';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      'recipe-grant:' || target_user_id::text || ':' || normalized_week_start::text,
      0
    )
  );

  select coalesce(sum(grant_item.additional_uses), 0)
  into already_granted
  from public.recipe_import_usage_grants grant_item
  where grant_item.user_id = target_user_id
    and grant_item.week_start = normalized_week_start;

  if already_granted + additional_uses > 20 then
    raise exception '한 주의 추가 승인 합계는 최대 20회입니다.';
  end if;

  if target_request_id is not null then
    perform 1
    from public.recipe_import_extra_use_requests request
    where request.id = target_request_id
      and request.user_id = target_user_id
      and request.week_start = normalized_week_start
      and request.status = 'pending'
    for update;

    if not found then
      raise exception '검토할 추가 이용 요청을 찾을 수 없습니다.';
    end if;
  end if;

  insert into public.recipe_import_usage_grants (
    store_id,
    user_id,
    week_start,
    additional_uses,
    approved_by,
    reason,
    request_id
  ) values (
    target_profile.store_id,
    target_user_id,
    normalized_week_start,
    additional_uses,
    auth.uid(),
    normalized_reason,
    target_request_id
  ) returning * into grant_row;

  if target_request_id is not null then
    update public.recipe_import_extra_use_requests request
    set status = 'approved',
        reviewed_by = auth.uid(),
        reviewed_at = clock_timestamp(),
        review_reason = normalized_reason
    where request.id = target_request_id;
  end if;

  return grant_row;
end;
$$;

create or replace function public.approve_recipe_import_cost(
  target_job_id uuid,
  target_approved_cost_usd numeric,
  reason text
)
returns public.recipe_import_cost_approvals
language plpgsql
security definer
set search_path = public
as $$
declare
  target_job public.recipe_import_jobs%rowtype;
  approval_row public.recipe_import_cost_approvals%rowtype;
begin
  if auth.uid() is null or not public.is_master(auth.uid()) then
    raise exception 'master만 고비용 작업을 승인할 수 있습니다.';
  end if;
  if target_approved_cost_usd is null
    or target_approved_cost_usd <= 0.50
    or target_approved_cost_usd > 5.00 then
    raise exception '건별 승인 금액은 0.50달러 초과, 5달러 이하여야 합니다.';
  end if;
  if char_length(trim(coalesce(reason, ''))) not between 1 and 500 then
    raise exception '승인 사유는 1자부터 500자까지 입력해 주세요.';
  end if;

  select * into target_job
  from public.recipe_import_jobs job
  where job.id = target_job_id
  for update;

  if not found then
    raise exception '가져오기 작업을 찾을 수 없습니다.';
  end if;
  if target_approved_cost_usd < target_job.estimated_cost_usd then
    raise exception '예상 비용 이상을 승인해 주세요.';
  end if;
  if target_job.status not in (
    'awaiting_approval',
    'awaiting_cost_approval',
    'failed'
  ) then
    raise exception '현재 상태에서는 비용을 승인할 수 없습니다.';
  end if;

  insert into public.recipe_import_cost_approvals (
    job_id,
    store_id,
    user_id,
    approved_cost_usd,
    approved_by,
    reason
  ) values (
    target_job.id,
    target_job.store_id,
    target_job.created_by,
    target_approved_cost_usd,
    auth.uid(),
    trim(reason)
  ) returning * into approval_row;

  update public.recipe_import_jobs job
  set approved_cost_usd = target_approved_cost_usd,
      status = 'queued',
      processing_started_at = null,
      processing_claimed_by = null,
      error_message = null
  where job.id = target_job.id;

  return approval_row;
end;
$$;

create or replace function public.get_my_recipe_import_quota()
returns table (
  week_start date,
  base_uses integer,
  additional_uses integer,
  used_uses integer,
  remaining_uses integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  current_week date := public.recipe_import_week_start();
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.';
  end if;

  return query
  with totals as (
    select
      least(coalesce((
        select sum(grant_item.additional_uses)
        from public.recipe_import_usage_grants grant_item
        where grant_item.user_id = auth.uid()
          and grant_item.week_start = current_week
      ), 0), 20)::integer as granted,
      coalesce((
        select count(*)
        from public.recipe_import_usage usage
        where usage.user_id = auth.uid()
          and usage.week_start = current_week
      ), 0)::integer as used
  )
  select
    current_week,
    10,
    totals.granted,
    totals.used,
    greatest(10 + totals.granted - totals.used, 0)
  from totals;
end;
$$;

-- service_role-only: conditionally claims queued -> processing and enforces
-- one active job per user and two per store. No usage is charged yet.
create or replace function public.claim_recipe_import_processing(
  target_job_id uuid,
  target_actor_id uuid
)
returns table (
  claimed boolean,
  job_status text,
  approved_cost_usd numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  target_job public.recipe_import_jobs%rowtype;
  actor_profile public.profiles%rowtype;
  current_week date := public.recipe_import_week_start();
  granted_uses integer;
  used_uses integer;
  actor_can_manage boolean;
  high_cost_approved boolean;
begin
  select * into target_job
  from public.recipe_import_jobs job
  where job.id = target_job_id
  for update;

  if not found then
    raise exception '가져오기 작업을 찾을 수 없습니다.';
  end if;
  if target_job.created_by is null then
    raise exception '작업 소유자를 확인할 수 없습니다.';
  end if;

  select * into actor_profile
  from public.profiles profile
  where profile.id = target_actor_id;

  actor_can_manage := actor_profile.role = 'master'
    or (
      actor_profile.store_id = target_job.store_id
      and (
        actor_profile.role = 'store_admin'
        or exists (
          select 1
          from public.staff_permissions permission
          where permission.store_id = target_job.store_id
            and permission.user_id = target_actor_id
            and permission.permission_key = 'group_order_recipe_management'
        )
      )
    );

  if not coalesce(actor_can_manage, false) then
    raise exception '레시피 가져오기 권한이 없습니다.';
  end if;

  if target_job.status = 'processing' then
    claimed := false;
    job_status := target_job.status;
    approved_cost_usd := target_job.approved_cost_usd;
    return next;
    return;
  end if;

  if target_job.status <> 'queued' then
    claimed := false;
    job_status := target_job.status;
    approved_cost_usd := target_job.approved_cost_usd;
    return next;
    return;
  end if;

  if target_job.approved_cost_usd is null
    or target_job.approved_cost_usd < target_job.estimated_cost_usd
    or target_job.approved_cost_usd > 5.00 then
    raise exception '승인된 비용 한도를 확인해 주세요.';
  end if;

  if target_job.approved_cost_usd > 0.50 then
    select exists (
      select 1
      from public.recipe_import_cost_approvals approval
      where approval.job_id = target_job.id
        and approval.approved_cost_usd >= target_job.approved_cost_usd
    ) into high_cost_approved;

    if not high_cost_approved then
      raise exception 'master의 건별 비용 승인이 필요합니다.';
    end if;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('recipe-user:' || target_job.created_by::text, 0)
  );
  perform pg_advisory_xact_lock(
    hashtextextended('recipe-store:' || target_job.store_id::text, 0)
  );

  update public.recipe_import_jobs job
  set status = 'failed',
      error_message = '처리 제한 시간을 초과했습니다.',
      processing_claimed_by = null
  where job.status = 'processing'
    and job.processing_started_at < clock_timestamp() - interval '15 minutes';

  if exists (
    select 1
    from public.recipe_import_jobs job
    where job.status = 'processing'
      and job.created_by = target_job.created_by
      and job.id <> target_job.id
  ) then
    raise exception '사용자당 한 번에 한 개의 분석만 처리할 수 있습니다.';
  end if;

  if (
    select count(*)
    from public.recipe_import_jobs job
    where job.status = 'processing'
      and job.store_id = target_job.store_id
      and job.id <> target_job.id
  ) >= 2 then
    raise exception '매장당 동시에 두 개의 분석만 처리할 수 있습니다.';
  end if;

  select least(coalesce(sum(grant_item.additional_uses), 0), 20)::integer
  into granted_uses
  from public.recipe_import_usage_grants grant_item
  where grant_item.user_id = target_job.created_by
    and grant_item.week_start = current_week;

  select count(*)::integer
  into used_uses
  from public.recipe_import_usage usage
  where usage.user_id = target_job.created_by
    and usage.week_start = current_week;

  if used_uses >= 10 + granted_uses
    and not exists (
      select 1
      from public.recipe_import_usage usage
      where usage.job_id = target_job.id
    ) then
    raise exception '이번 주 레시피 분석 이용 횟수를 모두 사용했습니다.';
  end if;

  update public.recipe_import_jobs job
  set status = 'processing',
      processing_started_at = clock_timestamp(),
      processing_claimed_by = target_actor_id,
      error_message = null
  where job.id = target_job.id
    and job.status = 'queued';

  if not found then
    claimed := false;
    job_status := target_job.status;
    approved_cost_usd := target_job.approved_cost_usd;
    return next;
    return;
  end if;

  claimed := true;
  job_status := 'processing';
  approved_cost_usd := target_job.approved_cost_usd;
  return next;
end;
$$;

-- service_role-only: called immediately before the outbound Gemini request.
-- A retry of the same job does not consume another weekly use.
create or replace function public.start_recipe_import_gemini(
  target_job_id uuid,
  target_actor_id uuid,
  target_verified_file_size bigint,
  target_verified_mime_type text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  target_job public.recipe_import_jobs%rowtype;
  inserted_usage_id uuid;
begin
  select * into target_job
  from public.recipe_import_jobs job
  where job.id = target_job_id
  for update;

  if not found
    or target_job.status <> 'processing'
    or target_job.processing_claimed_by <> target_actor_id then
    raise exception '분석 작업을 시작할 수 없는 상태입니다.';
  end if;
  if target_verified_file_size is null
    or target_verified_file_size <= 0
    or target_verified_file_size > 52428800
    or target_verified_file_size <> target_job.file_size then
    raise exception 'Storage의 실제 파일 크기가 등록 정보와 일치하지 않습니다.';
  end if;
  if nullif(trim(target_verified_mime_type), '') is null then
    raise exception '검증된 파일 형식이 필요합니다.';
  end if;

  insert into public.recipe_import_usage (
    job_id,
    store_id,
    user_id,
    week_start
  ) values (
    target_job.id,
    target_job.store_id,
    target_job.created_by,
    public.recipe_import_week_start()
  )
  on conflict (job_id) do nothing
  returning id into inserted_usage_id;

  update public.recipe_import_jobs job
  set gemini_started_at = coalesce(job.gemini_started_at, clock_timestamp()),
      verified_file_size = target_verified_file_size,
      verified_mime_type = trim(target_verified_mime_type)
  where job.id = target_job.id;

  return inserted_usage_id is not null;
end;
$$;

revoke all on function public.recipe_import_week_start(timestamptz)
from public, anon;
revoke all on function public.create_recipe_import_job(
  uuid, text, text, bigint, text, numeric
) from public, anon;
revoke all on function public.approve_recipe_import_job(uuid, numeric)
from public, anon;
revoke all on function public.request_recipe_import_extra_uses(integer, text)
from public, anon;
revoke all on function public.grant_recipe_import_extra_uses(
  uuid, date, integer, text, uuid
) from public, anon;
revoke all on function public.approve_recipe_import_cost(uuid, numeric, text)
from public, anon;
revoke all on function public.get_my_recipe_import_quota()
from public, anon;
revoke all on function public.claim_recipe_import_processing(uuid, uuid)
from public, anon, authenticated;
revoke all on function public.start_recipe_import_gemini(
  uuid, uuid, bigint, text
) from public, anon, authenticated;

grant execute on function public.recipe_import_week_start(timestamptz)
to authenticated;
grant execute on function public.create_recipe_import_job(
  uuid, text, text, bigint, text, numeric
) to authenticated;
grant execute on function public.approve_recipe_import_job(uuid, numeric)
to authenticated;
grant execute on function public.request_recipe_import_extra_uses(integer, text)
to authenticated;
grant execute on function public.grant_recipe_import_extra_uses(
  uuid, date, integer, text, uuid
) to authenticated;
grant execute on function public.approve_recipe_import_cost(uuid, numeric, text)
to authenticated;
grant execute on function public.get_my_recipe_import_quota()
to authenticated;
grant execute on function public.claim_recipe_import_processing(uuid, uuid)
to service_role;
grant execute on function public.start_recipe_import_gemini(
  uuid, uuid, bigint, text
) to service_role;

notify pgrst, 'reload schema';
