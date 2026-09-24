import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Check, Download, Nfc, Pencil, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { PageTitle } from "../components/PageTitle";
import { StatusMessage } from "../components/StatusMessage";
import { attendanceTagUrl, calculatePayrollSummary, differenceInMinutes, resolveEffectiveDated, signedMinutesLabel } from "../lib/attendancePayroll";
import { isNativeNfcAvailable, writeAttendanceUrlToNfc } from "../lib/nativeAttendanceNfc";
import * as Services from "../services";
import type { ProfileRole } from "../types/domain";
import type { Database } from "../types/supabase";

type Row<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Row"];
type StaffEntry = { id: string; display_name: string; role: ProfileRole };
type NewTag = { id: string; name: string; token: string; created_at: string };

type Props = { currentStoreId: string; currentRole: ProfileRole; onTestTag: (token: string) => void };

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
const SEGMENT_LABEL = { schedule_overrun: "일정 외", overtime: "연장", night: "야간", holiday: "휴일" } as const;
const STATUS_LABEL = { open: "근무 중", closed: "퇴근", needs_review: "확인 필요", approved: "승인" } as const;
const ATTENDANCE_LINK_HOST = import.meta.env.VITE_ATTENDANCE_LINK_HOST ?? "stroage-manage.vercel.app";

