import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { URL } from "node:url";

const service = await readFile(new URL("../src/services/catalog/ProductLookupService.ts", import.meta.url), "utf8");
const domain = await readFile(new URL("../src/types/domain.ts", import.meta.url), "utf8");

test("catalog lookup uses a restricted RPC instead of exposing the catalog table", () => {
  assert.match(service, /rpc\("lookup_shared_product_catalog"/);
  assert.doesNotMatch(service, /select\("product_catalog"/);
});

test("shared candidate contract contains reusable fields without store provenance", () => {
  for (const field of ["category", "storage_type", "supplier_name", "product_url"]) {
    assert.match(domain, new RegExp(`${field}: string \\| null`));
  }
  assert.doesNotMatch(domain, /source_store_id/);
});
