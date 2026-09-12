import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { URL } from "node:url";

const edge = await readFile(new URL("../supabase/functions/product-lookup/index.ts", import.meta.url), "utf8");
const handler = await readFile(new URL("../supabase/functions/product-lookup/handler.ts", import.meta.url), "utf8");
const migration = await readFile(new URL("../supabase/migrations/087_product_lookup_quota.sql", import.meta.url), "utf8");

test("product lookup keeps authentication, store scope, catalog-first, and shared quota boundaries", () => {
  assert.match(edge, /auth\.getUser\(\)/);
  assert.match(handler, /profile\.role === "master"/);
  assert.match(handler, /profile\.store_id !== storeId/);
  assert.match(handler, /profile\.deletion_requested_at/);
  assert.match(handler, /store\.status !== "active"/);
  assert.ok(edge.indexOf('.from("product_catalog")') < edge.indexOf('consume_product_lookup_quota'));
  assert.match(edge, /OpenFoodFactsAdapter\.lookup/);
  assert.match(handler, /Math\.max\(1, deadline/);
});

test("candidate confirmation is server-only HMAC and explicitly bound", () => {
  assert.match(edge, /PRODUCT_LOOKUP_TOKEN_SECRET/);
  assert.match(handler, /crypto\.subtle\.sign\("HMAC"/);
  for (const field of ["candidate", "userId", "storeId", "gtin", "source", "exp"]) assert.match(handler, new RegExp(`\\b${field}\\b`));
  assert.match(handler, /byteLength < 32/);
});

test("quota is an atomic locked server RPC with no client table grants", () => {
  assert.match(migration, /for update/);
  assert.match(migration, /set consumed = consumed \+ 1/);
  assert.match(migration, /grant execute on function public\.consume_product_lookup_quota\(uuid\) to service_role/);
  assert.match(migration, /revoke all on public\.product_lookup_quota from public, anon, authenticated/);
});
