import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import test from "node:test";

const inventoryOperationPage = readFileSync(new URL("../src/pages/InventoryOperationPage.tsx", import.meta.url), "utf8");
const mobileInventoryControls = readFileSync(new URL("../src/components/MobileInventoryControls.tsx", import.meta.url), "utf8");

function functionBody(name, nextName) {
  const start = inventoryOperationPage.indexOf(`function ${name}`);
  const end = inventoryOperationPage.indexOf(`function ${nextName}`, start);
  return inventoryOperationPage.slice(start, end);
}

test("mobile inventory drafts are persisted only by the save action", () => {
  const saveMobileDraft = functionBody("saveMobileDraft", "changeMobileInputMode");

  assert.doesNotMatch(inventoryOperationPage, /mobileFinalizeRef|registerBeforeLeave|visibilitychange|pagehide|appStateChange|recoverMobileInventorySessions/);
  assert.match(saveMobileDraft, /const targets = buildMobileSaveTargets\(pendingDraft\);/);
  assert.match(saveMobileDraft, /for \(const \[index, target\] of targets\.entries\(\)\)/);
  assert.match(saveMobileDraft, /mobileQueuedTargetRef\.current = target/);
  assert.match(saveMobileDraft, /await flushMobileTargets\(index === targets\.length - 1\)/);
  assert.match(saveMobileDraft, /await finalizeMobileInventorySession\(sessionId\)/);
  assert.match(inventoryOperationPage, /onSave=\{\(\) => void saveMobileDraft\(\)\}/);
});

test("mobile history keeps local dial commits navigable before save", () => {
  const commit = functionBody("handleMobileCommit", "recordMobileInventoryCheck");

  assert.doesNotMatch(inventoryOperationPage, /mobileHistoryNavigationDisabled|historyNavigationDisabled/);
  assert.doesNotMatch(mobileInventoryControls, /historyNavigationDisabled/);
  assert.match(commit, /const nextHistory = history\.slice\(0, Math\.max\(0, currentIndex \+ 1\)\);/);
  assert.match(commit, /syncMobileEditHistory\(nextHistory, nextIndex\);/);
  assert.doesNotMatch(commit, /mobileQueuedTargetRef\.current|queueMobileTarget/);
});

test("mobile history navigation remains available for drafts and explicit-save only", () => {
  const historyNavigation = functionBody("handleMobileHistoryNavigation", "handleMobileKeypadConfirm");

  assert.match(historyNavigation, /if \(mobileSaveInFlightRef\.current \|\| mobileQueuedTargetRef\.current\) return;/);
  assert.doesNotMatch(historyNavigation, /mobileDraftTargetRef\.current/);
  assert.match(historyNavigation, /handleMobileCommit\(target, targetIndex\);/);
  assert.doesNotMatch(historyNavigation, /flushMobileTargets|saveMobileDraft|applyMobileInventoryChange/);
});

test("changing mobile tabs keeps the selected history quantity", () => {
  const mobileControls = inventoryOperationPage.slice(
    inventoryOperationPage.indexOf("<MobileInventoryControls"),
    inventoryOperationPage.indexOf("<QuantityKeypadSheet"),
  );

  assert.doesNotMatch(mobileControls, /onModeChange=\{[\s\S]*?resetMobileDraft\(\)/);
  assert.match(mobileControls, /setMobileMode\(nextMode\);/);
});

test("mobile history labels follow the selected point with a 24-hour timestamp", () => {
  const syncHistory = functionBody("syncMobileEditHistory", "recordMobileEditResult");

  assert.match(syncHistory, /const editAt = nextHistory\[nextIndex\]\?\.editAt \?\? "";/);
  assert.match(syncHistory, /mobileEditPointAtRef\.current = editAt;/);
  assert.match(syncHistory, /setMobileEditPointAt\(editAt\);/);
  assert.match(
    inventoryOperationPage,
    /historyPositionLabel=\{mobileEditPointAt \? `히스토리 시점 \$\{formatDateTime\(mobileEditPointAt\)\}` : null\}/,
  );
  assert.doesNotMatch(inventoryOperationPage, /formatMonthDay/);
  assert.match(mobileInventoryControls, /const historyStatusLabel = historyPositionLabel/);
});
