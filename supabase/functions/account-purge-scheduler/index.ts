import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type JsonRecord = Record<string, unknown>;

type CandidateStore = {
  id: string;
  status: "active" | "inactive" | "pending_deletion";
  created_by: string | null;
  deletion_requested_at: string | null;
  purge_after: string | null;
  purge_started_at: string | null;
  purge_owner_id: string | null;
};

type StoreMember = {
  id: string;
  role: "master" | "store_admin" | "staff";
  deletion_requested_at: string | null;
};

Deno.serve(async (req) => {
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const expectedSecret = Deno.env.get("ACCOUNT_PURGE_SECRET") ?? "";
  if (!expectedSecret || !safeEqual(req.headers.get("x-account-purge-secret") ?? "", expectedSecret)) {
    return jsonResponse({ error: "정리 작업 인증이 필요합니다." }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: "Edge Function 환경변수가 설정되지 않았습니다." }, 500);
  }

  const body = await req.json().catch(() => ({})) as JsonRecord;
  const dryRun = body.dryRun !== false;
  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  const now = new Date().toISOString();
  const { data: candidates, error: candidateError } = await adminClient
    .from("stores")
    .select("id,status,created_by,deletion_requested_at,purge_after,purge_started_at,purge_owner_id")
    .eq("status", "pending_deletion")
    .lte("purge_after", now)
    .order("purge_after", { ascending: true })
    .limit(100);

  if (candidateError) return jsonResponse({ error: "정리 대상을 조회하지 못했습니다." }, 500);

  const { data: run, error: runError } = await adminClient
    .from("retention_job_runs")
    .insert({
      job_type: "account_purge",
      dry_run: dryRun,
      candidate_count: candidates?.length ?? 0
    })
    .select("id")
    .single();
  if (runError || !run) return jsonResponse({ error: "정리 작업 감사 기록을 만들지 못했습니다." }, 500);

  let successCount = 0;
  let failureCount = 0;
  const errorCodes = new Set<string>();

  for (const candidate of (candidates ?? []) as CandidateStore[]) {
    try {
      const validation = await validatePersonalStore(adminClient, candidate.id, now);
      if (!validation.ok) {
        failureCount += 1;
        errorCodes.add(validation.errorCode);
        continue;
      }

      if (dryRun) {
        successCount += 1;
        continue;
      }

      const ownerId = validation.ownerId;
      const { data: claimed, error: claimError } = await adminClient
        .from("stores")
        .update({
          purge_started_at: candidate.purge_started_at ?? now,
          purge_owner_id: ownerId
        })
        .eq("id", candidate.id)
        .eq("status", "pending_deletion")
        .lte("purge_after", now)
        .select("id")
        .maybeSingle();
      if (claimError || !claimed) throw new PurgeError("STORE_CLAIM_FAILED");

      const revalidation = await validatePersonalStore(adminClient, candidate.id, now, ownerId);
      if (!revalidation.ok) throw new PurgeError(revalidation.errorCode);

      if (revalidation.memberCount === 1) {
        const dependencyError = await deleteOwnerRestrictedDependencies(
          adminClient,
          candidate.id
        );
        if (dependencyError) throw new PurgeError(dependencyError);

        const { error: deleteUserError } = await adminClient.auth.admin.deleteUser(ownerId);
        if (deleteUserError && !isMissingUserError(deleteUserError.message)) {
          throw new PurgeError("AUTH_DELETE_FAILED");
        }
      }

      const { data: deletedStore, error: deleteStoreError } = await adminClient
        .from("stores")
        .delete()
        .eq("id", candidate.id)
        .eq("status", "pending_deletion")
        .select("id")
        .maybeSingle();
      if (deleteStoreError || !deletedStore) throw new PurgeError("STORE_DELETE_FAILED");
      successCount += 1;
    } catch (purgeError) {
      failureCount += 1;
      errorCodes.add(purgeError instanceof PurgeError ? purgeError.code : "UNEXPECTED_PURGE_FAILURE");
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
    candidateCount: candidates?.length ?? 0,
    successCount,
    failureCount,
    errorCodes: [...errorCodes]
  });
});

async function validatePersonalStore(
  adminClient: ReturnType<typeof createClient>,
  storeId: string,
  now: string,
  expectedOwnerId?: string
): Promise<
  | { ok: true; ownerId: string; memberCount: number }
  | { ok: false; errorCode: string }
> {
  const { data: store, error: storeError } = await adminClient
    .from("stores")
    .select("id,status,created_by,deletion_requested_at,purge_after,purge_started_at,purge_owner_id")
    .eq("id", storeId)
    .maybeSingle<CandidateStore>();
  if (storeError || !store) return { ok: false, errorCode: "STORE_NOT_FOUND" };
  if (store.status !== "pending_deletion" || !store.deletion_requested_at || !store.purge_after || store.purge_after > now) {
    return { ok: false, errorCode: "STORE_NOT_EXPIRED" };
  }

  const ownerId = expectedOwnerId ?? store.purge_owner_id ?? store.created_by;
  if (!ownerId
    || (store.created_by && store.created_by !== ownerId)
    || (store.purge_owner_id && store.purge_owner_id !== ownerId)
    || (!store.created_by && (!store.purge_started_at || store.purge_owner_id !== ownerId))) {
    return { ok: false, errorCode: "OWNER_CHANGED" };
  }

  const { data: members, error: memberError } = await adminClient
    .from("profiles")
    .select("id,role,deletion_requested_at")
    .eq("store_id", storeId);
  if (memberError) return { ok: false, errorCode: "MEMBERSHIP_READ_FAILED" };
  const typedMembers = (members ?? []) as StoreMember[];
  if (typedMembers.length === 0) {
    if (!store.purge_started_at || store.purge_owner_id !== ownerId) {
      return { ok: false, errorCode: "OWNER_PROFILE_MISSING" };
    }
    return { ok: true, ownerId, memberCount: 0 };
  }
  if (typedMembers.length !== 1) return { ok: false, errorCode: "MEMBERSHIP_CHANGED" };
  const member = typedMembers[0];
  if (member.id !== ownerId || member.role !== "store_admin" || !member.deletion_requested_at) {
    return { ok: false, errorCode: "OWNER_PROFILE_CHANGED" };
  }
  return { ok: true, ownerId, memberCount: 1 };
}

async function deleteOwnerRestrictedDependencies(
  adminClient: ReturnType<typeof createClient>,
  storeId: string
) {
  // These rows have an ON DELETE RESTRICT reference to auth.users. They are
  // store-scoped and would be removed by the store cascade moments later, but
  // must be cleared first so the Auth Admin deletion can succeed. A retry is
  // safe because each delete is scoped and idempotent.
  for (const tableName of [
    "mobile_inventory_sessions",
    "recipe_import_usage_grants",
    "recipe_import_cost_approvals"
  ]) {
    const { error } = await adminClient
      .from(tableName)
      .delete()
      .eq("store_id", storeId);
    if (error) return "AUTH_DEPENDENCY_DELETE_FAILED";
  }
  return null;
}

class PurgeError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

function isMissingUserError(message: string) {
  const normalized = message.toLowerCase();
  return normalized.includes("user not found") || normalized.includes("not_found");
}

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
