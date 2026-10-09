import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import { URL } from "node:url";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("../src/lib/attendancePayroll.ts", import.meta.url), "utf8");
const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const initializer = app.slice(app.indexOf("function initialAttendanceToken()"), app.indexOf("function attendanceFinalizeRequestId"));
function runtime() {
  const context = { exports: {}, crypto: webcrypto, URL };
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, context);
  return context.exports;
}
function storage() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
}

test("pending NFC stays in its originating runtime and keeps its retry identity", () => {
  const device = storage();
  const first = runtime();
  first.savePendingAttendanceToken(device, "fixture-token", 1000);
  const requestId = first.pendingAttendanceRequestId(device, 1001);
  first.savePendingAttendanceToken(device, "fixture-token", 1002);
  assert.equal(first.pendingAttendanceRequestId(device, 1003), requestId);
  assert.equal(first.readPendingAttendanceToken(device, 1003), "fixture-token");
  const otherDevice = storage();
  assert.equal(runtime().readPendingAttendanceToken(otherDevice, 1003), null);
  assert.equal(runtime().readPendingAttendanceToken(device, 1003), null, "restored session storage after restart must not replay the tap");
  assert.equal(first.readPendingAttendanceToken(device, 1003), null);
});

test("copied browser session storage cannot open attendance in another runtime", () => {
  const original = storage();
  runtime().savePendingAttendanceToken(original, "fixture-token", 1000);
  const cloned = storage();
  cloned.setItem("stockly-pending-attendance-token", original.getItem("stockly-pending-attendance-token"));
  assert.equal(runtime().pendingAttendanceRequestId(cloned, 1001), null);
});

test("legacy stored tokens and expired taps cannot be restored", () => {
  const device = storage();
  device.setItem("stockly-pending-attendance-token", JSON.stringify({ token: "old-token", savedAt: 1000, requestId: "old-request" }));
  const current = runtime();
  assert.equal(current.readPendingAttendanceToken(device, 1001), null);
  current.savePendingAttendanceToken(device, "fixture-token", 1000);
  assert.equal(current.readPendingAttendanceToken(device, 1000 + 11 * 60_000), null);
});

test("browser NFC URL is consumed before login so a reload cannot replay it", () => {
  const device = storage();
  const current = runtime();
  const window = { location: { href: "https://fixture.invalid/attendance/tag/fixture-token" }, history: { state: null, replaceState: (_state, _unused, path) => { window.location.href = `https://fixture.invalid${path}`; } } };
  const context = { ...current, sessionStorage: device, window, attendanceTokenFromUrl: url => current.parseAttendanceTagUrl(url, "fixture.invalid") };
  const initialize = vm.runInNewContext(ts.transpileModule(`(${initializer.trim()})`, {}).outputText, context);
  assert.equal(initialize(), "fixture-token");
  assert.equal(window.location.href, "https://fixture.invalid/");
  assert.equal(initialize(), "fixture-token", "React StrictMode initialization must retain the live tap");
  Object.assign(context, runtime());
  assert.equal(initialize(), null, "a new app runtime with the same URL/storage must stay closed");
});
