import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { URL } from "node:url";

const controlsPath = new URL("../src/components/MobileInventoryControls.tsx", import.meta.url);
const pagePath = new URL("../src/pages/InventoryOperationPage.tsx", import.meta.url);

test("audit mode exposes a save action for an unchanged inventory check", async () => {
  const controls = await readFile(controlsPath, "utf8");
  const page = await readFile(pagePath, "utf8");

  assert.match(controls, /onAuditSave:\s*\(\)\s*=>\s*void/);
  assert.match(controls, /mode === "audit"[\s\S]*?onClick=\{onAuditSave\}[\s\S]*?>\s*저장/s);
  assert.match(page, /onAuditSave=\{\(\) => void recordMobileInventoryCheck\(\["창고", "매장"\]\)\}/);
  assert.match(page, /for \(const locationToCheck of locations\)[\s\S]*?target_location: locationToCheck/s);
});
