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

test("Dev attendance tags use the Dev channel for writing and cold/warm launch parsing", async () => {
  const [app, management] = await Promise.all([source("src/App.tsx"), source("src/pages/AttendanceManagementPage.tsx")]);
  assert.match(app, /parseAttendanceTagUrl\(url, ATTENDANCE_LINK_HOST, PRODUCT_TAG_CHANNEL\)/);
  assert.match(management, /import.meta.env.MODE === "staging" \? "development" : "production"/);
  assert.match(management, /attendanceTagUrl\(newTag\.token, ATTENDANCE_LINK_HOST, ATTENDANCE_TAG_CHANNEL\)/);
  const attendanceTagUrls = [...management.matchAll(/attendanceTagUrl\(newTag\.token, ATTENDANCE_LINK_HOST[^)]*\)/g)].map(([call]) => call);
  assert.equal(attendanceTagUrls.length, 3, "displayed, copied, and NFC-written URLs must share one channel");
  assert.ok(attendanceTagUrls.every((call) => call.endsWith(", ATTENDANCE_TAG_CHANNEL)")), attendanceTagUrls.join("\n"));
  assert.match(app, /if \(attendanceTokenFromUrl\(window\.location\.href\)\) window\.history\.replaceState/);
});

test("attendance management exposes filters, signed differences, and complete Excel sheets", async () => {
  const page = await source("src/pages/AttendanceManagementPage.tsx");
  assert.match(page, /직원 선택/);
  assert.doesNotMatch(page, />전체 상태</);
  assert.doesNotMatch(page, /statusFilter|setStatusFilter|상태 필터/);
  assert.match(page, /signedMinutesLabel/);
  assert.match(page, /await import\("xlsx"\)/);
  assert.doesNotMatch(page, /import \* as XLSX from "xlsx"/);
  assert.match(page, /상세 근태/);
  assert.match(page, /직원 요약/);
  assert.match(page, /예정 출근/);
  assert.match(page, /구간 후보 수/);
  assert.match(page, /미확정 주 수/);
});

test("unresolved NFC events do not warn, while attendance still requires explicit confirmation", async () => {
  const [page, app, prompt] = await Promise.all([
    source("src/pages/AttendanceManagementPage.tsx"),
    source("src/App.tsx"),
    source("src/components/AttendancePunchPrompt.tsx")
  ]);
  assert.doesNotMatch(page, /unresolvedEvents|입력 대기·입력 누락·만료 기록이/);
  assert.match(app, /begin_attendance_punch/);
  assert.match(app, /finalize_attendance_punch/);
  assert.match(prompt, /onClick=\{\(\) => onConfirm\(enteredDate, enteredTime\)\}/);
});

test("attendance management consolidates staff, records, and schedules into the calendar", async () => {
  const page = await source("src/pages/AttendanceManagementPage.tsx");
  for (const [key, label] of [["calendar", "달력"], ["nfc", "NFC 관리"], ["payroll", "급여 기준"]]) {
    assert.ok(page.includes(`["${key}", "${label}"]`));
    assert.ok(page.includes(`activeSection === "${key}" &&`));
  }
  assert.ok(page.includes('["records", "근태 기록 · 엑셀"]') && page.includes('["staff", "직원 등록·관리"]'));
  assert.ok(page.includes('currentRole === "store_admin" ? <button') && page.includes('aria-pressed={editingCalendar}'));
  assert.ok(page.includes('editingCalendar && currentRole === "store_admin"'));
  assert.ok(page.includes('title="근태관리 메뉴"'));
});

test("calendar month bounds schedule, actual, and pending records", async () => {
  const page = await source("src/pages/AttendanceManagementPage.tsx");
  for (const fragment of ['setFromDate(monthStart)', 'setToDate(new Date(Date.UTC', 'setScheduleMonth(monthStart)', 'gte("work_date", scheduleMonth).lte("work_date", scheduleMonthEnd)', 'gte("confirmed_check_in_at", rangeStart).lte("confirmed_check_in_at", rangeEnd)']) assert.ok(page.includes(fragment), fragment);
  assert.ok(page.includes('whitespace-nowrap'));
});

