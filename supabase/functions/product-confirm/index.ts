import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createProductConfirmHandler, type ConfirmProfile, type ConfirmStore } from "./handler.ts";

const TOKEN_SECRET_NAME = "PRODUCT_LOOKUP_TOKEN_SECRET";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" } });
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) return new Response(JSON.stringify({ status: "unavailable", reason: "configuration" }), { status: 500 });
  const authorization = req.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return json({ status: "unauthenticated" }, 401);
  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } } });
  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  const getUser = async () => { const { data, error } = await userClient.auth.getUser(); return error || !data.user ? null : { id: data.user.id }; };
  const getProfile = async (userId: string) => { const { data, error } = await adminClient.from("profiles").select("id, store_id, role, deletion_requested_at").eq("id", userId).maybeSingle<ConfirmProfile>(); return error ? null : data; };
  const getStore = async (storeId: string) => { const { data, error } = await adminClient.from("stores").select("id, status").eq("id", storeId).maybeSingle<ConfirmStore>(); return error ? null : data; };
  const catalog = (candidate: unknown) => candidate as Record<string, unknown>;
  return createProductConfirmHandler({
    getUser,
    getProfile,
    getStore,
    tokenSecret: Deno.env.get(TOKEN_SECRET_NAME),
    createProduct: async ({ actorId, storeId, productData, catalogData, requestId }) => {
      const { data, error } = await adminClient.rpc("create_product_with_catalog", { actor_id: actorId, product_store_id: storeId, product_data: productData, catalog_data: catalog(catalogData), request_id: requestId });
      return { data: data as Record<string, unknown> | null, error };
    },
    restoreProduct: async ({ actorId, productId, productData, catalogData, requestId }) => {
      const { data, error } = await adminClient.rpc("restore_product_with_catalog", { actor_id: actorId, target_product_id: productId, product_data: productData, catalog_data: catalog(catalogData), request_id: requestId });
      return { data: data as Record<string, unknown> | null, error };
    }
  })(req);
});

function json(body: unknown, status: number) { return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }); }
