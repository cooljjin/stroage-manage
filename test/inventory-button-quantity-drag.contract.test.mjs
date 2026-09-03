import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import test from "node:test";

const inventoryOperationPage = readFileSync(new URL("../src/pages/InventoryOperationPage.tsx", import.meta.url), "utf8");
const buttonModeForm = inventoryOperationPage.slice(
  inventoryOperationPage.indexOf('<form onSubmit={handleSubmit}'),
  inventoryOperationPage.indexOf('<form onSubmit={handleMemoSubmit}')
);

test("button input quantity supports horizontal drag with visible direction hints", () => {
  assert.match(inventoryOperationPage, /const QUANTITY_DRAG_STEP_PX = \d+;/);
  assert.match(inventoryOperationPage, /function startQuantityDrag\(/);
  assert.match(inventoryOperationPage, /const stepCount = Math\.trunc\(deltaX \/ QUANTITY_DRAG_STEP_PX\);/);
  assert.match(inventoryOperationPage, /Math\.max\(0, drag\.startQuantity \+ stepCount\)/);
  assert.match(buttonModeForm, /onPointerDown=\{startQuantityDrag\}/);
  assert.match(buttonModeForm, /onPointerMove=\{handleQuantityDrag\}/);
  assert.match(buttonModeForm, /<ChevronLeft aria-hidden="true"/);
  assert.match(buttonModeForm, /<ChevronRight aria-hidden="true"/);
  assert.match(buttonModeForm, /좌우로 밀어 수량 조정/);
});
