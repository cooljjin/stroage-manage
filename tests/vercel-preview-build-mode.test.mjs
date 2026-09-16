import assert from "node:assert/strict"
import { chmod, copyFile, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { spawnSync } from "node:child_process"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import process from "node:process"
import test from "node:test"

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..")
const sourceScript = join(projectRoot, "scripts/build-for-deployment.mjs")

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "stockly-vercel-build-"))
  await mkdir(join(root, "scripts"))
  await mkdir(join(root, "bin"))
  await copyFile(sourceScript, join(root, "scripts/build-for-deployment.mjs"))
  await writeFile(join(root, "bin/npx"), '#!/bin/sh\nprintf "%s\\n" "$*" >> .tool-calls\n')
  await chmod(join(root, "bin/npx"), 0o755)
  return root
}

function run(root, vercelEnv) {
  return spawnSync(process.execPath, ["scripts/build-for-deployment.mjs"], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, PATH: `${join(root, "bin")}:${process.env.PATH}`, VERCEL_ENV: vercelEnv }
  })
}

test("Vercel Preview builds the staging Vite bundle", async (t) => {
  const root = await fixture()
  t.after(() => rm(root, { recursive: true, force: true }))

  const result = run(root, "preview")

  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual((await readFile(join(root, ".tool-calls"), "utf8")).trim().split("\n"), ["tsc -b", "vite build --mode staging"])
})

test("Vercel Production builds the production Vite bundle", async (t) => {
  const root = await fixture()
  t.after(() => rm(root, { recursive: true, force: true }))

  const result = run(root, "production")

  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual((await readFile(join(root, ".tool-calls"), "utf8")).trim().split("\n"), ["tsc -b", "vite build --mode production"])
})
