-- AI-assisted group-order recipe import and unlinked ingredient support.
-- The source file is kept in private Storage; these tables retain only the
-- normalized review state and enough provenance to audit a decision.

alter table public.group_order_recipe_ingredients
  alter column product_id drop not null;

alter table public.group_order_recipe_ingredients
  add column if not exists ingredient_name text;

alter table public.group_order_recipe_ingredients
  drop constraint if exists group_order_recipe_ingredients_product_or_name_check;

alter table public.group_order_recipe_ingredients
  add constraint group_order_recipe_ingredients_product_or_name_check
  check (product_id is not null or char_length(trim(coalesce(ingredient_name, ''))) > 0);

create index if not exists group_order_recipe_ingredients_menu_custom_name_idx
on public.group_order_recipe_ingredients (menu_id, lower(trim(ingredient_name)))
where product_id is null;

create table if not exists public.recipe_import_jobs (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  source_type text not null check (source_type in ('xlsx', 'xls', 'csv', 'pdf')),
  file_name text not null check (char_length(trim(file_name)) > 0),
  file_size bigint not null check (file_size > 0 and file_size <= 52428800),
  file_hash text not null check (char_length(trim(file_hash)) >= 32),
  storage_path text,
  status text not null default 'awaiting_approval'
    check (status in ('awaiting_approval', 'uploading', 'queued', 'processing', 'needs_review', 'ready', 'awaiting_cost_approval', 'applying', 'completed', 'failed', 'cancelled')),
  estimated_cost_usd numeric(12, 6) not null default 0 check (estimated_cost_usd >= 0),
  approved_cost_usd numeric(12, 6) check (approved_cost_usd is null or approved_cost_usd >= 0),
  actual_cost_usd numeric(12, 6) not null default 0 check (actual_cost_usd >= 0),
  input_tokens bigint not null default 0 check (input_tokens >= 0),
  output_tokens bigint not null default 0 check (output_tokens >= 0),
  provider text not null default 'google',
  model text not null default 'gemini-2.5-flash-lite',
  prompt_version text not null default 'recipe-import-v1',
  total_segments integer not null default 0 check (total_segments >= 0),
  completed_segments integer not null default 0 check (completed_segments >= 0),
  error_message text,
  source_expires_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz
);

create index if not exists recipe_import_jobs_store_created_idx
on public.recipe_import_jobs (store_id, created_at desc);

create index if not exists recipe_import_jobs_hash_idx
on public.recipe_import_jobs (store_id, file_hash, status);

