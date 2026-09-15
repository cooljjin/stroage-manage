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
  assert.match(saveMobileDraft, /const targets = buildMobileSaveTargets\(pendingDraft\);/);
  assert.match(saveMobileDraft, /for \(const \[index, target\] of targets\.entries\(\)\)/);
  assert.match(saveMobileDraft, /mobileQueuedTargetRef\.current = target;/);
  assert.match(saveMobileDraft, /mobileHistoryNavigationRef\.current = mobileEditHistoryIndexRef\.current;/);
  assert.match(saveMobileDraft, /const saved = await flushMobileTargets\(index === targets\.length - 1\);/);
});

test("saving two changed locations keeps dial values at the draft until the final result", () => {
  const applyMobileResult = functionBody("applyMobileResult", "flushMobileTargets");
  const flushMobileTargets = functionBody("flushMobileTargets", "saveMobileDraft");
  const saveMobileDraft = functionBody("saveMobileDraft", "changeMobileInputMode");

  assert.match(applyMobileResult, /renderDialValues: boolean/);
  assert.match(applyMobileResult, /if \(renderDialValues\) \{/);
  assert.match(applyMobileResult, /setMobileWarehouseQty\(result\.warehouse_qty\);/);
  assert.match(applyMobileResult, /setMobileStoreQty\(result\.store_qty\);/);
  assert.match(flushMobileTargets, /renderDialValues = true/);
  assert.match(flushMobileTargets, /applyMobileResult\(data, target, renderDialValues\);/);
  assert.match(saveMobileDraft, /const targets = buildMobileSaveTargets\(pendingDraft\);/);
  assert.match(saveMobileDraft, /await flushMobileTargets\(index === targets\.length - 1\);/);
});
