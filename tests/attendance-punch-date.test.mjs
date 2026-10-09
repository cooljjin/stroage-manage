import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { URL } from "node:url";
import vm from "node:vm";
import ts from "typescript";
import * as AttendancePayroll from "../src/lib/attendancePayroll.ts";

const componentSource = readFileSync(new URL("../src/components/AttendancePunchPrompt.tsx", import.meta.url), "utf8");
const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");

function elements(tree) {
  const result = [];
  const visit = (node) => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node || typeof node !== "object") return;
    result.push(node);
    visit(node.props?.children);
  };
  visit(tree);
  return result;
}

function runComponent(punch) {
  const confirmed = [];
  const state = [];
  let cursor = 0;
  const module = { exports: {} };
  const jsx = (type, props, key) => ({ type, props: props ?? {}, key });
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in state)) state[index] = typeof initial === "function" ? initial() : initial;
      return [state[index], (value) => { state[index] = typeof value === "function" ? value(state[index]) : value; }];
    },
    useMemo(callback) { return callback(); }
  };
  const mocks = {
    "react": react,
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "lucide-react": { Clock3: "Clock3", Nfc: "Nfc", X: "X" },
    "../lib/attendancePayroll": AttendancePayroll
  };
  const compiled = ts.transpileModule(componentSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }
  }).outputText;
  vm.runInNewContext(`(function(require, module, exports) { ${compiled} })`)((name) => {
    if (!(name in mocks)) throw new Error(`Unexpected component import: ${name}`);
    return mocks[name];
  }, module, module.exports);
  const render = () => {
    cursor = 0;
    return module.exports.AttendancePunchPrompt({ punch, saving: false, error: "", onConfirm: (...args) => confirmed.push(args), onClose() {} });
  };
  return { render, confirmed };
}

test("explicit checkout date resolves exactly as entered instead of silently advancing a day", () => {
  assert.equal(
    AttendancePayroll.resolveEnteredDateTime(
      "2026-09-22T12:00:00.000Z", "2026-09-22", "21:00", "Asia/Seoul", "2026-09-22T11:00:00.000Z"
    ),
    "2026-09-22T12:00:00.000Z"
  );
  assert.equal(
    AttendancePayroll.resolveEnteredDateTime(
      "2026-09-22T12:00:00.000Z", "2026-09-23", "21:00", "Asia/Seoul", "2026-09-22T11:00:00.000Z"
    ),
    "2026-09-23T12:00:00.000Z"
  );
});

test("attendance date defaults to Seoul tag date and follows rounded time across midnight", () => {
  assert.equal(AttendancePayroll.defaultAttendanceDate({ tagged_at: "2026-09-22T12:00:00.000Z" }), "2026-09-22");
  assert.equal(AttendancePayroll.defaultAttendanceDate({ tagged_at: "2026-09-22T14:45:00.000Z" }), "2026-09-23");
});

test("invalid civil dates, times, and non-positive shifts are rejected", () => {
  assert.throws(() => AttendancePayroll.resolveEnteredDateTime("2026-09-22T12:00:00.000Z", "2026-02-30", "21:00"), /유효한 날짜와 시간을 입력해 주세요/);
  assert.throws(() => AttendancePayroll.resolveEnteredDateTime("2026-09-22T12:00:00.000Z", "2026-09-22", "25:00"), /유효한 날짜와 시간을 입력해 주세요/);
  assert.throws(() => AttendancePayroll.resolveEnteredDateTime("2026-09-22T12:00:00.000Z", "2026-09-22", "20:00", "Asia/Seoul", "2026-09-22T11:00:00.000Z"), /퇴근 시각은 출근 시각보다 뒤여야 합니다/);
});

