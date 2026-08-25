-- Server-side quota, cost approval, and atomic claim contract. All fixtures
-- and usage rows are rolled back.

begin;

insert into public.stores (id, name)
values ('11000000-0000-0000-0000-000000000001', '레시피 보안 테스트 매장');

insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
) values
  ('00000000-0000-0000-0000-000000000000', '21000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'recipe-user@example.invalid', '', clock_timestamp(), '{}', '{}', clock_timestamp(), clock_timestamp()),
  ('00000000-0000-0000-0000-000000000000', '21000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'recipe-master@example.invalid', '', clock_timestamp(), '{}', '{}', clock_timestamp(), clock_timestamp()),
  ('00000000-0000-0000-0000-000000000000', '21000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'recipe-limited@example.invalid', '', clock_timestamp(), '{}', '{}', clock_timestamp(), clock_timestamp()),
  ('00000000-0000-0000-0000-000000000000', '21000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'recipe-concurrent-a@example.invalid', '', clock_timestamp(), '{}', '{}', clock_timestamp(), clock_timestamp()),
  ('00000000-0000-0000-0000-000000000000', '21000000-0000-0000-0000-000000000005', 'authenticated', 'authenticated', 'recipe-concurrent-b@example.invalid', '', clock_timestamp(), '{}', '{}', clock_timestamp(), clock_timestamp()),
  ('00000000-0000-0000-0000-000000000000', '21000000-0000-0000-0000-000000000006', 'authenticated', 'authenticated', 'recipe-concurrent-c@example.invalid', '', clock_timestamp(), '{}', '{}', clock_timestamp(), clock_timestamp());

insert into public.profiles (id, email, display_name, store_id, role) values
  ('21000000-0000-0000-0000-000000000001', 'recipe-user@example.invalid', '레시피 테스트 사용자', '11000000-0000-0000-0000-000000000001', 'store_admin'),
  ('21000000-0000-0000-0000-000000000002', 'recipe-master@example.invalid', '레시피 테스트 master', '11000000-0000-0000-0000-000000000001', 'master'),
  ('21000000-0000-0000-0000-000000000003', 'recipe-limited@example.invalid', '레시피 한도 테스트 사용자', '11000000-0000-0000-0000-000000000001', 'store_admin'),
  ('21000000-0000-0000-0000-000000000004', 'recipe-concurrent-a@example.invalid', '레시피 동시 테스트 A', '11000000-0000-0000-0000-000000000001', 'store_admin'),
  ('21000000-0000-0000-0000-000000000005', 'recipe-concurrent-b@example.invalid', '레시피 동시 테스트 B', '11000000-0000-0000-0000-000000000001', 'store_admin'),
  ('21000000-0000-0000-0000-000000000006', 'recipe-concurrent-c@example.invalid', '레시피 동시 테스트 C', '11000000-0000-0000-0000-000000000001', 'store_admin');

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"21000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);

create temporary table recipe_high_job on commit drop as
select (public.create_recipe_import_job(
  '11000000-0000-0000-0000-000000000001',
  'csv',
  'security-high.csv',
  20,
  repeat('a', 64),
  0.60
)).id as id;
grant select on recipe_high_job to service_role;

select public.save_recipe_import_manifest(
  (select id from recipe_high_job),
  '{"sourceType":"csv","fileName":"security-high.csv","fileSize":20,"cellCount":4,"sheets":[]}'::jsonb
);
select public.mark_recipe_import_uploaded((select id from recipe_high_job));

do $$
begin
  if (select status from public.recipe_import_jobs
      where id = (select id from recipe_high_job)) <> 'awaiting_cost_approval' then
    raise exception 'high-cost upload did not remain pending master approval';
  end if;

  begin
    perform public.approve_recipe_import_job(
      (select id from recipe_high_job),
      0.60
    );
    raise exception 'ordinary user approved more than $0.50';
  exception
    when others then
      if sqlerrm = 'ordinary user approved more than $0.50' then
        raise;
      end if;
  end;
end;
$$;

create temporary table recipe_extra_request on commit drop as
select (public.request_recipe_import_extra_uses(
  5,
  '보안 테스트 추가 분석'
)).id as id;

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"21000000-0000-0000-0000-000000000002","role":"authenticated"}',
  true
);

select public.approve_recipe_import_cost(
  (select id from recipe_high_job),
  0.60,
  '보안 테스트 고비용 승인'
);

do $$
begin
  if (select status from public.recipe_import_jobs
      where id = (select id from recipe_high_job)) <> 'queued' then
    raise exception 'master approval did not queue an uploaded job';
  end if;
end;
$$;

select public.reject_recipe_import_extra_use_request(
  (select id from recipe_extra_request),
  '보안 테스트 반려'
);

select public.grant_recipe_import_extra_uses(
  '21000000-0000-0000-0000-000000000001',
  public.recipe_import_week_start(),
  20,
  '보안 테스트 주간 최대 부여',
  null
);

do $$
begin
  begin
    perform public.grant_recipe_import_extra_uses(
      '21000000-0000-0000-0000-000000000001',
      public.recipe_import_week_start(),
      1,
      '최대 초과 테스트',
      null
    );
    raise exception 'weekly extra-use grant exceeded 20';
  exception
    when others then
      if sqlerrm = 'weekly extra-use grant exceeded 20' then
        raise;
      end if;
  end;
end;
$$;

reset role;
set local role service_role;

do $$
declare
  claim_row record;
  first_start boolean;
  second_start boolean;
begin
  select * into claim_row
  from public.claim_recipe_import_processing(
    (select id from recipe_high_job),
    '21000000-0000-0000-0000-000000000002'
  );
  if claim_row.claimed is distinct from true then
    raise exception 'queued high-cost job was not claimed';
  end if;

  select public.start_recipe_import_gemini(
    (select id from recipe_high_job),
    '21000000-0000-0000-0000-000000000002',
    20,
    'text/csv'
  ) into first_start;
  select public.start_recipe_import_gemini(
    (select id from recipe_high_job),
    '21000000-0000-0000-0000-000000000002',
    20,
    'text/csv'
  ) into second_start;

  if first_start is distinct from true or second_start is distinct from false then
    raise exception 'Gemini retry usage was not idempotent';
  end if;
end;
$$;

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"21000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);

create temporary table recipe_second_job on commit drop as
select (public.create_recipe_import_job(
  '11000000-0000-0000-0000-000000000001',
  'csv',
  'security-second.csv',
  20,
  repeat('b', 64),
  0.10
)).id as id;
grant select on recipe_second_job to service_role;

select public.save_recipe_import_manifest(
  (select id from recipe_second_job),
  '{"sourceType":"csv","fileName":"security-second.csv","fileSize":20,"cellCount":4,"sheets":[]}'::jsonb
);
select public.approve_recipe_import_job((select id from recipe_second_job), 0.10);
select public.mark_recipe_import_uploaded((select id from recipe_second_job));

reset role;
set local role service_role;

do $$
begin
  begin
    perform public.claim_recipe_import_processing(
      (select id from recipe_second_job),
      '21000000-0000-0000-0000-000000000001'
    );
    raise exception 'second concurrent user job was claimed';
  exception
    when others then
      if sqlerrm = 'second concurrent user job was claimed' then
        raise;
      end if;
  end;
end;
$$;

reset role;

insert into public.recipe_import_menus (
  job_id,
  source_key,
  name,
  sort_order,
  review_status,
  decision
) values (
  (select id from recipe_high_job),
  'security-menu',
  '보안 테스트 메뉴',
  1,
  'ready',
  'create'
);

update public.recipe_import_jobs
set status = 'awaiting_cost_approval',
    actual_cost_usd = 0.80,
    total_segments = 1,
    completed_segments = 1
where id = (select id from recipe_high_job);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"21000000-0000-0000-0000-000000000002","role":"authenticated"}',
  true
);

