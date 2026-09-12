import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "vite";

const server = await createServer({ root: new globalThis.URL("..", import.meta.url).pathname, server: { middlewareMode: true } });
const { createProductLookupHandler, signCandidate, verifyCandidateToken } = await server.ssrLoadModule("/supabase/functions/product-lookup/handler.ts");
test.after(() => server.close());

const storeId = "11000000-0000-1000-8000-000000000001";
const userId = "22000000-0000-1000-8000-000000000001";
const candidate = { gtin: "00036000291452", canonical_name: "Example", brand: null, manufacturer: null, size: null, unit: null, quantity_text: null, image_url: null, source: "internal", source_url: null, license: null, image_license: null, confidence: null };
const baseDeps = (overrides = {}) => ({
  getUser: async () => ({ id: userId }),
  getProfile: async () => ({ id: userId, store_id: storeId, role: "staff", deletion_requested_at: null }),
  getStore: async () => ({ id: storeId, status: "active" }),
  findCatalog: async () => candidate,
  consumeQuota: async () => { throw new Error("quota should be bypassed"); },
  lookupProvider: async () => { throw new Error("provider should be bypassed"); },
  tokenSecret: "x".repeat(32),
  ...overrides
});

async function json(response) { return { status: response.status, body: await response.json() }; }

 test("authenticated active-store catalog hits bypass quota and provider", async () => {
  const response = await createProductLookupHandler(baseDeps())(new globalThis.Request("https://example.test", { method: "POST", body: JSON.stringify({ barcode: "036000291452", storeId }) }));
  assert.deepEqual(await json(response), { status: 200, body: { status: "hit", gtin: candidate.gtin, candidate } });
});

test("rejects master and cross-store access before catalog lookup", async () => {
  for (const profile of [
    { id: userId, store_id: storeId, role: "master", deletion_requested_at: null },
    { id: userId, store_id: "11000000-0000-1000-8000-000000000002", role: "staff", deletion_requested_at: null }
  ]) {
    const response = await createProductLookupHandler(baseDeps({ getProfile: async () => profile, findCatalog: async () => { throw new Error("catalog should be bypassed"); } }))(new globalThis.Request("https://example.test", { method: "POST", body: JSON.stringify({ barcode: "036000291452", storeId }) }));
    assert.equal(response.status, 403);
  }
});

test("rejects unauthenticated, missing/deleting profiles, and inactive or missing stores", async () => {
  for (const [overrides, expectedStatus] of [
    [{ getUser: async () => null }, 401],
    [{ getProfile: async () => null }, 403],
    [{ getProfile: async () => ({ id: userId, store_id: storeId, role: "staff", deletion_requested_at: "2026-01-01" }) }, 403],
    [{ getStore: async () => null }, 403],
    [{ getStore: async () => ({ id: storeId, status: "inactive" }) }, 403]
  ]) {
    const response = await createProductLookupHandler(baseDeps(overrides))(new globalThis.Request("https://example.test", { method: "POST", body: JSON.stringify({ barcode: "036000291452", storeId }) }));
    assert.equal(response.status, expectedStatus);
  }
});

test("rejects null JSON instead of treating it as a request", async () => {
  const response = await createProductLookupHandler(baseDeps())(new globalThis.Request("https://example.test", { method: "POST", body: "null" }));
  assert.deepEqual(await json(response), { status: 400, body: { status: "invalid", reason: "invalid_json" } });
});

test("binds confirmation tokens and rejects tampering or expiry", async () => {
  const now = () => 1_700_000_000_000;
  const token = await signCandidate(candidate, userId, storeId, candidate.gtin, "s".repeat(32), now);
  assert.ok(await verifyCandidateToken(token, userId, storeId, candidate.gtin, "s".repeat(32), now));
  assert.equal(await verifyCandidateToken(token, "22000000-0000-0000-0000-000000000002", storeId, candidate.gtin, "s".repeat(32), now), null);
  const [payload, signature] = token.split(".");
  const tampered = `${payload.slice(0, -1)}${payload.endsWith("A") ? "B" : "A"}.${signature}`;
  assert.equal(await verifyCandidateToken(tampered, userId, storeId, candidate.gtin, "s".repeat(32), now), null);
  assert.equal(await verifyCandidateToken(token, userId, "11000000-0000-1000-8000-000000000002", candidate.gtin, "s".repeat(32), now), null);
  assert.equal(await verifyCandidateToken(token, userId, storeId, "00000000000000", "s".repeat(32), now), null);
  const [encodedPayload, encodedSignature] = token.split(".");
  const changedPayload = JSON.parse(globalThis.Buffer.from(encodedPayload, "base64url").toString());
  changedPayload.candidate = { ...changedPayload.candidate, canonical_name: "Tampered" };
  assert.deepEqual(
    { userId: changedPayload.userId, storeId: changedPayload.storeId, gtin: changedPayload.gtin, source: changedPayload.source, exp: changedPayload.exp },
    { userId, storeId, gtin: candidate.gtin, source: "open_food_facts", exp: 1_700_000_300 }
  );
  const validJsonTamper = `${globalThis.Buffer.from(JSON.stringify(changedPayload)).toString("base64url")}.${encodedSignature}`;
  assert.equal(await verifyCandidateToken(validJsonTamper, userId, storeId, candidate.gtin, "s".repeat(32), now), null);
  assert.equal(await verifyCandidateToken(token, userId, storeId, candidate.gtin, "w".repeat(32), now), null);
  assert.equal(await verifyCandidateToken(token, userId, storeId, candidate.gtin, "s".repeat(32), () => now() + 300_000), null);
});

test("rejects a correctly signed token with the wrong source", async () => {
  const now = () => 1_700_000_000_000;
  const wrongSourcePayload = { candidate, userId, storeId, gtin: candidate.gtin, source: "internal", exp: 1_700_000_300 };
  const encodedPayload = globalThis.Buffer.from(JSON.stringify(wrongSourcePayload)).toString("base64url");
  const key = await globalThis.crypto.subtle.importKey("raw", new globalThis.TextEncoder().encode("s".repeat(32)), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await globalThis.crypto.subtle.sign("HMAC", key, new globalThis.TextEncoder().encode(encodedPayload));
  const token = `${encodedPayload}.${globalThis.Buffer.from(signature).toString("base64url")}`;
  assert.equal(await verifyCandidateToken(token, userId, storeId, candidate.gtin, "s".repeat(32), now), null);
});

test("provider-found response issues a bound confirmation token", async () => {
  const response = await createProductLookupHandler(baseDeps({
    findCatalog: async () => null,
    consumeQuota: async () => ({ allowed: true }),
    lookupProvider: async () => ({ status: "found", candidate })
  }))(new globalThis.Request("https://example.test", { method: "POST", body: JSON.stringify({ barcode: "036000291452", storeId }) }));
  const result = await json(response);
  assert.equal(result.status, 200);
  assert.equal(result.body.status, "miss");
  assert.equal(result.body.gtin, candidate.gtin);
  assert.deepEqual(result.body.candidate, candidate);
  const payload = await verifyCandidateToken(result.body.confirmationToken, userId, storeId, candidate.gtin, "x".repeat(32));
  assert.ok(payload);
  assert.deepEqual(payload, {
    candidate,
    userId,
    storeId,
    gtin: candidate.gtin,
    source: "open_food_facts",
    exp: payload.exp
  });
});
