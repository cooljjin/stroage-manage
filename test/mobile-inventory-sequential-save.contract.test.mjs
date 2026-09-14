import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import test from "node:test";

const inventoryOperationPage = readFileSync(new URL("../src/pages/InventoryOperationPage.tsx", import.meta.url), "utf8");

function functionBody(name, nextName) {
  const start = inventoryOperationPage.indexOf(`function ${name}`);
  const end = inventoryOperationPage.indexOf(`function ${nextName}`, start);
  return inventoryOperationPage.slice(start, end);
}

test("saving drafts changed at both locations persists each location in order", () => {
  const saveMobileDraft = functionBody("saveMobileDraft", "changeMobileInputMode");

  assert.match(inventoryOperationPage, /function buildMobileSaveTargets\(draft: MobileInventoryTarget\): MobileInventoryTarget\[\]/);
  assert.match(inventoryOperationPage, /targetLocation: "창고"/);
  assert.match(inventoryOperationPage, /targetLocation: "매장"/);
  assert.match(saveMobileDraft, /for \(const target of buildMobileSaveTargets\(pendingDraft\)\)/);
  assert.match(saveMobileDraft, /mobileQueuedTargetRef\.current = target;/);
  assert.match(saveMobileDraft, /mobileHistoryNavigationRef\.current = mobileEditHistoryIndexRef\.current;/);
  assert.match(saveMobileDraft, /const saved = await flushMobileTargets\(\);/);
});
