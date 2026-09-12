import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "vite";

const server = await createServer({ root: new globalThis.URL("..", import.meta.url).pathname, server: { middlewareMode: true } });
const { createProductConfirmHandler } = await server.ssrLoadModule("/supabase/functions/product-confirm/handler.ts");
const { signCandidate } = await server.ssrLoadModule("/supabase/functions/product-lookup/handler.ts");
test.after(() => server.close());

const userId = "22000000-0000-1000-8000-000000000001";
const storeId = "11000000-0000-1000-8000-000000000001";
const otherStoreId = "11000000-0000-1000-8000-000000000002";
const productId = "33000000-0000-1000-8000-000000000001";
const requestId = "44000000-0000-1000-8000-000000000001";
const gtin = "00036000291452";
const equivalentUpc = "036000291452";
const equivalentEan13 = "0036000291452";
const equivalentEan8 = "96385074";
const ean8Gtin = "00000096385074";
const secret = "s".repeat(32);
const candidate = { gtin, canonical_name: "Canonical", brand: "Brand", manufacturer: null, size: 500, unit: "g", quantity_text: "500 g", image_url: "https://example.test/image", source: "open_food_facts", source_url: "https://example.test", license: null, image_license: null, confidence: 0.9 };
const token = (changes = {}) => signCandidate({ ...candidate, ...(changes.candidate ?? {}) }, changes.userId ?? userId, changes.storeId ?? storeId, changes.gtin ?? gtin, changes.secret ?? secret, () => changes.now ?? 1_700_000_000_000);
const request = (body, options = {}) => new globalThis.Request("https://example.test", { method: options.method ?? "POST", body: options.body ?? JSON.stringify(body), headers: { "content-type": "application/json", ...(options.headers ?? {}) } });
const baseDeps = (overrides = {}) => ({
  getUser: async () => ({ id: userId }),
  getProfile: async () => ({ id: userId, store_id: storeId, role: "staff", deletion_requested_at: null }),
  getStore: async () => ({ id: storeId, status: "active" }),
  tokenSecret: secret,
  now: () => 1_700_000_000_000,
  createProduct: async () => ({ data: { id: productId }, error: null }),
  restoreProduct: async () => ({ data: { id: productId }, error: null }),
  ...overrides
});
const responseBody = async (response) => ({ status: response.status, body: await response.json() });
const encode = (value) => globalThis.Buffer.from(JSON.stringify(value)).toString("base64url");
const signedPayload = async (payload, signingSecret = secret) => {
  const encoded = encode(payload);
  const key = await globalThis.crypto.subtle.importKey("raw", new globalThis.TextEncoder().encode(signingSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await globalThis.crypto.subtle.sign("HMAC", key, new globalThis.TextEncoder().encode(encoded));
  return `${encoded}.${globalThis.Buffer.from(signature).toString("base64url")}`;
};
const validPayload = () => ({ candidate, userId, storeId, gtin, source: "open_food_facts", exp: 1_700_000_100 });

 test("confirms create and restore while preserving equivalent raw UPC/EAN and EAN8 barcodes in both inputs", async () => {
  for (const [targetProductId, location, barcode, format, bodyGtin, tokenGtin] of [
    [undefined, "productData", equivalentUpc, "GTIN14", gtin, gtin],
    [undefined, "localOverride", equivalentEan13, "GTIN14", gtin, gtin],
    [productId, "productData", equivalentEan13, "UPC_A", equivalentUpc, gtin],
    [productId, "localOverride", equivalentUpc, "EAN13", equivalentEan13, gtin],
    [undefined, "productData", equivalentEan8, "EAN8", equivalentEan8, ean8Gtin],
    [undefined, "localOverride", equivalentEan8, "EAN8", equivalentEan8, ean8Gtin],
    [productId, "productData", equivalentEan8, "EAN8", equivalentEan8, ean8Gtin],
    [productId, "localOverride", equivalentEan8, "EAN8", equivalentEan8, ean8Gtin]
  ]) {
    const calls = [];
    const response = await createProductConfirmHandler(baseDeps({
      createProduct: async (args) => { calls.push(args); return { data: { id: productId }, error: null }; },
      restoreProduct: async (args) => { calls.push(args); return { data: { id: productId }, error: null }; }
    }))(request({ storeId, gtin: bodyGtin, format, confirmationToken: await token({ candidate: { gtin: tokenGtin }, gtin: tokenGtin }), requestId, ...(targetProductId ? { targetProductId } : {}), [location]: { barcode } }));
    assert.equal(response.status, 200);
    assert.equal(calls[0].productData.barcode, barcode);
    assert.equal(calls[0].catalogData.gtin, tokenGtin);
  }
});

test("confirms restore and rejects mismatched, blank, or malformed barcodes before RPC", async () => {
  for (const [targetProductId, location] of [[undefined, "productData"], [productId, "localOverride"]]) {
    for (const barcode of ["00036000291469", "", "not-a-barcode", null]) {
      let writes = 0;
      const response = await createProductConfirmHandler(baseDeps({
        createProduct: async () => { writes += 1; return { data: { id: productId }, error: null }; },
        restoreProduct: async () => { writes += 1; return { data: { id: productId }, error: null }; }
      }))(request({ storeId, gtin, confirmationToken: await token(), requestId, ...(targetProductId ? { targetProductId } : {}), [location]: { barcode } }));
      assert.equal(response.status, 400);
      assert.equal(writes, 0);
    }
  }
});

test("verifies candidate content, original token, secret, and both source claims", async () => {
  const valid = await token();
  const [encoded, signature] = valid.split(".");
  const tampered = JSON.parse(globalThis.Buffer.from(encoded, "base64url").toString());
  tampered.candidate.canonical_name = "Tampered";
  const validJsonTamper = `${encode(tampered)}.${signature}`;
  const wrongSecret = await token({ secret: "w".repeat(32) });
  const wrongTopLevelSource = await signedPayload({ ...validPayload(), source: "internal" });
  const wrongCandidateSource = await signedPayload({ ...validPayload(), candidate: { ...candidate, source: "internal" } });
  const handler = createProductConfirmHandler(baseDeps());
  for (const confirmationToken of [validJsonTamper, wrongSecret, wrongTopLevelSource, wrongCandidateSource]) {
    assert.equal((await handler(request({ storeId, gtin, confirmationToken, requestId }))).status, 400);
  }
  assert.equal((await handler(request({ storeId, gtin, confirmationToken: valid, requestId }))).status, 200);
});

test("enforces auth, OPTIONS, profile, role, and store guards without writes", async () => {
  let writes = 0;
  const guarded = (overrides) => createProductConfirmHandler(baseDeps({ createProduct: async () => { writes += 1; return { data: { id: productId }, error: null }; }, ...overrides }));
  assert.equal((await guarded({ getUser: async () => null })(request({}))).status, 401);
  assert.equal((await guarded({})(request({}, { method: "OPTIONS", body: undefined }))).status, 200);
  for (const overrides of [
    { getProfile: async () => null },
    { getProfile: async () => ({ id: userId, store_id: storeId, role: "master", deletion_requested_at: null }) },
    { getProfile: async () => ({ id: userId, store_id: otherStoreId, role: "staff", deletion_requested_at: null }) },
    { getProfile: async () => ({ id: userId, store_id: storeId, role: "staff", deletion_requested_at: "2026-01-01" }) },
    { getStore: async () => null },
    { getStore: async () => ({ id: storeId, status: "inactive" }) }
  ]) assert.equal((await guarded(overrides)(request({ storeId, gtin, confirmationToken: await token(), requestId }))).status, 403);
  assert.equal(writes, 0);
});

test("retains method and token identity, GTIN, source, and expiry rejection coverage", async () => {
  const handler = createProductConfirmHandler(baseDeps());
  const body = { storeId, gtin, requestId };
  assert.equal((await handler(new globalThis.Request("https://example.test", { method: "GET" }))).status, 405);
  for (const payload of [
    { ...validPayload(), exp: 1_699_999_999 },
    { ...validPayload(), userId: "22000000-0000-1000-8000-000000000009" },
    { ...validPayload(), storeId: otherStoreId },
    { ...validPayload(), gtin: "00036000291469", candidate: { ...candidate, gtin: "00036000291469" } },
    { ...validPayload(), source: "internal" },
    { ...validPayload(), candidate: { ...candidate, source: "internal" } }
  ]) {
    const response = await handler(request({ ...body, confirmationToken: await signedPayload(payload) }));
    assert.equal(response.status, 400);
  }
});

test("rejects malformed JSON, shapes, and size before persistence", async () => {
  const handler = createProductConfirmHandler(baseDeps());
  assert.equal((await handler(request({}, { body: "{" }))).status, 400);
  assert.equal((await handler(request({ storeId, gtin, confirmationToken: await token(), requestId: "bad" }))).status, 400);
  assert.equal((await handler(request({ storeId, gtin, confirmationToken: await token(), requestId, productData: "bad" }))).status, 400);
  assert.equal((await handler(request({}, { body: "x".repeat(8193) }))).status, 400);
});

test("models complete replay, canonical winner reuse, local separation, and uncertain retry", async () => {
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const requests = new Map();
  const canonicalWinner = {
    id: "canonical-1", gtin, canonical_name: "Winner", brand: "Winner Brand", manufacturer: "Winner Manufacturer",
    size: 1000, unit: "ml", quantity_text: "1 L", image_url: "https://winner.test/image", source: "open_food_facts",
    source_url: "https://winner.test", license: "winner-license", image_license: "winner-image-license", confidence: 0.91,
    verified_at: "2026-01-01T00:00:00Z", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z"
  };
  const canonical = new Map([[gtin, clone(canonicalWinner)]]);
  const products = new Map();
  let writes = 0;
  const snapshot = () => ({ canonical: clone([...canonical]), products: clone([...products]), requests: clone([...requests]) });
  const createProduct = async ({ actorId, storeId: scopedStoreId, requestId: id, catalogData, productData }) => {
    const fingerprint = JSON.stringify({ actorId, storeId: scopedStoreId, catalogData, productData });
    const previous = requests.get(id);
    if (previous && previous.fingerprint !== fingerprint) return { data: null, error: { message: "request_conflict" } };
    if (previous) return { data: previous.product, error: null };
    const winner = canonical.get(catalogData.gtin) ?? { id: "canonical-1", ...catalogData, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" };
    const product = {
      id: `product-${products.size + 1}`, store_id: scopedStoreId, catalog_id: winner.id, name: productData.name,
      barcode: productData.barcode, category: null, supplier_name: null, storage_type: null, default_location: null,
      unit_name: null, unit_weight_enabled: false, unit_weight: null, unit_weight_unit: null, processing_required: false,
      processed_unit_weight: null, processed_unit_weight_unit: null, minimum_stock: 0, receipt_check_only: false,
      status_enabled: false, stock_status: null, product_url: null
    };
    products.set(product.id, product);
    requests.set(id, { request_id: id, operation: "create_product_with_catalog", actor_id: actorId, store_id: scopedStoreId, fingerprint, product });
    writes += 1;
    if (productData.name === "uncertain") throw new Error("network details must not escape");
    return { data: product, error: null };
  };
  const incomingCandidate = {
    manufacturer: "Incoming Manufacturer", size: 2000, unit: "kg", quantity_text: "2 kg",
    source_url: "https://incoming.test", verified_at: "client-controlled", canonical_name: "Incoming", brand: "Incoming Brand"
  };
  const handler = createProductConfirmHandler(baseDeps({ createProduct }));
  const body = { storeId, gtin, confirmationToken: await token({ candidate: incomingCandidate }), requestId, localOverride: { name: "Local" } };
  const before = snapshot();
  const first = await handler(request(body));
  const afterFirst = snapshot();
  const replay = await handler(request(body));
  const afterReplay = snapshot();
  const changed = await handler(request({ ...body, localOverride: { name: "Changed" } }));
  assert.equal(first.status, 200);
  assert.equal(replay.status, 200);
  assert.deepEqual(await responseBody(first), await responseBody(replay));
  assert.deepEqual(afterReplay, afterFirst);
  assert.deepEqual(afterFirst.canonical[0][1], canonicalWinner);
  assert.equal(afterFirst.products[0][1].catalog_id, canonicalWinner.id);
  assert.equal(afterFirst.products[0][1].name, "Local");
  assert.equal(afterFirst.requests[0][1].request_id, requestId);
  assert.equal(changed.status, 503);
  assert.equal(writes, 1);
  assert.equal(products.size, 1);
  assert.notDeepEqual(afterFirst, before);

  const uncertainRequestId = "55000000-0000-1000-8000-000000000001";
  const uncertainBody = { storeId, gtin, confirmationToken: await token(), requestId: uncertainRequestId, localOverride: { name: "uncertain" } };
  const uncertainBefore = snapshot();
  const uncertain = await handler(request(uncertainBody));
  const uncertainAfterFailure = snapshot();
  const uncertainRetry = await handler(request(uncertainBody));
  const uncertainAfterRetry = snapshot();
  const uncertainChanged = await handler(request({ ...uncertainBody, localOverride: { name: "changed-after-uncertain" } }));
  assert.deepEqual((await responseBody(uncertain)).body, { status: "transaction_failed", reason: "transaction_failed", requestId: uncertainRequestId, retryable: true, operation: "create_product_with_catalog" });
  assert.equal(uncertainRetry.status, 200);
  assert.deepEqual((await uncertainRetry.clone().json()).product, uncertainAfterFailure.products.at(-1)[1]);
  assert.deepEqual(uncertainAfterRetry, uncertainAfterFailure);
  assert.equal(uncertainChanged.status, 503);
  assert.equal(writes, 2);
  assert.equal(products.size, 2);
  assert.notDeepEqual(uncertainAfterFailure, uncertainBefore);
});

test("normalizes thrown create and restore transaction errors with request id", async () => {
  for (const operation of ["createProduct", "restoreProduct"]) {
    const response = await createProductConfirmHandler(baseDeps({ [operation]: async () => { throw new TypeError("secret internal detail"); } }))(request({ storeId, gtin, confirmationToken: await token(), requestId, ...(operation === "restoreProduct" ? { targetProductId: productId } : {}) }));
    assert.deepEqual(await responseBody(response), { status: 503, body: { status: "transaction_failed", reason: "transaction_failed", requestId, retryable: true, operation: operation === "restoreProduct" ? "restore_product_with_catalog" : "create_product_with_catalog" } });
  }
});
