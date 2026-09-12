import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);
const docker = "/Applications/Docker.app/Contents/Resources/bin/docker";
const container = globalThis.process.env.STOCKLY_QUOTA_CONTAINER ?? "stockly-task08-review-eed07c98";
const psql = (sql) => exec(docker, ["exec", container, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-U", "supabase_admin", "-d", "postgres", "-At", "-c", sql]);

const ids = Array.from({ length: 16 }, (_, index) => `22000000-0000-0000-0000-${String(index + 10).padStart(12, "0")}`);

test("concurrent quota RPC calls never exceed the configured ceiling", { timeout: 30_000 }, async () => {
  await psql("update public.product_lookup_quota set quota_limit = 1, consumed = 0, window_started_at = date_trunc('day', clock_timestamp() at time zone 'utc') at time zone 'utc'");
  const results = await Promise.all(ids.map((id) => psql(`select allowed || ':' || remaining from public.consume_product_lookup_quota('${id}'::uuid)`)));
  const allowed = results.filter(({ stdout }) => stdout.trim().startsWith("true:")).length;
  const { stdout } = await psql("select consumed || ':' || quota_limit from public.product_lookup_quota where id");
  const [consumed, limit] = stdout.trim().split(":").map(Number);
  assert.equal(allowed, 1);
  assert.equal(consumed, 1);
  assert.equal(limit, 1);
});
