import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import test from "node:test";

const mobileInventory = readFileSync(new URL("../src/lib/mobileInventory.ts", import.meta.url), "utf8");
const verticalQuantityWheel = readFileSync(new URL("../src/components/VerticalQuantityWheel.tsx", import.meta.url), "utf8");

test("dial wheel keeps a fractional center but shows integer adjacent values", () => {
  assert.match(mobileInventory, /snapFractionalValue = false/);
  assert.match(mobileInventory, /const baseValue = snapFractionalValue && offset !== 0 && !Number\.isInteger\(value\) \? Math\.trunc\(value\) : value;/);
  assert.match(mobileInventory, /const nextValue = baseValue \+ offset \* \(reverseDisplayOrder \? -1 : 1\);/);
  assert.match(verticalQuantityWheel, /snapFractionalValueOnStep = true/);
  assert.match(verticalQuantityWheel, /getVerticalWheelSlotValue\(displayValue, offset, min, max, reverseDisplayOrder, snapFractionalValueOnStep\)/);
});
