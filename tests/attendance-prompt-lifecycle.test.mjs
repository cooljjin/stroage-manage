import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { URL } from "node:url";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("App.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const effects = [];
function visit(node) {
  if (ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect" && node.arguments[0]?.getText(ast).includes("setAttendancePunch")) {
    effects.push(ts.transpileModule(`(${node.arguments[0].getText(ast)})`, {}).outputText);
  }
  ts.forEachChild(node, visit);
}
visit(ast);

const messageEffects = [];
function visitMessageEffect(node) {
  if (ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect" && node.arguments[1]?.getText(ast) === "[attendanceMessage]") {
    messageEffects.push(ts.transpileModule(`(${node.arguments[0].getText(ast)})`, {}).outputText);
  }
  ts.forEachChild(node, visitMessageEffect);
}
visitMessageEffect(ast);

test("attendance completion notice clears after 3 seconds and cancels stale timers", () => {
  assert.equal(messageEffects.length, 1, "completion notice needs an auto-dismiss effect");
  let visible = "출근 시각 저장 완료";
  let clock = 0;
  let nextId = 0;
  const timers = new Map();
  const context = {
    attendanceMessage: visible,
    setAttendanceMessage: value => { visible = value; },
    window: {
      setTimeout: (callback, delay) => { const id = ++nextId; timers.set(id, { callback, at: clock + delay }); return id; },
      clearTimeout: id => timers.delete(id)
    }
  };
  const run = () => vm.runInNewContext(messageEffects[0], context)();
  const advance = milliseconds => {
    clock += milliseconds;
    for (const [id, timer] of timers) if (timer.at <= clock) { timers.delete(id); timer.callback(); }
  };
  const cleanup = run();
  advance(2999);
  assert.equal(visible, "출근 시각 저장 완료");
  cleanup();
  visible = context.attendanceMessage = "퇴근 시각 저장 완료";
  const unmount = run();
  advance(1);
  assert.equal(visible, "퇴근 시각 저장 완료", "old notice timer must not clear the new notice");
  advance(2999);
  assert.equal(visible, "");
  unmount();
  context.attendanceMessage = "";
  run();
  assert.equal(timers.size, 0, "empty notices must not schedule a timer");
  context.attendanceMessage = "저장 완료";
  run()();
  assert.equal(timers.size, 0, "unmount/StrictMode cleanup must cancel the timer");
});

// Execute the actual App attendance effects with an isolated RPC boundary, no DB access.
async function mount(punch, { token = null, testTag = null, error = null, unmount = false, expired = false } = {}) {
  const calls = [];
  let requestReads = 0;
  let visible = null;
  const storage = { getItem: () => null, setItem() {}, removeItem() {} };
  const context = {
    profile: { id: "isolated-user", store_id: "isolated-store" },
    attendanceUserRef: { current: null },
    attendanceToken: token, attendanceTestTag: testTag, sessionStorage: storage,
    pendingAttendanceRequestId: () => expired && requestReads++ > 0 ? null : "stable-request-id",
    consumePendingAttendanceToken: () => {},
    attendanceTokenFromUrl: () => null,
    window: { location: { href: "https://example.invalid/" } },
    Services: { DatabaseService: { rpc: (name, args) => {
      calls.push({ name, args });
      return Promise.resolve({ data: error ? null : punch, error });
    } } },
    setAttendancePunch: value => { visible = value; },
    setAttendanceBusy() {}, setAttendanceError() {}, setAttendanceMessage() {},
    setAttendanceToken() {}, setAttendanceTestTag() {}
  };
  const cleanups = effects.map(effect => vm.runInNewContext(effect, context)());
  if (unmount) cleanups.forEach(cleanup => cleanup?.());
  await Promise.resolve();
  return { visible, calls };
}

for (const punchType of ["check_in", "check_out"]) {
  const punch = { id: "pending-event", punch_type: punchType, status: "pending" };
  test(`${punchType} prompt is not restored on ordinary reopen or profile refresh`, async () => {
    for (let i = 0; i < 2; i++) {
      const { visible, calls } = await mount(punch);
      assert.equal(visible, null, "opening without a new tag must not restore the prompt");
      assert.deepEqual(calls, [], "startup must not read or mutate pending attendance");
    }
  });
  test(`${punchType} NFC and test tags still open the existing attendance flow`, async () => {
    for (const options of [{ token: "valid-token" }, { testTag: { id: "test-tag", requestId: "test-request-id" } }]) {
      const { visible, calls } = await mount(punch, options);
      assert.equal(visible, punch);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].name, options.token ? "begin_attendance_punch" : "begin_attendance_tag_test");
      assert.equal(calls[0].args.request_id, options.token ? "stable-request-id" : "test-request-id");
    }
  });
  test(`${punchType} failed or cancelled tag requests do not open a prompt`, async () => {
    for (const options of [{ token: "valid-token", error: { message: "offline" } }, { token: "valid-token", unmount: true }]) {
      assert.equal((await mount(punch, options)).visible, null);
    }
  });
}


test("an expired tag cannot open a prompt after a delayed RPC response", async () => {
  const result = await mount({ id: "expired-event", status: "pending" }, { token: "fixture-token", expired: true });
  assert.equal(result.calls.length, 1);
  assert.equal(result.visible, null);
});

test("changing account or store clears the originating user's attendance prompt", () => {
  const identityEffect = effects.find(effect => effect.includes("attendanceUserRef"));
  assert.ok(identityEffect);
  for (const nextProfile of [null, { id: "other-user", store_id: "isolated-store" }, { id: "isolated-user", store_id: "other-store" }]) {
    let visible = { id: "originating-punch" };
    let pending = "fixture-token";
    const context = {
      profile: { id: "isolated-user", store_id: "isolated-store" },
      attendanceUserRef: { current: null }, sessionStorage: {},
      consumePendingAttendanceToken: () => { pending = null; },
      setAttendanceToken() {}, setAttendanceTestTag() {}, setAttendanceBusy() {}, setAttendanceError() {}, setAttendanceMessage() {},
      setAttendancePunch: value => { visible = value; }
    };
    const run = () => vm.runInNewContext(identityEffect, context)();
    run(); run();
    assert.ok(visible, "same account refresh keeps its live prompt");
    context.profile = nextProfile;
    run();
    assert.equal(visible, null);
    assert.equal(pending, null);
  }
});
