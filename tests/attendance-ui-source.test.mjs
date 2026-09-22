import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { URL } from "node:url";
import test from "node:test";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

async function clientSource() {
  const root = new URL("../src/", import.meta.url);
  const files = (await readdir(root, { recursive: true })).filter((path) => /\.(?:ts|tsx)$/.test(path));
  return (await Promise.all(files.map((path) => readFile(new URL(path, root), "utf8")))).join("\n");
}

test("attendance management is permission-gated in menu, route, and database types", async () => {
  const [domain, permissions, menu, app, lazyPages, supabase] = await Promise.all([
    source("src/types/domain.ts"),
    source("src/lib/staffPermissions.ts"),
    source("src/components/TopMenu.tsx"),
    source("src/App.tsx"),
    source("src/routes/lazyPages.ts"),
    source("src/types/supabase.ts")
  ]);
  assert.match(domain, /attendance_management/);
  assert.match(domain, /"attendance"/);
  assert.match(permissions, /근태관리/);
  assert.match(menu, /근태관리/);
  assert.match(app, /AttendanceManagementPage/);
  assert.match(app, /AttendancePunchPrompt/);
  assert.match(app, /getLaunchUrl/);
  assert.match(lazyPages, /AttendanceManagementPage/);
  assert.match(supabase, /attendance_punch_events/);
  assert.match(supabase, /finalize_attendance_punch/);
});

test("NFC attendance opens from HTTPS links on iOS", async () => {
  const [entitlements, association] = await Promise.all([
    source("ios/App/App/AppRelease.entitlements"),
    source("public/apple-app-site-association")
  ]);
  assert.match(entitlements, /applinks:stroage-manage\.vercel\.app/);
  assert.match(association, /\/attendance\/tag\/\*/);
  assert.match(association, /com\.jinkim\.stockly/);
  assert.match(association, /com\.jinkim\.storeinventory\.poc/);
});

test("attendance management exposes filters, signed differences, warnings, and complete Excel sheets", async () => {
  const page = await source("src/pages/AttendanceManagementPage.tsx");
  assert.match(page, /직원 필터/);
  assert.match(page, /상태 필터/);
  assert.match(page, /signedMinutesLabel/);
  assert.match(page, /입력 대기|입력 누락|만료/);
  assert.match(page, /await import\("xlsx"\)/);
  assert.doesNotMatch(page, /import \* as XLSX from "xlsx"/);
  assert.match(page, /상세 근태/);
  assert.match(page, /직원 요약/);
  assert.match(page, /예정 출근/);
  assert.match(page, /구간 후보 수/);
  assert.match(page, /미확정 주 수/);
});

test("attendance prompt uses backend scheduled time and completion copy includes both times", async () => {
  const [prompt, app] = await Promise.all([
    source("src/components/AttendancePunchPrompt.tsx"),
    source("src/App.tsx")
  ]);
  assert.match(prompt, /defaultAttendanceTime/);
  assert.match(prompt, /warning_message/);
  assert.match(app, /savePendingAttendanceToken/);
  assert.match(app, /consumePendingAttendanceToken/);
  assert.match(app, /급여 반영/);
  assert.match(app, /NFC 태그/);
});

test("native NFC links use the configured HTTPS host and punch retries keep request IDs", async () => {
  const [page, app] = await Promise.all([
    source("src/pages/AttendanceManagementPage.tsx"),
    source("src/App.tsx")
  ]);
  assert.match(page, /attendanceTagUrl/);
  assert.doesNotMatch(page, /window\.location\.origin}\/attendance\/tag/);
  assert.match(app, /pendingAttendanceRequestId/);
  assert.match(app, /attendanceFinalizeRequestId/);
  assert.match(app, /attendanceRetry/);
  assert.match(app, /status\s*===\s*"expired"/);
  assert.match(app, /consumePendingAttendanceToken\(sessionStorage\)[\s\S]{0,300}setAttendancePunch/);
});

test("native app writes the one-time attendance URL as an NDEF URI", async () => {
  const [nfc, page, info] = await Promise.all([
    source("src/lib/nativeAttendanceNfc.ts"),
    source("src/pages/AttendanceManagementPage.tsx"),
    source("ios/App/App/Info.plist")
  ]);
  assert.match(nfc, /CapacitorNfc\.write/);
  assert.match(nfc, /allowFormat: true/);
  assert.match(nfc, /type: \[0x55\]/);
  assert.match(nfc, /invalidateAfterFirstRead: false/);
  assert.match(page, /writeAttendanceUrlToNfc/);
  assert.match(info, /NFCReaderUsageDescription/);
});

test("attendance management writes only through audited RPCs", async () => {
  const page = await source("src/pages/AttendanceManagementPage.tsx");
  const allClientSource = await clientSource();
  const managedTables = "attendance_(?:work_schedules|schedule_overrides|pay_rates|payroll_rules|weekly_allowances|shift_segments)";
  assert.doesNotMatch(allClientSource, new RegExp(`DatabaseService\\.(?:insert|upsert|update|delete)\\(\\"${managedTables}\\"`));
  for (const rpc of [
    "save_attendance_work_schedule",
    "save_attendance_schedule_override",
    "save_attendance_pay_rate",
    "save_attendance_payroll_rules",
    "confirm_attendance_weekly_allowance",
    "confirm_attendance_segments"
  ]) assert.match(page, new RegExp(`DatabaseService\\.rpc\\(\\"${rpc}\\"`));
});

test("attendance UI loads rule history and exposes derived weekly allowance and tag reissue", async () => {
  const page = await source("src/pages/AttendanceManagementPage.tsx");
  assert.doesNotMatch(page, /attendance_payroll_rules[\s\S]{0,180}maybeSingle/);
  assert.match(page, /weekly_contracted_minutes/);
  assert.doesNotMatch(page, /weeklyAmount|확정 주휴수당/);
  assert.match(page, /rotate_attendance_tag/);
  for (const heading of ["주휴수당", "연장수당", "야간수당", "휴일수당", "수당 제외 합계", "수당 포함 합계"]) {
    assert.match(page, new RegExp(heading));
  }
});

test("attendance Supabase types include complete effective contracts and management RPCs", async () => {
  const supabase = await source("src/types/supabase.ts");
  for (const field of [
    "weekly_contracted_minutes", "effective_to", "effective_from", "rounding_rule", "rounding_version",
    "weekly_threshold_minutes", "weekly_overtime_threshold_minutes", "scheduled_time", "attendance_management_audit", "entity_type", "before_values", "after_values"
  ]) assert.match(supabase, new RegExp(field));
  for (const rpc of [
    "save_attendance_work_schedule", "save_attendance_schedule_override", "save_attendance_pay_rate",
    "save_attendance_payroll_rules", "confirm_attendance_weekly_allowance", "confirm_attendance_segments",
    "rotate_attendance_tag"
  ]) assert.match(supabase, new RegExp(`${rpc}:`));
});
