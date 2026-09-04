import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { URL } from "node:url";

const controlsPath = new URL("../src/components/MobileInventoryControls.tsx", import.meta.url);
const pagePath = new URL("../src/pages/InventoryOperationPage.tsx", import.meta.url);

test("dial inventory changes save only through the full-width save action", async () => {
  const controls = await readFile(controlsPath, "utf8");
  const page = await readFile(pagePath, "utf8");

  assert.match(controls, /onSave:\s*\(\)\s*=>\s*void/);
  assert.doesNotMatch(controls, /onAuditSave/);
  assert.match(
    controls,
    /<button type="button" onClick=\{onSave\}[\s\S]*?className="primary-button inline-flex min-h-10 w-full items-center justify-center gap-1[^"]*"[\s\S]*?>\s*<Check size=\{16\} \/>저장\s*<\/button>/
  );
  assert.match(page, /onSave=\{\(\) => void saveMobileInventory\(\)\}/);

  const commitHandler = page.match(/function handleMobileCommit[\s\S]*?\n {2}\}/)?.[0] ?? "";
  assert.doesNotMatch(commitHandler, /queueMobileTarget\(/);
  const queueHandler = page.match(/function queueMobileTarget[\s\S]*?\n {2}\}/)?.[0] ?? "";
  assert.doesNotMatch(queueHandler, /flushMobileTargets\(/);
});
