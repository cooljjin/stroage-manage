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

test("attendance management keeps the four feature tabs and their sections", async () => {
  const page = await source("src/pages/AttendanceManagementPage.tsx");
  for (const [key, label] of [["records", "근태 기록"], ["nfc", "NFC 관리"], ["schedule", "근무 일정"], ["payroll", "급여 기준"]]) {
    assert.match(page, new RegExp(`\\["${key}", "${label}"\\]`));
    assert.match(page, new RegExp(`activeSection === "${key}" &&`));
  }
  assert.match(page, /aria-label="근태관리 기능"/);
  assert.match(page, /aria-current={activeSection === section/);
});

test("attendance date filters fit the mobile viewport and refresh label stays on one line", async () => {
  const page = await source("src/pages/AttendanceManagementPage.tsx");
  for (const label of ["조회 시작", "조회 종료"]) {
    assert.match(page, new RegExp(`${label}<input type="date" className="[^"]*min-w-0[^"]*max-w-full[^"]*appearance-none`));
  }
  assert.match(page, /secondary-button[^"]*shrink-0[^"]*whitespace-nowrap/);
});

test("attendance schedule and shift date/time inputs stay within iOS grid cells", async () => {
  const page = await source("src/pages/AttendanceManagementPage.tsx");
  for (const label of ["적용 시작", "출근", "퇴근", "예외 날짜", "확정 출근", "확정 퇴근"]) {
    assert.match(page, new RegExp(`${label}<input type="(?:date|time|datetime-local)" className="[^"]*min-w-0[^"]*max-w-full[^"]*appearance-none`));
  }
  assert.match(page, /<label className="min-w-0 text-sm">적용 시작/);
  assert.match(page, /<label className="min-w-0 text-sm font-semibold">확정 출근/);
});

test("the mobile menu has a viewport-bounded touch scroll area", async () => {
  const menu = await source("src/components/TopMenu.tsx");
  assert.match(menu, /max-h-\[calc\(100dvh-8rem-env\(safe-area-inset-bottom\)\)\]/);
  assert.match(menu, /touch-pan-y overflow-y-scroll/);
  assert.match(menu, /-webkit-overflow-scrolling:touch/);
});

test("NFC info shows a test action beside the heading", async () => {
  const page = await source("src/pages/AttendanceManagementPage.tsx");
  assert.match(page, /<h2[^>]*>\s*<Nfc size=\{20\} \/>NFC 정보<\/h2>\s*\{import\.meta\.env\.MODE === "staging" && <button[^>]*onClick=\{\(\) => void testNewTag\(\)\}[^>]*>테스트<\/button>\}/);
  assert.match(page, /if \(!newTag\) \{\s*setError\("먼저 NFC 태그를 만들어 주세요\."\);\s*return;/);
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
  assert.match(nfc, /iosSessionType: "tag"/);
  assert.match(page, /writeAttendanceUrlToNfc/);
  assert.match(info, /NFCReaderUsageDescription/);
});

test("staging test button permits only the two named test stores through the real punch flow", async () => {
  const [page, app] = await Promise.all([
    source("src/pages/AttendanceManagementPage.tsx"),
    source("src/App.tsx")
  ]);
  assert.match(page, /import\.meta\.env\.MODE === "staging"[\s\S]*?onClick=\{\(\) => void testNewTag\(\)\}[\s\S]*?>테스트<\/button>/);
  assert.match(page, /select\("stores", "name"\)\.eq\("id", currentStoreId\)\.maybeSingle\(\)/);
  assert.match(page, /store\?\.name !== "테스트 매장" && store\?\.name !== "테스트점"[\s\S]*?return;/);
  assert.match(page, /onTestTag\(newTag\.token\)/);
  assert.match(app, /onTestTag=\{[\s\S]*?setAttendanceToken\(savePendingAttendanceToken\(sessionStorage, token\)\)/);
  assert.match(app, /begin_attendance_punch/);
});

test("deleting an attendance tag revokes it, hides it, preserves history, and audits the change", async () => {
  const [page, sql, types] = await Promise.all([
    source("src/pages/AttendanceManagementPage.tsx"),
    source("supabase/migrations/093_attendance_tag_deletion.sql"),
    source("src/types/supabase.ts")
  ]);
  assert.match(page, /select\("attendance_tags", "\*"\)\.eq\("store_id", currentStoreId\)\.is\("deleted_at", null\)/);
  assert.match(page, /window\.confirm\([\s\S]*?delete_attendance_tag[\s\S]*?setNewTag\(/);
  assert.match(page, /aria-label=\{`\$\{tag\.name\} 태그 삭제`\}/);
  assert.match(sql, /add column deleted_at timestamptz/i);
  assert.match(sql, /old\.deleted_at is not null[\s\S]*?raise exception/i);
  assert.match(sql, /select \* into before_row from public\.attendance_tags where id = target_tag_id for update/i);
  assert.match(sql, /set is_active = false, deleted_at = clock_timestamp\(\)/i);
  assert.match(sql, /audit_attendance_management\(changed\.store_id, 'tag', changed\.id, 'NFC 태그 삭제'/i);
  assert.doesNotMatch(sql, /delete from public\.attendance_(?:tags|punch_events|shifts)/i);
  assert.match(sql, /grant execute on function public\.delete_attendance_tag\(uuid\) to authenticated/i);
  assert.match(types, /delete_attendance_tag: \{ Args: \{ target_tag_id: string \}/);
});

test("development iOS release signs NFC TAG without changing staff entitlements", async () => {
  const [nfcEntitlements, sharedEntitlements, project] = await Promise.all([
    source("ios/App/App/AppNfcRelease.entitlements"),
    source("ios/App/App/AppRelease.entitlements"),
    source("ios/App/App.xcodeproj/project.pbxproj")
  ]);
  assert.match(nfcEntitlements, /com\.apple\.developer\.nfc\.readersession\.formats/);
  assert.match(nfcEntitlements, /<string>TAG<\/string>/);
  assert.doesNotMatch(nfcEntitlements, /<string>NDEF<\/string>/);
  assert.doesNotMatch(sharedEntitlements, /com\.apple\.developer\.nfc\.readersession\.formats/);
  const appRelease = project.match(/504EC3181FED79650016851F \/\* Release \*\/ = \{[\s\S]*?\n\t\t\};/)?.[0];
  assert.ok(appRelease);
  assert.match(appRelease, /CODE_SIGN_ENTITLEMENTS = App\/AppNfcRelease\.entitlements/);
  assert.match(appRelease, /Stockly App Store 1\.0\.40 NFC/);
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
