import assert from "node:assert/strict";
import { chmod, copyFile, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import process from "node:process";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const sourceScript = join(projectRoot, "scripts/seed-staging.mjs");
const stagingRef = "nchvyxhyfatgwpvilbng";
const productionRef = "pcvpkndyqkljgbrvssza";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "stockly-staging-seed-"));
  await mkdir(join(root, "scripts"));
  await mkdir(join(root, "bin"));
  await mkdir(join(root, "supabase/tests"), { recursive: true });
  await copyFile(sourceScript, join(root, "scripts/seed-staging.mjs"));
  await writeFile(join(root, "package.json"), '{"type":"module"}\n');
  await writeFile(join(root, "supabase/seed.staging.sql"), "select 'seed';\n");
  await writeFile(join(root, "supabase/tests/staging_seed_contract.sql"), "select 'contract';\n");
  await writeFile(join(root, "bin/npx"), `#!/bin/sh
printf '%s\\n' "$*" >> .tool-calls
if [ "$1 $2 $3 $4" = "supabase projects list --output" ]; then
  printf '[{"ref":"%s","linked":true}]\\n' "$FAKE_LINKED_REF"
fi
`);
  await chmod(join(root, "bin/npx"), 0o755);
  return root;
}

function run(root, linkedRef) {
  return spawnSync(process.execPath, ["scripts/seed-staging.mjs"], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, PATH: `${join(root, "bin")}:${process.env.PATH}`, FAKE_LINKED_REF: linkedRef }
  });
}

test("documentation routes staging seed writes through the guarded command", async () => {
  const packageJson = JSON.parse(await readFile(join(projectRoot, "package.json"), "utf8"));
  const documentation = await readFile(join(projectRoot, "docs/staging-test-data.md"), "utf8");
  assert.equal(packageJson.scripts["seed:staging"], "node scripts/seed-staging.mjs");
  assert.match(documentation, /npm run seed:staging/);
  assert.doesNotMatch(documentation, /db query --linked --file supabase\/seed\.staging\.sql/);
});

test("staging seed guard rejects a production link before any database query", async (t) => {
  const root = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = run(root, productionRef);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /staging project/i);
  const calls = await readFile(join(root, ".tool-calls"), "utf8");
  assert.equal(calls.trim(), "supabase projects list --output json");
});

test("staging seed guard applies seed and contract only to the exact staging link", async (t) => {
  const root = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = run(root, stagingRef);

  assert.equal(result.status, 0, result.stderr);
  const calls = (await readFile(join(root, ".tool-calls"), "utf8")).trim().split("\n");
  assert.deepEqual(calls, [
    "supabase projects list --output json",
    "supabase db query --linked --file supabase/seed.staging.sql",
    "supabase db query --linked --file supabase/tests/staging_seed_contract.sql"
  ]);
});
