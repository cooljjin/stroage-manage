-- Complete the upload/approval state machine. Spreadsheet manifests are kept
-- with the private job only until retention cleanup so a master can approve
-- and start a high-cost job after the creator leaves the page.

alter table public.recipe_import_jobs
  add column if not exists source_uploaded_at timestamptz,
  add column if not exists source_manifest jsonb;

create or replace function public.save_recipe_import_manifest(
  target_job_id uuid,
  target_manifest jsonb
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

  if not found
    or target_job.created_by <> auth.uid()
    or not public.can_manage_store_task(
      target_job.store_id,
      'group_order_recipe_management'
    ) then
    raise exception '가져오기 작업에 접근할 권한이 없습니다.';
  end if;
  if target_job.status not in (
    'awaiting_approval',
    'awaiting_cost_approval',
    'uploading'
  ) then
    raise exception '현재 상태에서는 파일 정보를 저장할 수 없습니다.';
  end if;
  if target_manifest is null
    or jsonb_typeof(target_manifest) <> 'object'
    or target_manifest ->> 'sourceType' is distinct from target_job.source_type
    or nullif(target_manifest ->> 'fileName', '') is null
    or (target_manifest ->> 'fileSize')::bigint is distinct from target_job.file_size then
    raise exception '파일 사전 확인 정보가 작업 정보와 일치하지 않습니다.';
  end if;
  if octet_length(target_manifest::text) > 20971520 then
    raise exception '파일 사전 확인 정보는 20MB 이하만 저장할 수 있습니다.';
  end if;

  update public.recipe_import_jobs job
  set source_manifest = target_manifest
  where job.id = target_job.id
  returning * into target_job;

  return target_job;
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
  next_status text;
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.';
  end if;

  select * into target_job
  from public.recipe_import_jobs job
  where job.id = target_job_id
  for update;

  if not found
    or target_job.created_by <> auth.uid()
    or not public.can_manage_store_task(
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
    or target_approved_cost_usd < greatest(
      target_job.estimated_cost_usd,
      target_job.actual_cost_usd
    ) then
    raise exception '예상 또는 실제 비용 이상을 승인해 주세요.';
  end if;
  if target_approved_cost_usd > 0.50 then
    raise exception '0.50달러 초과 작업은 master의 건별 승인이 필요합니다.';
  end if;

  if target_job.gemini_started_at is not null
    and target_job.total_segments > 0
    and target_job.completed_segments = target_job.total_segments then
    select case
      when exists (
        select 1
        from public.recipe_import_menus menu
        where menu.job_id = target_job.id
          and menu.review_status <> 'ready'
      ) then 'needs_review'
      else 'ready'
    end into next_status;
  elsif target_job.source_uploaded_at is not null then
    next_status := 'queued';
  else
    next_status := 'uploading';
  end if;

  update public.recipe_import_jobs job
  set approved_cost_usd = target_approved_cost_usd,
      status = next_status,
      processing_started_at = null,
      processing_claimed_by = null,
      error_message = null
  where job.id = target_job.id
  returning * into target_job;

  return target_job;
end;
$$;

create or replace function public.mark_recipe_import_uploaded(
  target_job_id uuid
)
returns public.recipe_import_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  target_job public.recipe_import_jobs%rowtype;
  has_high_cost_approval boolean := false;
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.';
  end if;

  select * into target_job
  from public.recipe_import_jobs job
  where job.id = target_job_id
  for update;

  if not found
    or target_job.created_by <> auth.uid()
    or not public.can_manage_store_task(
      target_job.store_id,
      'group_order_recipe_management'
    ) then
    raise exception '가져오기 작업에 접근할 권한이 없습니다.';
  end if;
  if target_job.status not in (
    'awaiting_approval',
    'awaiting_cost_approval',
    'uploading',
    'queued'
  ) then
    raise exception '파일 업로드 상태를 변경할 수 없습니다.';
  end if;
  if target_job.storage_path is null or target_job.source_manifest is null then
    raise exception '원본 파일 경로와 사전 확인 정보가 필요합니다.';
  end if;

  if coalesce(target_job.approved_cost_usd, 0) > 0.50 then
    select exists (
      select 1
      from public.recipe_import_cost_approvals approval
      where approval.job_id = target_job.id
        and approval.approved_cost_usd >= target_job.approved_cost_usd
    ) into has_high_cost_approval;
  end if;

  update public.recipe_import_jobs job
  set source_uploaded_at = coalesce(job.source_uploaded_at, clock_timestamp()),
      status = case
        when job.approved_cost_usd is not null
          and job.approved_cost_usd >= job.estimated_cost_usd
          and (
            job.approved_cost_usd <= 0.50
            or has_high_cost_approval
          )
          then 'queued'
        else 'awaiting_cost_approval'
      end,
      error_message = null
  where job.id = target_job.id
  returning * into target_job;

  return target_job;
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
  normalized_reason text := trim(coalesce($3, ''));
  next_status text;
begin
  if auth.uid() is null or not public.is_master(auth.uid()) then
    raise exception 'master만 고비용 작업을 승인할 수 있습니다.';
  end if;
  if target_approved_cost_usd is null
    or target_approved_cost_usd <= 0.50
    or target_approved_cost_usd > 5.00 then
    raise exception '건별 승인 금액은 0.50달러 초과, 5달러 이하여야 합니다.';
  end if;
  if char_length(normalized_reason) not between 1 and 500 then
    raise exception '승인 사유는 1자부터 500자까지 입력해 주세요.';
  end if;

  select * into target_job
  from public.recipe_import_jobs job
  where job.id = target_job_id
  for update;

  if not found then
    raise exception '가져오기 작업을 찾을 수 없습니다.';
  end if;
  if target_approved_cost_usd < greatest(
    target_job.estimated_cost_usd,
    target_job.actual_cost_usd
  ) then
    raise exception '예상 또는 실제 비용 이상을 승인해 주세요.';
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
    normalized_reason
  ) returning * into approval_row;

  if target_job.gemini_started_at is not null
    and target_job.total_segments > 0
    and target_job.completed_segments = target_job.total_segments then
    select case
      when exists (
        select 1
        from public.recipe_import_menus menu
        where menu.job_id = target_job.id
          and menu.review_status <> 'ready'
      ) then 'needs_review'
      else 'ready'
    end into next_status;
  elsif target_job.source_uploaded_at is not null then
    next_status := 'queued';
  else
    next_status := 'uploading';
  end if;

  update public.recipe_import_jobs job
  set approved_cost_usd = target_approved_cost_usd,
      status = next_status,
      processing_started_at = null,
      processing_claimed_by = null,
      error_message = null
  where job.id = target_job.id;

  return approval_row;
end;
$$;

create or replace function public.reject_recipe_import_extra_use_request(
  target_request_id uuid,
  reason text
)
returns public.recipe_import_extra_use_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  request_row public.recipe_import_extra_use_requests%rowtype;
  normalized_reason text := trim(coalesce($2, ''));
begin
  if auth.uid() is null or not public.is_master(auth.uid()) then
    raise exception 'master만 추가 이용 요청을 반려할 수 있습니다.';
  end if;
  if char_length(normalized_reason) not between 1 and 500 then
    raise exception '반려 사유는 1자부터 500자까지 입력해 주세요.';
  end if;

  select * into request_row
  from public.recipe_import_extra_use_requests request
  where request.id = target_request_id
    and request.status = 'pending'
  for update;

  if not found then
    raise exception '검토할 추가 이용 요청을 찾을 수 없습니다.';
  end if;

  update public.recipe_import_extra_use_requests request
  set status = 'rejected',
      reviewed_by = auth.uid(),
      reviewed_at = clock_timestamp(),
      review_reason = normalized_reason
  where request.id = request_row.id
  returning * into request_row;

  return request_row;
end;
$$;

revoke all on function public.save_recipe_import_manifest(uuid, jsonb)
from public, anon;
revoke all on function public.approve_recipe_import_job(uuid, numeric)
from public, anon;
revoke all on function public.mark_recipe_import_uploaded(uuid)
from public, anon;
revoke all on function public.approve_recipe_import_cost(uuid, numeric, text)
from public, anon;
revoke all on function public.reject_recipe_import_extra_use_request(uuid, text)
from public, anon;

grant execute on function public.save_recipe_import_manifest(uuid, jsonb)
to authenticated;
grant execute on function public.approve_recipe_import_job(uuid, numeric)
to authenticated;
grant execute on function public.mark_recipe_import_uploaded(uuid)
to authenticated;
grant execute on function public.approve_recipe_import_cost(uuid, numeric, text)
to authenticated;
grant execute on function public.reject_recipe_import_extra_use_request(uuid, text)
to authenticated;

notify pgrst, 'reload schema';
