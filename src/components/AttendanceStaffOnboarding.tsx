import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { StatusMessage } from "./StatusMessage";
import * as Services from "../services";
import type { ProfileRole, StoreInvite } from "../types/domain";
import type { Database } from "../types/supabase";
import { useCalendarDateSelection } from "../hooks/useCalendarDateSelection";

type Row<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Row"];
type StaffEntry = { id: string; display_name: string; role: ProfileRole };
type Step = "home" | "person" | "dates" | "time";
type Props = {
  currentStoreId: string;
  staff: StaffEntry[];
  schedules: Row<"attendance_work_schedules">[];
  overrides: Row<"attendance_schedule_overrides">[];
  month: string;
  onChangeMonth: (offset: number) => void;
  onScheduleExisting: (userId: string, day?: string) => void;
  startSignal: number;
  refreshSignal: number;
  hideHomeCalendar?: boolean;
  onUpdated?: () => void;
};

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

function todayValue() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function dayOfWeek(value: string) {
  return new Date(`${value}T00:00:00Z`).getUTCDay();
}

function daysForMonth(month: string) {
  const [year, number] = month.split("-").map(Number);
  const count = new Date(Date.UTC(year, number, 0)).getUTCDate();
  const blanks = new Date(Date.UTC(year, number - 1, 1)).getUTCDay();
  return [...Array<null>(blanks).fill(null), ...Array.from({ length: count }, (_, index) => `${month.slice(0, 7)}-${String(index + 1).padStart(2, "0")}`)];
}