function dateValue(offsetDays = 0) {
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" });
  return formatter.format(new Date(Date.now() + offsetDays * 86400000));
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
  const [fromDate, setFromDate] = useState(() => dateValue(-30));
  const [toDate, setToDate] = useState(() => dateValue());
  const [employeeFilter, setEmployeeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [includeAllowances, setIncludeAllowances] = useState(true);
  const [activeSection, setActiveSection] = useState("records");
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
  const [newTag, setNewTag] = useState<NewTag | null>(null);
  const [nfcWriting, setNfcWriting] = useState(false);
  const [tagName, setTagName] = useState("");
  const [selectedShift, setSelectedShift] = useState<Row<"attendance_shifts"> | null>(null);
  const [editIn, setEditIn] = useState("");
  const [editOut, setEditOut] = useState("");
  const [editBreak, setEditBreak] = useState("0");
  const [editReason, setEditReason] = useState("");
  const [scheduleUser, setScheduleUser] = useState("");
  const [scheduleWeekday, setScheduleWeekday] = useState("1");
  const [scheduleStart, setScheduleStart] = useState("09:00");
  const [scheduleEnd, setScheduleEnd] = useState("18:00");
  const [scheduleBreak, setScheduleBreak] = useState("60");
  const [scheduleFrom, setScheduleFrom] = useState(() => dateValue());
  const [overrideDate, setOverrideDate] = useState(() => dateValue());
  const [overrideDayOff, setOverrideDayOff] = useState(false);
  const [rateUser, setRateUser] = useState("");
  const [hourlyWage, setHourlyWage] = useState("");
  const [weeklyContractedMinutes, setWeeklyContractedMinutes] = useState("2400");
  const [rateFrom, setRateFrom] = useState(() => dateValue());
  const [weekStart, setWeekStart] = useState(() => weekStartForDate(new Date().toISOString()));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const staffById = useMemo(() => new Map(staff.map((entry) => [entry.id, entry])), [staff]);
  const eventsById = useMemo(() => new Map(events.map((event) => [event.id, event])), [events]);
  const segmentsByShift = useMemo(() => {
    const map = new Map<string, Row<"attendance_shift_segments">[]>();
    segments.forEach((segment) => map.set(segment.shift_id, [...(map.get(segment.shift_id) ?? []), segment]));
    return map;
  }, [segments]);
  const currentRule = useMemo(() => resolveEffectiveDated(rules, new Date().toISOString()), [rules]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");
    const rangeStart = new Date(`${fromDate}T00:00:00+09:00`).toISOString();
    const rangeEnd = new Date(`${toDate}T23:59:59+09:00`).toISOString();
    const [staffResult, shiftsResult, eventsResult, segmentsResult, ratesResult, allowancesResult, rulesResult, tagsResult, schedulesResult, overridesResult] = await Promise.all([
      Services.DatabaseService.rpc("list_store_staff_directory"),
      Services.DatabaseService.select("attendance_shifts", "*").eq("store_id", currentStoreId).gte("confirmed_check_in_at", rangeStart).lte("confirmed_check_in_at", rangeEnd).order("confirmed_check_in_at", { ascending: false }),
      Services.DatabaseService.select("attendance_punch_events", "*").eq("store_id", currentStoreId).gte("tagged_at", rangeStart).lte("tagged_at", new Date(new Date(rangeEnd).getTime() + 86400000).toISOString()),
      Services.DatabaseService.select("attendance_shift_segments", "*").eq("store_id", currentStoreId),
      Services.DatabaseService.select("attendance_pay_rates", "*").eq("store_id", currentStoreId).order("effective_from", { ascending: false }),
      Services.DatabaseService.select("attendance_weekly_allowances", "*").eq("store_id", currentStoreId).gte("week_start", fromDate).lte("week_start", toDate),
      Services.DatabaseService.select("attendance_payroll_rules", "*").eq("store_id", currentStoreId).order("effective_from", { ascending: false }),
      Services.DatabaseService.select("attendance_tags", "*").eq("store_id", currentStoreId).is("deleted_at", null).order("created_at", { ascending: false }),
      Services.DatabaseService.select("attendance_work_schedules", "*").eq("store_id", currentStoreId).order("weekday", { ascending: true }),
      Services.DatabaseService.select("attendance_schedule_overrides", "*").eq("store_id", currentStoreId).gte("work_date", fromDate).order("work_date", { ascending: true })
    ]);
    const firstError = [staffResult, shiftsResult, eventsResult, segmentsResult, ratesResult, allowancesResult, rulesResult, tagsResult, schedulesResult, overridesResult].find((result) => result.error)?.error;
    if (firstError) setError(firstError.message);
    else {
      const nextStaff = (staffResult.data ?? []) as StaffEntry[];
      setStaff(nextStaff);
      setShifts((shiftsResult.data ?? []) as Row<"attendance_shifts">[]);
      setEvents((eventsResult.data ?? []) as Row<"attendance_punch_events">[]);
      setSegments((segmentsResult.data ?? []) as Row<"attendance_shift_segments">[]);
      setRates((ratesResult.data ?? []) as Row<"attendance_pay_rates">[]);
      setAllowances((allowancesResult.data ?? []) as Row<"attendance_weekly_allowances">[]);
      setRules((rulesResult.data ?? []) as Row<"attendance_payroll_rules">[]);
      setTags((tagsResult.data ?? []) as Row<"attendance_tags">[]);
      setSchedules((schedulesResult.data ?? []) as Row<"attendance_work_schedules">[]);
      setOverrides((overridesResult.data ?? []) as Row<"attendance_schedule_overrides">[]);
      const firstUser = nextStaff.find((entry) => entry.role !== "master")?.id ?? "";
      setScheduleUser((value) => value || firstUser);
      setRateUser((value) => value || firstUser);
    }
    setLoading(false);
  }, [currentStoreId, fromDate, toDate]);

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
    () => payRows.filter(({ shift }) => (!employeeFilter || shift.user_id === employeeFilter) && (!statusFilter || shift.status === statusFilter)),
    [employeeFilter, payRows, statusFilter]
  );
  const unresolvedEvents = useMemo(
    () => events.filter((event) => ["pending", "expired"].includes(event.status as string) && (!employeeFilter || event.user_id === employeeFilter)),
    [employeeFilter, events]
  );
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

  async function perform(action: () => PromiseLike<{ error: { message: string } | null }>, success: string) {
    setSaving(true); setError(""); setMessage("");
    try {
      const result = await action();
      if (result.error) setError(result.error.message);
      else { setMessage(success); await loadData(); }
    } catch (caught) { setError(caught instanceof Error ? caught.message : "저장하지 못했습니다."); }
    setSaving(false);
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
      await writeAttendanceUrlToNfc(attendanceTagUrl(newTag.token, ATTENDANCE_LINK_HOST));
      setMessage("NFC 태그에 출퇴근 URL을 기록했습니다.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "NFC 태그 기록에 실패했습니다.");
    } finally { setNfcWriting(false); }
  }

  async function testNewTag() {
    if (!newTag || import.meta.env.MODE !== "staging") return;
    setSaving(true); setError(""); setMessage("");
    try {
      const { data: store, error: storeError } = await Services.DatabaseService.select("stores", "name").eq("id", currentStoreId).maybeSingle();
      if (storeError) throw storeError;
      if (store?.name !== "테스트 매장") { setError("테스트 매장에서만 NFC 태그 테스트를 사용할 수 있습니다."); return; }
      onTestTag(newTag.token);
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

  async function addSchedule(event: FormEvent) {
    event.preventDefault();
    await perform(() => Services.DatabaseService.rpc("save_attendance_work_schedule", { target_user_id: scheduleUser, target_weekday: Number(scheduleWeekday), target_start_time: scheduleStart, target_end_time: scheduleEnd, target_break_minutes: Number(scheduleBreak), target_effective_from: scheduleFrom, target_effective_to: null, change_reason: "관리 화면에서 반복 일정 등록" }), "반복 근무 일정을 등록했습니다.");
  }

  async function addOverride(event: FormEvent) {
    event.preventDefault();
    await perform(() => Services.DatabaseService.rpc("save_attendance_schedule_override", { target_user_id: scheduleUser, target_work_date: overrideDate, target_is_day_off: overrideDayOff, target_start_time: overrideDayOff ? null : scheduleStart, target_end_time: overrideDayOff ? null : scheduleEnd, target_break_minutes: overrideDayOff ? 0 : Number(scheduleBreak), target_note: null, change_reason: "관리 화면에서 예외 일정 저장" }), "날짜별 예외 일정을 저장했습니다.");
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
    setSelectedShift(shift); setEditIn(localInput(shift.confirmed_check_in_at)); setEditOut(localInput(shift.confirmed_check_out_at)); setEditBreak(String(shift.unpaid_break_minutes)); setEditReason("");
  }

  async function saveShift(event: FormEvent) {
    event.preventDefault();
    if (!selectedShift) return;
    await perform(() => Services.DatabaseService.rpc("manage_attendance_shift", { target_shift_id: selectedShift.id, confirmed_check_in: seoulInputToIso(editIn)!, confirmed_check_out: seoulInputToIso(editOut), unpaid_break: Number(editBreak), target_status: editOut ? "approved" : "needs_review", change_reason: editReason.trim() }), "근태 기록을 수정하고 감사 이력을 남겼습니다.");
    setSelectedShift(null);
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

  return (
    <section>
      <PageTitle title="근태관리" description="NFC 실제 태그 시각과 급여 반영 시각을 분리해 관리합니다." action={<button type="button" className="secondary-button inline-flex shrink-0 items-center gap-2 whitespace-nowrap" onClick={() => void loadData()} disabled={loading}><RefreshCw size={17} />새로고침</button>} />
      {error ? <div className="mb-3"><StatusMessage type="error">{error}</StatusMessage></div> : null}
      {message ? <div className="mb-3"><StatusMessage type="success">{message}</StatusMessage></div> : null}
      {!currentRule?.is_confirmed ? <div className="mb-3"><StatusMessage type="error">사업장 법정수당 기준이 확정되지 않아 급여는 예상 금액입니다.</StatusMessage></div> : null}

      <nav className="mb-4 flex min-w-0 gap-2 overflow-x-auto border-b border-slate-200 dark:border-slate-800" aria-label="근태관리 기능">
        {([["records", "근태 기록"], ["nfc", "NFC 관리"], ["schedule", "근무 일정"], ["payroll", "급여 기준"]] as const).map(([section, label]) => <button key={section} type="button" onClick={() => setActiveSection(section)} aria-current={activeSection === section ? "page" : undefined} className={`min-h-11 shrink-0 border-b-2 px-3 text-sm font-extrabold whitespace-nowrap ${activeSection === section ? "border-brand-600 text-brand-700 dark:text-brand-200" : "border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"}`}>{label}</button>)}
      </nav>
      {activeSection === "records" && <>
      <div className="mb-4 grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <label className="min-w-0 text-sm font-semibold">조회 시작<input type="date" className="field mt-1 block min-w-0 max-w-full appearance-none" value={fromDate} onChange={(event) => setFromDate(event.target.value)} /></label>
        <label className="min-w-0 text-sm font-semibold">조회 종료<input type="date" className="field mt-1 block min-w-0 max-w-full appearance-none" value={toDate} onChange={(event) => setToDate(event.target.value)} /></label>
        <label className="text-sm font-semibold">직원 필터<select className="field mt-1" value={employeeFilter} onChange={(event) => setEmployeeFilter(event.target.value)}><option value="">전체 직원</option>{staff.filter((entry) => entry.role !== "master").map((entry) => <option key={entry.id} value={entry.id}>{entry.display_name}</option>)}</select></label>
        <label className="text-sm font-semibold">상태 필터<select className="field mt-1" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="">전체 상태</option>{Object.entries(STATUS_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="panel flex min-h-12 items-center gap-3 p-3 text-sm font-bold"><input type="checkbox" className="h-5 w-5 accent-brand-600" checked={includeAllowances} onChange={(event) => setIncludeAllowances(event.target.checked)} />법정수당 포함</label>
        <button type="button" className="primary-button inline-flex items-center justify-center gap-2" onClick={() => void exportExcel()} disabled={!visiblePayRows.length}><Download size={18} />엑셀 받기</button>
      </div>

      {unresolvedEvents.length ? <div className="mb-4"><StatusMessage type="error">입력 대기·입력 누락·만료 기록이 {unresolvedEvents.length}건 있습니다. {unresolvedEvents.map((event) => `${staffById.get(event.user_id)?.display_name ?? "직원"} ${formatDateTime(event.tagged_at)} (${(event.status as string) === "expired" ? "만료" : "입력 대기"})`).join(" · ")}</StatusMessage></div> : null}

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="panel p-4"><p className="text-xs text-slate-500">총 근무</p><p className="mt-1 text-xl font-bold">{minutesLabel(totals.minutes)}</p></div>
        <div className="panel p-4"><p className="text-xs text-slate-500">기본급</p><p className="mt-1 text-xl font-bold">{totals.base.toLocaleString()}원</p></div>
        <div className="panel p-4"><p className="text-xs text-slate-500">주휴수당</p><p className="mt-1 text-xl font-bold">{totals.weekly.toLocaleString()}원</p></div>
        <div className="panel p-4"><p className="text-xs text-slate-500">연장수당</p><p className="mt-1 text-xl font-bold">{totals.overtime.toLocaleString()}원</p></div>
        <div className="panel p-4"><p className="text-xs text-slate-500">야간수당</p><p className="mt-1 text-xl font-bold">{totals.night.toLocaleString()}원</p></div>
        <div className="panel p-4"><p className="text-xs text-slate-500">휴일수당</p><p className="mt-1 text-xl font-bold">{totals.holiday.toLocaleString()}원</p></div>
        <div className="panel p-4"><p className="text-xs text-slate-500">{includeAllowances ? "수당 포함 예상" : "수당 제외 합계"}</p><p className="mt-1 text-xl font-bold">{totals.shown.toLocaleString()}원</p></div>
        <div className="panel p-4"><p className="text-xs text-slate-500">주 기준 / 반올림</p><p className="mt-1 font-bold">{currentRule?.weekly_threshold_minutes ?? 900}분 / 주 연장 {currentRule?.weekly_overtime_threshold_minutes ?? 2400}분 · {currentRule?.rounding_rule ?? "half_up"} v{currentRule?.rounding_version ?? 1}</p></div>
      </div>

      <div className="panel mb-5 overflow-x-auto">
        <table className="w-full min-w-[1100px] text-left text-sm"><thead className="bg-slate-100 text-xs dark:bg-slate-900"><tr><th className="px-3 py-3">직원</th><th>실제 태그</th><th>직원 입력</th><th>관리자 확정</th><th>일정/수당 구간</th><th>근무</th><th>시급</th><th>금액</th><th>상태</th><th /></tr></thead>
          <tbody>{visiblePayRows.map(({ shift, wage, summary, segments: shiftSegments }) => {
            const checkIn = eventsById.get(shift.check_in_event_id); const checkOut = shift.check_out_event_id ? eventsById.get(shift.check_out_event_id) : null;
            return <tr key={shift.id} className="border-t border-slate-100 align-top dark:border-slate-900">
              <td className="px-3 py-3 font-bold">{staffById.get(shift.user_id)?.display_name ?? "직원"}</td>
              <td className="py-3">{formatDateTime(checkIn?.tagged_at ?? null)}<br />{formatDateTime(checkOut?.tagged_at ?? null)}</td>
              <td className="py-3">{formatDateTime(shift.entered_check_in_at)} <span className="text-xs font-semibold text-amber-700 dark:text-amber-300">({attendanceDifference(checkIn?.tagged_at, shift.entered_check_in_at)})</span><br />{formatDateTime(shift.entered_check_out_at)} <span className="text-xs font-semibold text-amber-700 dark:text-amber-300">({attendanceDifference(checkOut?.tagged_at, shift.entered_check_out_at)})</span></td>
              <td className="py-3">{formatDateTime(shift.confirmed_check_in_at)} <span className="text-xs font-semibold text-brand-700 dark:text-brand-200">({attendanceDifference(checkIn?.tagged_at, shift.confirmed_check_in_at)})</span><br />{formatDateTime(shift.confirmed_check_out_at)} <span className="text-xs font-semibold text-brand-700 dark:text-brand-200">({attendanceDifference(checkOut?.tagged_at, shift.confirmed_check_out_at)})</span></td>
              <td className="py-3">{shiftSegments.length ? shiftSegments.map((segment) => <div key={segment.id} className="mb-1 flex items-center gap-1"><span>{SEGMENT_LABEL[segment.segment_type]} {formatDateTime(segment.starts_at)}~{formatDateTime(segment.ends_at)} ({segment.status})</span>{segment.status === "candidate" ? <><button type="button" aria-label="구간 확정" onClick={() => void setSegmentStatus(segment, "confirmed")}><Check size={16} /></button><button type="button" aria-label="구간 제외" onClick={() => void setSegmentStatus(segment, "rejected")}><X size={16} /></button></> : null}</div>) : "-"}</td>
              <td className="py-3">{minutesLabel(summary.workedMinutes)}</td><td className="py-3">{wage.toLocaleString()}원</td><td className="py-3 font-bold">{(includeAllowances ? summary.withAllowances : summary.withoutAllowances).toLocaleString()}원</td><td className="py-3">{STATUS_LABEL[shift.status]}</td>
              <td className="px-3 py-3"><button type="button" className="secondary-button p-2" aria-label="근태 수정" onClick={() => startEditing(shift)}><Pencil size={16} /></button></td>
            </tr>;
          })}</tbody></table>
        {!loading && !visiblePayRows.length ? <div className="p-4"><StatusMessage>선택한 조건의 근태 기록이 없습니다.</StatusMessage></div> : null}
      </div>

      {selectedShift ? <form className="panel mb-5 grid gap-3 p-4 sm:grid-cols-2" onSubmit={saveShift}><h2 className="text-lg font-bold sm:col-span-2">근태 기록 수정</h2><label className="text-sm font-semibold">확정 출근<input type="datetime-local" className="field mt-1" value={editIn} onChange={(event) => setEditIn(event.target.value)} required /></label><label className="text-sm font-semibold">확정 퇴근<input type="datetime-local" className="field mt-1" value={editOut} onChange={(event) => setEditOut(event.target.value)} /></label><label className="text-sm font-semibold">무급휴게(분)<input type="number" min="0" max="720" className="field mt-1" value={editBreak} onChange={(event) => setEditBreak(event.target.value)} /></label><label className="text-sm font-semibold">수정 사유<input className="field mt-1" value={editReason} onChange={(event) => setEditReason(event.target.value)} required /></label><div className="flex gap-2 sm:col-span-2"><button type="submit" className="primary-button flex-1" disabled={saving}>저장</button><button type="button" className="secondary-button" onClick={() => setSelectedShift(null)}>취소</button></div></form> : null}
      </>}

      <div className="grid gap-5">
        {activeSection === "nfc" && <>
        <div className="panel p-4"><h2 className="mb-3 flex items-center gap-2 text-lg font-bold"><Nfc size={20} />NFC 정보</h2><form className="flex gap-2" onSubmit={createTag}><input className="field flex-1" aria-label="새 NFC 태그 이름" placeholder="예: 카운터 출퇴근" value={tagName} onChange={(event) => setTagName(event.target.value)} required /><button type="submit" className="primary-button" aria-label="NFC 태그 만들기" disabled={saving}><Plus size={18} /></button></form>{newTag ? <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:bg-amber-950"><p className="font-bold">NFC 스티커에 이 HTTPS URL을 기록하세요. 다시 표시되지 않습니다.</p><code className="mt-2 block break-all select-all">{attendanceTagUrl(newTag.token, ATTENDANCE_LINK_HOST)}</code><button type="button" className="secondary-button mt-2" onClick={() => void navigator.clipboard.writeText(attendanceTagUrl(newTag.token, ATTENDANCE_LINK_HOST))}>URL 복사</button><button type="button" className="secondary-button mt-2 ml-2" onClick={() => void writeNewTagToNfc()} disabled={nfcWriting || !isNativeNfcAvailable()}>{nfcWriting ? "태그 기록 중..." : "앱에서 NFC에 저장"}</button>{import.meta.env.MODE === "staging" && <button type="button" className="secondary-button mt-2 ml-2" onClick={() => void testNewTag()} disabled={saving || nfcWriting}>테스트</button>}<p className="mt-2 text-xs text-slate-500">{isNativeNfcAvailable() ? "NFC 태그를 휴대폰에 대면 이 URL을 직접 기록합니다." : "NFC 저장은 iOS·Android 앱에서 사용할 수 있습니다."}{import.meta.env.MODE === "staging" ? " 테스트는 NFC 없이 실제 근태 기록을 생성합니다 (테스트 매장 전용)." : null}</p></div> : null}<div className="mt-3 space-y-2">{tags.map((tag) => <div key={tag.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-slate-100 p-2 dark:bg-slate-900"><span className="min-w-0 break-words"><strong>{tag.name}</strong> · {tag.is_active ? "활성" : "비활성"}</span><span className="flex flex-wrap gap-1"><button type="button" className="secondary-button p-2" onClick={() => void editTag(tag)} aria-label="태그 이름 수정" title="태그 이름 수정"><Pencil size={15} /></button><button type="button" className="secondary-button px-2" onClick={() => void toggleTag(tag)}>{tag.is_active ? "중지" : "활성"}</button><button type="button" className="secondary-button px-2" onClick={() => void rotateTag(tag)} disabled={saving}>재발급</button><button type="button" className="secondary-button p-2" onClick={() => void deleteTag(tag)} disabled={saving} aria-label={`${tag.name} 태그 삭제`} title={`${tag.name} 태그 삭제`}><Trash2 size={15} /></button></span></div>)}</div></div>
        </>}

        {activeSection === "schedule" && <>
        <div className="panel p-4"><h2 className="mb-3 text-lg font-bold">반복·예외 근무 일정</h2><form className="grid gap-2 sm:grid-cols-2" onSubmit={addSchedule}><select className="field sm:col-span-2" value={scheduleUser} onChange={(event) => setScheduleUser(event.target.value)}>{staff.map((entry) => <option key={entry.id} value={entry.id}>{entry.display_name}</option>)}</select><label className="text-sm">요일<select className="field mt-1" value={scheduleWeekday} onChange={(event) => setScheduleWeekday(event.target.value)}>{WEEKDAYS.map((day, index) => <option key={day} value={index}>{day}요일</option>)}</select></label><label className="text-sm">적용 시작<input type="date" className="field mt-1" value={scheduleFrom} onChange={(event) => setScheduleFrom(event.target.value)} /></label><label className="text-sm">출근<input type="time" className="field mt-1" value={scheduleStart} onChange={(event) => setScheduleStart(event.target.value)} /></label><label className="text-sm">퇴근<input type="time" className="field mt-1" value={scheduleEnd} onChange={(event) => setScheduleEnd(event.target.value)} /></label><label className="text-sm">무급휴게(분)<input type="number" className="field mt-1" value={scheduleBreak} onChange={(event) => setScheduleBreak(event.target.value)} /></label><button type="submit" className="primary-button self-end" disabled={saving}>반복 일정 추가</button></form><form className="mt-3 grid gap-2 sm:grid-cols-2" onSubmit={addOverride}><label className="text-sm">예외 날짜<input type="date" className="field mt-1" value={overrideDate} onChange={(event) => setOverrideDate(event.target.value)} /></label><label className="flex items-center gap-2 self-end py-3 text-sm font-bold"><input type="checkbox" checked={overrideDayOff} onChange={(event) => setOverrideDayOff(event.target.checked)} />휴무</label><button type="submit" className="secondary-button sm:col-span-2" disabled={saving}>날짜별 예외 저장</button></form><div className="mt-3 text-sm">{schedules.map((item) => <p key={item.id}>{staffById.get(item.user_id)?.display_name} · {WEEKDAYS[item.weekday]} {item.start_time.slice(0, 5)}~{item.end_time.slice(0, 5)}</p>)}{overrides.map((item) => <p key={item.id} className="text-amber-700 dark:text-amber-300">예외 {item.work_date} · {staffById.get(item.user_id)?.display_name} · {item.is_day_off ? "휴무" : `${item.start_time?.slice(0, 5)}~${item.end_time?.slice(0, 5)}`}</p>)}</div></div>
        </>}

        {activeSection === "payroll" && <>
        <div className="panel p-4 lg:col-span-2"><h2 className="mb-3 text-lg font-bold">급여 기준</h2><div className="grid gap-4 lg:grid-cols-2"><form className="grid gap-2 sm:grid-cols-2" onSubmit={addRate}><select className="field sm:col-span-2" value={rateUser} onChange={(event) => setRateUser(event.target.value)}>{staff.map((entry) => <option key={entry.id} value={entry.id}>{entry.display_name}</option>)}</select><label className="text-sm">시급<input type="number" min="0" className="field mt-1" value={hourlyWage} onChange={(event) => setHourlyWage(event.target.value)} required disabled={currentRole !== "store_admin"} /></label><label className="text-sm">주 소정근로시간(분)<input type="number" min="0" max="10080" className="field mt-1" value={weeklyContractedMinutes} onChange={(event) => setWeeklyContractedMinutes(event.target.value)} required disabled={currentRole !== "store_admin"} /></label><label className="text-sm">적용 시작일<input type="date" className="field mt-1" value={rateFrom} onChange={(event) => setRateFrom(event.target.value)} disabled={currentRole !== "store_admin"} /></label><button type="submit" className="primary-button sm:col-span-2" disabled={saving || currentRole !== "store_admin"}>시급 이력 추가</button></form><form className="grid gap-2 sm:grid-cols-2" onSubmit={addWeeklyAllowance}><label className="text-sm">주 시작일<input type="date" className="field mt-1" value={weekStart} onChange={(event) => setWeekStart(event.target.value)} /></label><label className="text-sm sm:col-span-2">주휴수당은 시급·주 소정근로시간으로 서버에서 계산됩니다.</label><button type="submit" className="secondary-button sm:col-span-2" disabled={saving}>주휴 대상 확정</button></form></div><div className="mt-3 flex flex-wrap items-center justify-between gap-2"><p className="text-xs text-slate-500">시급과 법정수당 기준은 관리자만 수정할 수 있습니다. 주휴수당은 소정근로일 개근 여부 확인 후 확정하세요.</p>{currentRole === "store_admin" && !currentRule?.is_confirmed ? <button type="button" className="secondary-button" onClick={() => void confirmPayrollRules()} disabled={saving}>기본 법정수당 기준 확정</button> : null}</div></div>
        </>}
      </div>
    </section>
  );
}
