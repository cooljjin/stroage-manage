import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import test from "node:test";

const inventoryOperationPage = readFileSync(new URL("../src/pages/InventoryOperationPage.tsx", import.meta.url), "utf8");
const buttonModeForm = inventoryOperationPage.slice(
  inventoryOperationPage.indexOf('<form onSubmit={handleSubmit}'),
  inventoryOperationPage.indexOf('<form onSubmit={handleMemoSubmit}')
);

test("button input mode shows save before the status section on mobile", () => {
  assert.match(buttonModeForm, /primary-button order-10 mt-4 min-h-11 w-full/);
  assert.match(buttonModeForm, /order-12 mt-5 rounded-md border border-slate-200/);
});
