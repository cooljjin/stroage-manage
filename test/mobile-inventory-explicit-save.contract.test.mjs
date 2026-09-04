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

test("mobile inventory drafts are persisted only by the save action", () => {
  const queueMobileTarget = functionBody("queueMobileTarget", "saveMobileDraft");
  const saveMobileDraft = functionBody("saveMobileDraft", "changeMobileInputMode");

  assert.doesNotMatch(inventoryOperationPage, /mobileFinalizeRef|registerBeforeLeave|visibilitychange|pagehide|appStateChange|recoverMobileInventorySessions/);
  assert.doesNotMatch(queueMobileTarget, /flushMobileTargets/);
  assert.match(saveMobileDraft, /mobileQueuedTargetRef\.current = pendingDraft/);
  assert.match(saveMobileDraft, /await flushMobileTargets\(\)/);
  assert.match(saveMobileDraft, /await finalizeMobileInventorySession\(sessionId\)/);
  assert.match(inventoryOperationPage, /onSave=\{\(\) => void saveMobileDraft\(\)\}/);
});