test("attendance schedule and shift date/time inputs stay within iOS grid cells", async () => {
  const page = await source("src/pages/AttendanceManagementPage.tsx");
  for (const label of ["적용 시작일", "확정 출근", "확정 퇴근"]) {
    assert.match(page, new RegExp(`${label}<input type="(?:date|time|datetime-local)" className="[^"]*min-w-0[^"]*max-w-full[^"]*appearance-none`));
  }
  assert.match(page, /<label className="min-w-0">적용 시작일/);
  assert.match(page, /<label className="min-w-0 text-sm font-semibold">확정 출근/);
});

test("the mobile menu scrolls above the bottom nav within iOS safe areas", async () => {
  const [menu, bottomNav] = await Promise.all([source("src/components/TopMenu.tsx"), source("src/components/BottomNav.tsx")]);
  assert.match(menu, /max-h-\[calc\(100dvh-env\(safe-area-inset-top\)-env\(safe-area-inset-bottom\)-9rem\)\]/);
  assert.match(bottomNav, /min-h-\[64px\]/);
  assert.match(menu, /touch-pan-y overflow-y-scroll/);
  assert.match(menu, /-webkit-overflow-scrolling:touch/);
});

test("NFC test is attached to each tag and uses the validated selected tag", async () => {
  const page = await source("src/pages/AttendanceManagementPage.tsx");
  assert.match(page, /tags\.map\(\(tag\)[\s\S]*?onClick=\{\(\) => void testTag\(tag\)\}[\s\S]*?>테스트<\/button>/);
  assert.match(page, /onTestTag\(tag\.id\)/);
  assert.match(page, /disabled=\{saving \|\| !tag\.is_active\}/);
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

test("attendance time prompt has a dismiss X wired to the parent without saving", async () => {
  const [prompt, app] = await Promise.all([
    source("src/components/AttendancePunchPrompt.tsx"),
    source("src/App.tsx")
  ]);
  assert.match(prompt, /onClose: \(\) => void/);
  assert.match(prompt, /aria-label="닫기"[^>]*onClick=\{onClose\}|onClick=\{onClose\}[^>]*aria-label="닫기"/);
  assert.match(app, /<AttendancePunchPrompt[^\n]*onClose=\{\(\) => setAttendancePunch\(null\)\}/);
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

test("native NFC writer stores HTTPS URLs as NDEF URI records", async () => {
  const [nfc, records, page, info] = await Promise.all([
    source("src/lib/nativeAttendanceNfc.ts"),
    source("src/lib/productNfc.ts"),
    source("src/pages/AttendanceManagementPage.tsx"),
    source("ios/App/App/Info.plist")
  ]);
  assert.match(nfc, /CapacitorNfc\.write/);
  assert.match(nfc, /allowFormat: true/);
  assert.match(nfc, /urlNdefRecord/);
  assert.match(records, /type: \[0x55\]/);
  assert.match(nfc, /invalidateAfterFirstRead: false/);
  assert.match(nfc, /iosSessionType: "tag"/);
  assert.match(page, /writeAttendanceUrlToNfc/);
  assert.match(info, /NFCReaderUsageDescription/);
});

test("staging tag test checks the named test store and starts the real punch flow", async () => {
  const [page, app] = await Promise.all([
    source("src/pages/AttendanceManagementPage.tsx"),
    source("src/App.tsx")
  ]);
  assert.match(page, /import\.meta\.env\.MODE === "staging"[\s\S]*?onClick=\{\(\) => void testTag\(tag\)\}[\s\S]*?>테스트<\/button>/);
  assert.match(page, /select\("stores", "name"\)\.eq\("id", currentStoreId\)\.maybeSingle\(\)/);
  assert.match(page, /store\?\.name !== "테스트 매장" && store\?\.name !== "테스트점"[\s\S]*?return;/);
  assert.match(page, /onTestTag\(tag\.id\)/);
  assert.match(app, /begin_attendance_tag_test/);
  assert.match(app, /begin_attendance_punch/);
});

test("attendance rows remain available below the calendar on demand", async () => {
  const page = await source("src/pages/AttendanceManagementPage.tsx");
  for (const fragment of ['setShowDetails', '출근시간', '퇴근시간', '상세 보기', '간략히 보기', '근태 기록 · 엑셀', 'onClick={() => void exportExcel()}']) assert.ok(page.includes(fragment), fragment);
});

test("one calendar combines planned, pending, day-off, and actual shifts", async () => {
  const page = await source("src/pages/AttendanceManagementPage.tsx");
  for (const fragment of ['scheduleCalendarDays.map((day, index)', 'attendance_pending_staff_dates', 'if (override?.is_day_off)', 'calendarRowsByDate.get(day)', 'calendarEntries.get(selectedCalendarDates[0])', 'visiblePayRows.forEach((row)', 'localInput(row.shift.confirmed_check_in_at).slice(0, 10)', 'setSelectedCalendarDates([day])']) assert.ok(page.includes(fragment), fragment);
  assert.ok(page.includes('currentRole === "store_admin" ? Services.DatabaseService.select("attendance_pending_staff"'));
});

test("staff onboarding calendars use pointer range selection for home and work-date selection", async () => {
  const onboarding = await source("src/components/AttendanceStaffOnboarding.tsx");
  assert.match(onboarding, /useCalendarDateSelection/);
  assert.match(onboarding, /selectedHomeDates/);
  assert.match(onboarding, /data-calendar-date=\{day\}/);
  assert.match(onboarding, /onPointerDown=\{\(event\) => calendarSelection\.onPointerDownDate\(day, event\)\}/);
  assert.match(onboarding, /onPointerMove=\{calendarSelection\.onPointerMove\}/);
  assert.match(onboarding, /onPointerUp=\{calendarSelection\.onPointerUp\}/);
  assert.match(onboarding, /onPointerCancel=\{calendarSelection\.onPointerCancel\}/);
  assert.match(onboarding, /touch-none sm:touch-auto select-none/);
});

test("staff onboarding bounds optional phone values in the form and RPC migration", async () => {
  const [onboarding, migration] = await Promise.all([
    source("src/components/AttendanceStaffOnboarding.tsx"),
    source("supabase/migrations/096_attendance_staff_onboarding.sql")
  ]);
  assert.match(onboarding, /type="tel" value=\{phone\} maxLength=\{40\}/);
  assert.match(onboarding, /type="tel" value=\{editPhone\} maxLength=\{40\}/);
  assert.match(migration, /phone text check \(phone is null or char_length\(btrim\(phone\)\) between 1 and 40\)/);
  assert.match(migration, /target_phone is not null and char_length\(btrim\(target_phone\)\) > 40/);
});

test("calendar date stays at the top above event previews at every zoom", async () => {
  const page = await source("src/pages/AttendanceManagementPage.tsx");
  assert.match(page, /data-calendar-date=\{day\}/);
  assert.ok(page.indexOf("하루 내역`}") < page.indexOf("entries.slice(0, calendarZoom"));
});

test("calendar zooms with pinch or accessible controls and keeps full day details", async () => {
  const page = await source("src/pages/AttendanceManagementPage.tsx");
  for (const fragment of ['aria-label="달력 축소"', 'aria-label="달력 확대"', 'onTouchStart={startPinch}', 'onTouchMove={movePinch}', 'onTouchEnd=', 'entries.slice(0, calendarZoom', 'openDay(day, entry.key)', 'title={`${detail?.name', 'entries.map((entry) =>']) assert.ok(page.includes(fragment), fragment);
});

test("pinch resizes continuously around its midpoint instead of stepping on release", async () => {
  const page = await source("src/pages/AttendanceManagementPage.tsx");
  assert.match(page, /Math\.log\(distance \/ pinch\.startDistance\)/);
  assert.doesNotMatch(page, /window\.scrollBy|useLayoutEffect/);
  assert.match(page, /document\.body\.style\.position = "fixed"/);
  assert.match(page, /document\.body\.style\.top = `-\$\{scrollY\}px`/);
  assert.match(page, /onTouchCancel=\{endPinch\}/);
  assert.match(page, /event\.touches\.length === 0\) endPinch\(\)/);
  assert.match(page, /grid\.addEventListener\("touchmove", blockNativeScroll, \{ passive: false \}\)/);
  assert.match(page, /if \(pinchGesture\.current\) event\.preventDefault\(\)/);
  assert.match(page, /grid\.removeEventListener\("touchmove", blockNativeScroll\)/);
  assert.doesNotMatch(page, /nextZoom === calendarZoom\) window\.scrollBy/);
  assert.ok(page.includes("minHeight: `${100 + 32 * calendarZoom}px`"));
  assert.doesNotMatch(page, /pinchDelta|transition-\[height\]/);
});

test("pinch locks the page and restores its original styles and scroll on release", async () => {
  const { transpileModule } = await import("typescript");
  const { runInNewContext } = await import("node:vm");
  const page = await source("src/pages/AttendanceManagementPage.tsx");
  const handlers = page.slice(page.indexOf("  function startPinch("), page.indexOf("  const dayEntries", page.indexOf("  function startPinch(")));
  const style = { position: "relative", top: "2px", width: "90%", overflow: "auto" };
  const original = { ...style };
  const scrolls = [];
  const context = { editingCalendar: false, calendarZoom: 0, pinchGesture: { current: null }, pinchScrollLock: { current: null }, document: { body: { style } }, window: { scrollY: 240, scrollTo: (options) => scrolls.push(options.top) }, setCalendarZoom: () => {} };
  runInNewContext(transpileModule(handlers, {}).outputText, context);
  context.startPinch({ touches: [{ clientX: 0, clientY: 0 }] });
  assert.deepEqual(style, original);
  const event = { touches: [{ clientX: 0, clientY: 0 }, { clientX: 100, clientY: 0 }] };
  context.startPinch(event);
  assert.equal(style.position, "fixed");
  assert.equal(style.top, "-240px");
  context.movePinch({ touches: [{ clientX: 0, clientY: 20 }, { clientX: 150, clientY: 20 }] });
  assert.deepEqual(scrolls, []);
  context.startPinch(event);
  context.endPinch();
  assert.deepEqual(style, original);
  assert.deepEqual(scrolls, [240]);
  context.endPinch();
  assert.deepEqual(scrolls, [240]);
});

test("calendar editing uses existing audited schedule paths without a second display grid", async () => {
  const page = await source("src/pages/AttendanceManagementPage.tsx");
  for (const fragment of ['>기본 근무</button>', '>휴무·교대</button>', 'selectedScheduleDates', 'scheduleWeekday', 'save_attendance_work_schedule', 'save_attendance_schedule_override', 'editingCalendar ? scheduleCalendarSelection.onPointerMove : undefined', 'editingCalendar ? scheduleCalendarSelection.onPointerUp : undefined', 'editingCalendar ? scheduleCalendarSelection.onPointerCancel : undefined', 'data-calendar-date={day}', 'function weekdayForDate(date: string)']) assert.ok(page.includes(fragment), fragment);
  assert.equal(page.split('scheduleCalendarDays.map((day, index)').length - 1, 1);
});

test("view taps select one day while edit taps toggle schedule dates", async () => {
  const [page, hook] = await Promise.all([source("src/pages/AttendanceManagementPage.tsx"), source("src/hooks/useCalendarDateSelection.ts")]);
  assert.ok(hook.includes('toggleScheduleDate(current, date)'));
  assert.ok(page.includes('editingCalendar ? scheduleCalendarSelection.onClickDate(day, event) : openDay(day)'));
  assert.ok(!page.includes('scheduleRangeStart'));
});

test("edit drag still snapshots and previews contiguous date ranges", async () => {
  const [page, hook, dates] = await Promise.all([source("src/pages/AttendanceManagementPage.tsx"), source("src/hooks/useCalendarDateSelection.ts"), source("src/lib/scheduleDateSelection.ts")]);
  for (const fragment of ['editingCalendar ? "grid grid-cols-7 touch-none sm:touch-auto select-none" : "grid grid-cols-7 touch-pan-y select-none"', 'editingCalendar ? scheduleCalendarSelection.onPointerMove : undefined', 'editingCalendar ? scheduleCalendarSelection.onPointerUp : undefined', 'editingCalendar ? scheduleCalendarSelection.onPointerCancel : undefined', 'editingCalendar ? (event) => scheduleCalendarSelection.onPointerDownDate(day, event) : undefined']) assert.ok(page.includes(fragment), fragment);
  for (const fragment of ['initialSelection = [...selectedDates]', 'hasExceededScheduleDragThreshold', 'applyScheduleDateRange(active.initialSelection', 'setSelectedDates(active.initialSelection)', 'setPointerCapture(event.pointerId)']) assert.ok(hook.includes(fragment), fragment);
  assert.ok(dates.includes('document.elementFromPoint(clientX, clientY)'));
});

test("compact attendance rows fit mobile without horizontal scrolling and keep every field", async () => {
  const page = await source("src/pages/AttendanceManagementPage.tsx");
  assert.match(page, /<div className="sm:hidden">\s*\{visiblePayRows\.map/);
  assert.match(page, /<table className=\{`hidden sm:table/);
  const cards = page.split('<div className="sm:hidden">\n          {visiblePayRows.map')[1]?.split("<table")[0] ?? "";
  for (const field of ["display_name", "confirmed_check_in_at", "confirmed_check_out_at", "workedMinutes", "wage.toLocaleString()", "withAllowances", "withoutAllowances", "STATUS_LABEL[shift.status]", "startEditing(shift)"]) {
    assert.ok(cards.includes(field), `mobile compact card missing ${field}`);
  }
});

test("mobile attendance cards show employee with date and only labeled check-in/out times", async () => {
  const page = await source("src/pages/AttendanceManagementPage.tsx");
  const cards = page.split('<div className="sm:hidden">\n          {visiblePayRows.map')[1]?.split("<table")[0] ?? "";
  const overview = cards.split("<details")[0] ?? "";
  assert.match(overview, /<strong className="min-w-0 break-words">\{staffById\.get\(shift\.user_id\)\?\.display_name \?\? "직원"\}<\/strong>/);
  assert.match(overview, /localInput\(shift\.confirmed_check_in_at\)\.slice\(5, 10\)\.replace\("-", "\."\)/);
  assert.match(overview, /출근 : \{[^}]+\}[^<]*<\/span><span> \/ <\/span><span>퇴근 :/);
  assert.doesNotMatch(overview, /STATUS_LABEL\[shift\.status\]|minutesLabel|summary\.withAllowances|summary\.withoutAllowances/);
  assert.match(overview, /confirmed_check_out_at \? localInput\(shift\.confirmed_check_out_at\)\.slice\(11, 16\)/);
  const details = cards.split("<details")[1] ?? "";
  assert.match(details, /기록 상세[\s\S]*STATUS_LABEL\[shift\.status\][\s\S]*minutesLabel\(summary\.workedMinutes\)[\s\S]*wage\.toLocaleString\(\)/);
});

test("calendar shares employee filtering and hides secondary payroll details", async () => {
  const page = await source("src/pages/AttendanceManagementPage.tsx");
  for (const fragment of ['aria-expanded={filtersOpen}', '직원 · {employeeFilter', 'staffById.get(employeeFilter)?.display_name', 'filtersOpen ? "grid" : "hidden"', '>계산 내역</summary>', '>기록 상세</summary>', '>근태 기록 · 엑셀</summary>', '{showDetails ? "간략히 보기" : "상세 보기"}</button>']) assert.ok(page.includes(fragment), fragment);
});

test("attendance calendar explains selection, schedule editing, filters, and event colors", async () => {
  const page = await source("src/pages/AttendanceManagementPage.tsx");
  assert.match(page, /날짜를 눌러 근무·출퇴근 기록을 확인하고, 관리자는 근무표를 편집합니다/);
  assert.match(page, /{editingCalendar \? "편집 완료" : "근무표 편집"}/);
  assert.match(page, /aria-label="달력 범례"/);
  for (const label of ["예정", "출퇴근 기록", "휴무", "가입 전 일정"]) assert.match(page, new RegExp(`label: "${label}"`));
  assert.match(page, /직원 · \{employeeFilter/);
  assert.match(page, /화면 예상 금액에 법정수당 포함/);
  assert.match(page, /예상 금액 표시만 바꾸며 근태 기록이나 급여 기준은 변경하지 않습니다/);
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

test("development and staff iOS releases require NFC TAG without NDEF", async () => {
  const [nfcEntitlements, sharedEntitlements, project] = await Promise.all([
    source("ios/App/App/AppNfcRelease.entitlements"),
    source("ios/App/App/AppRelease.entitlements"),
    source("ios/App/App.xcodeproj/project.pbxproj")
  ]);
  assert.match(nfcEntitlements, /com\.apple\.developer\.nfc\.readersession\.formats/);
  assert.match(nfcEntitlements, /<string>TAG<\/string>/);
  assert.doesNotMatch(nfcEntitlements, /<string>NDEF<\/string>/);
  assert.match(sharedEntitlements, /com\.apple\.developer\.nfc\.readersession\.formats/);
  assert.match(sharedEntitlements, /<string>TAG<\/string>/);
  assert.doesNotMatch(sharedEntitlements, /<string>NDEF<\/string>/);
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

test("attendance refresh updates successful query states and distinguishes loaded payroll rules", async () => {
  const { transpileModule } = await import("typescript");
  const { runInNewContext } = await import("node:vm");
  const page = await source("src/pages/AttendanceManagementPage.tsx");
  const callbackStart = page.indexOf("async () => {", page.indexOf("const loadData = useCallback("));
  const callbackEnd = page.indexOf("\n  }, [currentStoreId", callbackStart);
  assert.notEqual(callbackStart, -1);
  assert.notEqual(callbackEnd, -1);
  const callback = `${page.slice(callbackStart, callbackEnd)}\n}; loadData;`;
  const queryResults = Object.fromEntries([
    ["list_store_staff_directory", []],
    ["attendance_shifts", [{ id: "fresh-shift" }]],
    ["attendance_punch_events", []],
    ["attendance_shift_segments", []],
    ["attendance_pay_rates", []],
    ["attendance_weekly_allowances", []],
    ["attendance_payroll_rules", [{ id: "unconfirmed-rule", is_confirmed: false }]],
    ["attendance_tags", [{ id: "fresh-tag" }]],
    ["attendance_work_schedules", []],
    ["attendance_schedule_overrides", []],
    ["attendance_pending_staff", []],
    ["attendance_pending_staff_dates", []]
  ].map(([table, data]) => [table, { data, error: null }]));
  const state = {};
  const setters = ["staff", "shifts", "events", "segments", "rates", "allowances", "rules", "tags", "schedules", "overrides", "pendingStaff", "pendingDates", "loading", "error", "scheduleUser", "rateUser", "payrollRulesStatus"];
  const context = {
    currentStoreId: "store",
    currentRole: "store_admin",
    fromDate: "2026-10-01",
    toDate: "2026-10-31",
    scheduleMonth: "2026-10-01",
    scheduleMonthEnd: "2026-10-31",
    Services: { DatabaseService: {
      rpc: (name) => Promise.resolve(queryResults[name]),
      select: (table) => {
        const query = {
          eq: () => query, gte: () => query, lte: () => query, order: () => query, is: () => query,
          then: (resolve, reject) => Promise.resolve(queryResults[table]).then(resolve, reject)
        };
        return query;
      }
    } },
    ...Object.fromEntries(setters.map((name) => [`set${name[0].toUpperCase()}${name.slice(1)}`, (value) => { state[name] = typeof value === "function" ? value(state[name] ?? "") : value; }]))
  };
  const loadData = runInNewContext(transpileModule(`const loadData = ${callback}`, { compilerOptions: { target: 99 } }).outputText, context);

  queryResults.attendance_payroll_rules.error = { message: "payroll rules unavailable" };
  queryResults.list_store_staff_directory = { data: null, error: { message: "staff unavailable" } };
  await loadData();
  assert.equal(state.shifts?.[0]?.id, "fresh-shift", "a failed staff query must not block successful shift data");
  assert.equal(state.tags?.[0]?.id, "fresh-tag", "a failed query must not block other successful data");
  assert.equal(state.payrollRulesStatus, "error", "a failed policy query is not evidence of an unconfirmed policy");
  assert.match(page, /payrollRulesStatus === "loaded" && !currentRule\?\.is_confirmed/);

  queryResults.attendance_payroll_rules = { data: [{ id: "unconfirmed-rule", is_confirmed: false }], error: null };
  queryResults.list_store_staff_directory = { data: [], error: null };
  await loadData();
  assert.equal(state.rules?.[0]?.is_confirmed, false, "a successful unconfirmed policy must remain visible to the warning");
  assert.equal(state.payrollRulesStatus, "loaded");
});
