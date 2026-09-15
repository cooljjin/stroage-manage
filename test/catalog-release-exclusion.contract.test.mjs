import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import test from "node:test";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (path) => readFileSync(resolve(root, path), "utf8");

test("release source excludes unfinished product catalog runtime flows", () => {
  assert.doesNotMatch(read("src/App.tsx"), /product-lookup|product-confirm|ProductLookup/);
  assert.doesNotMatch(read("src/pages/ProductEditPage.tsx"), /ProductLookup|product-lookup|product-confirm/);
  assert.doesNotMatch(read("src/services/index.ts"), /ProductLookupService|OpenFoodFactsAdapter/);
  assert.doesNotMatch(read("supabase/config.toml"), /product-lookup|product-confirm/);
  assert.equal(existsSync(resolve(root, "src/services/catalog")), false);
  assert.equal(existsSync(resolve(root, "supabase/functions/product-lookup")), false);
  assert.equal(existsSync(resolve(root, "supabase/functions/product-confirm")), false);
});
