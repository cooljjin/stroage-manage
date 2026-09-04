import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import test from "node:test";

const inventoryOperationPage = readFileSync(new URL("../src/pages/InventoryOperationPage.tsx", import.meta.url), "utf8");

test("inventory input mode defaults to the current viewport until the user chooses a mode", () => {
  assert.match(inventoryOperationPage, /function readStoredMobileDialMode\(defaultDialMode: boolean\): boolean/);
  assert.match(inventoryOperationPage, /const storedMode = window\.localStorage\.getItem\(MOBILE_INPUT_MODE_STORAGE_KEY\);/);
  assert.match(inventoryOperationPage, /return storedMode === "dial" \? true : storedMode === "button" \? false : defaultDialMode;/);
  assert.match(inventoryOperationPage, /useState\(\(\) => readStoredMobileDialMode\(isInventoryTouchViewport\)\)/);
  assert.match(inventoryOperationPage, /if \(readStoredMobileDialMode\(isInventoryTouchViewport\) !== isInventoryTouchViewport\) return;/);
  assert.match(inventoryOperationPage, /setMobileDialMode\(isInventoryTouchViewport\);/);
});
