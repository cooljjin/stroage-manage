import { validateGtin, type GtinFormat } from "../../../src/lib/gtin.ts";
import type { ProductCandidate } from "../../../src/types/productLookup.ts";

const MAX_BODY_BYTES = 8192;
const TOKEN_SOURCE = "open_food_facts";
const OPERATION_CREATE = "create_product_with_catalog";
const OPERATION_RESTORE = "restore_product_with_catalog";

export type ConfirmProfile = { id: string; store_id: string | null; role: "master" | "store_admin" | "staff"; deletion_requested_at: string | null };
export type ConfirmStore = { id: string; status: string };
export type ConfirmProduct = Record<string, unknown>;
export type ProductConfirmDependencies = {
  getUser: (request: Request) => Promise<{ id: string } | null>;
  getProfile: (userId: string) => Promise<ConfirmProfile | null>;
  getStore: (storeId: string) => Promise<ConfirmStore | null>;
  createProduct: (args: { actorId: string; storeId: string; productData: Record<string, unknown>; catalogData: ProductCandidate; requestId: string }) => Promise<{ data: ConfirmProduct | null; error: { message: string } | null }>;
  restoreProduct: (args: { actorId: string; storeId: string; productId: string; productData: Record<string, unknown>; catalogData: ProductCandidate; requestId: string }) => Promise<{ data: ConfirmProduct | null; error: { message: string } | null }>;
  tokenSecret: string | undefined;
  now?: () => number;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
const productFields = new Set([
  "name", "barcode", "category", "supplier_name", "storage_type", "default_location", "unit_name",
  "unit_weight_enabled", "unit_weight", "unit_weight_unit", "processing_required", "processed_unit_weight",
  "processed_unit_weight_unit", "minimum_stock", "receipt_check_only", "status_enabled", "stock_status", "product_url"
]);

export function createProductConfirmHandler(deps: ProductConfirmDependencies) {
  return async (req: Request) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    if (req.method !== "POST") return jsonResponse({ status: "invalid", reason: "method_not_allowed" }, 405);
    if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return jsonResponse({ status: "invalid", reason: "request_too_large" }, 400);

    const user = await deps.getUser(req);
    if (!user) return jsonResponse({ status: "unauthenticated" }, 401);
    const body = await readBody(req);
    if (!body) return jsonResponse({ status: "invalid", reason: "invalid_json" }, 400);

    const storeId = stringValue(body.storeId);
    const token = stringValue(body.confirmationToken);
    const requestId = stringValue(body.requestId);
    const gtinInput = stringValue(body.gtin);
    const targetProductId = body.targetProductId === undefined ? null : stringValue(body.targetProductId);
    if (!isUuid(storeId) || !isUuid(requestId) || !token || !gtinInput || (body.targetProductId !== undefined && (!targetProductId || !isUuid(targetProductId)))) {
      return jsonResponse({ status: "invalid", reason: "request_shape" }, 400);
    }
    const gtinValidation = validateGtin(gtinInput, body.format as GtinFormat | undefined);
    if (gtinValidation.status !== "valid") return jsonResponse({ status: "invalid", reason: "gtin" }, 400);
    const gtin = gtinValidation.gtin14;
    const payload = await verifyCandidateToken(token, user.id, storeId, gtin, deps.tokenSecret, deps.now);
    if (!payload) return jsonResponse({ status: "invalid", reason: "confirmation_token" }, 400);

    const [profile, store] = await Promise.all([deps.getProfile(user.id), deps.getStore(storeId)]);
    if (!profile || !store || profile.role === "master" || profile.store_id !== storeId || profile.deletion_requested_at || store.status !== "active") {
      return jsonResponse({ status: "forbidden", reason: "store_access" }, 403);
    }

    const productData = buildProductData(payload.candidate as ProductCandidate, body.productData, body.localOverride, gtin);
    if (!productData) return jsonResponse({ status: "invalid", reason: "product_data" }, 400);
    const operation = targetProductId ? OPERATION_RESTORE : OPERATION_CREATE;
    try {
      const result = targetProductId
        ? await deps.restoreProduct({ actorId: user.id, storeId, productId: targetProductId, productData, catalogData: freezeCandidate(payload.candidate as ProductCandidate), requestId })
        : await deps.createProduct({ actorId: user.id, storeId, productData, catalogData: freezeCandidate(payload.candidate as ProductCandidate), requestId });
      if (result.error || !result.data) return jsonResponse({ status: "transaction_failed", reason: result.error?.message ?? "transaction_failed", requestId, retryable: true, operation }, 503);
      return jsonResponse({ status: "confirmed", requestId, product: result.data, operation }, 200);
    } catch {
      return jsonResponse({ status: "transaction_failed", reason: "transaction_failed", requestId, retryable: true, operation }, 503);
    }
  };
}