test("prompt date and time edits update the visible preview and confirmation payload", () => {
  const { render, confirmed } = runComponent({
    id: "event-1", punch_type: "check_out", tagged_at: "2026-09-22T12:00:00.000Z",
    open_check_in_at: "2026-09-22T11:00:00.000Z", scheduled_time: null, tag_name: "출퇴근", warning_message: null
  });
  let tree = elements(render());
  const dateInput = tree.find((node) => node.type === "input" && node.props.type === "date");
  const timeInput = tree.find((node) => node.type === "input" && node.props.type === "time");
  assert.ok(dateInput, "explicit date control must render");
  assert.ok(timeInput, "existing time control must remain");
  assert.equal(dateInput.props.value, "2026-09-22");
  dateInput.props.onChange({ target: { value: "2026-09-23" } });
  timeInput.props.onChange({ target: { value: "21:00" } });
  tree = elements(render());
  const preview = tree.find((node) => node.type === "p" && JSON.stringify(node.props.children).includes("급여 반영 시각"));
  assert.ok(preview);
  const previewText = preview.props.children[1].props.children;
  const expectedPreview = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).format(new Date("2026-09-23T12:00:00.000Z"));
  assert.equal(previewText, expectedPreview);
  const save = tree.find((node) => node.type === "button" && JSON.stringify(node.props.children).includes("기록 저장"));
  save.props.onClick();
  assert.deepEqual(confirmed, [["2026-09-23", "21:00"]]);
});

test("prompt reports empty or invalid dates and times and disables saving", () => {
  const punch = {
    id: "event-1", punch_type: "check_out", tagged_at: "2026-09-22T12:00:00.000Z",
    open_check_in_at: "2026-09-22T11:00:00.000Z", scheduled_time: null, tag_name: "출퇴근", warning_message: null
  };
  for (const [date, time] of [["", "21:00"], ["2026-02-30", "21:00"], ["2026-09-22", ""]]) {
    const { render, confirmed } = runComponent(punch);
    let tree = elements(render());
    tree.find((node) => node.type === "input" && node.props.type === "date").props.onChange({ target: { value: date } });
    tree.find((node) => node.type === "input" && node.props.type === "time").props.onChange({ target: { value: time } });
    tree = elements(render());
    const save = tree.find((node) => node.type === "button" && JSON.stringify(node.props.children).includes("기록 저장"));
    assert.equal(save.props.disabled, true);
    assert.ok(tree.some((node) => node.type === "p" && node.props.role === "alert" && String(node.props.children).includes("유효한 날짜와 시간을 입력해 주세요.")));
    assert.deepEqual(confirmed, []);
  }
});

test("App finalizer sends the exact preview date and time to the explicit-date RPC", async () => {
  const ast = ts.createSourceFile("App.tsx", appSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let declaration;
  const visit = (node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === "confirmAttendancePunch") declaration = node;
    ts.forEachChild(node, visit);
  };
  visit(ast);
  assert.ok(declaration, "attendance finalizer must exist");
  const compiled = ts.transpileModule(`(${declaration.getText(ast)})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const calls = [];
  const context = {
    attendancePunch: { id: "event-1", punch_type: "check_out", tagged_at: "2026-09-22T12:00:00.000Z", open_check_in_at: "2026-09-22T11:00:00.000Z" },
    attendanceBusy: false,
    resolveEnteredDateTime: AttendancePayroll.resolveEnteredDateTime,
    attendanceFinalizeRequestId: () => "stable-finalize-request",
    clearAttendanceFinalizeRequestId() {},
    setAttendanceBusy() {}, setAttendanceError() {}, setAttendanceMessage() {}, setAttendancePunch() {},
    attendanceTimeLabel: (value) => value,
    Services: { DatabaseService: { rpc: async (name, args) => { calls.push({ name, args }); return { data: { id: "shift-1" }, error: null }; } } }
  };
  const finalizer = vm.runInNewContext(compiled, context);
  await finalizer("2026-09-23", "21:00");
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [{
    name: "finalize_attendance_punch",
    args: { target_event_id: "event-1", entered_date: "2026-09-23", entered_time: "21:00", request_id: "stable-finalize-request" }
  }]);
});
