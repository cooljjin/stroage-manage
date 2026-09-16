import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import test from "node:test";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const productionRef = "pcvpkndyqkljgbrvssza";

function buildStaging(overrides) {
  return spawnSync(npm, ["run", "build:staging"], {
    cwd: projectRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      VITE_SUPABASE_ANON_KEY: "test-anon-key",
      ...overrides
    }
  });
}

test("direct staging build rejects a complete production environment", () => {
  const result = buildStaging({
    VITE_DEPLOYMENT_ENV: "production",
    VITE_SUPABASE_PROJECT_REF: productionRef,
    VITE_SUPABASE_URL: `https://${productionRef}.supabase.co`
  });

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /staging.*VITE_DEPLOYMENT_ENV|VITE_DEPLOYMENT_ENV.*staging/i);
});

test("direct staging build rejects missing deployment metadata", () => {
  const result = buildStaging({
    VITE_DEPLOYMENT_ENV: "",
    VITE_SUPABASE_PROJECT_REF: "",
    VITE_SUPABASE_URL: ""
  });

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /staging.*VITE_DEPLOYMENT_ENV/i);
});