function minuteValue(time: string) {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

function shortDate(value: string) {
  return `${Number(value.slice(5, 7))}월 ${Number(value.slice(8, 10))}일`;
}

export function AttendanceStaffOnboarding({ currentStoreId, staff, schedules, overrides, month, onChangeMonth, onScheduleExisting, startSignal, refreshSignal, hideHomeCalendar = false, onUpdated }: Props) {
  const [step, setStep] = useState<Step>("home");
  const [pending, setPending] = useState<Row<"attendance_pending_staff">[]>([]);
  const [pendingDates, setPendingDates] = useState<Row<"attendance_pending_staff_dates">[]>([]);
  const [selectedPending, setSelectedPending] = useState<Row<"attendance_pending_staff"> | null>(null);
  const [selectedHomeDates, setSelectedHomeDates] = useState<string[]>(() => [todayValue()]);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [selectedDates, setSelectedDates] = useState<string[]>([]);
  const homeCalendarSelection = useCalendarDateSelection(selectedHomeDates, setSelectedHomeDates);
  const workDateSelection = useCalendarDateSelection(selectedDates, setSelectedDates);
  const calendarSelection = step === "dates" ? workDateSelection : homeCalendarSelection;
  const [repeatDays, setRepeatDays] = useState<number[]>([]);
  const [repeatFrom, setRepeatFrom] = useState(todayValue());
  const [repeatUntil, setRepeatUntil] = useState(() => {
    const today = todayValue();
    const [year, monthNumber] = today.split("-").map(Number);
    return new Date(Date.UTC(year, monthNumber + 1, 0)).toISOString().slice(0, 10);
  });
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("18:00");
  const [breakMinutes, setBreakMinutes] = useState(60);
  const [inviteAfterSave, setInviteAfterSave] = useState(false);
  const [invite, setInvite] = useState<StoreInvite | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const loadPending = useCallback(async () => {
    setLoading(true);
    const [peopleResult, datesResult] = await Promise.all([
      Services.DatabaseService.select("attendance_pending_staff", "*").eq("store_id", currentStoreId).order("display_name"),
      Services.DatabaseService.select("attendance_pending_staff_dates", "*").eq("store_id", currentStoreId).order("work_date")
    ]);
    if (peopleResult.error || datesResult.error) {
      setError("직원 등록 정보를 불러오지 못했습니다. staging 데이터베이스 업데이트가 필요할 수 있습니다.");
    } else {
      setPending((peopleResult.data ?? []) as Row<"attendance_pending_staff">[]);
      setPendingDates((datesResult.data ?? []) as Row<"attendance_pending_staff_dates">[]);
    }
    setLoading(false);
  }, [currentStoreId]);

  useEffect(() => { void loadPending(); }, [loadPending]);
  useEffect(() => { if (refreshSignal > 0) void loadPending(); }, [refreshSignal, loadPending]);
  useEffect(() => {
    if (startSignal === 0) return;
    setStep("person"); setSelectedPending(null); setName(""); setPhone("");
    setSelectedDates([]); setRepeatDays([]); setInviteAfterSave(false);
    setStartTime("09:00"); setEndTime("18:00"); setBreakMinutes(60);
    setError(""); setMessage(""); setInvite(null);
  }, [startSignal]);

  const plannedDates = useMemo(() => {
    const dates = new Set(selectedDates);
    if (repeatDays.length && repeatFrom <= repeatUntil) {
      const date = new Date(`${repeatFrom}T00:00:00Z`);
      const until = new Date(`${repeatUntil}T00:00:00Z`);
      for (; date <= until && dates.size <= 100; date.setUTCDate(date.getUTCDate() + 1)) {
        if (repeatDays.includes(date.getUTCDay())) dates.add(date.toISOString().slice(0, 10));
      }
    }
    return [...dates].sort();
  }, [repeatDays, repeatFrom, repeatUntil, selectedDates]);

  const calendarDays = useMemo(() => daysForMonth(month), [month]);
  const linkedStaff = staff.filter((entry) => entry.role === "staff");
  const activePending = pending.filter((entry) => !entry.linked_profile_id);
  const pendingNames = new Map(pending.map((entry) => [entry.id, entry.display_name]));

  function displaySchedule(day: string) {
    const results: { key: string; name: string; time: string; userId?: string; pendingId?: string }[] = [];
    for (const entry of linkedStaff) {
      const exception = overrides.find((item) => item.user_id === entry.id && item.work_date === day);
      if (exception?.is_day_off) continue;
      const routine = schedules.filter((item) => item.user_id === entry.id && item.weekday === dayOfWeek(day) && item.effective_from <= day && (!item.effective_to || item.effective_to >= day)).sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0];
      const start = exception?.start_time ?? routine?.start_time;
      const end = exception?.end_time ?? routine?.end_time;
      if (start && end) results.push({ key: `linked-${entry.id}`, name: entry.display_name, time: `${start.slice(0, 5)}–${end.slice(0, 5)}`, userId: entry.id });
    }
    for (const item of pendingDates.filter((date) => date.work_date === day && activePending.some((entry) => entry.id === date.pending_staff_id))) {
      results.push({ key: `pending-${item.id}`, name: pendingNames.get(item.pending_staff_id) ?? "직원", time: `${item.start_time.slice(0, 5)}–${item.end_time.slice(0, 5)}`, pendingId: item.pending_staff_id });
    }
    return results;
  }

  function clearDraft() {
    setStep("home"); setSelectedPending(null); setName(""); setPhone("");
    setSelectedDates([]); setRepeatDays([]); setInviteAfterSave(false);
    setStartTime("09:00"); setEndTime("18:00"); setBreakMinutes(60);
  }

  function beginNew() {
    clearDraft(); setError(""); setMessage(""); setInvite(null); setStep("person");
  }

  function beginPendingSchedule(person: Row<"attendance_pending_staff">, day?: string) {
    clearDraft(); setSelectedPending(person); setSelectedDates(day ? [day] : []);
    setError(""); setMessage(""); setStep("dates");
  }

  async function showInvite(person: Row<"attendance_pending_staff">) {
    setBusy(true); setError(""); setInvite(null);
    const { data, error: createError } = await Services.DatabaseService.rpc("create_attendance_pending_invite", { target_pending_id: person.id });
    if (createError) setError(createError.message);
    else { setInvite(data as StoreInvite); setMessage(`${person.display_name}님 초대코드를 준비했습니다.`); await loadPending(); }
    setBusy(false);
  }

  async function save(skipSchedule = false) {
    if (busy) return;
    const dates = skipSchedule ? [] : plannedDates;
    if (!selectedPending && !name.trim()) { setStep("person"); setError("직원 이름을 입력해 주세요."); return; }
    if (repeatDays.length && repeatFrom > repeatUntil) { setError("반복 종료일을 시작일 이후로 선택해 주세요."); return; }
    if (dates.length > 100) { setError("근무 날짜는 한 번에 100일까지 선택할 수 있습니다."); return; }
    if (dates.length && (minuteValue(endTime) <= minuteValue(startTime) || breakMinutes >= minuteValue(endTime) - minuteValue(startTime))) {
      setError("종료 시간은 시작 시간보다 늦고, 휴게 시간은 전체 근무보다 짧아야 합니다."); return;
    }
    setBusy(true); setError(""); setMessage(""); setInvite(null);
    if (selectedPending) {
      const { error: saveError } = await Services.DatabaseService.rpc("save_attendance_pending_staff_dates", {
        target_pending_id: selectedPending.id, target_dates: dates, target_start_time: startTime,
        target_end_time: endTime, target_break_minutes: breakMinutes
      });
      if (saveError) { setError(saveError.message); setBusy(false); return; }
      setMessage(`${selectedPending.display_name}님의 근무 일정을 저장했습니다.`);
    } else {
      const { data, error: saveError } = await Services.DatabaseService.rpc("create_attendance_pending_staff", {
        target_name: name.trim(), target_phone: phone.trim(), target_dates: dates,
        target_start_time: startTime, target_end_time: endTime, target_break_minutes: breakMinutes
      });
      if (saveError) { setError(saveError.message); setBusy(false); return; }
      setMessage(`${name.trim()}님을 등록했습니다.`);
      if (inviteAfterSave) {
        const { data: inviteData, error: inviteError } = await Services.DatabaseService.rpc("create_attendance_pending_invite", { target_pending_id: (data as Row<"attendance_pending_staff">).id });
        if (inviteError) setError(`직원은 저장됐지만 초대코드를 만들지 못했습니다: ${inviteError.message}`);
        else setInvite(inviteData as StoreInvite);
      }
    }
    clearDraft(); await loadPending(); onUpdated?.(); setBusy(false);
  }

  async function updatePerson(person: Row<"attendance_pending_staff">) {
    if (!editName.trim()) { setError("직원 이름을 입력해 주세요."); return; }
    setBusy(true); setError("");
    const { error: updateError } = await Services.DatabaseService.rpc("update_attendance_pending_staff", {
      target_pending_id: person.id, target_name: editName.trim(), target_phone: editPhone.trim()
    });
    if (updateError) setError(updateError.message);
    else { setEditingId(null); setMessage("직원 정보를 수정했습니다."); await loadPending(); }
    setBusy(false);
  }

  async function deletePerson(person: Row<"attendance_pending_staff">) {
    if (!window.confirm(`${person.display_name}님과 등록한 근무 일정, 미사용 초대코드를 삭제할까요?`)) return;
    setBusy(true); setError("");
    const { error: deleteError } = await Services.DatabaseService.rpc("delete_attendance_pending_staff", { target_pending_id: person.id });
    if (deleteError) setError(deleteError.message);
    else { setInvite(null); setMessage("가입 전 직원을 삭제했습니다."); await loadPending(); onUpdated?.(); }
    setBusy(false);
  }

  const grid = <div className="panel p-3 sm:p-4">
    <div className="mb-3 flex items-center justify-between gap-2">
      <button type="button" className="touch-button icon-button" aria-label="이전 달" title="이전 달" onClick={() => onChangeMonth(-1)}><ChevronLeft size={19} /></button>
      <h2 className="font-bold">{month.slice(0, 4)}년 {Number(month.slice(5, 7))}월</h2>
      <button type="button" className="touch-button icon-button" aria-label="다음 달" title="다음 달" onClick={() => onChangeMonth(1)}><ChevronRight size={19} /></button>
    </div>
    <div className="grid grid-cols-7 text-center text-xs font-bold text-slate-500">{WEEKDAYS.map((day) => <span key={day} className="py-1">{day}</span>)}</div>
    <div className="mt-1 grid grid-cols-7 gap-1 touch-none sm:touch-auto select-none" onPointerMove={calendarSelection.onPointerMove} onPointerUp={calendarSelection.onPointerUp} onPointerCancel={calendarSelection.onPointerCancel}>
      {calendarDays.map((day, index) => {
        if (!day) return <span key={`blank-${index}`} />;
        const selected = step === "dates" ? plannedDates.includes(day) : selectedHomeDates.includes(day);
        return <button key={day} data-calendar-date={day} type="button" aria-pressed={selected}
          onClick={(event) => calendarSelection.onClickDate(day, event)} onPointerDown={(event) => calendarSelection.onPointerDownDate(day, event)}
          className={`min-h-16 min-w-0 rounded-md border p-1 text-left text-xs ${selected ? "border-brand-600 bg-brand-50 dark:bg-brand-950" : "border-slate-200 dark:border-slate-800"}`}>
          <strong>{Number(day.slice(-2))}</strong>
          {step === "home" ? displaySchedule(day).slice(0, 2).map((entry) => <span key={entry.key} className="mt-0.5 block truncate text-[10px]">{entry.name}</span>) : null}
        </button>;
      })}
    </div>
  </div>;

  return <div className="space-y-4">
    {step === "home" ? <div className="flex items-center justify-between gap-2"><div><h2 className="text-lg font-extrabold">근무 일정</h2><p className="text-sm text-slate-500">직원을 등록하고 근무할 날짜와 시간을 정하세요.</p></div><button type="button" className="primary-button inline-flex shrink-0 items-center gap-1" onClick={beginNew}><Plus size={18} /> 새 직원</button></div>
      : <div className="flex items-center gap-3"><button type="button" className="secondary-button" onClick={clearDraft}>취소</button><div><p className="text-xs text-slate-500">{step === "person" ? "1 / 3" : step === "dates" ? "2 / 3" : "3 / 3"}</p><h2 className="text-lg font-extrabold">{step === "person" ? "새 직원 등록" : step === "dates" ? "근무 날짜 선택" : "근무 시간 설정"}</h2></div></div>}
    {error ? <StatusMessage type="error">{error}</StatusMessage> : null}
    {message ? <StatusMessage type="success">{message}</StatusMessage> : null}
    {invite && step === "home" ? <div className="panel space-y-2 p-4"><strong>직원 초대코드</strong><p className="text-sm text-slate-500">직원이 앱에 가입한 뒤 이 코드를 입력하면 등록한 일정이 연결됩니다. {new Date(invite.expires_at).toLocaleDateString("ko-KR")}까지 사용할 수 있습니다.</p><div className="flex gap-2"><input className="field min-w-0 flex-1 text-center font-bold" readOnly value={invite.token} aria-label="직원 초대코드" /><button type="button" className="secondary-button" onClick={() => void navigator.clipboard.writeText(invite.token).then(() => setMessage("초대코드를 복사했습니다.")).catch(() => setError("복사할 수 없습니다. 코드를 직접 선택해 주세요."))}>복사</button></div></div> : null}

    {step === "person" ? <div className="panel space-y-4 p-4">
      <p className="text-sm text-slate-600 dark:text-slate-300">직원 정보를 먼저 입력하세요. 직원의 앱 가입은 나중에 해도 됩니다.</p>
      <label className="block text-sm font-semibold">직원 이름 *<input className="field mt-1 w-full" value={name} maxLength={80} onChange={(event) => setName(event.target.value)} placeholder="예: 김민지" autoFocus /></label>
      <label className="block text-sm font-semibold">연락처 (선택)<input className="field mt-1 w-full" type="tel" value={phone} maxLength={40} onChange={(event) => setPhone(event.target.value)} placeholder="010-0000-0000" /></label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={inviteAfterSave} onChange={(event) => setInviteAfterSave(event.target.checked)} />등록 후 앱 초대코드 만들기</label>
      <button type="button" className="primary-button w-full" disabled={!name.trim()} onClick={() => { setError(""); setStep("dates"); }}>다음: 근무 날짜 선택</button>
    </div> : null}

    {step === "dates" ? <>
      <p className="text-sm text-slate-600 dark:text-slate-300">{selectedPending?.display_name ?? name}님이 일할 날짜를 달력에서 선택하세요. 탭은 하루, 드래그는 시작 날짜 상태에 따라 연속 범위를 선택·해제합니다.</p>
      {grid}
      <div className="panel space-y-3 p-4"><strong>매주 같은 요일에 일하나요?</strong><div className="flex flex-wrap gap-2">{WEEKDAYS.map((day, index) => <button key={day} type="button" aria-pressed={repeatDays.includes(index)} className={repeatDays.includes(index) ? "primary-button !px-3" : "secondary-button !px-3"} onClick={() => setRepeatDays((current) => current.includes(index) ? current.filter((value) => value !== index) : [...current, index])}>{day}</button>)}</div>{repeatDays.length ? <div className="grid gap-2 sm:grid-cols-2"><label className="text-sm">반복 시작일<input className="field mt-1 block w-full" type="date" value={repeatFrom} onChange={(event) => setRepeatFrom(event.target.value)} /></label><label className="text-sm">반복 종료일<input className="field mt-1 block w-full" type="date" min={repeatFrom} value={repeatUntil} onChange={(event) => setRepeatUntil(event.target.value)} /></label></div> : null}<p className="text-sm">선택한 근무일: <strong>{plannedDates.length}일</strong></p></div>
      <div className="grid gap-2 sm:grid-cols-3"><button type="button" className="secondary-button" onClick={() => selectedPending ? clearDraft() : setStep("person")}>이전</button>{!selectedPending ? <button type="button" className="secondary-button" disabled={busy} onClick={() => void save(true)}>직원만 먼저 등록</button> : null}<button type="button" className="primary-button" disabled={!plannedDates.length || plannedDates.length > 100} onClick={() => { setError(""); setStep("time"); }}>다음: 근무 시간</button></div>
    </> : null}

    {step === "time" ? <div className="panel space-y-4 p-4">
      <p className="text-sm">{selectedPending?.display_name ?? name}님 · 근무일 {plannedDates.length}일</p>
      <div className="grid grid-cols-2 gap-3"><label className="text-sm font-semibold">시작 시간<input className="field mt-1 w-full" type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} /></label><label className="text-sm font-semibold">종료 시간<input className="field mt-1 w-full" type="time" value={endTime} onChange={(event) => setEndTime(event.target.value)} /></label></div>
      <label className="block text-sm font-semibold">무급 휴게 시간<select className="field mt-1 w-full" value={breakMinutes} onChange={(event) => setBreakMinutes(Number(event.target.value))}><option value={0}>없음</option><option value={30}>30분</option><option value={60}>1시간</option><option value={90}>1시간 30분</option><option value={120}>2시간</option></select></label>
      <div className="rounded-md bg-slate-100 p-3 text-sm dark:bg-slate-900">{minuteValue(endTime) > minuteValue(startTime) && breakMinutes < minuteValue(endTime) - minuteValue(startTime) ? <>{startTime}–{endTime} · 휴게 {breakMinutes}분 · 하루 {Math.floor((minuteValue(endTime) - minuteValue(startTime) - breakMinutes) / 60)}시간 {(minuteValue(endTime) - minuteValue(startTime) - breakMinutes) % 60}분</> : "근무 시간과 휴게 시간을 확인해 주세요."}</div>
      <div className="flex gap-2"><button type="button" className="secondary-button" onClick={() => setStep("dates")}>이전</button><button type="button" className="primary-button flex-1" disabled={busy || minuteValue(endTime) <= minuteValue(startTime) || breakMinutes >= minuteValue(endTime) - minuteValue(startTime)} onClick={() => void save()}>{busy ? "저장 중..." : selectedPending ? "근무 일정 저장" : "직원과 일정 저장"}</button></div>
    </div> : null}

    {step === "home" ? <>
      {!hideHomeCalendar ? <>{grid}
      <p className="text-sm text-slate-500">날짜 탭은 하루, 드래그는 연속 범위를 선택·해제합니다.</p>
      <div className="panel space-y-2 p-4">{selectedHomeDates.length ? selectedHomeDates.map((day) => {
        const entries = displaySchedule(day);
        return <div key={day} className="border-t border-slate-100 first:border-t-0 dark:border-slate-800"><h3 className="mb-2 font-bold">{shortDate(day)} 근무 예정</h3>{entries.length ? entries.map((entry) => <button type="button" key={entry.key} className="secondary-button mb-2 flex w-full items-center justify-between gap-2 text-left" onClick={() => entry.pendingId ? beginPendingSchedule(pending.find((person) => person.id === entry.pendingId)!, day) : onScheduleExisting(entry.userId!, day)}><span>{entry.name}</span><span>{entry.time}</span></button>) : <p className="mb-2 text-sm text-slate-500">등록된 근무가 없습니다.</p>}</div>;
      }) : <p className="text-sm text-slate-500">선택한 날짜가 없습니다.</p>}</div></> : null}
      {loading ? <StatusMessage>직원 목록을 불러오는 중...</StatusMessage> : null}
      <div className="space-y-3"><h3 className="font-bold">직원</h3>{activePending.map((person) => {
        const dates = pendingDates.filter((item) => item.pending_staff_id === person.id);
        return <div key={person.id} className="panel space-y-3 p-4"><div className="flex items-start justify-between gap-2"><div><strong>{person.display_name}</strong><p className="text-xs text-slate-500">{person.invite_id ? "초대 대기 중" : "앱 초대 전"}{person.phone ? ` · ${person.phone}` : ""}</p></div><button type="button" className="secondary-button shrink-0" onClick={() => beginPendingSchedule(person)}>+ 일정 추가</button></div><p className="text-sm text-slate-500">등록한 근무일 {dates.length}일{dates.length ? ` · ${dates.slice(0, 3).map((item) => shortDate(item.work_date)).join(", ")}` : ""}</p>{editingId === person.id ? <div className="space-y-2"><label className="block text-sm">직원 이름<input className="field mt-1 w-full" value={editName} maxLength={80} onChange={(event) => setEditName(event.target.value)} /></label><label className="block text-sm">연락처<input className="field mt-1 w-full" type="tel" value={editPhone} maxLength={40} onChange={(event) => setEditPhone(event.target.value)} /></label><div className="flex gap-2"><button type="button" className="secondary-button" onClick={() => setEditingId(null)}>취소</button><button type="button" className="primary-button" disabled={busy || !editName.trim()} onClick={() => void updatePerson(person)}>저장</button></div></div> : <div className="flex flex-wrap gap-2"><button type="button" className="secondary-button" onClick={() => { setEditingId(person.id); setEditName(person.display_name); setEditPhone(person.phone ?? ""); }}>정보 수정</button><button type="button" className="secondary-button" disabled={busy} onClick={() => void showInvite(person)}>{person.invite_id ? "초대코드 보기·갱신" : "앱 초대코드 만들기"}</button><button type="button" className="secondary-button text-red-600 dark:text-red-300" disabled={busy} onClick={() => void deletePerson(person)}>삭제</button></div>}</div>;
      })}{linkedStaff.map((entry) => <div key={entry.id} className="panel flex items-center justify-between gap-2 p-4"><div><strong>{entry.display_name}</strong><p className="text-xs text-slate-500">앱 연결 완료</p></div><button type="button" className="secondary-button" onClick={() => onScheduleExisting(entry.id)}>일정 관리</button></div>)}</div>
    </> : null}
  </div>;
}
