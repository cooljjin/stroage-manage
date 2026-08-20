-- Keep the user-facing filename intact while using an ASCII-only Storage key.
-- Supabase Storage rejects non-ASCII object keys, including Korean filenames.
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
  original_file_name text := nullif(trim(coalesce(target_file_name, '')), '');
  storage_file_name text;
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

  if original_file_name is null then
    original_file_name := 'recipe-source.' || target_source_type;
  end if;
  storage_file_name := 'source.' || target_source_type;

  insert into public.recipe_import_jobs (
    store_id, created_by, source_type, file_name, file_size, file_hash,
    storage_path, estimated_cost_usd, source_expires_at
  ) values (
    target_store_id, auth.uid(), target_source_type, original_file_name,
    target_file_size, trim(target_file_hash),
    target_store_id::text || '/' || auth.uid()::text || '/' || gen_random_uuid()::text || '/' || storage_file_name,
    target_estimated_cost_usd, clock_timestamp() + interval '7 days'
  ) returning * into created_job;

  return created_job;
end;
$$;
