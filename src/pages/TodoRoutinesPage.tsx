import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, CheckCircle2, Plus, Trash2 } from "lucide-react";
import { PageTitle } from "../components/PageTitle";
import { StatusMessage } from "../components/StatusMessage";
import { getSeoulDateValue, WEEKDAYS } from "../lib/businessCalendar";
import * as Services from "../services";
import type { InventoryCheckTodoSetting, TodoRoutine, TodoRoutineScheduleType } from "../types/domain";

type Props = {
  currentStoreId: string;
};

const SCHEDULE_LABELS: Record<TodoRoutineScheduleType, string> = {
  once: "지정일",
  daily: "일간 루틴",
  weekly: "주간",
  monthly: "월간",
  interval: "기간 임의 지정"
};

function routineDescription(routine: TodoRoutine) {
  if (routine.schedule_type === "once") return routine.target_date ?? "-";
  if (routine.schedule_type === "daily") return "매일";
  if (routine.schedule_type === "weekly") return `매주 ${WEEKDAYS[routine.weekday ?? 0].label}`;
  if (routine.schedule_type === "interval") return `${routine.interval_days ?? 1}일마다`;
  return `매월 ${routine.month_day ?? 1}일`;
}

export function TodoRoutinesPage({ currentStoreId }: Props) {
  const todayValue = useMemo(() => getSeoulDateValue(), []);
  const [routines, setRoutines] = useState<TodoRoutine[]>([]);
  const [inventoryCheckEnabled, setInventoryCheckEnabled] = useState(false);
  const [inventoryCheckThresholdDays, setInventoryCheckThresholdDays] = useState("30");
  const [content, setContent] = useState("");
  const [scheduleType, setScheduleType] = useState<TodoRoutineScheduleType>("once");
  const [targetDate, setTargetDate] = useState(todayValue);
  const [weekday, setWeekday] = useState(() => new Date(`${todayValue}T00:00:00`).getDay());
  const [monthDay, setMonthDay] = useState(() => Number(todayValue.slice(-2)));
  const [intervalDays, setIntervalDays] = useState("10");
  const [startsOn, setStartsOn] = useState(todayValue);
  const [endsOn, setEndsOn] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settingSaving, setSettingSaving] = useState(false);
  const [actioningIds, setActioningIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const loadRoutines = useCallback(async () => {
    setLoading(true);
    setError("");
    const [routineResult, settingResult] = await Promise.all([
      Services.DatabaseService.select("todo_routines", "*")
        .eq("store_id", currentStoreId)
        .order("is_active", { ascending: false })
        .order("created_at", { ascending: false }),
      Services.DatabaseService.select("inventory_check_todo_settings", "*")
        .eq("store_id", currentStoreId)
        .maybeSingle()
    ]);

    const loadError = routineResult.error ?? settingResult.error;

    if (loadError) {
      setError(
        loadError.message.includes("todo_routines")
          ? "To do list 루틴용 데이터베이스 업데이트가 필요합니다."
          : loadError.message.includes("inventory_check_todo_settings")
            || loadError.message.includes("stale_inventory_product_id")
            || loadError.message.includes("schema cache")
            ? "오래된 재고 파악 To do 기능용 데이터베이스 업데이트가 필요합니다."
            : loadError.message
      );
    } else {
      const setting = (settingResult.data as InventoryCheckTodoSetting | null) ?? null;
      setRoutines((routineResult.data ?? []) as TodoRoutine[]);
      setInventoryCheckEnabled(setting?.is_enabled ?? false);
      setInventoryCheckThresholdDays(String(setting?.threshold_days ?? 30));
    }
    setLoading(false);
  }, [currentStoreId]);

  useEffect(() => {
    void loadRoutines();
  }, [loadRoutines]);

  async function addRoutine(event: FormEvent) {
    event.preventDefault();
    const trimmedContent = content.trim();
    if (!trimmedContent) {
      setError("할 일을 입력해 주세요.");
      return;
    }
    const parsedIntervalDays = Number(intervalDays);
    if (scheduleType === "interval" && (!Number.isInteger(parsedIntervalDays) || parsedIntervalDays < 1)) {
      setError("반복 간격은 1일 이상 정수로 입력해 주세요.");
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");
    const { data: userData } = await Services.AuthService.getUser();
    if (!userData.user) {
      setError("로그인이 필요합니다.");
      setSaving(false);
      return;
    }

    const { error: insertError } = await Services.DatabaseService.insert("todo_routines", {
      store_id: currentStoreId,
      content: trimmedContent,
      schedule_type: scheduleType,
      target_date: scheduleType === "once" ? targetDate : null,
      weekday: scheduleType === "weekly" ? weekday : null,
      month_day: scheduleType === "monthly" ? monthDay : null,
      interval_days: scheduleType === "interval" ? parsedIntervalDays : null,
      starts_on: scheduleType === "once" ? targetDate : startsOn,
      ends_on: endsOn || null,
      created_by: userData.user.id
    });

    if (insertError) {
      setError(insertError.message);
    } else {
      setContent("");
      setMessage("To do list 루틴을 추가했습니다.");
      await loadRoutines();
    }
    setSaving(false);
  }

  async function saveInventoryCheckSetting(event: FormEvent) {
    event.preventDefault();
    const thresholdDays = Number(inventoryCheckThresholdDays);
    if (!Number.isInteger(thresholdDays) || thresholdDays < 1) {
      setError("재고 파악 기준 기간은 1일 이상 정수로 입력해 주세요.");
      return;
    }

    setSettingSaving(true);
    setError("");
    setMessage("");
    const { error: saveError } = await Services.DatabaseService.upsert(
      "inventory_check_todo_settings",
      {
        store_id: currentStoreId,
        is_enabled: inventoryCheckEnabled,
        threshold_days: thresholdDays,
        updated_at: new Date().toISOString()
      },
      { onConflict: "store_id" }
    );

    if (saveError) {
      setError(
        saveError.message.includes("inventory_check_todo_settings") || saveError.message.includes("schema cache")
          ? "오래된 재고 파악 To do 기능용 데이터베이스 업데이트가 필요합니다."
          : saveError.message
      );
    } else {
      if (!inventoryCheckEnabled) {
        const { error: cleanupError } = await Services.DatabaseService.delete("dashboard_todos")
          .eq("store_id", currentStoreId)
          .eq("is_completed", false)
          .not("stale_inventory_product_id", "is", null);

        if (cleanupError) {
          setError(cleanupError.message.includes("stale_inventory_product_id") ? "오래된 재고 파악 To do 기능용 데이터베이스 업데이트가 필요합니다." : cleanupError.message);
          setSettingSaving(false);
          return;
        }
      }
      setMessage("오래된 재고 파악 설정을 저장했습니다.");
      await loadRoutines();
    }
    setSettingSaving(false);
  }

  async function toggleRoutine(routine: TodoRoutine) {
    setActioningIds((current) => new Set(current).add(routine.id));
    setError("");
    const { error: updateError } = await Services.DatabaseService.update("todo_routines", {
      is_active: !routine.is_active,
      updated_at: new Date().toISOString()
    }).eq("id", routine.id);

    if (updateError) {
      setError(updateError.message);
    } else {
      setRoutines((current) => current.map((item) => (item.id === routine.id ? { ...item, is_active: !item.is_active } : item)));
    }
    setActioningIds((current) => {
      const next = new Set(current);
      next.delete(routine.id);
      return next;
    });
  }

  async function deleteRoutine(routine: TodoRoutine) {
    if (!window.confirm(`"${routine.content}" 루틴을 삭제할까요? 이미 홈에 생성된 할 일은 유지됩니다.`)) return;

    setActioningIds((current) => new Set(current).add(routine.id));
    setError("");
    const { error: deleteError } = await Services.DatabaseService.delete("todo_routines").eq("id", routine.id);

    if (deleteError) {
      setError(deleteError.message);
    } else {
      setRoutines((current) => current.filter((item) => item.id !== routine.id));
    }
    setActioningIds((current) => {
      const next = new Set(current);
      next.delete(routine.id);
      return next;
    });
  }

  return (
    <section>
      <PageTitle title="To do list" description="지정일, 일간, 주간, 월간, 기간 임의 지정 루틴으로 홈 화면에 노출될 할 일을 관리합니다." />

      {error ? <div className="mb-3"><StatusMessage type="error">{error}</StatusMessage></div> : null}
      {message ? <div className="mb-3"><StatusMessage type="success">{message}</StatusMessage></div> : null}

      <form onSubmit={saveInventoryCheckSetting} className="panel mb-4 p-4">
        <div className="mb-4 flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-lg bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-100">
            <CheckCircle2 size={21} />
          </span>
          <div>
            <h2 className="font-extrabold">오래된 재고 파악</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">설정한 기간 동안 재고 작업이 없던 품목을 홈 To do list에 표시합니다.</p>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
          <label className="flex min-h-11 items-center gap-2 rounded-md border border-slate-200 px-3 dark:border-slate-800">
            <input
              type="checkbox"
              checked={inventoryCheckEnabled}
              onChange={(event) => setInventoryCheckEnabled(event.target.checked)}
              className="h-5 w-5 accent-brand-600"
            />
            <span className="text-sm font-bold">홈 To do list에 오래된 재고 파악 항목 표시</span>
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-bold">기준 기간</span>
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
              <input
                className="field"
                type="number"
                min={1}
                step={1}
                value={inventoryCheckThresholdDays}
                onChange={(event) => setInventoryCheckThresholdDays(event.target.value)}
                disabled={!inventoryCheckEnabled}
              />
              <span className="text-sm font-bold text-slate-500 dark:text-slate-400">일</span>
            </div>
          </label>
        </div>

        <button type="submit" className="primary-button mt-4 inline-flex w-full items-center justify-center gap-2" disabled={settingSaving}>
          <CheckCircle2 size={18} />
          {settingSaving ? "저장 중..." : "설정 저장"}
        </button>
      </form>

      <form onSubmit={addRoutine} className="panel mb-4 p-4">
        <div className="mb-4 flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-lg bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-100">
            <CalendarDays size={21} />
          </span>
          <div>
            <h2 className="font-extrabold">새 루틴 추가</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">날짜가 도래하면 홈 To do list에 자동으로 표시됩니다.</p>
          </div>
        </div>

        <label className="block">
          <span className="mb-1 block text-sm font-bold">할 일</span>
          <input className="field" value={content} onChange={(event) => setContent(event.target.value)} placeholder="예: 냉장 쇼케이스 점검" />
        </label>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-sm font-bold">반복 방식</span>
            <select className="field" value={scheduleType} onChange={(event) => setScheduleType(event.target.value as TodoRoutineScheduleType)}>
              <option value="once">지정일</option>
              <option value="daily">일간 루틴</option>
              <option value="weekly">주간 루틴</option>
              <option value="monthly">월간 루틴</option>
              <option value="interval">기간 임의 지정</option>
            </select>
          </label>

          {scheduleType === "once" ? (
            <label className="block">
              <span className="mb-1 block text-sm font-bold">지정 날짜</span>
              <input className="field" type="date" value={targetDate} onChange={(event) => setTargetDate(event.target.value)} />
            </label>
          ) : null}

          {scheduleType === "weekly" ? (
            <label className="block">
              <span className="mb-1 block text-sm font-bold">요일</span>
              <select className="field" value={weekday} onChange={(event) => setWeekday(Number(event.target.value))}>
                {WEEKDAYS.map((weekdayOption) => <option key={weekdayOption.value} value={weekdayOption.value}>{weekdayOption.label}</option>)}
              </select>
            </label>
          ) : null}

          {scheduleType === "monthly" ? (
            <label className="block">
              <span className="mb-1 block text-sm font-bold">매월 날짜</span>
              <input className="field" type="number" min={1} max={31} value={monthDay} onChange={(event) => setMonthDay(Number(event.target.value))} />
            </label>
          ) : null}

          {scheduleType === "interval" ? (
            <label className="block">
              <span className="mb-1 block text-sm font-bold">반복 간격</span>
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
                <input className="field" type="number" min={1} step={1} value={intervalDays} onChange={(event) => setIntervalDays(event.target.value)} />
                <span className="text-sm font-bold text-slate-500 dark:text-slate-400">일마다</span>
              </div>
            </label>
          ) : null}
        </div>

        {scheduleType !== "once" ? (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-sm font-bold">시작일</span>
              <input className="field" type="date" value={startsOn} onChange={(event) => setStartsOn(event.target.value)} />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-bold">종료일</span>
              <input className="field" type="date" value={endsOn} onChange={(event) => setEndsOn(event.target.value)} />
            </label>
          </div>
        ) : null}

        <button type="submit" className="primary-button mt-4 inline-flex w-full items-center justify-center gap-2" disabled={saving || !content.trim()}>
          <Plus size={18} />
          {saving ? "저장 중..." : "루틴 저장"}
        </button>
      </form>

      <div className="panel overflow-hidden">
        {loading ? <div className="p-4"><StatusMessage>To do list 루틴을 불러오는 중...</StatusMessage></div> : null}
        {!loading && routines.length === 0 ? <div className="p-4"><StatusMessage>등록된 To do list 루틴이 없습니다.</StatusMessage></div> : null}
        {routines.map((routine) => (
          <div key={routine.id} className="flex min-w-0 items-center gap-3 border-b border-slate-100 p-4 last:border-0 dark:border-slate-800">
            <button
              type="button"
              disabled={actioningIds.has(routine.id)}
              onClick={() => void toggleRoutine(routine)}
              className={`grid h-9 w-9 shrink-0 place-items-center rounded-md border ${routine.is_active ? "border-brand-600 bg-brand-600 text-white" : "border-slate-300 text-slate-400 dark:border-slate-700"}`}
              aria-label={routine.is_active ? "루틴 비활성화" : "루틴 활성화"}
            >
              <CheckCircle2 size={18} />
            </button>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className={`break-words text-sm font-extrabold ${routine.is_active ? "" : "text-slate-400 line-through"}`}>{routine.content}</p>
                <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                  {SCHEDULE_LABELS[routine.schedule_type]}
                </span>
              </div>
              <p className="mt-1 text-xs font-semibold text-slate-500 dark:text-slate-400">
                {routineDescription(routine)}
                {routine.schedule_type !== "once" ? ` · ${routine.starts_on}부터${routine.ends_on ? ` ${routine.ends_on}까지` : ""}` : ""}
              </p>
            </div>
            <button
              type="button"
              disabled={actioningIds.has(routine.id)}
              onClick={() => void deleteRoutine(routine)}
              className="touch-button grid shrink-0 place-items-center text-slate-400 hover:text-red-600 disabled:opacity-40 dark:hover:text-red-400"
              aria-label={`${routine.content} 삭제`}
              title="삭제"
            >
              <Trash2 size={18} />
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
