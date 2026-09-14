import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import test from "node:test";

const inventoryOperationPage = readFileSync(new URL("../src/pages/InventoryOperationPage.tsx", import.meta.url), "utf8");
const mobileInventoryControls = readFileSync(new URL("../src/components/MobileInventoryControls.tsx", import.meta.url), "utf8");

function functionBody(source, name, nextName) {
  const start = source.indexOf(`function ${name}`);
  const end = source.indexOf(`function ${nextName}`, start);
  return source.slice(start, end);
}

test("history navigation explicitly rebases dial displays for every selected local point", () => {
  const historyNavigation = functionBody(inventoryOperationPage, "handleMobileHistoryNavigation", "handleMobileKeypadConfirm");

  assert.match(inventoryOperationPage, /const \[mobileHistoryRebaseSequence, setMobileHistoryRebaseSequence\] = useState\(0\);/);
  assert.match(historyNavigation, /setMobileHistoryRebaseSequence\(\(sequence\) => sequence \+ 1\);/);
  assert.match(inventoryOperationPage, /historyRebaseSequence=\{mobileHistoryRebaseSequence\}/);
  assert.match(mobileInventoryControls, /historyRebaseSequence\?: number;/);
  assert.match(mobileInventoryControls, /historyRebaseSequence,/);
  assert.match(mobileInventoryControls, /const wheelRebaseSequence = \(autoRebaseSequence \?\? 0\) \+ \(historyRebaseSequence \?\? 0\);/);
  assert.match(mobileInventoryControls, /authoritativeRebaseSequence=\{wheelRebaseSequence\}/);
});