select public.approve_recipe_import_cost(
  (select id from recipe_high_job),
  0.90,
  '완료된 분석 결과 비용 승인'
);

do $$
begin
  if (select status from public.recipe_import_jobs
      where id = (select id from recipe_high_job)) <> 'ready' then
    raise exception 'completed over-budget analysis was queued for duplicate Gemini work';
  end if;
end;
$$;

reset role;

-- A separate user with ten distinct started jobs cannot claim an eleventh.
insert into public.recipe_import_jobs (
  id,
  store_id,
  created_by,
  source_type,
  file_name,
  file_size,
  file_hash,
  storage_path,
  status,
  estimated_cost_usd,
  approved_cost_usd,
  source_uploaded_at
)
select
  gen_random_uuid(),
  '11000000-0000-0000-0000-000000000001',
  '21000000-0000-0000-0000-000000000003',
  'csv',
  'limit-' || series_value || '.csv',
  20,
  encode(digest('limit-' || series_value, 'sha256'), 'hex'),
  'limit/' || series_value,
  'completed',
  0.10,
  0.10,
  clock_timestamp()
from generate_series(1, 10) series_value;

insert into public.recipe_import_usage (job_id, store_id, user_id, week_start)
select
  job.id,
  job.store_id,
  job.created_by,
  public.recipe_import_week_start()
