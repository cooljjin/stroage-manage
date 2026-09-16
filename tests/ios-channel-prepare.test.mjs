import assert from "node:assert/strict";
import { chmod, copyFile, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import process from "node:process";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const sourceScript = join(projectRoot, "scripts/prepare-ios-channel.mjs");
const productionRef = "pcvpkndyqkljgbrvssza";
const stagingRef = "nchvyxhyfatgwpvilbng";

async function fixture(envFiles) {
  const root = await mkdtemp(join(tmpdir(), "stockly-ios-channel-"));
  await mkdir(join(root, "scripts"));
  await mkdir(join(root, "bin"));
  await copyFile(sourceScript, join(root, "scripts/prepare-ios-channel.mjs"));
  await writeFile(join(root, "package.json"), '{"type":"module"}\n');
  await Promise.all(Object.entries(envFiles).map(([name, value]) => writeFile(join(root, name), value)));
  await writeFile(join(root, "bin/npx"), `#!/bin/sh
printf '%s\\n' "$*" >> .tool-calls
printf 'npx:%s|%s|%s|%s\\n' "$*" "$VITE_DEPLOYMENT_ENV" "$VITE_UNRELATED_OVERRIDE" "$IOS_PREPARE_TEST_PRESERVE" >> .child-env
if [ "$1 $2" = "vite build" ]; then
  mkdir -p dist/assets
  printf '%s|%s|%s\\n' "$VITE_DEPLOYMENT_ENV" "$VITE_SUPABASE_PROJECT_REF" "$IOS_PREPARE_TEST_PRESERVE" > .build-env
  if [ "$FAKE_BUNDLE_MISMATCH" = "1" ]; then
    printf 'staging %s https://%s.supabase.co wrong-anon-key\\n' "${stagingRef}" "${productionRef}" > dist/assets/index.js
  else
    printf '%s %s %s %s\\n' "$VITE_DEPLOYMENT_ENV" "$VITE_SUPABASE_PROJECT_REF" "$VITE_SUPABASE_URL" "$VITE_SUPABASE_ANON_KEY" > dist/assets/index.js
  fi
fi
`);
  await writeFile(join(root, "bin/xcodebuild"), `#!/bin/sh
printf '%s\\n' "$*" >> .xcode-calls
printf 'xcodebuild:%s|%s|%s|%s\\n' "$*" "$VITE_DEPLOYMENT_ENV" "$VITE_UNRELATED_OVERRIDE" "$IOS_PREPARE_TEST_PRESERVE" >> .child-env
if [ "$FAKE_TARGET_MISMATCH" = "1" ]; then
  target='Wrong Target'
  bundle='com.example.wrong'
elif printf '%s' "$*" | grep -q 'Stockly Staff'; then
  target='Stockly Staff'
  bundle='com.jinkim.storeinventory.poc'
else
  target='App'
  bundle='com.jinkim.stockly'
fi
printf '    TARGET_NAME = %s\\n    PRODUCT_BUNDLE_IDENTIFIER = %s\\n' "$target" "$bundle"
`);
  await chmod(join(root, "bin/npx"), 0o755);
  await chmod(join(root, "bin/xcodebuild"), 0o755);
  return root;
}

function env(channel, ref, key = "test-anon-key") {
  return [
    `VITE_DEPLOYMENT_ENV=${channel}`,
    `VITE_SUPABASE_URL=https://${ref}.supabase.co`,
    `VITE_SUPABASE_ANON_KEY=${key}`,
    `VITE_SUPABASE_PROJECT_REF=${ref}`
  ].join("\n");
}

function run(root, channel, extraEnv = {}) {
  return spawnSync(process.execPath, ["scripts/prepare-ios-channel.mjs", channel], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, PATH: `${join(root, "bin")}:${process.env.PATH}`, ...extraEnv }
  });
}

