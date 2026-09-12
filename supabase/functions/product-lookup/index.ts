import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { OpenFoodFactsAdapter } from "../../../src/services/catalog/OpenFoodFactsAdapter.ts";
import { createProductLookupHandler, type LookupProfile, type LookupStore } from "./handler.ts";

const candidateColumns = "gtin, canonical_name, brand, manufacturer, size, unit, quantity_text, image_url, source, source_url, license, image_license, confidence";
const TOKEN_SECRET_NAME = "PRODUCT_LOOKUP_TOKEN_SECRET";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" } });
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) return new Response(JSON.stringify({ status: "unavailable", reason: "configuration" }), { status: 500 });

  const authorization = req.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return new Response(JSON.stringify({ status: "unavailable", reason: "unauthenticated" }), { status: 401 });
  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } } });
  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  const getUser = async () => {
    const { data, error } = await userClient.auth.getUser();
    return error || !data.user ? null : { id: data.user.id };
  };
  const getProfile = async (userId: string) => {
    const { data, error } = await adminClient.from("profiles").select("id, store_id, role, deletion_requested_at").eq("id", userId).maybeSingle<LookupProfile>();
    return error ? null : data;
  };
  const getStore = async (storeId: string) => {
    const { data, error } = await adminClient.from("stores").select("id, status").eq("id", storeId).maybeSingle<LookupStore>();
    return error ? null : data;
  };
  const findCatalog = async (gtin: string) => {
    const { data, error } = await adminClient.from("product_catalog").select(candidateColumns).eq("gtin", gtin).maybeSingle();
    return error ? null : data;
  };
  const consumeQuota = async (userId: string) => {
    const { data, error } = await adminClient.rpc("consume_product_lookup_quota", { actor_id: userId });
    if (error) return null;
    return (Array.isArray(data) ? data[0] : data) as { allowed: boolean; retry_after_seconds?: number } | null;
  };
  return createProductLookupHandler({
    getUser,
    getProfile,
    getStore,
    findCatalog,
    consumeQuota,
    lookupProvider: async (barcode, format, timeoutMs) => OpenFoodFactsAdapter.lookup(barcode, format, { timeoutMs }),
    tokenSecret: Deno.env.get(TOKEN_SECRET_NAME)
  })(req);
});
