import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const page = await readFile("src/pages/TimelineCalendarPage.tsx", "utf8");
const app = await readFile("src/App.tsx", "utf8");

test("timeline calendar fits its full month grid inside the mobile viewport", () => {
  assert.match(page, /h-\[calc\(100dvh-9\.5rem-env\(safe-area-inset-top\)-env\(safe-area-inset-bottom\)\)\]/);
  assert.match(page, /onClick=\{onBack\} className="touch-button inline-flex shrink-0 items-center justify-center border-0 bg-transparent p-1 text-slate-600 shadow-none hover:bg-transparent dark:bg-transparent dark:text-slate-300"/);
  assert.match(page, /grid-rows-6/);
  assert.match(page, /h-full min-h-0 rounded-md border p-1/);
  assert.match(page, /hidden text-sm text-slate-500 dark:text-slate-400 sm:block/);
  assert.match(app, /permittedRoute\.name !== "operation" && permittedRoute\.name !== "timeline-calendar"/);
  assert.match(app, /<TimelineCalendarPage currentStoreId=\{profile\.store_id\} onBack=\{goBack\} \/>/);
});