test("selected env replaces inherited VITE values while preserving non-VITE environment", async (t) => {
  const root = await fixture({
    ".env.staging": env("staging", stagingRef),
    ".env.production": env("production", productionRef)
  });
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = run(root, "staging", {
    VITE_DEPLOYMENT_ENV: "production",
    VITE_SUPABASE_PROJECT_REF: productionRef,
    VITE_SUPABASE_URL: `https://${productionRef}.supabase.co`,
    VITE_SUPABASE_ANON_KEY: "inherited-secret",
    VITE_UNRELATED_OVERRIDE: "must-be-removed",
    IOS_PREPARE_TEST_PRESERVE: "preserved"
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(await readFile(join(root, ".build-env"), "utf8"), `staging|${stagingRef}|preserved\n`);
  const childEnv = await readFile(join(root, ".child-env"), "utf8");
  assert.doesNotMatch(childEnv, /production|must-be-removed/);
  assert.equal(childEnv.match(/\|preserved$/gm)?.length, 4);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /inherited-secret/);
});

test("local Vite override files are rejected before build", async () => {
  for (const overrideName of [".env.local", ".env.staging.local"]) {
    const root = await fixture({
      ".env.staging": env("staging", stagingRef),
      ".env.production": env("production", productionRef),
      [overrideName]: "VITE_DEPLOYMENT_ENV=production\n"
    });

    const result = run(root, "staging");

    assert.notEqual(result.status, 0, overrideName);
    assert.match(result.stderr, new RegExp(overrideName.replaceAll(".", "\\.")), overrideName);
    await assert.rejects(readFile(join(root, ".tool-calls"), "utf8"));
    await rm(root, { recursive: true, force: true });
  }
});

test("generated bundle mismatch fails before Xcode validation and Capacitor copy", async (t) => {
  const root = await fixture({
    ".env.staging": env("staging", stagingRef),
    ".env.production": env("production", productionRef)
  });
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = run(root, "staging", { FAKE_BUNDLE_MISMATCH: "1" });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /generated bundle.*staging/i);
  const calls = await readFile(join(root, ".tool-calls"), "utf8");
  assert.doesNotMatch(calls, /cap copy ios/);
});

test("Xcode target mismatch fails before Capacitor copy", async (t) => {
  const root = await fixture({
    ".env.staging": env("staging", stagingRef),
    ".env.production": env("production", productionRef)
  });
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = run(root, "staging", { FAKE_TARGET_MISMATCH: "1" });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /TARGET_NAME.*App/);
  const calls = await readFile(join(root, ".tool-calls"), "utf8");
  assert.doesNotMatch(calls, /cap copy ios/);
  assert.match(await readFile(join(root, ".xcode-calls"), "utf8"), /-scheme App.*-showBuildSettings/);
});

test("staging accepts only its channel and invokes Vite then Capacitor", async (t) => {
  const root = await fixture({
    ".env.staging": env("staging", stagingRef),
    ".env.production": env("production", productionRef)
  });
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = run(root, "staging");

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /channel: staging/);
  assert.match(result.stdout, /Bundle ID: com\.jinkim\.stockly/);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /test-anon-key/);
  const calls = await (await import("node:fs/promises")).readFile(join(root, ".tool-calls"), "utf8");
  assert.deepEqual(calls.trim().split("\n"), ["tsc -b", "vite build --mode staging", "cap copy ios"]);
});

test("production accepts only its channel and invokes Vite then Capacitor", async (t) => {
  const root = await fixture({
    ".env.staging": env("staging", stagingRef),
    ".env.production": env("production", productionRef)
  });
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = run(root, "production");

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /channel: production/);
  assert.match(result.stdout, /Bundle ID: com\.jinkim\.storeinventory\.poc/);
});

test("production archive documentation selects the production scheme, target, and bundle id", async () => {
  const documentation = await readFile(join(projectRoot, "docs/testflight-staff-deployment.md"), "utf8");
  assert.match(documentation, /`Stockly Staff` scheme/);
  assert.match(documentation, /`Stockly Staff` target/);
  assert.match(documentation, /`com\.jinkim\.storeinventory\.poc`/);
  assert.doesNotMatch(documentation, /`App` target/);
});

test("runtime Supabase client binds Vite mode to required deployment metadata and exact project", async () => {
  const source = await readFile(join(projectRoot, "src/lib/supabase.ts"), "utf8");
  assert.match(source, /import\.meta\.env\.MODE/);
  assert.match(source, /import\.meta\.env\.VITE_DEPLOYMENT_ENV/);
  assert.match(source, /import\.meta\.env\.VITE_SUPABASE_PROJECT_REF/);
  assert.match(source, /staging:\s*"nchvyxhyfatgwpvilbng"/);
  assert.match(source, /production:\s*"pcvpkndyqkljgbrvssza"/);
  assert.match(source, /deploymentEnv !== viteMode/);
  assert.match(source, /supabaseProjectRef !== expectedProjectRef/);
});

test("invalid or matching targets fail before any build command", async () => {
  const cases = [
    { name: "missing anon key", staging: env("staging", stagingRef, "").replace("VITE_SUPABASE_ANON_KEY=\n", ""), production: env("production", productionRef), expected: /VITE_SUPABASE_ANON_KEY/ },
    { name: "wrong declared channel", staging: env("production", stagingRef), production: env("production", productionRef), expected: /VITE_DEPLOYMENT_ENV/ },
    { name: "shared project ref", staging: env("staging", stagingRef), production: env("production", stagingRef), expected: /must not share/ }
  ];

  for (const scenario of cases) {
    const root = await fixture({ ".env.staging": scenario.staging, ".env.production": scenario.production });
    const result = run(root, "staging");
    await rm(root, { recursive: true, force: true });
    assert.notEqual(result.status, 0, scenario.name);
    assert.match(result.stderr, scenario.expected, scenario.name);
  }
});
