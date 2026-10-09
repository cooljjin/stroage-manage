import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyScheduleDateRange,
  hasExceededScheduleDragThreshold,
  toggleScheduleDate
} from "../src/lib/scheduleDateSelection.ts";

const date = (day) => `2026-06-${String(day).padStart(2, "0")}`;
const dates = (...days) => days.map(date);
const daysBetween = (first, last) => Array.from({ length: last - first + 1 }, (_, index) => date(first + index));

test("taps toggle only the touched date and allow non-contiguous selection", () => {
  let selected = [];
  selected = toggleScheduleDate(selected, date(3));
  selected = toggleScheduleDate(selected, date(6));
  assert.deepEqual(selected, dates(3, 6));

  selected = [1, 2, 3, 4, 5, 6, 7].map(date);
  selected = toggleScheduleDate(selected, date(3));
  selected = toggleScheduleDate(selected, date(6));
  assert.deepEqual(selected, dates(1, 2, 4, 5, 7));
});

test("same-week drags select a date range in either horizontal direction", () => {
  assert.deepEqual(applyScheduleDateRange([], date(1), date(6), "select"), daysBetween(1, 6));
  assert.deepEqual(applyScheduleDateRange([], date(6), date(1), "select"), daysBetween(1, 6));
});

test("drags across one or multiple week rows use every actual date", () => {
  assert.deepEqual(applyScheduleDateRange([], date(5), date(10), "select"), daysBetween(5, 10));
  assert.deepEqual(applyScheduleDateRange([], date(5), date(19), "select"), daysBetween(5, 19));
});

test("upward and diagonal drags use the inclusive chronological range", () => {
  assert.deepEqual(applyScheduleDateRange([], date(12), date(4), "select"), daysBetween(4, 12));
  assert.deepEqual(applyScheduleDateRange([], date(5), date(16), "select"), daysBetween(5, 16));
});

test("drag preview shrinks when the pointer returns to an earlier date", () => {
  const initial = [date(20)];
  const firstPreview = applyScheduleDateRange(initial, date(5), date(12), "select");
  const returnedPreview = applyScheduleDateRange(initial, date(5), date(7), "select");
  assert.deepEqual(firstPreview, [...daysBetween(5, 12), date(20)].sort());
  assert.deepEqual(returnedPreview, [...daysBetween(5, 7), date(20)].sort());
});

test("dragging over selected dates deselects only the range and preserves outside dates", () => {
  const initial = [...daysBetween(1, 10), date(15)];
  assert.deepEqual(applyScheduleDateRange(initial, date(3), date(6), "deselect"), [
    ...dates(1, 2), ...daysBetween(7, 10), date(15)
  ]);
});

test("revisiting dates during a drag recomputes from the pointer-down snapshot", () => {
  const initial = [date(2), date(20)];
  applyScheduleDateRange(initial, date(5), date(12), "select");
  const finalPreview = applyScheduleDateRange(initial, date(5), date(7), "select");
  assert.deepEqual(finalPreview, [...dates(2), ...daysBetween(5, 7), date(20)].sort());
});

test("movement at or below eight pixels remains a tap; larger movement starts a drag", () => {
  assert.equal(hasExceededScheduleDragThreshold(0, 0, 8, 0), false);
  assert.equal(hasExceededScheduleDragThreshold(0, 0, 5.65, 5.65), false);
  assert.equal(hasExceededScheduleDragThreshold(0, 0, 8.01, 0), true);
  assert.equal(hasExceededScheduleDragThreshold(0, 0, 6, 6), true);
});
