import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { URL } from "node:url";
import { runInNewContext } from "node:vm";
import { transpileModule } from "typescript";

const page = await readFile(new URL("../src/pages/AttendanceManagementPage.tsx", import.meta.url), "utf8");
function functions(start, end, context) {
  runInNewContext(transpileModule(page.slice(page.indexOf(start), page.indexOf(end, page.indexOf(start))), {}).outputText, context);
}

test("failed shift save keeps the form and clears saving; retry closes only on success", async () => {
  let failed = true;
  const state = { saving: false, error: "", closed: false, reloads: 0 };
  const context = {
    selectedShift: { id: "test-shift" }, editIn: "2026-10-07T21:00", editOut: "", editBreak: "0", editReason: "테스트 수정", payrollRulesStatus: "loaded",
    seoulInputToIso: (value) => value || null,
    setSaving: (value) => { state.saving = value; }, setError: (value) => { state.error = value; }, setMessage: () => {},
    loadData: async () => { state.reloads++; }, setSelectedShift: (value) => { state.closed = value === null; },
    Services: { DatabaseService: { rpc: async () => ({ error: failed ? { message: "network failure" } : null }) } }
  };
  functions("  async function perform(", "  async function createTag(", context);
  functions("  async function saveShift(", "  async function setSegmentStatus(", context);
  await context.saveShift({ preventDefault() {} });
  assert.equal(state.closed, false);
  assert.equal(state.error, "network failure");
  assert.equal(state.saving, false);
  assert.equal(state.reloads, 0);
  failed = false;
  await context.saveShift({ preventDefault() {} });
  assert.equal(state.closed, true);
  assert.equal(state.reloads, 1);
});

test("popup dismissal protects dirty input and ignores dismissal during save", () => {
  let confirmed = false;
  const changes = [];
  const context = {
    editDirty: true, saving: false,
    window: { confirm: () => confirmed },
    setSelectedShift: (value) => changes.push(["shift", value]),
    setDayOpen: (value) => changes.push(["open", value]),
    setDetailKey: (value) => changes.push(["key", value])
  };
  functions("  function cancelEdit(", "  function openDay(", context);
  context.closeDay();
  assert.equal(changes.length, 0);
  confirmed = true;
  context.saving = true;
  context.closeDay();
  assert.equal(changes.length, 0);
  context.saving = false;
  context.closeDay();
  assert.deepEqual(changes, [["shift", null], ["open", false], ["key", null]]);
});

test("weekday save targets only the selected day and keeps the sheet open", async () => {
  const calls = [];
  const changes = [];
  const context = {
    saving: false, scheduleDrafts: { current: {} }, scheduleUser: "test-employee", scheduleWeekday: 2,
    scheduleStart: "10:00", scheduleEnd: "19:00", scheduleBreak: "30", scheduleFrom: "2026-10-09",
    WEEKDAYS: ["일", "월", "화", "수", "목", "금", "토"],
    setError: (value) => changes.push(["error", value]),
    setScheduleDirty: (value) => changes.push(["dirty", value]),
    Services: { DatabaseService: { rpc: async (name, args) => { calls.push({ name, args }); return { error: null }; } } },
    perform: async (action) => !(await action()).error
  };
  functions("  async function addSchedule()", "  async function addOverride()", context);
  await context.addSchedule();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "save_attendance_work_schedule");
  assert.equal(calls[0].args.target_weekday, 2);
  assert.equal(calls[0].args.target_start_time, "10:00");
  assert.ok(changes.every(([key, value]) => key === "dirty" && value === false));
  context.saving = true;
  await context.addSchedule();
  assert.equal(calls.length, 1);
});

