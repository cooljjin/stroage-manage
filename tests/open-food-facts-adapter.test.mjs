import assert from "node:assert/strict";
import test from "node:test";
import { URL } from "node:url";
import { createServer } from "vite";

const repositoryRoot = new URL("..", import.meta.url).pathname;
const server = await createServer({ root: repositoryRoot, server: { middlewareMode: true } });
const { OpenFoodFactsAdapter } = await server.ssrLoadModule("/src/services/catalog/OpenFoodFactsAdapter.ts");
test.after(() => server.close());

const barcode = "036000291452";
const response = (body, status = 200, headers = {}) => new globalThis.Response(JSON.stringify(body), { status, headers });
const product = {
  code: barcode,
  status: 1,
  product: {
    product_name: "Example product",
    brands: "Example brand",
    quantity: "500 g",
    product_quantity: 500,
    product_quantity_unit: "g",
    image_url: "https://images.example/product.jpg"
  }
};

test("returns a bounded attributed candidate for an exact OFF hit", async () => {
  let request;
  const result = await OpenFoodFactsAdapter.lookup(barcode, undefined, {
    fetch: async (input, init) => {
      request = { input: String(input), init };
      return response(product);
    }
  });
  assert.equal(result.status, "found");
  assert.equal(result.candidate.source, "open_food_facts");
  assert.equal(result.candidate.canonical_name, "Example product");
  assert.match(request.input, /fields=code,product_name/);
  assert.match(request.init.headers["User-Agent"], /Stockly/);
});

test("distinguishes missing, malformed, mismatch, timeout and rate limit", async () => {
  const lookup = (fetch) => OpenFoodFactsAdapter.lookup(barcode, undefined, { fetch, timeoutMs: 5 });
  assert.equal((await lookup(async () => response({ status: 0, code: barcode }))).status, "missing");
  assert.equal((await lookup(async () => new globalThis.Response("not found", { status: 404 }))).status, "missing");
  assert.equal((await lookup(async () => new globalThis.Response("not json"))).status, "malformed");
  assert.equal((await lookup(async () => response({ status: 1, code: "036000291453", product: product.product }))).status, "mismatch");
  assert.equal((await lookup(async (_input, init) => new Promise((_, reject) => {
    init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
  }))).status, "timeout");
  const limited = await lookup(async () => response({}, 429, { "retry-after": "12" }));
  assert.deepEqual(limited, { status: "rate_limited", input: barcode, gtin: "00036000291452", retryAfterSeconds: 12 });
});

test("classifies a response-body abort as a timeout", async () => {
  const result = await OpenFoodFactsAdapter.lookup(barcode, undefined, {
    timeoutMs: 5,
    fetch: async (_input, init) => ({
      status: 200,
      ok: true,
      headers: new globalThis.Headers(),
      json: () => new Promise((_, reject) => {
        init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
      })
    })
  });
  assert.equal(result.status, "timeout");
});

test("does not call OFF for malformed input", async () => {
  let calls = 0;
  const result = await OpenFoodFactsAdapter.lookup("036000291453", undefined, { fetch: async () => { calls += 1; return response(product); } });
  assert.equal(result.status, "malformed");
  assert.equal(calls, 0);
});