create table if not exists public.recipe_import_segments (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.recipe_import_jobs(id) on delete cascade,
  segment_key text not null,
  segment_kind text not null check (segment_kind in ('workbook', 'sheet', 'pdf_pages')),
  page_start integer,
  page_end integer,
  payload jsonb,
  status text not null default 'queued'
    check (status in ('queued', 'processing', 'completed', 'needs_review', 'failed')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  extracted_json jsonb,
  input_tokens bigint not null default 0 check (input_tokens >= 0),
  output_tokens bigint not null default 0 check (output_tokens >= 0),
  actual_cost_usd numeric(12, 6) not null default 0 check (actual_cost_usd >= 0),
  error_message text,
  locked_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (job_id, segment_key)
);

create index if not exists recipe_import_segments_queue_idx
on public.recipe_import_segments (status, updated_at);

create table if not exists public.recipe_import_menus (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.recipe_import_jobs(id) on delete cascade,
  source_key text not null,
  name text not null check (char_length(trim(name)) > 0),
  sort_order integer not null default 1000 check (sort_order >= 1),
  yield_quantity numeric(12, 4),
  yield_unit text,
  source_refs jsonb not null default '[]'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  confidence numeric(5, 4) check (confidence is null or confidence between 0 and 1),
  review_status text not null default 'review'
    check (review_status in ('ready', 'review', 'rejected')),
  decision text not null default 'create'
    check (decision in ('create', 'replace', 'skip')),
  existing_menu_id uuid references public.group_order_menus(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  unique (job_id, source_key)
);

create table if not exists public.recipe_import_ingredients (
  id uuid primary key default gen_random_uuid(),
  import_menu_id uuid not null references public.recipe_import_menus(id) on delete cascade,
  source_name text not null check (char_length(trim(source_name)) > 0),
  source_quantity numeric(12, 4),
  source_unit text,
  quantity_per_item numeric(12, 4) not null check (quantity_per_item > 0),
  quantity_unit text not null check (quantity_unit in ('g', 'kg', 'ml', 'L', '개')),
  product_id uuid references public.products(id) on delete restrict,
  ingredient_name text,
  source_refs jsonb not null default '[]'::jsonb,
  candidates jsonb not null default '[]'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  confidence numeric(5, 4) check (confidence is null or confidence between 0 and 1),
  match_status text not null default 'review'
    check (match_status in ('matched', 'temporary', 'review', 'rejected')),
  created_at timestamptz not null default clock_timestamp(),
  check (product_id is not null or char_length(trim(coalesce(ingredient_name, ''))) > 0)
);

create index if not exists recipe_import_ingredients_menu_idx
on public.recipe_import_ingredients (import_menu_id);

create table if not exists public.recipe_product_aliases (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  alias_normalized text not null check (char_length(trim(alias_normalized)) > 0),
  alias_display text not null check (char_length(trim(alias_display)) > 0),
  product_id uuid not null references public.products(id) on delete cascade,
  unit_context text,
  confirmed_count integer not null default 1 check (confirmed_count > 0),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (store_id, alias_normalized, unit_context)
);

create index if not exists recipe_product_aliases_store_alias_idx
on public.recipe_product_aliases (store_id, alias_normalized);

insert into storage.buckets (id, name, public)
values ('recipe-imports', 'recipe-imports', false)
on conflict (id) do update set public = false;

drop policy if exists "Recipe managers can upload recipe sources" on storage.objects;
create policy "Recipe managers can upload recipe sources"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'recipe-imports'
  and public.can_manage_store_task((storage.foldername(name))[1]::uuid, 'group_order_recipe_management')
);

drop policy if exists "Recipe managers can read recipe sources" on storage.objects;
create policy "Recipe managers can read recipe sources"
on storage.objects for select to authenticated
using (
  bucket_id = 'recipe-imports'
  and public.can_manage_store_task((storage.foldername(name))[1]::uuid, 'group_order_recipe_management')
);

drop policy if exists "Recipe managers can delete recipe sources" on storage.objects;
create policy "Recipe managers can delete recipe sources"
on storage.objects for delete to authenticated
using (
  bucket_id = 'recipe-imports'
  and public.can_manage_store_task((storage.foldername(name))[1]::uuid, 'group_order_recipe_management')
);

create or replace function public.touch_recipe_import_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = clock_timestamp();
  return new;
end;
$$;

drop trigger if exists recipe_import_jobs_touch_updated_at on public.recipe_import_jobs;
create trigger recipe_import_jobs_touch_updated_at
before update on public.recipe_import_jobs
for each row execute function public.touch_recipe_import_updated_at();

drop trigger if exists recipe_import_segments_touch_updated_at on public.recipe_import_segments;
create trigger recipe_import_segments_touch_updated_at
before update on public.recipe_import_segments
for each row execute function public.touch_recipe_import_updated_at();

drop trigger if exists recipe_product_aliases_touch_updated_at on public.recipe_product_aliases;
create trigger recipe_product_aliases_touch_updated_at
before update on public.recipe_product_aliases
for each row execute function public.touch_recipe_import_updated_at();

create or replace function public.validate_group_order_recipe_ingredient()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  menu_store_id uuid;
  product_store_id uuid;
begin
  select store_id into menu_store_id
  from public.group_order_menus
  where id = new.menu_id;

  if menu_store_id is null then
    raise exception '메뉴 레시피를 찾을 수 없습니다.';
  end if;

  if new.product_id is not null then
    select store_id into product_store_id
    from public.products
    where id = new.product_id and is_active = true;

    if product_store_id is null then
      raise exception '재료 품목을 찾을 수 없습니다.';
    end if;
  elsif char_length(trim(coalesce(new.ingredient_name, ''))) = 0 then
    raise exception '재고 품목 또는 임시 재료명이 필요합니다.';
  end if;

  if new.store_id is null then new.store_id := menu_store_id; end if;
  if new.store_id <> menu_store_id or (product_store_id is not null and new.store_id <> product_store_id) then
    raise exception '같은 매장의 메뉴와 재료만 등록할 수 있습니다.';
  end if;

  if new.quantity_per_item is null or new.quantity_per_item <= 0 then
    raise exception '재료 사용량은 0보다 커야 합니다.';
  end if;
  if new.quantity_unit not in ('g', 'kg', 'ml', 'L', '개') then
    raise exception '지원하지 않는 레시피 단위입니다.';
  end if;
  if new.product_id is not null then new.ingredient_name := null; end if;
  return new;
end;
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
  safe_file_name text := regexp_replace(trim(coalesce(target_file_name, 'recipe-source')), '[^[:alnum:]_.-]+', '_', 'g');
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다.'; end if;
  if not public.can_manage_store_task(target_store_id, 'group_order_recipe_management') then
    raise exception '메뉴 레시피 등록 권한이 없습니다.';
  end if;
  if target_source_type not in ('xlsx', 'xls', 'csv', 'pdf') then
    raise exception '지원하지 않는 파일 형식입니다.';
  end if;
  if target_file_size is null or target_file_size <= 0 or target_file_size > 52428800 then
    raise exception '파일은 50MB 이하만 가져올 수 있습니다.';
  end if;
  if target_estimated_cost_usd is null or target_estimated_cost_usd < 0 then
    raise exception '예상 비용이 올바르지 않습니다.';
  end if;
  if nullif(trim(coalesce(target_file_hash, '')), '') is null then
    raise exception '파일 식별자가 필요합니다.';
  end if;
  if safe_file_name = '' then safe_file_name := 'recipe-source'; end if;

  insert into public.recipe_import_jobs (
    store_id, created_by, source_type, file_name, file_size, file_hash,
    storage_path, estimated_cost_usd, source_expires_at
  ) values (
    target_store_id, auth.uid(), target_source_type, safe_file_name,
    target_file_size, trim(target_file_hash),
    target_store_id::text || '/' || auth.uid()::text || '/' || gen_random_uuid()::text || '/' || safe_file_name,
    target_estimated_cost_usd, clock_timestamp() + interval '7 days'
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
  select * into target_job from public.recipe_import_jobs where id = target_job_id for update;
  if not found or not public.can_manage_store_task(target_job.store_id, 'group_order_recipe_management') then
    raise exception '가져오기 작업에 접근할 권한이 없습니다.';
  end if;
  if target_job.status not in ('awaiting_approval', 'awaiting_cost_approval') then
    raise exception '현재 상태에서는 비용 승인을 변경할 수 없습니다.';
  end if;
  if target_approved_cost_usd is null or target_approved_cost_usd < target_job.estimated_cost_usd then
    raise exception '예상 비용 이상을 승인해 주세요.';
  end if;

  update public.recipe_import_jobs
  set approved_cost_usd = target_approved_cost_usd,
      status = case when storage_path is null then 'uploading' else 'queued' end,
      error_message = null
  where id = target_job.id
  returning * into target_job;
  return target_job;
end;
$$;

create or replace function public.mark_recipe_import_uploaded(target_job_id uuid)
returns public.recipe_import_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  target_job public.recipe_import_jobs%rowtype;
begin
  select * into target_job from public.recipe_import_jobs where id = target_job_id for update;
  if not found or not public.can_manage_store_task(target_job.store_id, 'group_order_recipe_management') then
    raise exception '가져오기 작업에 접근할 권한이 없습니다.';
  end if;
  if target_job.status not in ('uploading', 'queued') then
    raise exception '파일 업로드 상태를 변경할 수 없습니다.';
  end if;
  update public.recipe_import_jobs
  set status = 'queued', error_message = null
  where id = target_job.id
  returning * into target_job;
  return target_job;
end;
$$;

create or replace function public.apply_group_order_recipe_import_idempotent(
  target_job_id uuid,
  request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_job public.recipe_import_jobs%rowtype;
  request_row public.mutation_requests%rowtype;
  imported_menu public.recipe_import_menus%rowtype;
  imported_ingredient public.recipe_import_ingredients%rowtype;
  saved_menu_id uuid;
  result_json jsonb;
  applied_count integer := 0;
  ingredient_sort_order integer;
begin
  select * into target_job from public.recipe_import_jobs where id = target_job_id for update;
  if not found or not public.can_manage_store_task(target_job.store_id, 'group_order_recipe_management') then
    raise exception '가져오기 작업에 접근할 권한이 없습니다.';
  end if;
  if target_job.status not in ('ready', 'needs_review') then
    raise exception '검토가 끝난 가져오기 작업만 저장할 수 있습니다.';
  end if;
  if exists (
    select 1 from public.recipe_import_menus
    where job_id = target_job.id and decision <> 'skip'
      and (review_status <> 'ready' or (decision = 'replace' and existing_menu_id is null))
  ) then
    raise exception '검토가 끝나지 않은 메뉴가 있습니다.';
  end if;

  request_row := public.claim_mutation_request(target_job.store_id, 'apply_group_order_recipe_import', request_id);
  if request_row.completed_at is not null then return request_row.result_json; end if;

  update public.recipe_import_jobs set status = 'applying' where id = target_job.id;

  for imported_menu in
    select * from public.recipe_import_menus
    where job_id = target_job.id and decision <> 'skip'
    order by sort_order, name
  loop
    if imported_menu.decision = 'replace' then
      saved_menu_id := imported_menu.existing_menu_id;
      update public.group_order_menus
      set name = imported_menu.name, sort_order = imported_menu.sort_order, is_active = true
      where id = saved_menu_id and store_id = target_job.store_id;
      if not found then raise exception '교체할 기존 메뉴를 찾을 수 없습니다.'; end if;
      delete from public.group_order_recipe_ingredients where menu_id = saved_menu_id and store_id = target_job.store_id;
    else
      insert into public.group_order_menus (store_id, name, sort_order, is_active)
      values (target_job.store_id, imported_menu.name, imported_menu.sort_order, true)
      returning id into saved_menu_id;
    end if;

    ingredient_sort_order := 0;
    for imported_ingredient in
      select * from public.recipe_import_ingredients
      where import_menu_id = imported_menu.id
      order by created_at, id
    loop
      ingredient_sort_order := ingredient_sort_order + 1;
      insert into public.group_order_recipe_ingredients (
        store_id, menu_id, product_id, ingredient_name,
        quantity_per_item, quantity_unit, sort_order
      ) values (
        target_job.store_id, saved_menu_id, imported_ingredient.product_id,
        case when imported_ingredient.product_id is null then imported_ingredient.ingredient_name else null end,
        imported_ingredient.quantity_per_item, imported_ingredient.quantity_unit,
        ingredient_sort_order
      );
    end loop;
    applied_count := applied_count + 1;
  end loop;

  result_json := jsonb_build_object('job_id', target_job.id, 'applied_menu_count', applied_count);
  update public.recipe_import_jobs
  set status = 'completed', completed_at = clock_timestamp(), error_message = null
  where id = target_job.id;
  perform public.complete_mutation_request(request_row.id, result_json);
  return result_json;
end;
$$;

create or replace function public.link_recipe_product_alias(
  target_store_id uuid,
  target_alias text,
  target_product_id uuid,
  target_unit_context text default null
)
returns public.recipe_product_aliases
language plpgsql
security definer
set search_path = public
as $$
declare
  alias_row public.recipe_product_aliases%rowtype;
  normalized_alias text := lower(regexp_replace(trim(coalesce(target_alias, '')), '\s+', '', 'g'));
begin
  if not public.can_manage_store_task(target_store_id, 'group_order_recipe_management') then
    raise exception '메뉴 레시피 등록 권한이 없습니다.';
  end if;
  if normalized_alias = '' then raise exception '품목 별칭이 비어 있습니다.'; end if;
  if not exists (select 1 from public.products where id = target_product_id and store_id = target_store_id and is_active) then
    raise exception '연결할 품목을 찾을 수 없습니다.';
  end if;
  insert into public.recipe_product_aliases (
    store_id, alias_normalized, alias_display, product_id, unit_context, confirmed_count
  ) values (
    target_store_id, normalized_alias, trim(target_alias), target_product_id, target_unit_context, 1
  )
  on conflict (store_id, alias_normalized, unit_context) do update
  set product_id = excluded.product_id,
      alias_display = excluded.alias_display,
      confirmed_count = public.recipe_product_aliases.confirmed_count + 1
  returning * into alias_row;
  return alias_row;
end;
$$;

alter table public.recipe_import_jobs enable row level security;
alter table public.recipe_import_segments enable row level security;
alter table public.recipe_import_menus enable row level security;
alter table public.recipe_import_ingredients enable row level security;
alter table public.recipe_product_aliases enable row level security;

drop policy if exists "Recipe managers can read recipe import jobs" on public.recipe_import_jobs;
create policy "Recipe managers can read recipe import jobs"
on public.recipe_import_jobs for select to authenticated
using (public.can_manage_store_task(store_id, 'group_order_recipe_management'));

drop policy if exists "Recipe managers can read recipe import segments" on public.recipe_import_segments;
create policy "Recipe managers can read recipe import segments"
on public.recipe_import_segments for select to authenticated
using (exists (select 1 from public.recipe_import_jobs job where job.id = job_id and public.can_manage_store_task(job.store_id, 'group_order_recipe_management')));

drop policy if exists "Recipe managers can read recipe import menus" on public.recipe_import_menus;
create policy "Recipe managers can read recipe import menus"
on public.recipe_import_menus for select to authenticated
using (exists (select 1 from public.recipe_import_jobs job where job.id = job_id and public.can_manage_store_task(job.store_id, 'group_order_recipe_management')));

drop policy if exists "Recipe managers can manage recipe import menus" on public.recipe_import_menus;
create policy "Recipe managers can manage recipe import menus"
on public.recipe_import_menus for all to authenticated
using (exists (select 1 from public.recipe_import_jobs job where job.id = job_id and public.can_manage_store_task(job.store_id, 'group_order_recipe_management')))
with check (exists (select 1 from public.recipe_import_jobs job where job.id = job_id and public.can_manage_store_task(job.store_id, 'group_order_recipe_management')));

drop policy if exists "Recipe managers can read recipe import ingredients" on public.recipe_import_ingredients;
create policy "Recipe managers can read recipe import ingredients"
on public.recipe_import_ingredients for select to authenticated
using (exists (select 1 from public.recipe_import_menus menu join public.recipe_import_jobs job on job.id = menu.job_id where menu.id = import_menu_id and public.can_manage_store_task(job.store_id, 'group_order_recipe_management')));

drop policy if exists "Recipe managers can manage recipe import ingredients" on public.recipe_import_ingredients;
create policy "Recipe managers can manage recipe import ingredients"
on public.recipe_import_ingredients for all to authenticated
using (exists (select 1 from public.recipe_import_menus menu join public.recipe_import_jobs job on job.id = menu.job_id where menu.id = import_menu_id and public.can_manage_store_task(job.store_id, 'group_order_recipe_management')))
with check (exists (select 1 from public.recipe_import_menus menu join public.recipe_import_jobs job on job.id = menu.job_id where menu.id = import_menu_id and public.can_manage_store_task(job.store_id, 'group_order_recipe_management')));

drop policy if exists "Recipe managers can read recipe aliases" on public.recipe_product_aliases;
create policy "Recipe managers can read recipe aliases"
on public.recipe_product_aliases for select to authenticated
using (public.can_manage_store_task(store_id, 'group_order_recipe_management'));

revoke all on public.recipe_import_jobs from anon, authenticated;
revoke all on public.recipe_import_segments from anon, authenticated;
revoke all on public.recipe_import_menus from anon, authenticated;
revoke all on public.recipe_import_ingredients from anon, authenticated;
revoke all on public.recipe_product_aliases from anon, authenticated;

grant select on public.recipe_import_jobs to authenticated;
grant select on public.recipe_import_segments to authenticated;
grant select, update on public.recipe_import_menus to authenticated;
grant select, update on public.recipe_import_ingredients to authenticated;
grant select on public.recipe_product_aliases to authenticated;
grant execute on function public.create_recipe_import_job(uuid, text, text, bigint, text, numeric) to authenticated;
grant execute on function public.approve_recipe_import_job(uuid, numeric) to authenticated;
grant execute on function public.mark_recipe_import_uploaded(uuid) to authenticated;
grant execute on function public.apply_group_order_recipe_import_idempotent(uuid, uuid) to authenticated;
grant execute on function public.link_recipe_product_alias(uuid, text, uuid, text) to authenticated;

notify pgrst, 'reload schema';
