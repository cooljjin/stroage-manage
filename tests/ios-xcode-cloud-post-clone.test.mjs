import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { URL } from "node:url";
import test from "node:test";

const root = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const script = join(root, "ios/App/ci_scripts/ci_post_clone.sh");

test("post-clone script works without CI_WORKSPACE", () => {
  const temp = mkdtempSync(join(tmpdir(), "stockly-xcode-cloud-"));
  const bin = join(temp, "bin");
  const log = join(temp, "log");
  mkdirSync(bin);
  for (const command of ["brew", "node", "npm", "pod"]) {
    writeFileSync(join(bin, command), `#!/bin/sh\nif [ "$1" = "--prefix" ]; then echo "${temp}/node"; else printf '%s:%s\\n' "${command}" "$PWD" >> "${log}"; fi\n`);
    chmodSync(join(bin, command), 0o755);
  }
  try {
    execFileSync("sh", [script], { cwd: temp, env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, CI_WORKSPACE: undefined } });
    const output = readFileSync(log, "utf8");
    assert.match(output, new RegExp(`npm:${root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    assert.match(output, new RegExp(`pod:${join(root, "ios/App").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
