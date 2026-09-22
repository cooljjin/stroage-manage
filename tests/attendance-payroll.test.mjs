import assert from "node:assert/strict";
import test from "node:test";
import {
  calculatePayrollSummary,
  attendanceTagUrl,
  consumePendingAttendanceToken,
  defaultAttendanceTime,
  differenceInMinutes,
  parseAttendanceTagUrl,
  pendingAttendanceRequestId,
  readPendingAttendanceToken,
  resolveEffectiveDated,
  resolveEnteredDateTime,
  savePendingAttendanceToken,
  signedMinutesLabel
} from "../src/lib/attendancePayroll.ts";

test("attendance tag URLs accept only the configured attendance path", () => {
  assert.equal(attendanceTagUrl("abc_DEF-123", "stockly.example"), "https://stockly.example/attendance/tag/abc_DEF-123");
  assert.equal(parseAttendanceTagUrl("https://stockly.example/attendance/tag/abc_DEF-123", "stockly.example"), "abc_DEF-123");
  assert.equal(parseAttendanceTagUrl("https://evil.example/attendance/tag/abc", "stockly.example"), null);
  assert.equal(parseAttendanceTagUrl("https://stockly.example/inventory/abc", "stockly.example"), null);
});

test("entered check-in time remains separate from the NFC tag time", () => {
  const taggedAt = "2026-09-22T05:55:00.000Z"; // 14:55 Asia/Seoul
  const enteredAt = resolveEnteredDateTime(taggedAt, "15:00", "Asia/Seoul");

  assert.equal(enteredAt, "2026-09-22T06:00:00.000Z");
  assert.equal(differenceInMinutes(taggedAt, enteredAt), 5);
});

test("overnight checkout resolves after the open check-in", () => {
  const taggedAt = "2026-09-22T16:05:00.000Z"; // 01:05 next local day
  const enteredAt = resolveEnteredDateTime(taggedAt, "01:00", "Asia/Seoul", "2026-09-22T06:00:00.000Z");

  assert.equal(enteredAt, "2026-09-22T16:00:00.000Z");
});

test("payroll toggles allowances without changing base pay", () => {
  const summary = calculatePayrollSummary({
    shifts: [
      {
        checkInAt: "2026-09-22T06:00:00.000Z",
        checkOutAt: "2026-09-22T15:00:00.000Z",
        unpaidBreakMinutes: 60,
        hourlyWage: 12000,
        overtimeMinutes: 60,
        nightMinutes: 120,
        holidayMinutes: 0
      }
    ],
    weeklyAllowance: 48000,
    overtimeMultiplier: 0.5,
    nightMultiplier: 0.5,
    holidayMultiplier: 0.5
  });

  assert.equal(summary.workedMinutes, 480);
  assert.equal(summary.basePay, 96000);
  assert.equal(summary.overtimeAllowance, 6000);
  assert.equal(summary.nightAllowance, 12000);
  assert.equal(summary.withoutAllowances, 96000);
  assert.equal(summary.withAllowances, 162000);
});

test("signed attendance differences preserve early and late direction", () => {
  assert.equal(signedMinutesLabel(5), "+5분");
  assert.equal(signedMinutesLabel(-10), "-10분");
  assert.equal(signedMinutesLabel(0), "0분");
});

test("scheduled time from the punch is the prompt default", () => {
  assert.equal(defaultAttendanceTime({ scheduled_time: "09:30", tagged_at: "2026-09-22T05:55:00.000Z" }), "09:30");
  assert.equal(defaultAttendanceTime({ scheduled_time: null, tagged_at: "2026-09-22T05:55:00.000Z" }), "15:00");
});

test("effective-dated values use the Asia/Seoul work date and effective_to", () => {
  const history = [
    { id: "old", effective_from: "2026-08-01", effective_to: "2026-09-22" },
    { id: "new", effective_from: "2026-09-23", effective_to: null }
  ];

  assert.equal(resolveEffectiveDated(history, "2026-09-22T15:30:00.000Z")?.id, "new");
  assert.equal(resolveEffectiveDated(history, "2026-09-22T14:30:00.000Z")?.id, "old");
  assert.equal(resolveEffectiveDated([{ ...history[0], effective_to: "2026-09-21" }], "2026-09-22T14:30:00.000Z"), undefined);
});

test("payroll uses the configured won rounding rule and exposes the weekly threshold", () => {
  const common = {
    shifts: [{
      checkInAt: "2026-09-22T00:00:00.000Z",
      checkOutAt: "2026-09-22T00:01:00.000Z",
      unpaidBreakMinutes: 0,
      hourlyWage: 100,
      overtimeMinutes: 1,
      nightMinutes: 0,
      holidayMinutes: 0
    }],
    overtimeMultiplier: 0.5,
    weeklyThresholdMinutes: 900,
    roundingVersion: 1
  };

  assert.equal(calculatePayrollSummary({ ...common, roundingRule: "floor" }).withAllowances, 1);
  assert.equal(calculatePayrollSummary({ ...common, roundingRule: "ceil" }).withAllowances, 3);
  assert.equal(calculatePayrollSummary({ ...common, roundingRule: "half_up" }).withAllowances, 3);
  assert.equal(calculatePayrollSummary({ ...common, roundingRule: "half_up" }).weeklyThresholdMinutes, 900);
});

test("pending attendance token survives login briefly and is consumed once", () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key)
  };

  savePendingAttendanceToken(storage, "token_123", 1_000);
  const requestId = pendingAttendanceRequestId(storage, 1_000);
  savePendingAttendanceToken(storage, "token_123", 1_001);
  assert.equal(pendingAttendanceRequestId(storage, 1_001), requestId);
  assert.equal(readPendingAttendanceToken(storage, 1_000 + 4 * 60_000), "token_123");
  assert.equal(consumePendingAttendanceToken(storage, 1_000 + 4 * 60_000), "token_123");
  assert.equal(consumePendingAttendanceToken(storage, 1_000 + 4 * 60_000), null);

  savePendingAttendanceToken(storage, "expired", 1_000);
  assert.equal(readPendingAttendanceToken(storage, 1_000 + 11 * 60_000), null);
});