export async function verifyCandidateToken(token: string, userId: string, storeId: string, gtin: string, secret: string | undefined, now = Date.now) {
  if (!secret || new TextEncoder().encode(secret).byteLength < 32) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  try {
    const [encoded, encodedSignature] = parts;
    const payload = JSON.parse(new TextDecoder().decode(decodeBase64Url(encoded))) as Record<string, unknown>;
    const candidate = payload.candidate;
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
    const candidateRecord = candidate as Record<string, unknown>;
    const candidateGtin = candidateRecord.gtin;
    const candidateValidation = typeof candidateGtin === "string" ? validateGtin(candidateGtin) : null;
    if (payload.userId !== userId || payload.storeId !== storeId || payload.gtin !== gtin || payload.source !== TOKEN_SOURCE || typeof payload.exp !== "number" || payload.exp <= Math.floor(now() / 1000) || candidateGtin !== gtin || candidateRecord.source !== TOKEN_SOURCE || candidateValidation?.status !== "valid") return null;
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    return await crypto.subtle.verify("HMAC", key, decodeBase64Url(encodedSignature), new TextEncoder().encode(encoded)) ? payload as { candidate: ProductCandidate; userId: string; storeId: string; gtin: string; source: string; exp: number } : null;
  } catch { return null; }
}

function buildProductData(candidate: ProductCandidate, rawProductData: unknown, rawOverride: unknown, gtin: string) {
  const supplied = rawProductData === undefined ? {} : rawProductData;
  const override = rawOverride === undefined ? {} : rawOverride;
  if (!isObject(supplied) || !isObject(override) || Object.keys(supplied).length > 40 || Object.keys(override).length > 20) return null;
  for (const source of [supplied, override]) {
    if ("barcode" in source && (!isBarcodeEquivalent(source.barcode, gtin))) return null;
  }
  const productData: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(supplied)) if (productFields.has(key)) productData[key] = value;
  for (const [key, value] of Object.entries(override)) {
    if (key === "canonical_name" || key === "brand" || key === "image_url") continue;
    if (productFields.has(key)) productData[key] = value;
  }
  productData.name ??= candidate.canonical_name;
  productData.barcode ??= gtin;
  return typeof productData.name === "string" && productData.name.trim() ? productData : null;
}
function isBarcodeEquivalent(value: unknown, gtin: string) {
  if (typeof value !== "string") return false;
  const validation = validateGtin(value, value.length === 8 ? "EAN8" : undefined);
  return validation.status === "valid" && validation.gtin14 === gtin;
}
function freezeCandidate(candidate: ProductCandidate) { return { ...candidate }; }
function isObject(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function stringValue(value: unknown) { return typeof value === "string" ? value : ""; }
function isUuid(value: string) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }
async function readBody(req: Request) {
  try {
    const raw = await req.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) return null;
    const parsed: unknown = JSON.parse(raw);
    return isObject(parsed) ? parsed : null;
  } catch { return null; }
}
function decodeBase64Url(value: string) { const normalized = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "="); const binary = atob(normalized); return Uint8Array.from(binary, (character) => character.charCodeAt(0)); }
function jsonResponse(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