from public.recipe_import_jobs job
where job.created_by = '21000000-0000-0000-0000-000000000003'
  and job.status = 'completed';

insert into public.recipe_import_jobs (
  id,
  store_id,
  created_by,
  source_type,
  file_name,
  file_size,
  file_hash,
  storage_path,
  status,
  estimated_cost_usd,
  approved_cost_usd,
  source_uploaded_at
) values (
  '22000000-0000-0000-0000-000000000001',
  '11000000-0000-0000-0000-000000000001',
  '21000000-0000-0000-0000-000000000003',
  'csv',
  'limit-eleven.csv',
  20,
  repeat('c', 64),
  'limit/eleven',
  'queued',
  0.10,
  0.10,
  clock_timestamp()
);

set local role service_role;
do $$
begin
  begin
    perform public.claim_recipe_import_processing(
      '22000000-0000-0000-0000-000000000001',
      '21000000-0000-0000-0000-000000000003'
    );
    raise exception 'eleventh weekly job was claimed';
  exception
    when others then
      if sqlerrm = 'eleventh weekly job was claimed' then
        raise;
      end if;
  end;
end;
$$;
reset role;

-- Two processing jobs in one store prevent a third user's claim.
insert into public.recipe_import_jobs (
  id, store_id, created_by, source_type, file_name, file_size, file_hash,
  storage_path, status, estimated_cost_usd, approved_cost_usd,
  source_uploaded_at, processing_started_at, processing_claimed_by
) values
  ('22000000-0000-0000-0000-000000000002', '11000000-0000-0000-0000-000000000001', '21000000-0000-0000-0000-000000000004', 'csv', 'concurrent-a.csv', 20, repeat('d', 64), 'concurrent/a', 'processing', 0.10, 0.10, clock_timestamp(), clock_timestamp(), '21000000-0000-0000-0000-000000000004'),
  ('22000000-0000-0000-0000-000000000003', '11000000-0000-0000-0000-000000000001', '21000000-0000-0000-0000-000000000005', 'csv', 'concurrent-b.csv', 20, repeat('e', 64), 'concurrent/b', 'processing', 0.10, 0.10, clock_timestamp(), clock_timestamp(), '21000000-0000-0000-0000-000000000005'),
  ('22000000-0000-0000-0000-000000000004', '11000000-0000-0000-0000-000000000001', '21000000-0000-0000-0000-000000000006', 'csv', 'concurrent-c.csv', 20, repeat('f', 64), 'concurrent/c', 'queued', 0.10, 0.10, clock_timestamp(), null, null);

set local role service_role;
do $$
begin
  begin
    perform public.claim_recipe_import_processing(
      '22000000-0000-0000-0000-000000000004',
      '21000000-0000-0000-0000-000000000006'
    );
    raise exception 'third concurrent store job was claimed';
  exception
    when others then
      if sqlerrm = 'third concurrent store job was claimed' then
        raise;
      end if;
  end;
end;
$$;
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"21000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);

do $$
declare
  quota_row record;
begin
  select * into quota_row from public.get_my_recipe_import_quota();
  if quota_row.base_uses <> 10
    or quota_row.additional_uses <> 20
    or quota_row.used_uses <> 1
    or quota_row.remaining_uses <> 29 then
    raise exception 'weekly quota summary is incorrect';
  end if;
end;
$$;

reset role;
rollback;