test("weekday switch retains input without confirmation and cannot run while saving", () => {
  const changes = [];
  const context = {
    saving: false, scheduleWeekday: 1, scheduleDirty: true, calendarMode: "routine",
    scheduleUser: "employee", scheduleStart: "10:30", scheduleEnd: "18:00", scheduleBreak: "30", scheduleFrom: "2026-10-09",
    scheduleDrafts: { current: {} },
    setMessage() {}, setError() {},
    window: { confirm: () => { throw new Error("must not ask to discard"); } },
    setScheduleDirty: (value) => changes.push(["dirty", value]),
    setScheduleWeekday: (value) => changes.push(["weekday", value])
  };
  functions("  function retainScheduleDraft(", "  const loadData", context);
  context.saving = true;
  context.selectScheduleWeekday(2);
  assert.equal(changes.length, 0);
  context.saving = false;
  context.selectScheduleWeekday(2);
  assert.equal(context.scheduleDrafts.current["employee:1"].start, "10:30");
  assert.equal(context.scheduleDrafts.current["employee:1"].from, "2026-10-09");
  assert.deepEqual(changes, [["dirty", false], ["weekday", 2]]);
});

test("saving drafts retains failed and unattempted weekdays and does not retry successful weekdays", async () => {
  const calls = [];
  let failed = true;
  const draft = { user: "employee", start: "10:30", end: "18:00", breakMinutes: "30", from: "2026-10-09" };
  const context = {
    saving: false, scheduleUser: "employee", scheduleWeekday: 3, scheduleStart: "11:00", scheduleEnd: "19:00", scheduleBreak: "0", scheduleFrom: draft.from,
    scheduleDrafts: { current: { "employee:1": { ...draft, weekday: 1 }, "employee:2": { ...draft, weekday: 2 } } },
    WEEKDAYS: ["일", "월", "화", "수", "목", "금", "토"], setError() {}, setScheduleDirty() {},
    Services: { DatabaseService: { rpc: async (_name, args) => { calls.push(args); return { error: failed && args.target_weekday === 2 ? { message: "network" } : null }; } } },
    perform: async (action) => !(await action()).error
  };
  functions("  async function addSchedule()", "  async function addOverride()", context);
  await context.addSchedule();
  assert.equal(context.scheduleDrafts.current["employee:1"], undefined);
  assert.ok(context.scheduleDrafts.current["employee:2"]);
  assert.ok(context.scheduleDrafts.current["employee:3"]);
  failed = false;
  await context.addSchedule();
  assert.deepEqual(calls.map(args => args.target_weekday), [1, 2, 2, 3]);
  assert.equal(Object.keys(context.scheduleDrafts.current).length, 0);
});

test("shift edits save without confirmed payroll rules and approve only when the effective rule is confirmed", async () => {
  for (const [rulesStatus, confirmed, checkOut, expectedStatus] of [
    ["loaded", false, "2026-10-07T22:00", "needs_review"],
    ["loaded", undefined, "2026-10-07T22:00", "needs_review"],
    ["error", true, "2026-10-07T22:00", "needs_review"],
    ["loading", true, "2026-10-07T22:00", "needs_review"],
    ["loaded", true, "2026-10-07T22:00", "approved"],
    ["loaded", true, "", "needs_review"]
  ]) {
    const calls = [];
    let closed = false;
    const context = {
      selectedShift: { id: "test-shift" }, editIn: "2026-10-07T21:00", editOut: checkOut, editBreak: "0", editReason: "시간 수정",
      payrollRulesStatus: rulesStatus, rules: [],
      seoulInputToIso: (value) => value || null,
      resolveEffectiveDated: (_rules, date) => { assert.equal(date, "2026-10-07T21:00"); return confirmed === undefined ? undefined : { is_confirmed: confirmed }; },
      Services: { DatabaseService: { rpc: async (name, args) => { calls.push({ name, args }); return { error: null }; } } },
      perform: async (action) => !(await action()).error,
      setSelectedShift: (value) => { closed = value === null; }
    };
    functions("  async function saveShift(", "  async function deleteShift(", context);
    await context.saveShift({ preventDefault() {} });
    assert.equal(calls.length, 1, `edit must be saved when rules are ${rulesStatus}/${confirmed}`);
    assert.equal(calls[0].name, "manage_attendance_shift");
    assert.equal(calls[0].args.target_status, expectedStatus);
    assert.equal(calls[0].args.confirmed_check_out, checkOut || null);
    assert.equal(closed, true);
  }
});

