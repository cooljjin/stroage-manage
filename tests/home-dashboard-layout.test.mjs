import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import test from "node:test";
import {
  DEFAULT_HOME_DASHBOARD_CARD_ORDER,
  homeDashboardLayoutStorageKey,
  moveHomeDashboardCard,
  moveHomeDashboardCardBy,
  normalizeHomeDashboardCardOrder
} from "../src/lib/homeDashboardLayout.ts";

const page = readFileSync(new URL("../src/pages/HomePage.tsx", import.meta.url), "utf8");

test("home dashboard card order accepts only a complete unique known layout", () => {
  assert.deepEqual(DEFAULT_HOME_DASHBOARD_CARD_ORDER, ["receipts", "todos", "handovers"]);
  assert.deepEqual(normalizeHomeDashboardCardOrder(["handovers", "receipts", "todos"]), ["handovers", "receipts", "todos"]);
  assert.deepEqual(normalizeHomeDashboardCardOrder(["todos", "todos", "other"]), DEFAULT_HOME_DASHBOARD_CARD_ORDER);
});

test("home dashboard cards can be reordered by drop target and keyboard direction", () => {
  const order = ["receipts", "todos", "handovers"];
  assert.deepEqual(moveHomeDashboardCard(order, "receipts", "handovers"), ["todos", "handovers", "receipts"]);
  assert.deepEqual(moveHomeDashboardCardBy(order, "todos", 1), ["receipts", "handovers", "todos"]);
  assert.deepEqual(moveHomeDashboardCardBy(order, "receipts", -1), order);
  assert.deepEqual(order, ["receipts", "todos", "handovers"]);
});

test("home dashboard layout is stored per store and user and has an explicit edit/save flow", () => {
  assert.notEqual(homeDashboardLayoutStorageKey("store-a", "user-a"), homeDashboardLayoutStorageKey("store-a", "user-b"));
  assert.notEqual(homeDashboardLayoutStorageKey("store-a", "user-a"), homeDashboardLayoutStorageKey("store-b", "user-a"));
  assert.match(page, /aria-label="홈 화면 편집"/);
  assert.match(page, /data-home-dashboard-card=/);
  assert.match(page, /onPointerDown=\{\(event\) => startDashboardCardDrag/);
  assert.match(page, /onPointerMove=\{updateDashboardCardDrag/);
  assert.match(page, /ArrowUp|ArrowLeft/);
  assert.match(page, /localStorage\.setItem\(layoutStorageKey/);
  assert.match(page, /저장/);
  assert.match(page, /취소/);
});

test("dragged home card follows the pointer while its measured placeholder preserves the grid slot", () => {
  const renderer = page.slice(page.indexOf("function OrderedDashboardCards"), page.indexOf("export function HomePage"));
  const startDrag = page.slice(page.indexOf("function startDashboardCardDrag"), page.indexOf("function updateDashboardCardDrag"));
  const finishDrag = page.slice(page.indexOf("function finishDashboardCardDrag"), page.indexOf("function moveDashboardCardWithKeyboard"));

  assert.match(startDrag, /pointerX: event\.clientX - gridRect\.left/);
  assert.match(startDrag, /pointerY: event\.clientY - gridRect\.top/);
  assert.match(page, /pointerX: event\.clientX - gridRect\.left/);
  assert.match(page, /pointerY: event\.clientY - gridRect\.top/);
  assert.match(page, /data-home-dashboard-grid/);
  assert.match(renderer, /data-home-dashboard-card-placeholder=\{activeDrag \? cardId : undefined\}/);
  assert.match(renderer, /key=\{cardId\}/);
  assert.match(renderer, /left: activeDrag\.pointerX - activeDrag\.offsetX/);
  assert.match(renderer, /top: activeDrag\.pointerY - activeDrag\.offsetY/);
  assert.match(renderer, /position: "absolute"/);
  assert.match(renderer, /pointerEvents: "none"/);
  assert.match(renderer, /transform: "scale\(1\.02\)"/);
  assert.match(renderer, /boxShadow: "0 16px 32px rgba\(15, 23, 42, 0\.22\)"/);
  assert.match(renderer, /style=\{activeDrag \? \{\s*width: activeDrag\.width,\s*height: activeDrag\.height/);
  assert.match(renderer, /width: activeDrag\.width/);
  assert.match(renderer, /height: activeDrag\.height/);
  assert.match(finishDrag, /dashboardCardDragRef\.current = null/);
  assert.match(finishDrag, /setDraggingDashboardCard\(null\)/);
  assert.doesNotMatch(finishDrag, /setDraftDashboardCardOrder/);
});

test("dashboard drag capture stays on the stable grid as cards reorder", () => {
  const gridStart = page.indexOf("data-home-dashboard-grid", page.indexOf("function dashboardCardDragHandle"));
  const grid = page.slice(page.lastIndexOf("<div", gridStart), page.indexOf(">", gridStart) + 1);
  const handle = page.slice(page.indexOf("function dashboardCardDragHandle"), page.indexOf("function openTodoCalendar"));
  const startDrag = page.slice(page.indexOf("function startDashboardCardDrag"), page.indexOf("function updateDashboardCardDrag"));

  assert.match(startDrag, /grid\.setPointerCapture\(event\.pointerId\)/);
  assert.match(grid, /onPointerMove=\{updateDashboardCardDrag\}/);
  assert.match(grid, /onPointerUp=\{finishDashboardCardDrag\}/);
  assert.match(grid, /onPointerCancel=\{finishDashboardCardDrag\}/);
  assert.match(grid, /onLostPointerCapture=\{finishDashboardCardDrag\}/);
  assert.doesNotMatch(handle, /onPointerMove=|onPointerUp=|onPointerCancel=|onLostPointerCapture=/);
});
