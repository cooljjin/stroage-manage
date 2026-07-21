import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, ClipboardCheck, Clock, PackageCheck, StickyNote, Trash2, Users, X } from "lucide-react";
import { PageTitle } from "../components/PageTitle";
import { StatusMessage } from "../components/StatusMessage";
import { addDateValueDays, getDateValueWeekday, getSeoulDateValue } from "../lib/businessCalendar";
import { formatDateTime } from "../lib/date";
import * as Services from "../services";
import type { TimelineDay, TimelineEvent, TimelineEventType, TimelineMonth } from "../services";

type Props = {
  currentStoreId: string;
};

type TimelineSection = {
  type: TimelineEventType;
  label: string;
  icon: typeof PackageCheck;
  className: string;
};

const TIMELINE_SECTIONS: TimelineSection[] = [
  { type: "receipt", label: "입고", icon: PackageCheck, className: "text-emerald-700 dark:text-emerald-200" },
  { type: "group-order", label: "단체주문", icon: Users, className: "text-violet-700 dark:text-violet-200" },
  { type: "prep-production", label: "프랩 제조", icon: CalendarDays, className: "text-brand-700 dark:text-brand-100" },
  { type: "prep-disposal", label: "프랩 폐기", icon: Trash2, className: "text-rose-700 dark:text-rose-200" },
  { type: "inventory-adjustment", label: "재고 실사/조정", icon: ClipboardCheck, className: "text-amber-700 dark:text-amber-200" },
  { type: "todo-completed", label: "To do 완료", icon: CheckCircle2, className: "text-sky-700 dark:text-sky-200" },
  { type: "todo-planned", label: "예정 To do", icon: Clock, className: "text-slate-600 dark:text-slate-300" },
  { type: "memo", label: "메모", icon: StickyNote, className: "text-slate-600 dark:text-slate-300" }
];

function getMonthStart(dateValue: string) {
  return `${dateValue.slice(0, 7)}-01`;
}

function addMonths(monthStart: string, amount: number) {
  const [year, month] = monthStart.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1 + amount, 1));
  return date.toISOString().slice(0, 10);
}

function getCalendarDates(monthStart: string) {
  const firstDate = addDateValueDays(monthStart, -getDateValueWeekday(monthStart));
  return Array.from({ length: 42 }, (_, index) => addDateValueDays(firstDate, index));
}

function formatMonthLabel(value: string) {
  return new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "long", timeZone: "Asia/Seoul" }).format(new Date(`${value}T00:00:00+09:00`));
}

function formatDateLabel(value: string) {
  return new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", weekday: "long", timeZone: "Asia/Seoul" }).format(new Date(`${value}T00:00:00+09:00`));
}

function formatTime(value: string | null) {
  if (!value) return "";
  const parts = formatDateTime(value).split(" ");
  return parts[parts.length - 1] ?? "";
}

function getSectionEvents(day: TimelineDay | undefined, type: TimelineEventType) {
  return day?.events.filter((event) => event.type === type) ?? [];
}