test("date schedule saves only selected employee/date, preserves failed input and returns to day on success", async () => {
  const calls = [], changes = [];
  let failed = true;
  const context = {
    saving: false, loading: false, selectedCalendarDates: ["2026-10-10"], scheduleUser: "employee-2",
    scheduleStart: "21:00", scheduleEnd: "06:00", scheduleBreak: "", dateScheduleBreakEnabled: false,
    setError: (value) => changes.push(["error", value]),
    setDateScheduleOpen: (value) => changes.push(["open", value]),
    setDateScheduleDirty: (value) => changes.push(["dirty", value]),
    setDetailKey: (value) => changes.push(["detail", value]), setDayOpen: (value) => changes.push(["day", value]),
    Services: { DatabaseService: { rpc: async (name, args) => { calls.push({ name, args }); return { error: failed ? { message: "network" } : null }; } } },
    perform: async (action) => !(await action()).error
  };
  functions("  async function saveDateSchedule(", "  return (", context);
  await context.saveDateSchedule({ preventDefault() {} });
  assert.equal(changes.length, 0);
  assert.equal(calls[0].name, "save_attendance_schedule_override");
  assert.equal(calls[0].args.target_user_id, "employee-2");
  assert.equal(calls[0].args.target_work_date, "2026-10-10");
  assert.equal(calls[0].args.target_is_day_off, false);
  assert.equal(calls[0].args.target_break_minutes, 0);
  assert.equal(calls[0].args.target_end_time, "06:00");
  failed = false;
  await context.saveDateSchedule({ preventDefault() {} });
  assert.deepEqual(changes, [["open", false], ["dirty", false], ["detail", null], ["day", true]]);
  context.dateScheduleBreakEnabled = true;
  context.scheduleBreak = "-1";
  await context.saveDateSchedule({ preventDefault() {} });
  assert.equal(calls.length, 2);
  context.scheduleBreak = "30";
  await context.saveDateSchedule({ preventDefault() {} });
  assert.equal(calls[2].args.target_break_minutes, 30);
  context.dateScheduleBreakEnabled = false;
  await context.saveDateSchedule({ preventDefault() {} });
  assert.equal(calls[3].args.target_break_minutes, 0);
});

test("date schedule defaults are scoped to selected employee/store/day and override routine times", () => {
  const state = {};
  const context = {
    selectedCalendarDates: ["2026-10-10"], currentStoreId: "test-store", weekdayForDate: () => 6,
    overrides: [{ store_id: "other-store", user_id: "employee", work_date: "2026-10-10", start_time: "01:00" }],
    schedules: [{ store_id: "test-store", user_id: "employee", weekday: 6, effective_from: "2026-10-01", effective_to: null, start_time: "10:00:00", end_time: "19:00:00", unpaid_break_minutes: 30 }],
    setScheduleUser: (value) => { state.user = value; }, setScheduleStart: (value) => { state.start = value; },
    setScheduleEnd: (value) => { state.end = value; }, setScheduleBreak: (value) => { state.break = value; },
    setDateScheduleBreakEnabled: (value) => { state.breakEnabled = value; }
  };
  functions("  function loadDateSchedule(", "  function editSchedule(", context);
  context.loadDateSchedule("employee");
  assert.deepEqual(state, { user: "employee", start: "10:00", end: "19:00", break: "30", breakEnabled: true });
  context.overrides.push({ store_id: "test-store", user_id: "employee", work_date: "2026-10-10", start_time: "12:00:00", end_time: "20:00:00", unpaid_break_minutes: 0 });
  context.loadDateSchedule("employee");
  assert.deepEqual(state, { user: "employee", start: "12:00", end: "20:00", break: "0", breakEnabled: false });
  context.loadDateSchedule("new-employee");
  assert.deepEqual(state, { user: "new-employee", start: "09:00", end: "18:00", break: "0", breakEnabled: false });
});
