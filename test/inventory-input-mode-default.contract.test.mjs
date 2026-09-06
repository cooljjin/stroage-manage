import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import test from "node:test";

const inventoryOperationPage = readFileSync(new URL("../src/pages/InventoryOperationPage.tsx", import.meta.url), "utf8");

test("inventory input mode restores saved preferences and uses the current viewport as its fallback", () => {
  assert.match(inventoryOperationPage, /function readStoredMobileDialMode\(defaultDialMode: boolean\): boolean/);
  assert.match(inventoryOperationPage, /resolveMobileDialMode\(window\.localStorage\.getItem\(MOBILE_INPUT_MODE_STORAGE_KEY\), defaultDialMode\)/);
  assert.match(inventoryOperationPage, /useState\(\(\) => readStoredMobileDialMode\(isInventoryTouchViewport\)\)/);
  assert.match(inventoryOperationPage, /if \(readStoredMobileDialMode\(isInventoryTouchViewport\) !== isInventoryTouchViewport\) return;/);
  assert.match(inventoryOperationPage, /setMobileDialMode\(isInventoryTouchViewport\);/);
});
