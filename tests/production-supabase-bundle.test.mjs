import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, URL } from "node:url";
import { loadEnv, resolveConfig } from "vite";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const distDirectory = join(projectRoot, "dist");

function readRequiredEnv(env, name) {
  const value = env[name];
  assert.ok(value, `${name} must be set for Vite production mode before creating a production bundle`);
  return value;
}

test("production entry bundle embeds Vite's active Supabase configuration", async () => {
  const config = await resolveConfig({}, "build", "production");
  const env = loadEnv(config.mode, config.envDir, config.envPrefix);
  const supabaseUrl = readRequiredEnv(env, "VITE_SUPABASE_URL");
  const supabaseAnonKey = readRequiredEnv(env, "VITE_SUPABASE_ANON_KEY");
  const indexHtml = await readFile(join(distDirectory, "index.html"), "utf8");
  const entryPath = indexHtml.match(/<script[^>]+src="([^"?]+\.js)"[^>]*><\/script>/)?.[1];

  assert.ok(entryPath, "production index.html must reference an entry JavaScript bundle");
  const bundle = await readFile(join(distDirectory, entryPath.replace(/^\//, "")), "utf8");

  assert.ok(bundle.includes(supabaseUrl), "the active Supabase URL was not embedded in the entry bundle");
  assert.ok(bundle.includes(supabaseAnonKey), "the active Supabase key was not embedded in the entry bundle");
  assert.doesNotMatch(bundle, /\.env에 VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY를 설정해야 합니다\./);
});
