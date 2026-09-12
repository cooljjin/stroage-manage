import assert from "node:assert/strict";
import test from "node:test";
import { URL } from "node:url";
import { createServer } from "vite";

const repositoryRoot = new URL("..", import.meta.url).pathname;
const server = await createServer({
  root: repositoryRoot,
  server: { middlewareMode: true },
  define: {
    "import.meta.env.VITE_SUPABASE_URL": JSON.stringify("https://example.supabase.co"),
    "import.meta.env.VITE_SUPABASE_ANON_KEY": JSON.stringify("test-key")
  }
});
const [{ ProductLookupService }, { DatabaseService }] = await Promise.all([
  server.ssrLoadModule("/src/services/catalog/ProductLookupService.ts"),
  server.ssrLoadModule("/src/services/database/DatabaseService.ts")
]);
test.after(() => server.close());

const candidate = {
  gtin: "00036000291452",
  canonical_name: "Example product",
  brand: null,
  manufacturer: null,
  size: null,
  unit: null,
  quantity_text: null,
  image_url: null,
  source: "internal",
  source_url: null,
  license: null,
  image_license: null,
  confidence: null
};

function stubSelect(result) {
  DatabaseService.select = () => Promise.resolve(result);
}

test("returns a catalog hit with nullable metadata", async () => {
  stubSelect({ data: candidate, error: null });
  assert.deepEqual(await ProductLookupService.lookup("036000291452"), {
    status: "hit", input: "036000291452", gtin: candidate.gtin, candidate
  });
});

test("distinguishes catalog miss and database failure", async () => {
  stubSelect({ data: null, error: null });
  assert.deepEqual(await ProductLookupService.lookup("036000291452"), {
    status: "miss", input: "036000291452", gtin: candidate.gtin
  });

  stubSelect({ data: null, error: { message: "database unavailable", code: "PGRST000" } });
  const result = await ProductLookupService.lookup("036000291452");
  assert.equal(result.status, "unavailable");
  assert.equal(result.error.message, "database unavailable");
  assert.equal(result.error.code, "PGRST000");
});

test("does not query invalid or ambiguous input", async () => {
  let calls = 0;
  DatabaseService.select = () => { calls += 1; return Promise.resolve({ data: candidate, error: null }); };
  assert.equal((await ProductLookupService.lookup("96385074")).status, "ambiguous");
  assert.equal((await ProductLookupService.lookup("036000291453")).status, "invalid");
  assert.equal(calls, 0);
});
