import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-account-purge-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
}

type Profile = {
  id: string
  store_id: string
  role: "master" | "store_admin" | "staff"
  deletion_requested_at: string | null
}

type Store = {
  id: string
  status: "active" | "inactive" | "pending_deletion"
  created_by: string | null
  deletion_requested_at: string | null
  purge_after: string | null
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405)

  const supabaseUrl = Deno.env.get("SUPABASE_URL")
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return jsonResponse({ error: "Edge Function 환경변수가 설정되지 않았습니다." }, 500)
  }

  const body = await req.json().catch(() => ({})) as { action?: string; transferToUserId?: string }
  const adminClient = createClient(supabaseUrl, serviceRoleKey)

  if (body.action === "purge") {
    if (!isPurgeRequestAllowed(req)) return jsonResponse({ error: "정리 권한이 없습니다." }, 401)
    return purgeExpiredPersonalStores(adminClient)
  }

  const authorization = req.headers.get("Authorization")
  if (!authorization) return jsonResponse({ error: "로그인이 필요합니다." }, 401)
  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } } })
  const { data: authData, error: authError } = await userClient.auth.getUser()
  if (authError || !authData.user) return jsonResponse({ error: authError?.message ?? "로그인이 필요합니다." }, 401)

  const { data: profile, error: profileError } = await adminClient
    .from("profiles")
    .select("id, store_id, role, deletion_requested_at")
    .eq("id", authData.user.id)
    .single<Profile>()
  if (profileError || !profile) return jsonResponse({ error: "프로필을 찾을 수 없습니다." }, 404)

  const { data: store, error: storeError } = await adminClient
    .from("stores")
    .select("id, status, created_by, deletion_requested_at, purge_after")
    .eq("id", profile.store_id)
    .single<Store>()
  if (storeError || !store) return jsonResponse({ error: "매장을 찾을 수 없습니다." }, 404)

  if (body.action === "eligibility") return getEligibility(adminClient, profile, store)
  if (body.action === "restore") return restorePersonalStore(adminClient, profile, store)
  if (body.action === "request") return requestDeletion(adminClient, profile, store, body.transferToUserId)
  return jsonResponse({ error: "지원하지 않는 요청입니다." }, 400)
})

async function getEligibility(adminClient: ReturnType<typeof createClient>, profile: Profile, store: Store) {
  const { data: members, error } = await adminClient
    .from("profiles")
    .select("id, display_name, email, role")
    .eq("store_id", profile.store_id)
    .neq("id", profile.id)
    .order("created_at", { ascending: true })

  if (error) return jsonResponse({ error: error.message }, 400)
  const isPersonalStore = store.created_by === profile.id && (members ?? []).length === 0
  return jsonResponse({
    kind: isPersonalStore ? "personal" : "shared",
    members: isPersonalStore ? [] : (members ?? []),
    purgeAfter: store.purge_after
  })
}

async function requestDeletion(adminClient: ReturnType<typeof createClient>, profile: Profile, store: Store, transferToUserId?: string) {
  const eligibility = await getEligibilityData(adminClient, profile, store)
  if (eligibility.error) return jsonResponse({ error: eligibility.error }, 400)

  if (eligibility.kind === "personal") {
    if (store.status === "pending_deletion") return jsonResponse({ error: "이미 탈퇴가 요청되었습니다." }, 400)
    const purgeAfter = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    const now = new Date().toISOString()
    const { error: storeUpdateError } = await adminClient
      .from("stores")
      .update({ status: "pending_deletion", deletion_requested_at: now, purge_after: purgeAfter })
      .eq("id", store.id)
    if (storeUpdateError) return jsonResponse({ error: storeUpdateError.message }, 400)
    const { error: profileUpdateError } = await adminClient
      .from("profiles")
      .update({ deletion_requested_at: now })
      .eq("id", profile.id)
    if (profileUpdateError) return jsonResponse({ error: profileUpdateError.message }, 400)
    return jsonResponse({ kind: "personal", purgeAfter })
  }

  if (!transferToUserId) return jsonResponse({ error: "탈퇴 전에 이관할 관리자를 선택해 주세요." }, 400)
  const target = eligibility.members.find((member) => member.id === transferToUserId)
  if (!target) return jsonResponse({ error: "같은 매장의 구성원만 관리자로 이관할 수 있습니다." }, 400)

  const { error: transferError } = await adminClient
    .from("profiles")
    .update({ role: "store_admin", updated_at: new Date().toISOString() })
    .eq("id", target.id)
  if (transferError) return jsonResponse({ error: transferError.message }, 400)

  const { error: deleteError } = await adminClient.auth.admin.deleteUser(profile.id)
  if (deleteError) return jsonResponse({ error: deleteError.message }, 400)
  return jsonResponse({ kind: "shared" })
}

async function restorePersonalStore(adminClient: ReturnType<typeof createClient>, profile: Profile, store: Store) {
  if (store.created_by !== profile.id || store.status !== "pending_deletion" || !store.purge_after) {
    return jsonResponse({ error: "복구할 수 있는 개인 매장 탈퇴 요청이 없습니다." }, 400)
  }
  if (new Date(store.purge_after).getTime() <= Date.now()) {
    return jsonResponse({ error: "복구 기간이 만료되었습니다." }, 400)
  }

  const { error: storeError } = await adminClient
    .from("stores")
    .update({ status: "active", deletion_requested_at: null, purge_after: null })
    .eq("id", store.id)
  if (storeError) return jsonResponse({ error: storeError.message }, 400)
  const { data: restoredProfile, error: profileError } = await adminClient
    .from("profiles")
    .update({ deletion_requested_at: null })
    .eq("id", profile.id)
    .select("*")
    .single()
  if (profileError) return jsonResponse({ error: profileError.message }, 400)
  return jsonResponse({ profile: restoredProfile })
}

async function getEligibilityData(adminClient: ReturnType<typeof createClient>, profile: Profile, store: Store) {
  const { data: members, error } = await adminClient
    .from("profiles")
    .select("id, display_name, email, role")
    .eq("store_id", profile.store_id)
    .neq("id", profile.id)
  if (error) return { error: error.message, kind: "shared" as const, members: [] }
  return {
    error: "",
    kind: store.created_by === profile.id && (members ?? []).length === 0 ? "personal" as const : "shared" as const,
    members: members ?? []
  }
}

async function purgeExpiredPersonalStores(adminClient: ReturnType<typeof createClient>) {
  const { data: stores, error } = await adminClient
    .from("stores")
    .select("id")
    .eq("status", "pending_deletion")
    .lte("purge_after", new Date().toISOString())
  if (error) return jsonResponse({ error: error.message }, 400)

  for (const store of stores ?? []) {
    const { data: members, error: memberError } = await adminClient.from("profiles").select("id").eq("store_id", store.id)
    if (memberError) return jsonResponse({ error: memberError.message }, 400)
    for (const member of members ?? []) {
      const { error: deleteError } = await adminClient.auth.admin.deleteUser(member.id)
      if (deleteError) return jsonResponse({ error: deleteError.message }, 400)
    }
    const { error: storeError } = await adminClient.from("stores").delete().eq("id", store.id)
    if (storeError) return jsonResponse({ error: storeError.message }, 400)
  }
  return jsonResponse({ ok: true, purgedStoreCount: (stores ?? []).length })
}

function isPurgeRequestAllowed(req: Request) {
  const secret = Deno.env.get("ACCOUNT_PURGE_SECRET")
  return Boolean(secret && req.headers.get("x-account-purge-secret") === secret)
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } })
}
