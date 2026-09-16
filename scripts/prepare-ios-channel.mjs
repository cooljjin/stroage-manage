import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import process from "node:process";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";

const productionRef = "pcvpkndyqkljgbrvssza";
const channels = {
  staging: {
    bundleId: "com.jinkim.stockly",
    deploymentEnv: "staging",
    projectRef: "nchvyxhyfatgwpvilbng",
    scheme: "App",
    target: "App"
  },
  production: {
    bundleId: "com.jinkim.storeinventory.poc",
    deploymentEnv: "production",
    projectRef: productionRef,
    scheme: "Stockly Staff",
    target: "Stockly Staff"
  }
};

function fail(message) {
  process.stderr.write(`ios channel preparation failed: ${message}\n`);
  process.exit(1);
}

function readEnvFile(channel) {
  const filename = resolve(process.cwd(), `.env.${channel}`);
  let text;
  try {
    text = readFileSync(filename, "utf8");
  } catch {
    fail(`missing ${filename}`);
  }

  return Object.fromEntries(text.split(/\r?\n/).flatMap((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return [];
    const separator = trimmed.indexOf("=");
    return separator > 0 ? [[trimmed.slice(0, separator), trimmed.slice(separator + 1)]] : [];
  }));
}

function validate(channel, env, otherEnv) {
  const contract = channels[channel];
  assert.ok(contract, `channel must be one of: ${Object.keys(channels).join(", ")}`);
  for (const name of ["VITE_DEPLOYMENT_ENV", "VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY", "VITE_SUPABASE_PROJECT_REF"]) {
    assert.ok(env[name], `${name} must be set in .env.${channel}`);
  }
  assert.equal(env.VITE_DEPLOYMENT_ENV, contract.deploymentEnv, `VITE_DEPLOYMENT_ENV must be ${contract.deploymentEnv}`);
  assert.match(env.VITE_SUPABASE_PROJECT_REF, /^[a-z0-9]{20}$/, "VITE_SUPABASE_PROJECT_REF must be a Supabase project ref");
  assert.equal(env.VITE_SUPABASE_URL, `https://${env.VITE_SUPABASE_PROJECT_REF}.supabase.co`, "VITE_SUPABASE_URL must match VITE_SUPABASE_PROJECT_REF");
  assert.ok(!env.VITE_SUPABASE_SERVICE_ROLE_KEY, "VITE_SUPABASE_SERVICE_ROLE_KEY must not be present");

  if (contract.projectRef) {
    assert.equal(env.VITE_SUPABASE_PROJECT_REF, contract.projectRef, "production must use the production project ref");
  } else {
    assert.notEqual(env.VITE_SUPABASE_PROJECT_REF, productionRef, "staging must not use the production project ref");
  }

  assert.ok(otherEnv.VITE_SUPABASE_PROJECT_REF, `VITE_SUPABASE_PROJECT_REF must be set in the other channel file`);
  assert.notEqual(env.VITE_SUPABASE_PROJECT_REF, otherEnv.VITE_SUPABASE_PROJECT_REF, "staging and production must not share a project ref");
}

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { stdio: "inherit", env });
  if (result.error) fail(`${command} could not start: ${result.error.message}`);
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function validateXcodeTarget(contract, env) {
  const result = spawnSync("xcodebuild", [
    "-workspace", resolve(process.cwd(), "ios/App/App.xcworkspace"),
    "-scheme", contract.scheme,
    "-configuration", "Release",
    "-destination", "generic/platform=iOS",
    "-showBuildSettings"
  ], { encoding: "utf8", env });
  if (result.error) fail(`xcodebuild could not start: ${result.error.message}`);
  if (result.status !== 0) fail(`xcodebuild -showBuildSettings failed for ${contract.scheme}`);

  const readSetting = (name) => result.stdout.match(new RegExp(`^\\s*${name} = (.+)$`, "m"))?.[1].trim();
  assert.equal(readSetting("TARGET_NAME"), contract.target, `TARGET_NAME must be ${contract.target}`);
  assert.equal(readSetting("PRODUCT_BUNDLE_IDENTIFIER"), contract.bundleId, `PRODUCT_BUNDLE_IDENTIFIER must be ${contract.bundleId}`);
}

function bundleContains(value) {
  const pending = [resolve(process.cwd(), "dist")];
  while (pending.length > 0) {
    const path = pending.pop();
    if (!path || !existsSync(path)) continue;
    if (statSync(path).isDirectory()) {
      for (const entry of readdirSync(path)) pending.push(resolve(path, entry));
    } else if (readFileSync(path).includes(value)) {
      return true;
    }
  }
  return false;
}

const channel = process.argv[2];
if (!channels[channel] || process.argv.length !== 3) fail("usage: node scripts/prepare-ios-channel.mjs <staging|production>");

let selectedEnv;
try {
  for (const overrideName of [".env.local", `.env.${channel}.local`]) {
    if (existsSync(resolve(process.cwd(), overrideName))) {
      throw new Error(`${overrideName} is not allowed for an iOS channel build`);
    }
  }
  selectedEnv = readEnvFile(channel);
  const otherChannel = channel === "staging" ? "production" : "staging";
  validate(channel, selectedEnv, readEnvFile(otherChannel));
  const suffix = selectedEnv.VITE_SUPABASE_PROJECT_REF.slice(-6);
  process.stdout.write(`channel: ${channel}\nBundle ID: ${channels[channel].bundleId}\nproject ref suffix: …${suffix}\n`);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

const buildEnv = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("VITE_")));
Object.assign(buildEnv, Object.fromEntries(Object.entries(selectedEnv).filter(([name]) => name.startsWith("VITE_"))));
run("npx", ["tsc", "-b"], buildEnv);
run("npx", ["vite", "build", "--mode", channel], buildEnv);
if (!bundleContains(selectedEnv.VITE_SUPABASE_URL) || !bundleContains(selectedEnv.VITE_SUPABASE_ANON_KEY)) {
  fail(`generated bundle does not match the validated ${channel} Supabase credentials`);
}
try {
  validateXcodeTarget(channels[channel], buildEnv);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
run("npx", ["cap", "copy", "ios"], buildEnv);
