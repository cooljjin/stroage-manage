import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, ChevronRight, Plus, Trash2 } from "lucide-react";
import { PageTitle } from "../components/PageTitle";
import { StatusMessage } from "../components/StatusMessage";
import { getSeoulDateValue, WEEKDAYS } from "../lib/businessCalendar";
import { supabase } from "../lib/supabase";
import type { StoreClosureDate, WeeklyStoreClosure } from "../types/domain";

function closureDateLabel(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short"
  }).format(new Date(`${value}T00:00:00`));
}

export function SettingsPage() {
  const todayValue = useMemo(() => getSeoulDateValue(), []);
  const [weeklyClosures, setWeeklyClosures] = useState<WeeklyStoreClosure[]>([]);
  const [specificClosures, setSpecificClosures] = useState<StoreClosureDate[]>([]);
  const [closureDate, setClosureDate] = useState("");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const closedWeekdays = useMemo(() => new Set(weeklyClosures.map((item) => item.weekday)), [weeklyClosures]);

  const loadClosures = useCallback(async () => {
    setLoading(true);
    setError("");
    const [weeklyResult, specificResult] = await Promise.all([
      supabase.from("weekly_store_closures").select("*").order("weekday", { ascending: true }),
      supabase.from("store_closure_dates").select("*").gte("closure_date", todayValue).order("closure_date", { ascending: true })
    ]);

    const loadError = weeklyResult.error ?? specificResult.error;
    if (loadError) {
      setError(
        loadError.message.includes("weekly_store_closures") || loadError.message.includes("store_closure_dates")
          ? "휴무일용 데이터베이스 업데이트가 필요합니다."
          : loadError.message
      );
    } else {
      setWeeklyClosures((weeklyResult.data ?? []) as WeeklyStoreClosure[]);
      setSpecificClosures((specificResult.data ?? []) as StoreClosureDate[]);
    }
    setLoading(false);
  }, [todayValue]);

  useEffect(() => {
    void loadClosures();
  }, [loadClosures]);

  async function toggleWeeklyClosure(weekday: number) {
    setSavingKey(`weekday-${weekday}`);
    setError("");
    setMessage("");

    if (closedWeekdays.has(weekday)) {
      const { error: deleteError } = await supabase.from("weekly_store_closures").delete().eq("weekday", weekday);
      if (deleteError) {
        setError(deleteError.message);
      } else {
        setMessage(`${WEEKDAYS[weekday].label} 정기 휴무를 해제했습니다.`);
        await loadClosures();
      }
    } else {
      if (closedWeekdays.size >= 6) {
        setError("최소 한 요일은 영업일로 남겨야 합니다.");
        setSavingKey(null);
        return;
      }
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) {
        setError("로그인이 필요합니다.");
      } else {
        const { error: insertError } = await supabase.from("weekly_store_closures").insert({
          weekday,
          created_by: userData.user.id
        });
        if (insertError) {
          setError(insertError.message);
        } else {
          setMessage(`${WEEKDAYS[weekday].label}을 정기 휴무로 지정했습니다.`);
          await loadClosures();
        }
      }
    }

    setSavingKey(null);
  }

  async function addSpecificClosure(event: FormEvent) {
    event.preventDefault();
    if (!closureDate) return;

    setSavingKey("specific");
    setError("");
    setMessage("");
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      setError("로그인이 필요합니다.");
      setSavingKey(null);
      return;
    }

    const { error: insertError } = await supabase.from("store_closure_dates").insert({
      closure_date: closureDate,
      reason: reason.trim() || null,
      created_by: userData.user.id
    });

    if (insertError) {
      setError(insertError.code === "23505" ? "이미 휴무일로 지정된 날짜입니다." : insertError.message);
    } else {
      setClosureDate("");
      setReason("");
      setMessage("특정 휴무일을 추가했습니다.");
      await loadClosures();
    }
    setSavingKey(null);
  }

  async function deleteSpecificClosure(item: StoreClosureDate) {
    if (!window.confirm(`${closureDateLabel(item.closure_date)} 휴무를 삭제할까요?`)) return;

    setSavingKey(`date-${item.closure_date}`);
    setError("");
    setMessage("");
    const { error: deleteError } = await supabase.from("store_closure_dates").delete().eq("closure_date", item.closure_date);
    if (deleteError) {
      setError(deleteError.message);
    } else {
      setMessage("특정 휴무일을 삭제했습니다.");
      await loadClosures();
    }
    setSavingKey(null);
  }

  return (
    <section>
      <PageTitle title="환경설정" description="매장 운영에 필요한 설정을 관리합니다." />

      {loading ? <StatusMessage>환경설정을 불러오는 중...</StatusMessage> : null}
      {error ? <div className="mb-3"><StatusMessage type="error">{error}</StatusMessage></div> : null}
      {message ? <div className="mb-3"><StatusMessage type="success">{message}</StatusMessage></div> : null}

      {!loading ? (
        <div className="space-y-4">
          <div className="panel overflow-hidden">
            <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-4 dark:border-slate-800">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-100">
                <CalendarDays size={21} />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="font-extrabold">매장 휴무일 지정</h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">기존 미래 할 일과 인수인계도 다음 영업일로 자동 이동합니다.</p>
              </div>
              <ChevronRight className="text-slate-400" size={18} />
            </div>

            <div className="space-y-6 p-4">
              <div>
                <h3 className="text-sm font-extrabold">매주 반복 휴무</h3>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">매주 쉬는 요일을 모두 선택하세요.</p>
                <div className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-7">
                  {WEEKDAYS.map((day) => {
                    const selected = closedWeekdays.has(day.value);
                    return (
                      <button
                        key={day.value}
                        type="button"
                        disabled={savingKey !== null}
                        onClick={() => void toggleWeeklyClosure(day.value)}
                        aria-pressed={selected}
                        className={`min-h-12 rounded-md border text-sm font-extrabold disabled:opacity-50 ${
                          selected
                            ? "border-brand-600 bg-brand-600 text-white"
                            : "border-slate-300 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
                        }`}
                      >
                        {day.shortLabel}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="border-t border-slate-100 pt-5 dark:border-slate-800">
                <h3 className="text-sm font-extrabold">특정 날짜 휴무</h3>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">공휴일이나 매장 사정으로 쉬는 날짜를 추가하세요.</p>

                <form onSubmit={addSpecificClosure} className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,180px)_1fr_auto]">
                  <input
                    type="date"
                    className="field"
                    min={todayValue}
                    value={closureDate}
                    onChange={(event) => setClosureDate(event.target.value)}
                    aria-label="휴무 날짜"
                  />
                  <input
                    className="field"
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    placeholder="사유 (선택)"
                  />
                  <button
                    type="submit"
                    disabled={!closureDate || savingKey !== null}
                    className="primary-button inline-flex items-center justify-center gap-2 sm:min-w-24"
                  >
                    <Plus size={18} />
                    추가
                  </button>
                </form>

                <div className="mt-4 space-y-2">
                  {specificClosures.map((item) => (
                    <div key={item.closure_date} className="flex items-center gap-3 rounded-md border border-slate-200 p-3 dark:border-slate-800">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-bold">{closureDateLabel(item.closure_date)}</p>
                        <p className="truncate text-xs text-slate-500 dark:text-slate-400">{item.reason || "사유 없음"}</p>
                      </div>
                      <button
                        type="button"
                        disabled={savingKey !== null}
                        onClick={() => void deleteSpecificClosure(item)}
                        className="touch-button grid shrink-0 place-items-center text-slate-400 hover:text-red-600 disabled:opacity-40 dark:hover:text-red-400"
                        aria-label={`${closureDateLabel(item.closure_date)} 휴무 삭제`}
                        title="삭제"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  ))}
                  {specificClosures.length === 0 ? <StatusMessage>등록된 특정 휴무일이 없습니다.</StatusMessage> : null}
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-md border border-dashed border-slate-300 px-4 py-5 text-center text-xs font-semibold text-slate-400 dark:border-slate-700">
            새로운 환경설정 기능이 이곳에 추가됩니다.
          </div>
        </div>
      ) : null}
    </section>
  );
}
