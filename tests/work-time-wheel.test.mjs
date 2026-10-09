import assert from "node:assert/strict";
import test from "node:test";
import { URL } from "node:url";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { transpileModule } from "typescript";
const source = await readFile(new URL("../src/lib/workTimeWheel.ts", import.meta.url), "utf8");
const context = { exports: {} };
runInNewContext(transpileModule(source, { compilerOptions: { module: 1 } }).outputText, context);
const { wheelValue, centeredWheelRow, nearestWheelRow, formatWorkTime, WORK_TIME_HOURS: hours, WORK_TIME_MINUTES: minutes } = context.exports;

test("hour and half-hour wheels wrap without blank edges and preserve noon/midnight", () => {
  assert.equal(wheelValue((centeredWheelRow("23", hours) + 1) * 44, hours), "00");
  assert.equal(wheelValue((centeredWheelRow("00", hours) - 1) * 44, hours), "23");
  assert.equal(wheelValue((centeredWheelRow("11", hours) + 1) * 44, hours), "12");
  assert.equal(wheelValue((centeredWheelRow("30", minutes) + 1) * 44, minutes), "00");
  assert.equal(wheelValue((centeredWheelRow("00", minutes) - 1) * 44, minutes), "30");
  assert.equal(formatWorkTime("00:00"), "오전 12:00");
  assert.equal(formatWorkTime("12:30"), "오후 12:30");
});

test("settled recenter preserves value and nearest selection avoids long repeated-cycle jumps", () => {
  for (const options of [hours, minutes]) for (const value of options) {
    assert.equal(wheelValue(centeredWheelRow(value, options) * 44, options), value);
    const current = centeredWheelRow(options[0], options) * 44;
    const target = nearestWheelRow(current, value, options);
    assert.ok(Math.abs(target - current / 44) <= options.length / 2);
    assert.equal(wheelValue(target * 44, options), value);
  }
});

test("confirm reads the nearest visible row before any state update and bounds overscroll", () => {
  const row = centeredWheelRow("10", hours);
  assert.equal(wheelValue((row + 0.7) * 44, hours), "11");
  assert.equal(wheelValue(-100, minutes), "00");
  assert.equal(wheelValue(999999, minutes), "30");
});
