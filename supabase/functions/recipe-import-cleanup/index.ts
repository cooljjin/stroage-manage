import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type JsonRecord = Record<string, unknown>;

Deno.serve(async (req) => {
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const expectedSecret = Deno.env.get("RECIPE_IMPORT_CLEANUP_SECRET") ?? "";
  if (!expectedSecret || !safeEqual(req.headers.get("x-cleanup-secret") ?? "", expectedSecret)) {
    return jsonResponse({ error: "정리 작업 인증이 필요합니다." }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return jsonResponse({ error: "Edge Function 환경변수가 설정되지 않았습니다." }, 500);

  const body = await req.json().catch(() => ({})) as JsonRecord;
  const dryRun = body.dryRun !== false;
  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  const { data: jobs, error: jobsError } = await adminClient
    .from("recipe_import_jobs")
    .select("id,storage_path")
    .not("storage_path", "is", null)
    .lte("source_expires_at", new Date().toISOString())
    .order("source_expires_at", { ascending: true })
    .limit(500);

  if (jobsError) return jsonResponse({ error: "정리 대상을 조회하지 못했습니다." }, 500);

  const { data: run, error: runError } = await adminClient
    .from("retention_job_runs")
    .insert({
      job_type: "recipe_source_cleanup",
      dry_run: dryRun,
      candidate_count: jobs?.length ?? 0
    })
    .select("id")
    .single();
  if (runError || !run) return jsonResponse({ error: "정리 작업 감사 기록을 만들지 못했습니다." }, 500);

  let successCount = 0;
  let failureCount = 0;
  const errorCodes = new Set<string>();

  if (!dryRun) {
    for (const job of jobs ?? []) {
      if (!job.storage_path) continue;
      const { error: removeError } = await adminClient.storage.from("recipe-imports").remove([job.storage_path]);
      if (removeError) {
        failureCount += 1;
        errorCodes.add("STORAGE_DELETE_FAILED");
        continue;
      }

      const { error: updateError } = await adminClient
        .from("recipe_import_jobs")
        .update({ storage_path: null })
        .eq("id", job.id)
        .eq("storage_path", job.storage_path);
      if (updateError) {
        failureCount += 1;
        errorCodes.add("JOB_UPDATE_FAILED");
      } else {
        successCount += 1;
      }
    }
  }

  await adminClient
    .from("retention_job_runs")
    .update({
      success_count: successCount,
      failure_count: failureCount,
      error_codes: [...errorCodes],
      completed_at: new Date().toISOString()
    })
    .eq("id", run.id);

  await adminClient
    .from("retention_job_runs")
    .delete()
    .lt("started_at", new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString());

  return jsonResponse({
    ok: failureCount === 0,
    dryRun,
    candidateCount: jobs?.length ?? 0,
    successCount,
    failureCount,
    errorCodes: [...errorCodes]
  });
});

function safeEqual(left: string, right: string) {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  let difference = leftBytes.length ^ rightBytes.length;
  const length = Math.max(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return difference === 0;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}
