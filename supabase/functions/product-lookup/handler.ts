import { validateGtin, type GtinFormat } from "../../../src/lib/gtin.ts";
import type { ProductCandidate } from "../../../src/types/productLookup.ts";

const MAX_BODY_BYTES = 4096;
const TOKEN_TTL_SECONDS = 300;
const TOKEN_SOURCE = "open_food_facts";

export type LookupProfile = { id: string; store_id: string | null; role: "master" | "store_admin" | "staff"; deletion_requested_at: string | null };
export type LookupStore = { id: string; status: string };
export type LookupProviderResult =
  | { status: "found"; candidate: ProductCandidate }
  | { status: "missing" }
  | { status: "rate_limited"; retryAfterSeconds?: number }
  | { status: "timeout" }
  | { status: "unavailable" | "malformed" | "mismatch"; reason?: string };
export type ProductLookupDependencies = {
  getUser: (request: Request) => Promise<{ id: string } | null>;
  getProfile: (userId: string) => Promise<LookupProfile | null>;
  getStore: (storeId: string) => Promise<LookupStore | null>;
  findCatalog: (gtin: string) => Promise<ProductCandidate | null>;
  consumeQuota: (userId: string) => Promise<{ allowed: boolean; retry_after_seconds?: number } | null>;
  lookupProvider: (barcode: string, format: GtinFormat | undefined, timeoutMs: number) => Promise<LookupProviderResult>;
  tokenSecret: string | undefined;
  now?: () => number;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

export function createProductLookupHandler(deps: ProductLookupDependencies) {
  return async (req: Request) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    if (req.method !== "POST") return jsonResponse({ status: "unavailable", reason: "method_not_allowed" }, 405);
    if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return jsonResponse({ status: "invalid", reason: "request_too_large" }, 400);

    const user = await deps.getUser(req);
    if (!user) return jsonResponse({ status: "unavailable", reason: "unauthenticated" }, 401);

    let body: Record<string, unknown>;
    try {
      const raw = await req.text();
      if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) return jsonResponse({ status: "invalid", reason: "request_too_large" }, 400);
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("request_shape");
      body = parsed as Record<string, unknown>;
    } catch {
      return jsonResponse({ status: "invalid", reason: "invalid_json" }, 400);
    }

    const barcode = typeof body.barcode === "string" ? body.barcode : "";
    const storeId = typeof body.storeId === "string" ? body.storeId : "";
    const format = body.format === undefined ? undefined : body.format;
    if (!barcode || barcode.length > 32 || !/^[0-9]+$/.test(barcode)) return jsonResponse({ status: "invalid", reason: "barcode" }, 400);
    if (!isUuid(storeId) || (format !== undefined && !["EAN8", "UPC_E", "UPC_A", "EAN13", "GTIN14"].includes(String(format)))) {
      return jsonResponse({ status: "invalid", reason: "request_shape" }, 400);
    }

    const [profile, store] = await Promise.all([deps.getProfile(user.id), deps.getStore(storeId)]);
    if (!profile || !store || profile.role === "master" || profile.store_id !== storeId || profile.deletion_requested_at || store.status !== "active") {
      return jsonResponse({ status: "unavailable", reason: "store_access" }, 403);
    }

    const validation = validateGtin(barcode, format as GtinFormat | undefined);
    if (validation.status !== "valid") return jsonResponse({ status: validation.status, reason: validation.reason }, 400);
    const gtin = validation.gtin14;
    const catalog = await deps.findCatalog(gtin);
    if (catalog) return jsonResponse({ status: "hit", gtin, candidate: catalog });

    const quota = await deps.consumeQuota(user.id);
    if (!quota) return jsonResponse({ status: "unavailable", reason: "quota" }, 503);
    if (!quota.allowed) return jsonResponse({ status: "rate_limited", gtin, retryAfterSeconds: quota.retry_after_seconds ?? 86400 }, 429);

    const deadline = (deps.now ?? Date.now)() + 5000;
    const providerResult = await deps.lookupProvider(barcode, format as GtinFormat | undefined, Math.max(1, deadline - (deps.now ?? Date.now)()));
    if (providerResult.status === "found") {
      if (!deps.tokenSecret || new TextEncoder().encode(deps.tokenSecret).byteLength < 32) return jsonResponse({ status: "unavailable", gtin, reason: "token_configuration" }, 503);
      const confirmationToken = await signCandidate(providerResult.candidate, user.id, storeId, gtin, deps.tokenSecret, deps.now);
      return jsonResponse({ status: "miss", gtin, candidate: providerResult.candidate, confirmationToken });
    }
    if (providerResult.status === "missing") return jsonResponse({ status: "miss", gtin });
    if (providerResult.status === "rate_limited") return jsonResponse({ status: "rate_limited", gtin, retryAfterSeconds: providerResult.retryAfterSeconds }, 429);
    if (providerResult.status === "timeout") return jsonResponse({ status: "timeout", gtin }, 504);
    return jsonResponse({ status: "unavailable", gtin, reason: providerResult.reason ?? providerResult.status }, 503);
  };
}

export async function signCandidate(candidate: unknown, userId: string, storeId: string, gtin: string, secret: string, now = Date.now) {
  const payload = { candidate, userId, storeId, gtin, source: TOKEN_SOURCE, exp: Math.floor(now() / 1000) + TOKEN_TTL_SECONDS };
  const encoded = encodeBase64Url(JSON.stringify(payload));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(encoded));
  return `${encoded}.${encodeBase64Url(signature)}`;
}

export async function verifyCandidateToken(token: string, userId: string, storeId: string, gtin: string, secret: string, now = Date.now) {
  const [encoded, encodedSignature] = token.split(".");
  if (!encoded || !encodedSignature) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(decodeBase64Url(encoded))) as Record<string, unknown>;
    if (payload.userId !== userId || payload.storeId !== storeId || payload.gtin !== gtin || payload.source !== TOKEN_SOURCE || typeof payload.exp !== "number" || payload.exp <= Math.floor(now() / 1000)) return null;
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    const valid = await crypto.subtle.verify("HMAC", key, decodeBase64Url(encodedSignature), new TextEncoder().encode(encoded));
    return valid ? payload : null;
  } catch {
    return null;
  }
}

function encodeBase64Url(value: string | ArrayBuffer) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : new Uint8Array(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function decodeBase64Url(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(normalized);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
function isUuid(value: string) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }
function jsonResponse(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