export function TimelineCalendarPage({ currentStoreId }: Props) {
  const todayValue = useMemo(() => getSeoulDateValue(), []);
  const [monthStart, setMonthStart] = useState(() => getMonthStart(todayValue));
  const [timeline, setTimeline] = useState<TimelineMonth | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [openSection, setOpenSection] = useState<TimelineEventType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const calendarDates = useMemo(() => getCalendarDates(monthStart), [monthStart]);
  const selectedDay = selectedDate ? timeline?.days.get(selectedDate) : undefined;

  const loadTimeline = useCallback(async () => {
    setLoading(true);
    setError("");
    const { data, error: loadError } = await Services.TimelineService.getMonthTimeline(currentStoreId, monthStart);
    if (loadError) {
      setError(loadError.message.includes("dashboard_todos") || loadError.message.includes("group_order") || loadError.message.includes("inventory_logs")
        ? "매장 타임라인용 데이터를 불러오지 못했습니다. 데이터베이스 업데이트 상태를 확인해 주세요."
        : loadError.message);
      setTimeline(null);
    } else {
      setTimeline(data);
    }
    setLoading(false);
  }, [currentStoreId, monthStart]);

  useEffect(() => {
    void loadTimeline();
  }, [loadTimeline]);

  function openDay(date: string) {
    setSelectedDate(date);
    setOpenSection(null);
  }

  function closeDay() {
    setSelectedDate(null);
    setOpenSection(null);
  }

  function renderEvent(event: TimelineEvent) {
    const staffName = event.staffId ? timeline?.staffNames.get(event.staffId) ?? "직원" : null;
    return (
      <li key={event.id} className="flex min-w-0 items-start gap-2 border-t border-slate-100 py-2.5 first:border-t-0 dark:border-slate-800">
        <span className="mt-0.5 shrink-0 text-[11px] font-bold tabular-nums text-slate-400">{formatTime(event.occurredAt) || "예정"}</span>
        <div className="min-w-0 flex-1">
          <p className="break-words text-sm font-bold">{event.title}</p>
          <p className="mt-0.5 break-words text-xs text-slate-500 dark:text-slate-400">{event.detail}{staffName ? ` · ${staffName}` : ""}</p>
        </div>
      </li>
    );
  }

  return (
    <section>
      <PageTitle title="매장 타임라인" description="날짜별 매장 운영 기록을 확인합니다." />

      <div className="panel p-3">
        <div className="mb-3 flex items-center justify-between gap-2">
          <button type="button" onClick={() => setMonthStart((current) => addMonths(current, -1))} className="touch-button icon-button" aria-label="이전 달" title="이전 달">
            <ChevronLeft size={19} />
          </button>
          <div className="flex min-w-0 items-center gap-2">
            <CalendarDays className="shrink-0 text-brand-700 dark:text-brand-100" size={20} />
            <h1 className="truncate text-lg font-extrabold">{formatMonthLabel(monthStart)}</h1>
          </div>
          <button type="button" onClick={() => setMonthStart((current) => addMonths(current, 1))} className="touch-button icon-button" aria-label="다음 달" title="다음 달">
            <ChevronRight size={19} />
          </button>
        </div>

        <div className="grid grid-cols-7 border-b border-slate-100 pb-2 text-center text-xs font-extrabold text-slate-500 dark:border-slate-800 dark:text-slate-400">
          {["일", "월", "화", "수", "목", "금", "토"].map((weekday) => <span key={weekday}>{weekday}</span>)}
        </div>
        {loading ? <div className="grid min-h-72 place-items-center text-sm text-slate-500">타임라인을 불러오는 중...</div> : null}
        {!loading ? (
          <div className="mt-2 grid grid-cols-7 gap-1">
            {calendarDates.map((date) => {
              const day = timeline?.days.get(date);
              const eventTypes = TIMELINE_SECTIONS.filter((section) => getSectionEvents(day, section.type).length > 0);
              const isCurrentMonth = date.slice(0, 7) === monthStart.slice(0, 7);
              const isToday = date === todayValue;
              const hasGroupOrder = getSectionEvents(day, "group-order").length > 0;
              return (
                <button
                  key={date}
                  type="button"
                  onClick={() => openDay(date)}
                  className={`min-h-[74px] rounded-md border p-1.5 text-left transition-colors hover:bg-slate-50 dark:hover:bg-slate-900 ${
                    hasGroupOrder ? "border-violet-300 bg-violet-50/40 dark:border-violet-900 dark:bg-violet-950/30" : "border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950"
                  } ${isCurrentMonth ? "" : "opacity-45"}`}
                  aria-label={`${formatDateLabel(date)}${day?.events.length ? `, 이벤트 ${day.events.length}건` : ""}`}
                >
                  <span className={`grid h-6 w-6 place-items-center rounded-full text-xs font-extrabold ${isToday ? "bg-brand-600 text-white" : ""}`}>{Number(date.slice(-2))}</span>
                  {eventTypes.length > 0 ? (
                    <span className="mt-1 flex flex-wrap items-center gap-0.5">
                      {eventTypes.slice(0, 3).map((section) => {
                        const Icon = section.icon;
                        return <Icon key={section.type} size={12} className={section.className} aria-hidden="true" />;
                      })}
                      <span className="ml-auto text-[10px] font-extrabold tabular-nums text-slate-500 dark:text-slate-400">{day?.events.length}</span>
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>

      {error ? <div className="mt-3"><StatusMessage type="error">{error}</StatusMessage></div> : null}

      {selectedDate ? (
        <div className="fixed inset-0 z-50 flex items-end bg-slate-950/50 sm:items-center sm:justify-center sm:p-4" role="dialog" aria-modal="true" aria-label={`${formatDateLabel(selectedDate)} 운영 기록`}>
          <button type="button" onClick={closeDay} className="absolute inset-0 cursor-default" aria-label="운영 기록 닫기" />
          <section className="relative z-10 flex max-h-[82dvh] w-full flex-col rounded-t-2xl bg-white shadow-2xl dark:bg-slate-950 sm:max-w-lg sm:rounded-2xl">
            <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
              <div>
                <p className="text-xs font-bold text-brand-700 dark:text-brand-100">운영 기록</p>
                <h2 className="text-lg font-extrabold">{formatDateLabel(selectedDate)}</h2>
              </div>
              <button type="button" onClick={closeDay} className="touch-button icon-button" aria-label="닫기" title="닫기"><X size={20} /></button>
            </div>
            <div className="min-h-0 overflow-y-auto p-3">
              {!selectedDay?.events.length ? <p className="py-10 text-center text-sm text-slate-400">기록된 운영 일정이 없습니다.</p> : null}
              {TIMELINE_SECTIONS.map((section) => {
                const events = getSectionEvents(selectedDay, section.type);
                if (events.length === 0) return null;
                const Icon = section.icon;
                const isOpen = openSection === section.type;
                return (
                  <div key={section.type} className="border-b border-slate-100 last:border-b-0 dark:border-slate-800">
                    <button
                      type="button"
                      onClick={() => setOpenSection((current) => current === section.type ? null : section.type)}
                      className="flex min-h-12 w-full items-center gap-2 text-left"
                      aria-expanded={isOpen}
                    >
                      <ChevronDown size={17} className={`shrink-0 text-slate-400 transition-transform ${isOpen ? "rotate-0" : "-rotate-90"}`} />
                      <Icon size={18} className={`shrink-0 ${section.className}`} />
                      <span className="min-w-0 flex-1 text-sm font-extrabold">{section.label}</span>
                      <span className="text-xs font-bold tabular-nums text-slate-500 dark:text-slate-400">{events.length}건</span>
                    </button>
                    {isOpen ? <ul>{events.map(renderEvent)}</ul> : null}
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
