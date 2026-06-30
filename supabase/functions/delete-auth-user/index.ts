import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return jsonResponse({ error: "Edge Function 환경변수가 설정되지 않았습니다." }, 500);
  }

  const authorization = req.headers.get("Authorization");
  if (!authorization) {
    return jsonResponse({ error: "로그인이 필요합니다." }, 401);
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } }
  });
  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  const { data: authData, error: authError } = await userClient.auth.getUser();
  if (authError || !authData.user) {
    return jsonResponse({ error: authError?.message ?? "로그인이 필요합니다." }, 401);
  }

  const { data: requester, error: requesterError } = await adminClient
    .from("profiles")
    .select("id, role, store_id")
    .eq("id", authData.user.id)
    .single();

  if (requesterError || !requester || !["master", "store_admin"].includes(requester.role)) {
    return jsonResponse({ error: "사용자를 삭제할 권한이 없습니다." }, 403);
  }

  const { userId } = await req.json().catch(() => ({ userId: "" }));
  if (!userId || typeof userId !== "string") {
    return jsonResponse({ error: "삭제할 사용자 ID가 필요합니다." }, 400);
  }

  if (userId === authData.user.id) {
    return jsonResponse({ error: "본인 계정은 삭제할 수 없습니다." }, 400);
  }

  const { data: targetProfile, error: targetError } = await adminClient
    .from("profiles")
    .select("id, role, store_id")
    .eq("id", userId)
    .single();

  if (targetError || !targetProfile) {
    return jsonResponse({ error: "삭제할 사용자를 찾을 수 없습니다." }, 404);
  }

  if (requester.role !== "master") {
    const canDeleteStaffInOwnStore = requester.store_id === targetProfile.store_id && targetProfile.role === "staff";
    if (!canDeleteStaffInOwnStore) {
      return jsonResponse({ error: "관리자는 같은 매장의 직원만 삭제할 수 있습니다." }, 403);
    }
  }

  const { error: deleteError } = await adminClient.auth.admin.deleteUser(userId);
  if (deleteError) {
    return jsonResponse({ error: deleteError.message }, 400);
  }

  await adminClient.from("profiles").delete().eq("id", userId);

  return jsonResponse({ ok: true });
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    }
  });
}
