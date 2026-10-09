import { WorkTimeWheel } from "../components/WorkTimeWheel";
import { FormEvent, TouchEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Download, Nfc, Pencil, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { AttendanceSheet } from "../components/AttendanceSheet";
import { PageTitle } from "../components/PageTitle";
import { StatusMessage } from "../components/StatusMessage";
import { AttendanceStaffOnboarding } from "../components/AttendanceStaffOnboarding";
import { attendanceTagUrl, calculatePayrollSummary, differenceInMinutes, resolveEffectiveDated, signedMinutesLabel } from "../lib/attendancePayroll";
import { isNativeNfcAvailable, writeAttendanceUrlToNfc } from "../lib/nativeAttendanceNfc";
import { useCalendarDateSelection } from "../hooks/useCalendarDateSelection";
import * as Services from "../services";
import type { ProfileRole } from "../types/domain";
import type { Database } from "../types/supabase";

type Row<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Row"];
type StaffEntry = { id: string; display_name: string; role: ProfileRole };
type NewTag = { id: string; name: string; token: string; created_at: string };
type Props = { currentStoreId: string; currentRole: ProfileRole; onTestTag: (tagId: string) => void };
type ScheduleDraft = { user: string; weekday: number; start: string; end: string; breakMinutes: string; from: string };
type CalendarEntry = { key: string; userId?: string; name: string; time: string; kind: "planned" | "actual" | "dayOff" | "pending" };

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
const WORK_WEEKDAYS = [1, 2, 3, 4, 5, 6, 0];
const SEGMENT_LABEL = { schedule_overrun: "일정 외", overtime: "연장", night: "야간", holiday: "휴일" } as const;
const STATUS_LABEL = { open: "근무 중", closed: "퇴근", needs_review: "확인 필요", approved: "승인" } as const;
const CALENDAR_KIND: Record<CalendarEntry["kind"], { label: string; color: string }> = {
  planned: { label: "예정", color: "bg-sky-500" },
  actual: { label: "출퇴근 기록", color: "bg-emerald-500" },
  dayOff: { label: "휴무", color: "bg-amber-500" },
  pending: { label: "가입 전 일정", color: "bg-violet-500" }
};
const CALENDAR_KINDS = Object.keys(CALENDAR_KIND) as CalendarEntry["kind"][];
const ATTENDANCE_LINK_HOST = import.meta.env.VITE_ATTENDANCE_LINK_HOST ?? "stroage-manage.vercel.app";
const ATTENDANCE_TAG_CHANNEL = import.meta.env.MODE === "staging" ? "development" : "production";

function dateValue(offsetDays = 0) {
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" });
  return formatter.format(new Date(Date.now() + offsetDays * 86400000));
}

function weekdayForDate(date: string) {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

function formatDateTime(value: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(value));
}

function localInput(value: string | null) {
  if (!value) return "";
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(value));
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}T${map.hour}:${map.minute}`;
}

function seoulInputToIso(value: string) {
  return value ? new Date(`${value}:00+09:00`).toISOString() : null;
}

function minutesLabel(minutes: number) {
  return `${Math.floor(minutes / 60)}시간 ${minutes % 60}분`;
}

function attendanceDifference(actual: string | null | undefined, compared: string | null | undefined) {
  return actual && compared ? signedMinutesLabel(differenceInMinutes(actual, compared)) : "-";
}

function weekStartForDate(value: string) {
  const date = new Date(value);
  const seoulDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  const local = new Date(`${seoulDate}T00:00:00+09:00`);
  const day = local.getDay();
  local.setDate(local.getDate() - (day === 0 ? 6 : day - 1));
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(local);
}

export function AttendanceManagementPage({ currentStoreId, currentRole, onTestTag }: Props) {
  const [fromDate, setFromDate] = useState(() => `${dateValue().slice(0, 7)}-01`);
  const [toDate, setToDate] = useState(() => { const [year, month] = dateValue().split("-").map(Number); return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10); });
  const [employeeFilter, setEmployeeFilter] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [calendarZoom, setCalendarZoom] = useState(1);
  const [selectedCalendarDates, setSelectedCalendarDates] = useState<string[]>(() => [dateValue()]);
  const [editingCalendar, setEditingCalendar] = useState(false);
  const pinchGesture = useRef<{ startDistance: number; startZoom: number } | null>(null);
  const calendarGrid = useRef<HTMLDivElement>(null);
  const pinchScrollLock = useRef<{ scrollY: number; position: string; top: string; width: string; overflow: string } | null>(null);
  const [includeAllowances, setIncludeAllowances] = useState(true);
  const [dayOpen, setDayOpen] = useState(false);
  const [detailKey, setDetailKey] = useState<string | null>(null);
  const scheduleOriginal = useRef<{ start: string; end: string; breakMinutes: string; from: string; dayOff: boolean; user: string; mode: "routine" | "exception" } | null>(null);
  const scheduleDrafts = useRef<Record<string, ScheduleDraft>>({});
  const loadedScheduleKey = useRef("");
  const [scheduleDirty, setScheduleDirty] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [dateScheduleOpen, setDateScheduleOpen] = useState(false);
  const [dateScheduleDirty, setDateScheduleDirty] = useState(false);
  const [dateScheduleBreakEnabled, setDateScheduleBreakEnabled] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [activeSection, setActiveSection] = useState("calendar");
  const [refreshOnboardingSignal, setRefreshOnboardingSignal] = useState(0);
  const [staff, setStaff] = useState<StaffEntry[]>([]);
  const [shifts, setShifts] = useState<Row<"attendance_shifts">[]>([]);
  const [events, setEvents] = useState<Row<"attendance_punch_events">[]>([]);
  const [segments, setSegments] = useState<Row<"attendance_shift_segments">[]>([]);
  const [rates, setRates] = useState<Row<"attendance_pay_rates">[]>([]);
  const [allowances, setAllowances] = useState<Row<"attendance_weekly_allowances">[]>([]);
  const [rules, setRules] = useState<Row<"attendance_payroll_rules">[]>([]);
  const [tags, setTags] = useState<Row<"attendance_tags">[]>([]);
  const [schedules, setSchedules] = useState<Row<"attendance_work_schedules">[]>([]);
  const [overrides, setOverrides] = useState<Row<"attendance_schedule_overrides">[]>([]);
  const [pendingStaff, setPendingStaff] = useState<Row<"attendance_pending_staff">[]>([]);
  const [pendingDates, setPendingDates] = useState<Row<"attendance_pending_staff_dates">[]>([]);
  const [newTag, setNewTag] = useState<NewTag | null>(null);
  const [nfcWriting, setNfcWriting] = useState(false);
  const [tagName, setTagName] = useState("");
  const [selectedShift, setSelectedShift] = useState<Row<"attendance_shifts"> | null>(null);
  const [editIn, setEditIn] = useState("");
  const [editOut, setEditOut] = useState("");
  const [editBreak, setEditBreak] = useState("0");
  const [editReason, setEditReason] = useState("");
  const [scheduleUser, setScheduleUser] = useState("");
  const [scheduleMonth, setScheduleMonth] = useState(() => `${dateValue().slice(0, 7)}-01`);
  const [calendarMode, setCalendarMode] = useState<"routine" | "exception">("routine");
  const [selectedScheduleDates, setSelectedScheduleDates] = useState<string[]>([]);
  const [scheduleWeekday, setScheduleWeekday] = useState(1);
  const scheduleRangeHint = "날짜 탭은 하루만 선택·해제하고, 드래그는 시작일부터 현재일까지 연속 범위를 변경합니다.";
  const [scheduleStart, setScheduleStart] = useState("09:00");
  const [scheduleEnd, setScheduleEnd] = useState("18:00");
  const [scheduleBreak, setScheduleBreak] = useState("60");
  const [scheduleFrom, setScheduleFrom] = useState(() => dateValue());
  const [overrideDayOff, setOverrideDayOff] = useState(false);
  const [rateUser, setRateUser] = useState("");
  const [hourlyWage, setHourlyWage] = useState("");
  const [weeklyContractedMinutes, setWeeklyContractedMinutes] = useState("2400");
  const [rateFrom, setRateFrom] = useState(() => dateValue());
  const [weekStart, setWeekStart] = useState(() => weekStartForDate(new Date().toISOString()));
  const [loading, setLoading] = useState(true);
  const [payrollRulesStatus, setPayrollRulesStatus] = useState<"loading" | "loaded" | "error">("loading");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const scheduleCalendarSelection = useCalendarDateSelection(selectedScheduleDates, setSelectedScheduleDates);

  useEffect(() => {
    if (scheduleOpen && !scheduleOriginal.current) scheduleOriginal.current = { start: scheduleStart, end: scheduleEnd, breakMinutes: scheduleBreak, from: scheduleFrom, dayOff: overrideDayOff, user: scheduleUser, mode: calendarMode };
    if (!scheduleOpen) scheduleOriginal.current = null;
  }, [scheduleOpen, scheduleStart, scheduleEnd, scheduleBreak, scheduleFrom, overrideDayOff, scheduleUser, calendarMode]);

  function closeSchedule() {
    if (saving || ((scheduleDirty || Object.keys(scheduleDrafts.current).length > 0) && !window.confirm("입력한 변경 내용을 버리고 닫을까요?"))) return;
    const original = scheduleOriginal.current;
    if (original) {
      setScheduleStart(original.start); setScheduleEnd(original.end); setScheduleBreak(original.breakMinutes); setScheduleFrom(original.from); setOverrideDayOff(original.dayOff); setScheduleUser(original.user); setCalendarMode(original.mode);
    }
    scheduleDrafts.current = {};
    loadedScheduleKey.current = "";
    setScheduleDirty(false); setScheduleOpen(false);
  }

  useEffect(() => {
    const grid = calendarGrid.current;
    if (!grid) return;
    const blockNativeScroll = (event: globalThis.TouchEvent) => {
      if (pinchGesture.current) event.preventDefault();
    };
    grid.addEventListener("touchmove", blockNativeScroll, { passive: false });
    return () => {
      grid.removeEventListener("touchmove", blockNativeScroll);
      endPinch();
    };
  }, [loading, activeSection]);

  const scheduleMonthEnd = useMemo(() => {
    const [year, month] = scheduleMonth.split("-").map(Number);
    return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  }, [scheduleMonth]);

  const staffById = useMemo(() => new Map(staff.map((entry) => [entry.id, entry])), [staff]);
  const eventsById = useMemo(() => new Map(events.map((event) => [event.id, event])), [events]);
  const segmentsByShift = useMemo(() => {
    const map = new Map<string, Row<"attendance_shift_segments">[]>();
    segments.forEach((segment) => map.set(segment.shift_id, [...(map.get(segment.shift_id) ?? []), segment]));
    return map;
  }, [segments]);
  const currentRule = useMemo(() => resolveEffectiveDated(rules, new Date().toISOString()), [rules]);
  const selectedRoutine = useMemo(() => schedules
    .filter((item) => item.store_id === currentStoreId && item.user_id === scheduleUser && item.weekday === scheduleWeekday && item.effective_from <= scheduleFrom && (!item.effective_to || item.effective_to >= scheduleFrom))
    .sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0], [currentStoreId, schedules, scheduleUser, scheduleWeekday, scheduleFrom]);

  useEffect(() => {
    if (!scheduleOpen || calendarMode !== "routine") { loadedScheduleKey.current = ""; return; }
    const key = `${scheduleUser}:${scheduleWeekday}`;
    if (loadedScheduleKey.current === key && scheduleDirty) return;
    loadedScheduleKey.current = key;
    const draft = scheduleDrafts.current[key];
    setScheduleStart(draft?.start ?? selectedRoutine?.start_time.slice(0, 5) ?? "09:00");
    setScheduleEnd(draft?.end ?? selectedRoutine?.end_time.slice(0, 5) ?? "18:00");
    setScheduleBreak(draft?.breakMinutes ?? String(selectedRoutine?.unpaid_break_minutes ?? 60));
    if (draft) setScheduleFrom(draft.from);
    setScheduleDirty(Boolean(draft));
  }, [scheduleOpen, calendarMode, selectedRoutine, scheduleUser, scheduleWeekday, scheduleDirty]);

  function retainScheduleDraft() {
    if (calendarMode === "routine" && scheduleDirty) {
      scheduleDrafts.current[`${scheduleUser}:${scheduleWeekday}`] = { user: scheduleUser, weekday: scheduleWeekday, start: scheduleStart, end: scheduleEnd, breakMinutes: scheduleBreak, from: scheduleFrom };
    }
  }

  function selectScheduleWeekday(weekday: number) {
    if (saving || weekday === scheduleWeekday) return;
    retainScheduleDraft();
    setScheduleDirty(false);
    setMessage(""); setError("");
    setScheduleWeekday(weekday);
  }


  const loadData = useCallback(async () => {
    setLoading(true);
    setPayrollRulesStatus("loading");
    setError("");
    const rangeStart = new Date(`${fromDate}T00:00:00+09:00`).toISOString();
    const rangeEnd = new Date(`${toDate}T23:59:59+09:00`).toISOString();
    const [staffResult, shiftsResult, eventsResult, segmentsResult, ratesResult, allowancesResult, rulesResult, tagsResult, schedulesResult, overridesResult, pendingStaffResult, pendingDatesResult] = await Promise.all([
      Services.DatabaseService.rpc("list_store_staff_directory"),
      Services.DatabaseService.select("attendance_shifts", "*").eq("store_id", currentStoreId).gte("confirmed_check_in_at", rangeStart).lte("confirmed_check_in_at", rangeEnd).order("confirmed_check_in_at", { ascending: false }),
      Services.DatabaseService.select("attendance_punch_events", "*").eq("store_id", currentStoreId).gte("tagged_at", rangeStart).lte("tagged_at", new Date(new Date(rangeEnd).getTime() + 86400000).toISOString()),
      Services.DatabaseService.select("attendance_shift_segments", "*").eq("store_id", currentStoreId),
      Services.DatabaseService.select("attendance_pay_rates", "*").eq("store_id", currentStoreId).order("effective_from", { ascending: false }),
      Services.DatabaseService.select("attendance_weekly_allowances", "*").eq("store_id", currentStoreId).gte("week_start", fromDate).lte("week_start", toDate),
      Services.DatabaseService.select("attendance_payroll_rules", "*").eq("store_id", currentStoreId).order("effective_from", { ascending: false }),
      Services.DatabaseService.select("attendance_tags", "*").eq("store_id", currentStoreId).is("deleted_at", null).order("created_at", { ascending: false }),
      Services.DatabaseService.select("attendance_work_schedules", "*").eq("store_id", currentStoreId).order("weekday", { ascending: true }),
      Services.DatabaseService.select("attendance_schedule_overrides", "*").eq("store_id", currentStoreId).gte("work_date", scheduleMonth).lte("work_date", scheduleMonthEnd).order("work_date", { ascending: true }),
      currentRole === "store_admin" ? Services.DatabaseService.select("attendance_pending_staff", "*").eq("store_id", currentStoreId).order("display_name") : Promise.resolve({ data: [], error: null }),
      currentRole === "store_admin" ? Services.DatabaseService.select("attendance_pending_staff_dates", "*").eq("store_id", currentStoreId).gte("work_date", scheduleMonth).lte("work_date", scheduleMonthEnd) : Promise.resolve({ data: [], error: null })
    ]);
    const firstError = [staffResult, shiftsResult, eventsResult, segmentsResult, ratesResult, allowancesResult, rulesResult, tagsResult, schedulesResult, overridesResult].find((result) => result.error)?.error;
    if (firstError) setError(firstError.message);
    if (!staffResult.error) {
      const nextStaff = (staffResult.data ?? []) as StaffEntry[];
      setStaff(nextStaff);
      const firstUser = nextStaff.find((entry) => entry.role !== "master")?.id ?? "";
      setScheduleUser((value) => value || firstUser);
      setRateUser((value) => value || firstUser);
    }
    if (!shiftsResult.error) setShifts((shiftsResult.data ?? []) as Row<"attendance_shifts">[]);
    if (!eventsResult.error) setEvents((eventsResult.data ?? []) as Row<"attendance_punch_events">[]);
    if (!segmentsResult.error) setSegments((segmentsResult.data ?? []) as Row<"attendance_shift_segments">[]);
    if (!ratesResult.error) setRates((ratesResult.data ?? []) as Row<"attendance_pay_rates">[]);
    if (!allowancesResult.error) setAllowances((allowancesResult.data ?? []) as Row<"attendance_weekly_allowances">[]);
    if (rulesResult.error) setPayrollRulesStatus("error");
    else {
      setRules((rulesResult.data ?? []) as Row<"attendance_payroll_rules">[]);
      setPayrollRulesStatus("loaded");
    }
    if (!tagsResult.error) setTags((tagsResult.data ?? []) as Row<"attendance_tags">[]);
    if (!schedulesResult.error) setSchedules((schedulesResult.data ?? []) as Row<"attendance_work_schedules">[]);
    if (!overridesResult.error) setOverrides((overridesResult.data ?? []) as Row<"attendance_schedule_overrides">[]);
    if (!pendingStaffResult.error) setPendingStaff((pendingStaffResult.data ?? []) as Row<"attendance_pending_staff">[]);
    if (!pendingDatesResult.error) setPendingDates((pendingDatesResult.data ?? []) as Row<"attendance_pending_staff_dates">[]);
    if (pendingStaffResult.error || pendingDatesResult.error) setError("가입 전 직원 일정을 불러오지 못했습니다. 데이터베이스 업데이트가 필요할 수 있습니다.");
    setLoading(false);
  }, [currentStoreId, currentRole, fromDate, scheduleMonth, scheduleMonthEnd, toDate, setRateUser]);

  useEffect(() => { void loadData(); }, [loadData]);


  const payRows = useMemo(() => shifts.map((shift) => {
    const confirmedSegments = (segmentsByShift.get(shift.id) ?? []).filter((segment) => segment.status === "confirmed");
    const rate = resolveEffectiveDated(rates.filter((item) => item.user_id === shift.user_id), shift.confirmed_check_in_at);
    const rule = resolveEffectiveDated(rules, shift.confirmed_check_in_at);
    const wage = rate?.hourly_wage ?? 0;
    const segmentMinutes = (kind: Row<"attendance_shift_segments">["segment_type"]) => confirmedSegments.filter((segment) => segment.segment_type === kind).reduce((sum, segment) => sum + differenceInMinutes(segment.starts_at, segment.ends_at), 0);
    const summary = calculatePayrollSummary({
      shifts: shift.confirmed_check_out_at ? [{ checkInAt: shift.confirmed_check_in_at, checkOutAt: shift.confirmed_check_out_at, unpaidBreakMinutes: shift.unpaid_break_minutes, hourlyWage: Number(wage), overtimeMinutes: segmentMinutes("overtime"), nightMinutes: segmentMinutes("night"), holidayMinutes: segmentMinutes("holiday") }] : [],
      overtimeMultiplier: Number(rule?.overtime_multiplier ?? 0.5),
      nightMultiplier: Number(rule?.night_multiplier ?? 0.5),
      holidayMultiplier: Number(rule?.holiday_multiplier ?? 0.5),
      weeklyThresholdMinutes: rule?.weekly_threshold_minutes ?? 900,
      roundingRule: rule?.rounding_rule ?? "half_up",
      roundingVersion: rule?.rounding_version ?? 1
    });
    return { shift, wage: Number(wage), summary, segments: segmentsByShift.get(shift.id) ?? [], rate, rule };
  }), [rates, rules, segmentsByShift, shifts]);

  const visiblePayRows = useMemo(
    () => payRows.filter(({ shift }) => !employeeFilter || shift.user_id === employeeFilter),
    [employeeFilter, payRows]
  );
  const calendarRowsByDate = useMemo(() => {
    const byDate = new Map<string, typeof visiblePayRows>();
    visiblePayRows.forEach((row) => {
      const date = localInput(row.shift.confirmed_check_in_at).slice(0, 10);
      byDate.set(date, [...(byDate.get(date) ?? []), row]);
    });
    return byDate;
  }, [visiblePayRows]);

  const scheduleCalendarDays = useMemo(() => {
    const [year, month] = scheduleMonth.split("-").map(Number);
    const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return [...Array<null>(firstWeekday).fill(null), ...Array.from({ length: daysInMonth }, (_, index) => `${scheduleMonth.slice(0, 7)}-${String(index + 1).padStart(2, "0")}`)];
  }, [scheduleMonth]);
  const calendarEntries = useMemo(() => {
    const byDate = new Map<string, CalendarEntry[]>();
    for (const day of scheduleCalendarDays) {
      if (!day) continue;
      const entries: CalendarEntry[] = [];
      for (const person of staff.filter((entry) => entry.role !== "master" && (!employeeFilter || entry.id === employeeFilter))) {
        const override = overrides.find((item) => item.user_id === person.id && item.work_date === day);
        const routine = schedules.filter((item) => item.user_id === person.id && item.weekday === weekdayForDate(day) && item.effective_from <= day && (!item.effective_to || item.effective_to >= day)).sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0];
        if (override?.is_day_off) entries.push({ key: `off-${person.id}`, userId: person.id, name: person.display_name, time: "휴무", kind: "dayOff" });
        else {
          const start = override?.start_time ?? routine?.start_time;
          const end = override?.end_time ?? routine?.end_time;
          if (start && end) entries.push({ key: `plan-${person.id}`, userId: person.id, name: person.display_name, time: `${start.slice(0, 5)}–${end <= start ? "다음 날 " : ""}${end.slice(0, 5)}`, kind: "planned" });
        }
      }
      for (const pending of pendingDates.filter((item) => item.work_date === day)) {
        const person = pendingStaff.find((item) => item.id === pending.pending_staff_id && !item.linked_profile_id);
        if (person && !employeeFilter) entries.push({ key: `pending-${pending.id}`, name: person.display_name, time: `${pending.start_time.slice(0, 5)}–${pending.end_time <= pending.start_time ? "다음 날 " : ""}${pending.end_time.slice(0, 5)}`, kind: "pending" });
      }
      for (const { shift } of calendarRowsByDate.get(day) ?? []) {
        entries.push({ key: `actual-${shift.id}`, userId: shift.user_id, name: staffById.get(shift.user_id)?.display_name ?? "직원", time: `${localInput(shift.confirmed_check_in_at).slice(11, 16)}–${shift.confirmed_check_out_at ? `${localInput(shift.confirmed_check_out_at).slice(0, 10) !== day ? (Date.parse(localInput(shift.confirmed_check_out_at).slice(0, 10)) - Date.parse(day) === 86400000 ? "다음 날 " : localInput(shift.confirmed_check_out_at).slice(0, 10) + " ") : ""}${localInput(shift.confirmed_check_out_at).slice(11, 16)}` : shift.status === "open" ? "근무 중" : "퇴근 미입력"}`, kind: "actual" });
      }
      byDate.set(day, entries);
    }
    return byDate;
  }, [scheduleCalendarDays, staff, employeeFilter, overrides, schedules, pendingDates, pendingStaff, calendarRowsByDate, staffById]);
  function calendarEntryColor(kind: CalendarEntry["kind"]) { return CALENDAR_KIND[kind].color; }
  const unconfirmedWeeksByUser = useMemo(() => {
    const weeksByUser = new Map<string, Set<string>>();
    shifts.forEach((shift) => {
      const weeks = weeksByUser.get(shift.user_id) ?? new Set<string>();
      weeks.add(weekStartForDate(shift.confirmed_check_in_at));
      weeksByUser.set(shift.user_id, weeks);
    });
    const confirmed = new Set(allowances.map((item) => `${item.user_id}:${item.week_start}`));
    return new Map([...weeksByUser].map(([userId, weeks]) => [userId, [...weeks].filter((week) => !confirmed.has(`${userId}:${week}`)).length]));
  }, [allowances, shifts]);

  const totals = useMemo(() => {
    const base = visiblePayRows.reduce((sum, row) => sum + row.summary.basePay, 0);
    const overtime = visiblePayRows.reduce((sum, row) => sum + row.summary.overtimeAllowance, 0);
    const night = visiblePayRows.reduce((sum, row) => sum + row.summary.nightAllowance, 0);
    const holiday = visiblePayRows.reduce((sum, row) => sum + row.summary.holidayAllowance, 0);
    const weekly = allowances.filter((item) => item.eligible && (!employeeFilter || item.user_id === employeeFilter)).reduce((sum, item) => sum + Number(item.allowance_amount), 0);
    return { minutes: visiblePayRows.reduce((sum, row) => sum + row.summary.workedMinutes, 0), base, overtime, night, holiday, weekly, shown: base + (includeAllowances ? overtime + night + holiday + weekly : 0) };
  }, [allowances, employeeFilter, includeAllowances, visiblePayRows]);

  function showCalendarMonth(month: Date) {
    const monthStart = month.toISOString().slice(0, 7) + "-01";
    setFromDate(monthStart);
    setToDate(new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0)).toISOString().slice(0, 10));
    setScheduleMonth(monthStart);
    setSelectedCalendarDates([]);

  }

  async function perform(action: () => PromiseLike<{ error: { message: string } | null }>, success: string) {
    setSaving(true); setError(""); setMessage("");
    try {
      const result = await action();
      if (result.error) { setError(result.error.message); return false; }
      setMessage(success); await loadData(); return true;
    } catch (caught) { setError(caught instanceof Error ? caught.message : "저장하지 못했습니다."); return false; }
    finally { setSaving(false); }
  }

  async function createTag(event: FormEvent) {
    event.preventDefault();
    setSaving(true); setError(""); setMessage("");
    const { data, error: createError } = await Services.DatabaseService.rpc("create_attendance_tag", { tag_name: tagName.trim() });
    if (createError) setError(createError.message);
    else { setNewTag(data as unknown as NewTag); setTagName(""); setMessage("NFC 태그를 만들었습니다. 아래 URL은 지금만 확인할 수 있습니다."); await loadData(); }
    setSaving(false);
  }

  async function writeNewTagToNfc() {
    if (!newTag) return;
    setNfcWriting(true); setError(""); setMessage("");
    try {
      await writeAttendanceUrlToNfc(attendanceTagUrl(newTag.token, ATTENDANCE_LINK_HOST, ATTENDANCE_TAG_CHANNEL));
      setMessage("NFC 태그에 출퇴근 URL을 기록했습니다.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "NFC 태그 기록에 실패했습니다.");
    } finally { setNfcWriting(false); }
  }

  async function testTag(tag: Row<"attendance_tags">) {
    if (import.meta.env.MODE !== "staging") return;
    setSaving(true); setError(""); setMessage("");
    try {
      const { data: store, error: storeError } = await Services.DatabaseService.select("stores", "name").eq("id", currentStoreId).maybeSingle();
      if (storeError) throw storeError;
      if (store?.name !== "테스트 매장" && store?.name !== "테스트점") { setError("테스트 매장·테스트점에서만 NFC 태그 테스트를 사용할 수 있습니다."); return; }
      onTestTag(tag.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "테스트 매장 확인에 실패했습니다.");
    } finally { setSaving(false); }
  }

  async function editTag(tag: Row<"attendance_tags">) {
    const name = window.prompt("태그 이름", tag.name)?.trim();
    if (!name) return;
    await perform(() => Services.DatabaseService.rpc("update_attendance_tag", { target_tag_id: tag.id, tag_name: name, active: tag.is_active }), "태그 정보를 수정했습니다.");
  }

  async function toggleTag(tag: Row<"attendance_tags">) {
    await perform(() => Services.DatabaseService.rpc("update_attendance_tag", { target_tag_id: tag.id, tag_name: tag.name, active: !tag.is_active }), tag.is_active ? "태그를 비활성화했습니다." : "태그를 활성화했습니다.");
  }

  async function rotateTag(tag: Row<"attendance_tags">) {
    const reason = window.prompt("태그 재발급 사유")?.trim();
    if (!reason || !window.confirm(`${tag.name} 태그를 재발급할까요? 기존 링크는 즉시 사용할 수 없습니다.`)) return;
    setSaving(true); setError(""); setMessage("");
    const { data, error: rotateError } = await Services.DatabaseService.rpc("rotate_attendance_tag", { target_tag_id: tag.id, change_reason: reason });
    if (rotateError) setError(rotateError.message);
    else { setNewTag(data as unknown as NewTag); setMessage("NFC 태그를 재발급했습니다. 새 URL을 스티커에 다시 기록하세요."); await loadData(); }
    setSaving(false);
  }

  async function deleteTag(tag: Row<"attendance_tags">) {
    if (!window.confirm(`${tag.name} 태그를 삭제할까요? 기존 URL은 즉시 사용할 수 없고 과거 근태 기록은 유지됩니다. NFC 스티커의 데이터는 지워지지 않습니다.`)) return;
    setSaving(true); setError(""); setMessage("");
    try {
      const { error: deleteError } = await Services.DatabaseService.rpc("delete_attendance_tag", { target_tag_id: tag.id });
      if (deleteError) { setError(deleteError.message); return; }
      setNewTag((current) => current?.id === tag.id ? null : current);
      setMessage("NFC 태그를 삭제했습니다. 기존 URL은 사용할 수 없습니다.");
      await loadData();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "태그를 삭제하지 못했습니다.");
    } finally { setSaving(false); }
  }

  function changeScheduleMonth(offset: number) {
    const [year, month] = scheduleMonth.split("-").map(Number);
    showCalendarMonth(new Date(Date.UTC(year, month - 1 + offset, 1)));
    setSelectedScheduleDates([]);
    scheduleCalendarSelection.clearGesture();
  }


  async function addSchedule() {
    if (saving || !scheduleUser) return;
    const drafts = { ...scheduleDrafts.current, [`${scheduleUser}:${scheduleWeekday}`]: { user: scheduleUser, weekday: scheduleWeekday, start: scheduleStart, end: scheduleEnd, breakMinutes: scheduleBreak, from: scheduleFrom } };
    const entries = Object.entries(drafts);
    const invalid = entries.find(([, draft]) => !draft.start || !draft.end || !draft.from || !draft.breakMinutes || Number(draft.breakMinutes) < 0 || Number(draft.breakMinutes) > 720 || !Number.isInteger(Number(draft.breakMinutes)));
    if (invalid) {
      setError(`${WEEKDAYS[invalid[1].weekday]}요일 출근·퇴근시간, 적용 시작일과 무급휴게(0~720분)를 확인해 주세요.`); return;
    }
    scheduleDrafts.current = drafts;
    const saved = await perform(async () => {
      for (const [key, draft] of entries) {
        const result = await Services.DatabaseService.rpc("save_attendance_work_schedule", { target_user_id: draft.user, target_weekday: draft.weekday, target_start_time: draft.start, target_end_time: draft.end, target_break_minutes: Number(draft.breakMinutes), target_effective_from: draft.from, target_effective_to: null, change_reason: "관리 화면에서 요일별 근무 시간 설정" });
        if (result.error) return result;
        delete scheduleDrafts.current[key];
      }
      setScheduleDirty(false);
      return { error: null };
    }, "입력한 요일의 근무 시간을 저장했습니다.");
    if (saved) setScheduleDirty(false);
  }

  async function addOverride() {
    if (!scheduleUser || !selectedScheduleDates.length) { setError("직원과 휴무·교대 날짜를 선택하세요."); return; }
    const saved = await perform(async () => {
      const results = await Promise.all(selectedScheduleDates.map((date) => Services.DatabaseService.rpc("save_attendance_schedule_override", { target_user_id: scheduleUser, target_work_date: date, target_is_day_off: overrideDayOff, target_start_time: overrideDayOff ? null : scheduleStart, target_end_time: overrideDayOff ? null : scheduleEnd, target_break_minutes: overrideDayOff ? 0 : Number(scheduleBreak), target_note: null, change_reason: "관리 화면에서 예외 일정 저장" })));
      const failed = results.find((result) => result.error)?.error;
      if (failed) throw new Error(failed.message);
      return { error: null };
    }, "선택한 날짜의 휴무·교대 일정을 저장했습니다.");
    if (saved) { setScheduleDirty(false); if (!Object.keys(scheduleDrafts.current).length) { setScheduleOpen(false); setEditingCalendar(false); } }
  }

  async function addRate(event: FormEvent) {
    event.preventDefault();
    await perform(() => Services.DatabaseService.rpc("save_attendance_pay_rate", { target_user_id: rateUser, target_hourly_wage: Number(hourlyWage), target_weekly_contracted_minutes: Number(weeklyContractedMinutes), target_effective_from: rateFrom, target_effective_to: null, change_reason: "관리 화면에서 급여 기준 등록" }), "시급 이력을 등록했습니다.");
  }

  async function addWeeklyAllowance(event: FormEvent) {
    event.preventDefault();
    await perform(() => Services.DatabaseService.rpc("confirm_attendance_weekly_allowance", { target_user_id: rateUser, target_week_start: weekStart, target_eligible: true, target_note: null, change_reason: "관리 화면에서 주휴 대상 확인" }), "서버가 계산한 주휴수당을 확정했습니다.");
  }

  async function confirmPayrollRules() {
    if (payrollRulesStatus !== "loaded") return;
    await perform(() => Services.DatabaseService.rpc("save_attendance_payroll_rules", {
      target_effective_from: currentRule?.effective_from ?? dateValue(),
      target_effective_to: currentRule?.effective_to ?? null,
      target_overtime_multiplier: Number(currentRule?.overtime_multiplier ?? 0.5),
      target_night_multiplier: Number(currentRule?.night_multiplier ?? 0.5),
      target_holiday_multiplier: Number(currentRule?.holiday_multiplier ?? 0.5),
      target_weekly_threshold_minutes: Number(currentRule?.weekly_threshold_minutes ?? 900),
      target_weekly_overtime_threshold_minutes: Number(currentRule?.weekly_overtime_threshold_minutes ?? 2400),
      target_rounding_rule: currentRule?.rounding_rule ?? "half_up",
      target_rounding_version: currentRule?.rounding_version ?? 1,
      target_is_confirmed: true,
      change_reason: "관리 화면에서 법정수당 기준 확인"
    }), "사업장 법정수당 기준을 확정했습니다.");
  }

  function startEditing(shift: Row<"attendance_shifts">) {
    setSelectedCalendarDates([localInput(shift.confirmed_check_in_at).slice(0, 10)]); setDetailKey(`actual-${shift.id}`); setDayOpen(true);
    setSelectedShift(shift); setEditIn(localInput(shift.confirmed_check_in_at)); setEditOut(localInput(shift.confirmed_check_out_at)); setEditBreak(String(shift.unpaid_break_minutes)); setEditReason("");
  }

  async function saveShift(event: FormEvent) {
    event.preventDefault();
    if (!selectedShift) return;
    const canApprove = Boolean(editOut && payrollRulesStatus === "loaded" && resolveEffectiveDated(rules, seoulInputToIso(editIn)!)?.is_confirmed);
    const saved = await perform(() => Services.DatabaseService.rpc("manage_attendance_shift", { target_shift_id: selectedShift.id, confirmed_check_in: seoulInputToIso(editIn)!, confirmed_check_out: seoulInputToIso(editOut), unpaid_break: Number(editBreak), target_status: canApprove ? "approved" : "needs_review", change_reason: editReason.trim() }), "근태 기록을 수정하고 감사 이력을 남겼습니다.");
    if (saved) setSelectedShift(null);
  }

  async function deleteShift(shift: Row<"attendance_shifts">) {
    if (saving || shift.store_id !== currentStoreId) return;
    const reason = window.prompt("근태 기록 삭제 사유를 입력해 주세요 (1~500자).")?.trim();
    if (!reason) return;
    if (reason.length > 500) { setError("삭제 사유는 500자 이내로 입력해 주세요."); return; }
    const name = staffById.get(shift.user_id)?.display_name ?? "직원";
    if (!window.confirm(`${name} · ${formatDateTime(shift.confirmed_check_in_at)} 근태 기록을 삭제할까요?\n근무시간과 급여 집계에서 제외되며, 해당 주의 주휴수당은 다시 확정해야 합니다. 삭제 이력과 원본 NFC 기록은 보존됩니다. 삭제는 되돌릴 수 없습니다.`)) return;
    setSaving(true); setError(""); setMessage("");
    try {
      const { error: deleteError } = await Services.DatabaseService.rpc("delete_attendance_shift", {
        target_shift_id: shift.id, target_store_id: currentStoreId, change_reason: reason
      });
      if (deleteError) {
        setError(deleteError.code === "PGRST202" ? "데이터베이스 업데이트가 필요합니다." : deleteError.message);
        return;
      }
      setSelectedShift(null); setDetailKey(null); setDayOpen(false);
      setMessage("근태 기록을 삭제했습니다. 해당 주의 주휴수당을 다시 확정해 주세요.");
      await loadData();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "근태 기록을 삭제하지 못했습니다.");
    } finally { setSaving(false); }
  }

  async function setSegmentStatus(segment: Row<"attendance_shift_segments">, status: "confirmed" | "rejected") {
    const reason = window.prompt(status === "confirmed" ? "구간 확정 사유" : "구간 제외 사유")?.trim();
    if (!reason) return;
    await perform(() => Services.DatabaseService.rpc("confirm_attendance_segments", { target_shift_id: segment.shift_id, target_segment_id: segment.id, target_status: status, change_reason: reason }), status === "confirmed" ? "수당 구간을 확정했습니다." : "수당 구간을 제외했습니다.");
  }

  async function exportExcel() {
    const XLSX = await import("xlsx");
    const rows = visiblePayRows.map(({ shift, wage, summary, segments: shiftSegments }) => {
      const checkIn = eventsById.get(shift.check_in_event_id);
      const checkOut = shift.check_out_event_id ? eventsById.get(shift.check_out_event_id) : null;
      return {
        직원: staffById.get(shift.user_id)?.display_name ?? shift.user_id,
        "예정 출근": formatDateTime(shift.scheduled_start_at),
        "예정 퇴근": formatDateTime(shift.scheduled_end_at),
        "실제 출근 태그": formatDateTime(checkIn?.tagged_at ?? null),
        "직원 입력 출근": formatDateTime(shift.entered_check_in_at),
        "출근 입력 차이": attendanceDifference(checkIn?.tagged_at, shift.entered_check_in_at),
        "관리자 확정 출근": formatDateTime(shift.confirmed_check_in_at),
        "출근 확정 차이": attendanceDifference(checkIn?.tagged_at, shift.confirmed_check_in_at),
        "실제 퇴근 태그": formatDateTime(checkOut?.tagged_at ?? null),
        "직원 입력 퇴근": formatDateTime(shift.entered_check_out_at),
        "퇴근 입력 차이": attendanceDifference(checkOut?.tagged_at, shift.entered_check_out_at),
        "관리자 확정 퇴근": formatDateTime(shift.confirmed_check_out_at),
        "퇴근 확정 차이": attendanceDifference(checkOut?.tagged_at, shift.confirmed_check_out_at),
        "근무 분": summary.workedMinutes,
        시급: wage,
        기본급: summary.basePay,
        연장수당: summary.overtimeAllowance,
        야간수당: summary.nightAllowance,
        휴일수당: summary.holidayAllowance,
        "수당 제외 합계": summary.withoutAllowances,
        "수당 포함 합계": summary.withAllowances,
        "구간 후보 수": shiftSegments.filter((segment) => segment.status === "candidate").length,
        "미확정 주 수": unconfirmedWeeksByUser.get(shift.user_id) ?? 0,
        상태: STATUS_LABEL[shift.status]
      };
    });
    type EmployeeSummaryRow = { 직원: string; "근무 건수": number; "근무 분": number; "입력 차이 합계(분)": number; "확정 차이 합계(분)": number; "구간 후보 수": number; "미확정 주 수": number; 기본급: number; 주휴수당: number; 연장수당: number; 야간수당: number; 휴일수당: number; "수당 제외 합계": number; "수당 포함 합계": number };
    const emptyEmployeeSummary = (userId: string): EmployeeSummaryRow => ({ 직원: staffById.get(userId)?.display_name ?? userId, "근무 건수": 0, "근무 분": 0, "입력 차이 합계(분)": 0, "확정 차이 합계(분)": 0, "구간 후보 수": 0, "미확정 주 수": unconfirmedWeeksByUser.get(userId) ?? 0, 기본급: 0, 주휴수당: 0, 연장수당: 0, 야간수당: 0, 휴일수당: 0, "수당 제외 합계": 0, "수당 포함 합계": 0 });
    const summaryByEmployee = new Map<string, EmployeeSummaryRow>();
    visiblePayRows.forEach(({ shift, summary, segments: shiftSegments }) => {
      const checkIn = eventsById.get(shift.check_in_event_id);
      const checkOut = shift.check_out_event_id ? eventsById.get(shift.check_out_event_id) : null;
      const current = summaryByEmployee.get(shift.user_id) ?? emptyEmployeeSummary(shift.user_id);
      current["근무 건수"] += 1;
      current["근무 분"] += summary.workedMinutes;
      current["입력 차이 합계(분)"] += (checkIn ? differenceInMinutes(checkIn.tagged_at, shift.entered_check_in_at) : 0) + (checkOut && shift.entered_check_out_at ? differenceInMinutes(checkOut.tagged_at, shift.entered_check_out_at) : 0);
      current["확정 차이 합계(분)"] += (checkIn ? differenceInMinutes(checkIn.tagged_at, shift.confirmed_check_in_at) : 0) + (checkOut && shift.confirmed_check_out_at ? differenceInMinutes(checkOut.tagged_at, shift.confirmed_check_out_at) : 0);
      current["구간 후보 수"] += shiftSegments.filter((segment) => segment.status === "candidate").length;
      current.기본급 += summary.basePay;
      current.연장수당 += summary.overtimeAllowance;
      current.야간수당 += summary.nightAllowance;
      current.휴일수당 += summary.holidayAllowance;
      current["수당 제외 합계"] += summary.withoutAllowances;
      current["수당 포함 합계"] += summary.withAllowances;
      summaryByEmployee.set(shift.user_id, current);
    });
    allowances.filter((item) => item.eligible && (!employeeFilter || item.user_id === employeeFilter)).forEach((item) => {
      const current = summaryByEmployee.get(item.user_id) ?? emptyEmployeeSummary(item.user_id);
      current.주휴수당 += Number(item.allowance_amount);
      current["수당 포함 합계"] += Number(item.allowance_amount);
      summaryByEmployee.set(item.user_id, current);
    });
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), "상세 근태");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([...summaryByEmployee.values()]), "직원 요약");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(allowances.filter((item) => !employeeFilter || item.user_id === employeeFilter).map((item) => ({ 직원: staffById.get(item.user_id)?.display_name ?? item.user_id, 주시작일: item.week_start, 주휴대상: item.eligible ? "예" : "아니오", 주휴수당: item.allowance_amount, 메모: item.note ?? "" }))), "주휴수당");
    XLSX.writeFile(workbook, `근태기록_${fromDate}_${toDate}.xlsx`);
  }

  function startPinch(event: TouchEvent<HTMLDivElement>) {
    if (editingCalendar || event.touches.length !== 2) return;
    if (pinchGesture.current) return;
    const scrollY = window.scrollY;
    const { position, top, width, overflow } = document.body.style;
    pinchScrollLock.current = { scrollY, position, top, width, overflow };
    document.body.style.position = "fixed";
    document.body.style.top = `-${scrollY}px`;
    document.body.style.width = "100%";
    document.body.style.overflow = "hidden";
    pinchGesture.current = {
      startDistance: Math.hypot(event.touches[0].clientX - event.touches[1].clientX, event.touches[0].clientY - event.touches[1].clientY),
      startZoom: calendarZoom
    };
  }

  function endPinch() {
    pinchGesture.current = null;
    const snapshot = pinchScrollLock.current;
    if (!snapshot) return;
    const { scrollY, ...style } = snapshot;
    Object.assign(document.body.style, style);
    pinchScrollLock.current = null;
    window.scrollTo({ top: scrollY, behavior: "instant" });
  }

  function movePinch(event: TouchEvent<HTMLDivElement>) {
    const pinch = pinchGesture.current;
    if (!pinch || event.touches.length !== 2 || !pinch.startDistance) return;
    const distance = Math.hypot(event.touches[0].clientX - event.touches[1].clientX, event.touches[0].clientY - event.touches[1].clientY);
    const nextZoom = Math.max(0, Math.min(2, pinch.startZoom + Math.log(distance / pinch.startDistance) / Math.log(1.5)));
    setCalendarZoom(nextZoom);
  }

  const dayEntries = calendarEntries.get(selectedCalendarDates[0]) ?? [];
  const detail = dayEntries.find((entry) => entry.key === detailKey);
  const detailRow = visiblePayRows.find(({ shift }) => `actual-${shift.id}` === detailKey);
  const editDirty = selectedShift && (editIn !== localInput(selectedShift.confirmed_check_in_at) || editOut !== localInput(selectedShift.confirmed_check_out_at) || editBreak !== String(selectedShift.unpaid_break_minutes) || !!editReason);
  function cancelEdit() {
    if (saving || (editDirty && !window.confirm("입력한 변경 내용을 버릴까요?"))) return;
    setSelectedShift(null);
  }
  function closeDay() {
    if (saving || (editDirty && !window.confirm("입력한 변경 내용을 버리고 닫을까요?"))) return;
    setSelectedShift(null); setDayOpen(false); setDetailKey(null);
  }
  function openDay(day: string, key: string | null = null) {
    setSelectedCalendarDates([day]); setDetailKey(key); setDayOpen(true); setError("");
  }
  function loadDateSchedule(userId: string) {
    const day = selectedCalendarDates[0];
    const override = overrides.find((item) => item.store_id === currentStoreId && item.user_id === userId && item.work_date === day);
    const routine = schedules.filter((item) => item.store_id === currentStoreId && item.user_id === userId && item.weekday === weekdayForDate(day) && item.effective_from <= day && (!item.effective_to || item.effective_to >= day)).sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0];
    setScheduleUser(userId);
    setScheduleStart(override?.start_time?.slice(0, 5) ?? routine?.start_time.slice(0, 5) ?? "09:00");
    setScheduleEnd(override?.end_time?.slice(0, 5) ?? routine?.end_time.slice(0, 5) ?? "18:00");
    const breakMinutes = override?.unpaid_break_minutes ?? routine?.unpaid_break_minutes ?? 0;
    setScheduleBreak(String(breakMinutes));
    setDateScheduleBreakEnabled(breakMinutes > 0);
  }
  function editSchedule(entry?: CalendarEntry) {
    if (saving || loading || !selectedCalendarDates[0]) return;
    setError(""); setMessage(""); setDateScheduleDirty(false);
    loadDateSchedule(entry?.userId ?? employeeFilter ?? "");
    setDayOpen(false); setScheduleOpen(false); setDateScheduleOpen(true);
  }
  function closeDateSchedule() {
    if (saving || (dateScheduleDirty && !window.confirm("입력한 변경 내용을 버리고 닫을까요?"))) return;
    setDateScheduleOpen(false); setDateScheduleDirty(false); setDayOpen(true);
  }
  async function saveDateSchedule(event: FormEvent) {
    event.preventDefault();
    if (saving || loading) return;
    const day = selectedCalendarDates[0];
    if (!scheduleUser || !day || !scheduleStart || !scheduleEnd || (dateScheduleBreakEnabled && (scheduleBreak.trim() === "" || !Number.isInteger(Number(scheduleBreak)) || Number(scheduleBreak) < 1 || Number(scheduleBreak) > 720))) {
      setError("직원, 출근·퇴근시간과 무급휴게(1~720분)를 확인해 주세요."); return;
    }
    const saved = await perform(() => Services.DatabaseService.rpc("save_attendance_schedule_override", { target_user_id: scheduleUser, target_work_date: day, target_is_day_off: false, target_start_time: scheduleStart, target_end_time: scheduleEnd, target_break_minutes: dateScheduleBreakEnabled ? Number(scheduleBreak) : 0, target_note: null, change_reason: "달력에서 날짜별 근무일정 저장" }), "선택한 날짜의 근무일정을 저장했습니다.");
    if (saved) {
      setDateScheduleOpen(false); setDateScheduleDirty(false); setDetailKey(null); setDayOpen(true);
    }
  }
  return (
    <section>
      {dateScheduleOpen && <AttendanceSheet title={dayEntries.some((entry) => entry.userId === scheduleUser && entry.kind !== "actual") ? "근무일정 변경" : "근무일정 추가"} onClose={closeDateSchedule}>
        <form className="space-y-4" onSubmit={saveDateSchedule} onChangeCapture={() => setDateScheduleDirty(true)}>
          {error && <StatusMessage type="error">{error}</StatusMessage>}
          <div><p className="text-sm font-semibold">근무 날짜</p><p className="mt-1 font-bold tabular-nums">{selectedCalendarDates[0]} ({WEEKDAYS[weekdayForDate(selectedCalendarDates[0])]}요일)</p></div>
          <label className="block text-sm font-semibold">근무자<select className="field mt-1" value={scheduleUser} required disabled={saving || loading} onChange={(event) => loadDateSchedule(event.target.value)}><option value="">직원을 선택해 주세요</option>{staff.filter((entry) => entry.role !== "master").map((entry) => <option key={entry.id} value={entry.id}>{entry.display_name}</option>)}</select></label>
          <WorkTimeWheel label="출근시간" value={scheduleStart} disabled={saving || loading} onChange={(value) => { setScheduleStart(value); setDateScheduleDirty(true); }} />
          <WorkTimeWheel label="퇴근시간" value={scheduleEnd} disabled={saving || loading} onChange={(value) => { setScheduleEnd(value); setDateScheduleDirty(true); }} />
          {scheduleStart && scheduleEnd && scheduleEnd <= scheduleStart && <p className="text-sm text-slate-500">퇴근시간은 다음 날 기준입니다.</p>}
          <div>
            <label className="flex min-h-11 items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={dateScheduleBreakEnabled} disabled={saving || loading} aria-controls="date-schedule-break" onChange={(event) => { setDateScheduleBreakEnabled(event.target.checked); if (event.target.checked && Number(scheduleBreak) <= 0) setScheduleBreak(""); }} />무급휴게 있음</label>
            <label className={`block text-sm font-semibold ${dateScheduleBreakEnabled ? "" : "text-slate-400"}`}>무급휴게(분)<input id="date-schedule-break" type="number" min="1" max="720" step="1" className="field mt-1 disabled:bg-slate-100 disabled:opacity-60 dark:disabled:bg-slate-900" required={dateScheduleBreakEnabled} disabled={saving || loading || !dateScheduleBreakEnabled} value={dateScheduleBreakEnabled ? scheduleBreak : ""} onChange={(event) => setScheduleBreak(event.target.value)} /></label>
          </div>
          <p className="text-sm text-slate-500">선택한 날짜에만 적용됩니다. 실제 출퇴근 기록에는 영향을 주지 않습니다.</p>
          <button type="submit" className="primary-button sticky bottom-0 w-full" disabled={saving || loading || !scheduleUser}>{saving ? "저장 중..." : dayEntries.some((entry) => entry.userId === scheduleUser && entry.kind !== "actual") ? "근무일정 변경" : "근무일정 추가"}</button>
        </form>
      </AttendanceSheet>}
      {dayOpen && <AttendanceSheet title={`${detail?.name ?? (selectedShift ? staffById.get(selectedShift.user_id)?.display_name ?? "직원" : "하루 내역")} · ${selectedCalendarDates[0]}`} onClose={closeDay} onBack={selectedShift ? cancelEdit : detailKey ? () => setDetailKey(null) : undefined}>
        {error && <StatusMessage type="error">{error}</StatusMessage>}
        {selectedShift ? <form className="grid gap-3 p-4 sm:grid-cols-2" onSubmit={saveShift}><h2 className="text-lg font-bold sm:col-span-2">근태 기록 수정</h2><label className="min-w-0 text-sm font-semibold">확정 출근<input type="datetime-local" className="field mt-1 min-w-0 max-w-full appearance-none" value={editIn} onChange={(event) => setEditIn(event.target.value)} required /></label><label className="min-w-0 text-sm font-semibold">확정 퇴근<input type="datetime-local" className="field mt-1 min-w-0 max-w-full appearance-none" value={editOut} onChange={(event) => setEditOut(event.target.value)} /></label><label className="text-sm font-semibold">무급휴게(분)<input type="number" min="0" max="720" className="field mt-1" value={editBreak} onChange={(event) => setEditBreak(event.target.value)} /></label><label className="text-sm font-semibold">수정 사유<input className="field mt-1" value={editReason} onChange={(event) => setEditReason(event.target.value)} required /></label><div className="sticky bottom-0 flex gap-2 bg-white py-3 dark:bg-slate-950 sm:col-span-2"><button type="submit" className="primary-button flex-1" disabled={saving}>저장</button><button type="button" className="secondary-button" onClick={cancelEdit}>취소</button></div><div className="grid sm:col-span-2"><button type="button" className="secondary-button inline-flex min-h-11 items-center justify-center gap-2 text-red-600 dark:text-red-400" disabled={saving} onClick={() => void deleteShift(selectedShift)}><Trash2 size={16} />기록 삭제</button></div></form> : detail ? <div className="space-y-4">
          {dayEntries.filter((entry) => detail.userId ? entry.userId === detail.userId && entry.kind !== "actual" : entry.key === detail.key).map((entry) => <p key={entry.key}>{CALENDAR_KIND[entry.kind].label} · {entry.time}</p>)}
          {detail.kind === "actual" && <><p className="font-semibold">출퇴근 기록 · {detail.time}</p><p>상태 · {detailRow ? STATUS_LABEL[detailRow.shift.status] : "-"}</p><p>근무 시간 · {detailRow ? minutesLabel(detailRow.summary.workedMinutes) : "-"}</p><p>무급 휴게 · {detailRow?.shift.unpaid_break_minutes ?? 0}분</p>{detailRow && <details><summary className="min-h-11 py-3 font-semibold">기록 상세 보기</summary><div className="space-y-3 text-sm"><p>NFC 태그 · {formatDateTime(eventsById.get(detailRow.shift.check_in_event_id)?.tagged_at ?? null)} / {formatDateTime(eventsById.get(detailRow.shift.check_out_event_id ?? "")?.tagged_at ?? null)}</p><p>직원 입력 · {formatDateTime(detailRow.shift.entered_check_in_at)} / {formatDateTime(detailRow.shift.entered_check_out_at)}</p><p>관리자 확정 · {formatDateTime(detailRow.shift.confirmed_check_in_at)} / {formatDateTime(detailRow.shift.confirmed_check_out_at)}</p></div></details>}<button type="button" className="primary-button w-full" disabled={!detailRow || saving} onClick={() => { if (detailRow) startEditing(detailRow.shift); }}>기록 수정</button><button type="button" className="secondary-button inline-flex min-h-11 w-full items-center justify-center gap-2 text-red-600 dark:text-red-400" disabled={!detailRow || saving} onClick={() => { if (detailRow) void deleteShift(detailRow.shift); }}><Trash2 size={16} />기록 삭제</button></>}
          {currentRole === "store_admin" && detail.userId && detail.kind !== "actual" && <button type="button" className="primary-button w-full" onClick={() => editSchedule(detail)}>근무 일정 변경</button>}
          {currentRole === "store_admin" && detail.userId && detail.kind === "actual" && <button type="button" className="secondary-button min-h-11 w-full" disabled={saving} onClick={() => editSchedule(detail)}>근무 일정 추가</button>}
        </div> : <div className="space-y-3">
          {[...new Set(dayEntries.map((entry) => entry.userId ?? entry.key))].map((id) => { const entries = dayEntries.filter((entry) => (entry.userId ?? entry.key) === id); return <div key={id} className="border-b border-slate-200 pb-2 dark:border-slate-800"><p className="font-bold">{entries[0].name}</p>{entries.map((entry) => <button type="button" key={entry.key} className="flex min-h-12 w-full items-center justify-between gap-2 text-left text-sm" onClick={() => setDetailKey(entry.key)}><span>{CALENDAR_KIND[entry.kind].label}<br /><span className="tabular-nums">{entry.time}</span></span><ChevronRight size={18} /></button>)}</div>; })}
          {!dayEntries.length && <p className="text-sm text-slate-500">등록된 일정이나 출퇴근 기록이 없습니다.</p>}
          {currentRole === "store_admin" && <button type="button" className="secondary-button w-full" onClick={() => editSchedule()}>근무 일정 추가</button>}
        </div>}
      </AttendanceSheet>}
      <PageTitle title="근태관리" description="날짜를 눌러 근무·출퇴근 기록을 확인하고, 관리자는 근무표를 편집합니다." action={<button type="button" className="touch-button flex shrink-0 items-center justify-center border-0 bg-transparent text-slate-600 disabled:opacity-50 dark:text-slate-300" aria-label="새로고침" title="새로고침" onClick={() => { void loadData(); setRefreshOnboardingSignal((value) => value + 1); }} disabled={loading}><RefreshCw size={20} /></button>} />
      {error ? <div className="mb-3"><StatusMessage type="error">{error}</StatusMessage></div> : null}
      {message ? <div className="mb-3"><StatusMessage type="success">{message}</StatusMessage></div> : null}
      {payrollRulesStatus === "loaded" && !currentRule?.is_confirmed ? <div className="mb-3"><StatusMessage type="error">사업장 법정수당 기준이 확정되지 않아 급여는 예상 금액입니다.</StatusMessage></div> : null}

      <div className="mb-3 flex items-center justify-between gap-2">
        {activeSection !== "calendar" ? <button type="button" className="secondary-button" onClick={() => setActiveSection("calendar")}><ChevronLeft size={16} />달력으로</button> : <span className="text-sm text-slate-500">날짜나 직원 이름을 눌러 확인하세요.</span>}
        <button type="button" className="secondary-button shrink-0" onClick={() => setMoreOpen(true)}>더보기 ⋯</button>
      </div>
      {moreOpen && <AttendanceSheet title="근태관리 메뉴" onClose={() => setMoreOpen(false)}><div className="grid gap-2">{([["calendar", "달력"], ["summary", "월간 근태 요약"], ["records", "근태 기록 · 엑셀"], ["staff", "직원 등록·관리"], ["nfc", "NFC 관리"], ["payroll", "급여 기준"]] as const).filter(([key]) => key !== "staff" || currentRole === "store_admin").map(([key, label]) => <button key={key} type="button" className="secondary-button min-h-12 text-left" onClick={() => { setActiveSection(key); setMoreOpen(false); }}>{label}</button>)}</div></AttendanceSheet>}
      {activeSection === "calendar" && <>
      <button type="button" className="secondary-button mb-3 flex min-h-11 w-full min-w-0 items-center justify-between gap-2 text-left sm:hidden" aria-expanded={filtersOpen} aria-controls="attendance-filters" onClick={() => setFiltersOpen((open) => !open)}><span className="min-w-0 break-words">{filtersOpen ? "조회 조건" : <>직원 · {employeeFilter ? staffById.get(employeeFilter)?.display_name ?? "직원" : "전체 직원"}</>}</span><span className="shrink-0">{filtersOpen ? "접기" : "직원 필터"}</span></button>
      <div id="attendance-filters" className={`mb-4 min-w-0 gap-3 sm:grid sm:grid-cols-2 lg:grid-cols-4 ${filtersOpen ? "grid" : "hidden"}`}>
        <label className="min-w-0 text-sm font-semibold">직원 선택<select className="field mt-1" value={employeeFilter} onChange={(event) => setEmployeeFilter(event.target.value)}><option value="">전체 직원</option>{staff.filter((entry) => entry.role !== "master").map((entry) => <option key={entry.id} value={entry.id}>{entry.display_name}</option>)}</select></label>
      </div>

      <div className="mb-4" aria-label="근무 달력">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1"><button type="button" className="touch-button icon-button" aria-label="이전 달" onClick={() => changeScheduleMonth(-1)}><ChevronLeft size={20} /></button><button type="button" className="secondary-button px-2" onClick={() => { showCalendarMonth(new Date(`${dateValue().slice(0, 7)}-01T00:00:00Z`)); setSelectedCalendarDates([dateValue()]); }}>오늘</button><h2 className="min-w-24 whitespace-nowrap text-lg font-extrabold">{scheduleMonth.slice(0, 4)}년 {Number(scheduleMonth.slice(5, 7))}월</h2><button type="button" className="touch-button icon-button" aria-label="다음 달" onClick={() => changeScheduleMonth(1)}><ChevronRight size={20} /></button></div>
          {currentRole === "store_admin" ? <button type="button" className="secondary-button shrink-0" aria-pressed={editingCalendar} onClick={() => { setEditingCalendar((value) => !value); setSelectedScheduleDates([]); setScheduleOpen(false); scheduleCalendarSelection.clearGesture(); }}>{editingCalendar ? "편집 완료" : "근무표 편집"}</button> : null}
        </div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500"><div role="list" aria-label="달력 범례" className="flex flex-wrap items-center gap-x-3 gap-y-1">{CALENDAR_KINDS.map((kind) => <span key={kind} role="listitem" className="inline-flex items-center gap-1"><span aria-hidden="true" className={`h-2 w-2 rounded-full ${calendarEntryColor(kind)}`} />{CALENDAR_KIND[kind].label}</span>)}</div><div className="flex shrink-0 items-center gap-1"><button type="button" className="touch-button icon-button" aria-label="달력 축소" disabled={calendarZoom === 0} onClick={() => setCalendarZoom((value) => Math.max(0, Math.ceil(value) - 1))}>−</button><span aria-live="polite">{["작게", "보통", "크게"][Math.round(calendarZoom)]}</span><button type="button" className="touch-button icon-button" aria-label="달력 확대" disabled={calendarZoom === 2} onClick={() => setCalendarZoom((value) => Math.min(2, Math.floor(value) + 1))}>+</button></div></div>
        <div className="grid grid-cols-7 border-b border-slate-200 text-center text-xs font-semibold text-slate-500 dark:border-slate-800">{WEEKDAYS.map((day) => <span key={day} className="py-2">{day}</span>)}</div>
        {loading ? <p className="py-10 text-center text-sm text-slate-500">달력을 불러오는 중...</p> : <div ref={calendarGrid} className={editingCalendar ? "grid grid-cols-7 touch-none sm:touch-auto select-none" : "grid grid-cols-7 touch-pan-y select-none"} onTouchStart={startPinch} onTouchMove={movePinch} onTouchEnd={(event) => { if (event.touches.length === 0) endPinch(); }} onTouchCancel={endPinch} onPointerMove={editingCalendar ? scheduleCalendarSelection.onPointerMove : undefined} onPointerUp={editingCalendar ? scheduleCalendarSelection.onPointerUp : undefined} onPointerCancel={editingCalendar ? scheduleCalendarSelection.onPointerCancel : undefined}>
          {scheduleCalendarDays.map((day, index) => day ? (() => {
            const entries = calendarEntries.get(day) ?? [];
            const selected = (editingCalendar ? selectedScheduleDates : selectedCalendarDates).includes(day);
            return <div key={day} data-calendar-date={day} className={`relative flex min-w-0 flex-col border-b border-l border-slate-200 p-1 dark:border-slate-800 ${selected ? "bg-brand-50 dark:bg-brand-950" : ""}`} style={{ minHeight: `${100 + 32 * calendarZoom}px` }}>
              <button type="button" className={`min-h-11 w-full text-left ${editingCalendar ? "flex-1" : ""}`} onPointerDown={editingCalendar ? (event) => scheduleCalendarSelection.onPointerDownDate(day, event) : undefined} aria-label={`${day} 하루 내역`} aria-pressed={selected} onClick={(event) => editingCalendar ? scheduleCalendarSelection.onClickDate(day, event) : openDay(day)}><span className={`inline-flex h-7 min-w-7 items-center justify-center rounded-full font-bold ${day === dateValue() ? "bg-brand-600 text-white" : ""}`}>{Number(day.slice(-2))}</span></button>
              {!editingCalendar && entries.slice(0, calendarZoom === 2 ? 3 : 2).map((entry) => <button key={entry.key} type="button" className="min-h-11 min-w-0 text-left text-[11px] leading-tight" aria-label={`${entry.name} ${CALENDAR_KIND[entry.kind].label}`} onClick={() => openDay(day, entry.key)}><span className="block truncate font-semibold">{entry.name}</span><span className="flex items-center gap-1"><span className={`h-1.5 w-1.5 shrink-0 rounded-full ${calendarEntryColor(entry.kind)}`} />{entry.kind === "actual" ? "기록" : CALENDAR_KIND[entry.kind].label}</span></button>)}
              {!editingCalendar && entries.length > (calendarZoom === 2 ? 3 : 2) && <button type="button" className="min-h-11 text-left text-[11px] text-slate-500" onClick={() => openDay(day)}>+{entries.length - (calendarZoom === 2 ? 3 : 2)}건</button>}
            </div>;
          })() : <span key={`empty-${index}`} className="border-b border-slate-200 dark:border-slate-800" aria-hidden="true" />)}
        </div>}
        <p className="mt-2 text-xs text-slate-500">날짜를 누르면 하루 내역, 직원 이름을 누르면 상세 기록이 열립니다.</p>
      </div>
      {editingCalendar && currentRole === "store_admin" && <><div className="sticky bottom-20 z-10 mb-3 flex flex-wrap items-center gap-2 bg-white p-3 dark:bg-slate-950"><label className="min-w-0 flex-1 text-sm">직원<select className="field" value={scheduleUser} onChange={(event) => { retainScheduleDraft(); setScheduleDirty(false); setScheduleUser(event.target.value); }}>{staff.filter((entry) => entry.role !== "master").map((entry) => <option key={entry.id} value={entry.id}>{entry.display_name}</option>)}</select></label><button type="button" className="primary-button" disabled={saving || !scheduleUser} onClick={() => { setScheduleDirty(false); setCalendarMode("routine"); setScheduleOpen(true); }}>근무 시간 설정</button></div>{scheduleOpen && <AttendanceSheet title="근무 시간 설정" onClose={closeSchedule}>
        <div className="space-y-3" onChangeCapture={() => setScheduleDirty(true)}>
          {error && <StatusMessage type="error">{error}</StatusMessage>}
          {message && <StatusMessage type="success">{message}</StatusMessage>}
          <label className="block text-sm font-semibold">직원 선택<select className="field mt-1" value={scheduleUser} disabled={saving || loading} onChange={(event) => { retainScheduleDraft(); setScheduleDirty(false); setScheduleUser(event.target.value); }}>{staff.filter((entry) => entry.role !== "master").map((entry) => <option key={entry.id} value={entry.id}>{entry.display_name}</option>)}</select></label>
          <div className="flex gap-2" role="group" aria-label="일정 설정 모드">
            <button type="button" disabled={saving} className={calendarMode === "routine" ? "primary-button" : "secondary-button"} aria-pressed={calendarMode === "routine"} onClick={() => { setCalendarMode("routine"); scheduleCalendarSelection.clearGesture(); }}>기본 근무</button>
            <button type="button" disabled={saving} className={calendarMode === "exception" ? "primary-button" : "secondary-button"} aria-pressed={calendarMode === "exception"} onClick={() => { retainScheduleDraft(); setScheduleDirty(false); setCalendarMode("exception"); scheduleCalendarSelection.clearGesture(); }}>휴무·교대</button>
          </div>
          {calendarMode === "routine" ? <>
            <div className="grid grid-cols-7 gap-1" role="group" aria-label="근무 요일 선택">
              {WORK_WEEKDAYS.map((weekday) => <button key={weekday} type="button" disabled={saving || loading} aria-pressed={scheduleWeekday === weekday} aria-label={`${WEEKDAYS[weekday]}요일 근무 시간 설정${scheduleDrafts.current[`${scheduleUser}:${weekday}`] ? ", 임시저장됨" : ""}`} onClick={() => selectScheduleWeekday(weekday)} className={`touch-button min-w-0 rounded-lg border px-0 text-sm font-bold disabled:opacity-50 ${scheduleWeekday === weekday ? "border-brand-600 bg-brand-600 text-white" : scheduleDrafts.current[`${scheduleUser}:${weekday}`] ? "border-violet-200 bg-violet-100 text-violet-700 dark:border-violet-700 dark:bg-violet-950 dark:text-violet-200" : "border-slate-200 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"}`}>{WEEKDAYS[weekday]}</button>)}
            </div>
            <p className="text-sm font-semibold">{WEEKDAYS[scheduleWeekday]}요일 근무 시간{!selectedRoutine && <span className="ml-2 text-xs font-normal text-slate-500">미설정</span>}</p>
          </> : <>
            <p aria-live="polite" className="text-sm text-slate-600 dark:text-slate-300">{scheduleRangeHint} 선택: {selectedScheduleDates.length ? selectedScheduleDates.join(", ") : "없음"}</p>
            <label className="flex min-h-11 items-center gap-2 text-sm font-semibold"><input type="checkbox" disabled={saving} checked={overrideDayOff} onChange={(event) => setOverrideDayOff(event.target.checked)} />선택한 날짜는 휴무</label>
          </>}
          {!overrideDayOff || calendarMode === "routine" ? <>
            <WorkTimeWheel label="출근시간" value={scheduleStart} disabled={saving || loading} onChange={(value) => { setScheduleStart(value); setScheduleDirty(true); }} />
            <WorkTimeWheel label="퇴근시간" value={scheduleEnd} disabled={saving || loading} onChange={(value) => { setScheduleEnd(value); setScheduleDirty(true); }} />
            {scheduleEnd <= scheduleStart && <p className="text-xs text-slate-500">퇴근시간은 다음 날 기준입니다.</p>}
          </> : null}
          <details className="text-sm">
            <summary className="cursor-pointer py-2 font-semibold">추가 설정</summary>
            <div className="grid gap-3 pt-2 sm:grid-cols-2">
              {calendarMode === "routine" ? <label className="min-w-0">적용 시작일<input type="date" className="field mt-1 min-w-0 max-w-full appearance-none" disabled={saving || loading} value={scheduleFrom} onChange={(event) => setScheduleFrom(event.target.value)} /></label> : null}
              {!overrideDayOff || calendarMode === "routine" ? <label>무급휴게(분)<input type="number" min="0" max="720" className="field mt-1" disabled={saving || loading} value={scheduleBreak} onChange={(event) => setScheduleBreak(event.target.value)} /></label> : null}
            </div>
          </details>
          <button type="button" className="primary-button sticky bottom-0 w-full" disabled={saving || loading || !scheduleUser || (calendarMode === "exception" && !selectedScheduleDates.length)} onClick={() => void (calendarMode === "routine" ? addSchedule() : addOverride())}>{saving ? "저장 중..." : calendarMode === "routine" ? "근무 시간 저장" : "휴무·교대 저장"}</button>
          {calendarMode === "routine" && <p className="text-xs text-slate-500">{scheduleFrom}부터 매주 반복됩니다. 요일을 바꾸면 입력 내용이 임시저장됩니다. 연한 보라색은 임시저장한 요일이며, 근무 시간 저장을 누르면 함께 저장됩니다.</p>}
          {calendarMode === "exception" ? <p className="mt-2 text-xs text-slate-500">등록한 휴무·교대 일정은 이 화면에서 취소할 수 없습니다. 실제 출퇴근 기록에는 영향을 주지 않습니다.</p> : null}
        </div>
      </AttendanceSheet>}</>}
      </>}

      {activeSection === "summary" && <details open className="panel mb-4 p-3"><summary className="min-h-11 cursor-pointer py-2 font-bold">월간 근태 요약</summary>
      <label className="mb-1 flex min-h-11 items-center gap-2 text-sm font-semibold"><input type="checkbox" className="h-5 w-5 accent-brand-600" checked={includeAllowances} onChange={(event) => setIncludeAllowances(event.target.checked)} />화면 예상 금액에 법정수당 포함</label>
      <p className="mb-3 text-xs text-slate-500">예상 금액 표시만 바꾸며 근태 기록이나 급여 기준은 변경하지 않습니다.</p>
      <div className="mb-4 grid min-w-0 grid-cols-2 gap-3">
        <div className="panel min-w-0 p-3 sm:p-4"><p className="text-xs text-slate-500">총 근무</p><p className="mt-1 break-words text-lg font-bold tabular-nums sm:text-xl">{minutesLabel(totals.minutes)}</p></div>
        <div className="panel min-w-0 p-3 sm:p-4"><p className="text-xs text-slate-500">{includeAllowances ? "수당 포함 예상" : "수당 제외 합계"}</p><p className="mt-1 break-words text-lg font-bold tabular-nums sm:text-xl">{totals.shown.toLocaleString()}원</p></div>
      </div>
      <details className="panel mb-4 p-3 sm:p-4"><summary className="min-h-11 cursor-pointer py-2 font-bold">계산 내역</summary><div className="mt-2 grid min-w-0 gap-3 border-t border-slate-200 pt-3 sm:grid-cols-2 lg:grid-cols-3 dark:border-slate-800">
        <div><p className="text-xs text-slate-500">기본급</p><p className="font-bold tabular-nums">{totals.base.toLocaleString()}원</p></div>
        <div><p className="text-xs text-slate-500">주휴수당</p><p className="font-bold tabular-nums">{totals.weekly.toLocaleString()}원</p></div>
        <div><p className="text-xs text-slate-500">연장수당</p><p className="font-bold tabular-nums">{totals.overtime.toLocaleString()}원</p></div>
        <div><p className="text-xs text-slate-500">야간수당</p><p className="font-bold tabular-nums">{totals.night.toLocaleString()}원</p></div>
        <div><p className="text-xs text-slate-500">휴일수당</p><p className="font-bold tabular-nums">{totals.holiday.toLocaleString()}원</p></div>
        <div><p className="text-xs text-slate-500">주 기준 / 반올림</p><p className="break-words font-bold">{currentRule?.weekly_threshold_minutes ?? 900}분 / 주 연장 {currentRule?.weekly_overtime_threshold_minutes ?? 2400}분 · {currentRule?.rounding_rule ?? "half_up"} v{currentRule?.rounding_version ?? 1}</p></div>
      </div></details>
      </details>}

      {activeSection === "records" && <details open className="panel mb-4 p-3 sm:p-4"><summary className="min-h-11 cursor-pointer py-2 font-bold">근태 기록 · 엑셀</summary>
      <div className="mb-2 flex justify-end"><button type="button" className="secondary-button" onClick={() => setShowDetails((value) => !value)}>{showDetails ? "간략히 보기" : "상세 보기"}</button></div>
      <div className="panel mb-5 sm:overflow-x-auto">
        <div className="sm:hidden">
          {visiblePayRows.map(({ shift, wage, summary, segments: shiftSegments }) => {
            const checkIn = eventsById.get(shift.check_in_event_id); const checkOut = shift.check_out_event_id ? eventsById.get(shift.check_out_event_id) : null;
            return <div key={shift.id} className="border-b border-slate-100 px-3 py-2 last:border-b-0 dark:border-slate-900">
            <div className="flex min-w-0 items-center justify-between gap-2">
              <div className="flex min-w-0 flex-1 items-center justify-between gap-2"><strong className="min-w-0 break-words">{staffById.get(shift.user_id)?.display_name ?? "직원"}</strong><time className="shrink-0 text-sm text-slate-500 tabular-nums">{localInput(shift.confirmed_check_in_at).slice(5, 10).replace("-", ".")}</time></div>
              <button type="button" className="secondary-button flex min-h-11 min-w-11 shrink-0 items-center justify-center p-2" aria-label="근태 수정" title="근태 수정" onClick={() => startEditing(shift)}><Pencil size={16} /></button>
            </div>
            <p className="mt-1 flex flex-wrap gap-x-3 text-sm font-semibold tabular-nums"><span>출근 : {localInput(shift.confirmed_check_in_at).slice(11, 16) || "-"}</span><span> / </span><span>퇴근 : {shift.confirmed_check_out_at ? localInput(shift.confirmed_check_out_at).slice(11, 16) : shift.status === "open" ? "근무 중" : "미입력"}</span></p>
            <details className="mt-1 border-t border-slate-100 text-xs dark:border-slate-800"><summary className="min-h-11 cursor-pointer py-3 font-semibold">기록 상세</summary><div className="space-y-2 break-words pb-2">
              <p>상태: {STATUS_LABEL[shift.status]}</p>
              <p>근무: {minutesLabel(summary.workedMinutes)} · 금액: {(includeAllowances ? summary.withAllowances : summary.withoutAllowances).toLocaleString()}원</p>
              <p>시급: {wage.toLocaleString()}원</p>
              <p>실제 태그: {formatDateTime(checkIn?.tagged_at ?? null)} / {formatDateTime(checkOut?.tagged_at ?? null)}</p>
              <p>직원 입력: {formatDateTime(shift.entered_check_in_at)} ({attendanceDifference(checkIn?.tagged_at, shift.entered_check_in_at)}) / {formatDateTime(shift.entered_check_out_at)} ({attendanceDifference(checkOut?.tagged_at, shift.entered_check_out_at)})</p>
              <p>관리자 확정: {formatDateTime(shift.confirmed_check_in_at)} ({attendanceDifference(checkIn?.tagged_at, shift.confirmed_check_in_at)}) / {formatDateTime(shift.confirmed_check_out_at)} ({attendanceDifference(checkOut?.tagged_at, shift.confirmed_check_out_at)})</p>
              <div>일정/수당 구간: {shiftSegments.length ? shiftSegments.map((segment) => <div key={segment.id} className="mt-2 flex flex-wrap items-center gap-2"><span className="min-w-0 break-words">{SEGMENT_LABEL[segment.segment_type]} {formatDateTime(segment.starts_at)}~{formatDateTime(segment.ends_at)} ({segment.status})</span>{segment.status === "candidate" ? <><button type="button" className="secondary-button min-h-11" aria-label="구간 확정" onClick={() => void setSegmentStatus(segment, "confirmed")}><Check size={16} /></button><button type="button" className="secondary-button min-h-11" aria-label="구간 제외" onClick={() => void setSegmentStatus(segment, "rejected")}><X size={16} /></button></> : null}</div>) : "-"}</div>
            </div></details>
          </div>;
          })}
        </div>
        <table className={`hidden sm:table w-full text-left text-sm ${showDetails ? "min-w-[1100px]" : "min-w-[640px]"}`}><thead className="bg-slate-100 text-xs dark:bg-slate-900"><tr><th className="px-3 py-3">직원</th><th>출근시간</th><th>퇴근시간</th>{showDetails && <><th>실제 태그</th><th>직원 입력</th><th>관리자 확정</th><th>일정/수당 구간</th></>}<th>근무</th><th>시급</th><th>금액</th><th>상태</th><th /></tr></thead>
          <tbody>{visiblePayRows.map(({ shift, wage, summary, segments: shiftSegments }) => {
            const checkIn = eventsById.get(shift.check_in_event_id); const checkOut = shift.check_out_event_id ? eventsById.get(shift.check_out_event_id) : null;
            return <tr key={shift.id} className="border-t border-slate-100 align-top dark:border-slate-900">
              <td className="px-3 py-3 font-bold">{staffById.get(shift.user_id)?.display_name ?? "직원"}</td>
              <td className="py-3">{formatDateTime(shift.confirmed_check_in_at)}</td><td className="py-3">{formatDateTime(shift.confirmed_check_out_at)}</td>
              {showDetails && <>
              <td className="py-3">{formatDateTime(checkIn?.tagged_at ?? null)}<br />{formatDateTime(checkOut?.tagged_at ?? null)}</td>
              <td className="py-3">{formatDateTime(shift.entered_check_in_at)} <span className="text-xs font-semibold text-amber-700 dark:text-amber-300">({attendanceDifference(checkIn?.tagged_at, shift.entered_check_in_at)})</span><br />{formatDateTime(shift.entered_check_out_at)} <span className="text-xs font-semibold text-amber-700 dark:text-amber-300">({attendanceDifference(checkOut?.tagged_at, shift.entered_check_out_at)})</span></td>
              <td className="py-3">{formatDateTime(shift.confirmed_check_in_at)} <span className="text-xs font-semibold text-brand-700 dark:text-brand-200">({attendanceDifference(checkIn?.tagged_at, shift.confirmed_check_in_at)})</span><br />{formatDateTime(shift.confirmed_check_out_at)} <span className="text-xs font-semibold text-brand-700 dark:text-brand-200">({attendanceDifference(checkOut?.tagged_at, shift.confirmed_check_out_at)})</span></td>
              <td className="py-3">{shiftSegments.length ? shiftSegments.map((segment) => <div key={segment.id} className="mb-1 flex items-center gap-1"><span>{SEGMENT_LABEL[segment.segment_type]} {formatDateTime(segment.starts_at)}~{formatDateTime(segment.ends_at)} ({segment.status})</span>{segment.status === "candidate" ? <><button type="button" aria-label="구간 확정" onClick={() => void setSegmentStatus(segment, "confirmed")}><Check size={16} /></button><button type="button" aria-label="구간 제외" onClick={() => void setSegmentStatus(segment, "rejected")}><X size={16} /></button></> : null}</div>) : "-"}</td>
              </>}
              <td className="py-3">{minutesLabel(summary.workedMinutes)}</td><td className="py-3">{wage.toLocaleString()}원</td><td className="py-3 font-bold">{(includeAllowances ? summary.withAllowances : summary.withoutAllowances).toLocaleString()}원</td><td className="py-3">{STATUS_LABEL[shift.status]}</td>
              <td className="px-3 py-3"><div className="flex gap-2"><button type="button" className="secondary-button p-2" aria-label="근태 수정" title="근태 수정" disabled={saving} onClick={() => startEditing(shift)}><Pencil size={16} /></button><button type="button" className="secondary-button p-2 text-red-600 dark:text-red-400" aria-label="근태 기록 삭제" title="근태 기록 삭제" disabled={saving} onClick={() => void deleteShift(shift)}><Trash2 size={16} /></button></div></td>
            </tr>;
          })}</tbody></table>
        {!loading && !visiblePayRows.length ? <div className="p-4"><StatusMessage>선택한 조건의 근태 기록이 없습니다.</StatusMessage></div> : null}
      </div>
      <button type="button" className="primary-button mb-5 inline-flex w-full items-center justify-center gap-2 sm:w-auto" onClick={() => void exportExcel()} disabled={!visiblePayRows.length}><Download size={18} />엑셀 받기</button>
      </details>}

      <div className="grid gap-5">
        {currentRole === "store_admin" && activeSection === "staff" ? <details open className="panel p-3"><summary className="min-h-11 cursor-pointer py-2 font-bold">직원 등록·관리</summary><AttendanceStaffOnboarding
          currentStoreId={currentStoreId}
          hideHomeCalendar
          onUpdated={() => void loadData()}
          staff={staff}
          schedules={schedules}
          overrides={overrides}
          month={scheduleMonth}
          onChangeMonth={changeScheduleMonth}
          startSignal={0}
          refreshSignal={refreshOnboardingSignal}
          onScheduleExisting={(userId, day) => {
            setActiveSection("calendar"); setEditingCalendar(true); setScheduleDirty(false); setScheduleOpen(true);
            setScheduleUser(userId);
            setCalendarMode("exception");
            setSelectedScheduleDates(day ? [day] : []);
            if (day && day.slice(0, 7) !== scheduleMonth.slice(0, 7)) showCalendarMonth(new Date(`${day.slice(0, 7)}-01T00:00:00Z`));
          }}
        /></details> : null}
        {activeSection === "nfc" && <>
        <div className="panel p-4"><div className="mb-3 flex items-center justify-between gap-2"><h2 className="flex items-center gap-2 text-lg font-bold"><Nfc size={20} />NFC 정보</h2></div><form className="flex gap-2" onSubmit={createTag}><input className="field flex-1" aria-label="새 NFC 태그 이름" placeholder="예: 카운터 출퇴근" value={tagName} onChange={(event) => setTagName(event.target.value)} required /><button type="submit" className="primary-button" aria-label="NFC 태그 만들기" disabled={saving}><Plus size={18} /></button></form>{newTag ? <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:bg-amber-950"><p className="font-bold">NFC 스티커에 이 HTTPS URL을 기록하세요. 다시 표시되지 않습니다.</p><code className="mt-2 block break-all select-all">{attendanceTagUrl(newTag.token, ATTENDANCE_LINK_HOST, ATTENDANCE_TAG_CHANNEL)}</code><button type="button" className="secondary-button mt-2" onClick={() => void navigator.clipboard.writeText(attendanceTagUrl(newTag.token, ATTENDANCE_LINK_HOST, ATTENDANCE_TAG_CHANNEL))}>URL 복사</button><button type="button" className="secondary-button mt-2 ml-2" onClick={() => void writeNewTagToNfc()} disabled={nfcWriting || !isNativeNfcAvailable()}>{nfcWriting ? "태그 기록 중..." : "앱에서 NFC에 저장"}</button><p className="mt-2 text-xs text-slate-500">{isNativeNfcAvailable() ? "NFC 태그를 휴대폰에 대면 이 URL을 직접 기록합니다." : "NFC 저장은 iOS·Android 앱에서 사용할 수 있습니다."}</p></div> : null}{import.meta.env.MODE === "staging" && <p className="mt-3 text-xs text-amber-700 dark:text-amber-300">테스트는 NFC 없이 실제 출퇴근 입력을 시작합니다. 확인하면 테스트 매장에 근태 기록이 남습니다.</p>}<div className="mt-3 space-y-2">{tags.map((tag) => <div key={tag.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-slate-100 p-2 dark:bg-slate-900"><span className="min-w-0 break-words"><strong>{tag.name}</strong> · {tag.is_active ? "활성" : "비활성"}</span><span className="flex flex-wrap gap-1">{import.meta.env.MODE === "staging" && <button type="button" className="secondary-button px-2" onClick={() => void testTag(tag)} disabled={saving || !tag.is_active} aria-label={`${tag.name} 태그 테스트`}>테스트</button>}<button type="button" className="secondary-button p-2" onClick={() => void editTag(tag)} aria-label="태그 이름 수정" title="태그 이름 수정"><Pencil size={15} /></button><button type="button" className="secondary-button px-2" onClick={() => void toggleTag(tag)}>{tag.is_active ? "중지" : "활성"}</button><button type="button" className="secondary-button px-2" onClick={() => void rotateTag(tag)} disabled={saving}>재발급</button><button type="button" className="secondary-button p-2" onClick={() => void deleteTag(tag)} disabled={saving} aria-label={`${tag.name} 태그 삭제`} title={`${tag.name} 태그 삭제`}><Trash2 size={15} /></button></span></div>)}</div></div>
        </>}

        {activeSection === "payroll" && <>
        <div className="panel p-4 lg:col-span-2"><h2 className="mb-3 text-lg font-bold">급여 기준</h2><div className="grid gap-4 lg:grid-cols-2"><form className="grid gap-2 sm:grid-cols-2" onSubmit={addRate}><select className="field sm:col-span-2" value={rateUser} onChange={(event) => setRateUser(event.target.value)}>{staff.map((entry) => <option key={entry.id} value={entry.id}>{entry.display_name}</option>)}</select><label className="text-sm">시급<input type="number" min="0" className="field mt-1" value={hourlyWage} onChange={(event) => setHourlyWage(event.target.value)} required disabled={currentRole !== "store_admin"} /></label><label className="text-sm">주 소정근로시간(분)<input type="number" min="0" max="10080" className="field mt-1" value={weeklyContractedMinutes} onChange={(event) => setWeeklyContractedMinutes(event.target.value)} required disabled={currentRole !== "store_admin"} /></label><label className="text-sm">적용 시작일<input type="date" className="field mt-1" value={rateFrom} onChange={(event) => setRateFrom(event.target.value)} disabled={currentRole !== "store_admin"} /></label><button type="submit" className="primary-button sm:col-span-2" disabled={saving || currentRole !== "store_admin"}>시급 이력 추가</button></form><form className="grid gap-2 sm:grid-cols-2" onSubmit={addWeeklyAllowance}><label className="text-sm">주 시작일<input type="date" className="field mt-1" value={weekStart} onChange={(event) => setWeekStart(event.target.value)} /></label><label className="text-sm sm:col-span-2">주휴수당은 시급·주 소정근로시간으로 서버에서 계산됩니다.</label><button type="submit" className="secondary-button sm:col-span-2" disabled={saving}>주휴 대상 확정</button></form></div><div className="mt-3 flex flex-wrap items-center justify-between gap-2"><p className="text-xs text-slate-500">시급과 법정수당 기준은 관리자만 수정할 수 있습니다. 주휴수당은 소정근로일 개근 여부 확인 후 확정하세요.</p>{currentRole === "store_admin" && payrollRulesStatus === "loaded" && !currentRule?.is_confirmed ? <button type="button" className="secondary-button" onClick={() => void confirmPayrollRules()} disabled={saving}>사업장 기준 확정</button> : null}</div></div>
        </>}
      </div>
    </section>
  );
}
