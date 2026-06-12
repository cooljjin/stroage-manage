import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, Check, ChevronRight, ClipboardCheck, History, PackageCheck, Plus, Trash2, X } from "lucide-react";
import { StatusMessage } from "../components/StatusMessage";
import { formatDateTime } from "../lib/date";
import { supabase } from "../lib/supabase";
import type { AppRoute, DashboardTodo, HandoverNote, InventoryLog, Product, StaffProfile } from "../types/domain";

type Props = {
  navigate: (route: AppRoute) => void;
};

type ReceiptItem = {
  productId: string;
  name: string;
  quantity: number | null;
  lastReceivedAt: string | null;
};

type DashboardView = "today" | "tomorrow";

function formatDateValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function getDayRange(date: Date) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = addDays(start, 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

function shortDateLabel(value: string) {
  return new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", weekday: "short" }).format(new Date(`${value}T00:00:00`));
}

function SectionHeader({
  icon: Icon,
  title,
  badge,
  action
}: {
  icon: typeof PackageCheck;
  title: string;
  badge?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-2 border-b border-slate-100 px-3 dark:border-slate-800">
      <div className="flex min-w-0 items-center gap-2">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-100">
          <Icon size={18} />
        </span>
        <h2 className="truncate text-sm font-extrabold">{title}</h2>
        {badge ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">{badge}</span> : null}
      </div>
      {action}
    </div>
  );
}

export function HomePage({ navigate }: Props) {
  const today = useMemo(() => new Date(), []);
  const todayValue = useMemo(() => formatDateValue(today), [today]);
  const tomorrowValue = useMemo(() => formatDateValue(addDays(today, 1)), [today]);
  const [dashboardView, setDashboardView] = useState<DashboardView>("today");
  const [receipts, setReceipts] = useState<ReceiptItem[]>([]);
  const [todos, setTodos] = useState<DashboardTodo[]>([]);
  const [handovers, setHandovers] = useState<HandoverNote[]>([]);
  const [history, setHistory] = useState<HandoverNote[]>([]);
  const [profiles, setProfiles] = useState<Map<string, string>>(new Map());
  const [todoDraft, setTodoDraft] = useState("");
  const [handoverDraft, setHandoverDraft] = useState("");
  const [showTodoForm, setShowTodoForm] = useState(false);
  const [showHandoverForm, setShowHandoverForm] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const selectedDate = dashboardView === "today" ? todayValue : tomorrowValue;

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError("");
    const range = getDayRange(new Date(`${selectedDate}T00:00:00`));
    const receiptQuery =
      dashboardView === "today"
        ? supabase
            .from("inventory_logs")
            .select("*, products(name, barcode)")
            .eq("action", "입고")
            .is("reverted_at", null)
            .gte("created_at", range.start)
            .lt("created_at", range.end)
            .order("created_at", { ascending: false })
        : supabase
            .from("products")
            .select("*")
            .eq("is_active", true)
            .eq("fresh_order_selected", true)
            .order("name", { ascending: true });

    const [receiptResult, todoResult, handoverResult, profileResult] = await Promise.all([
      receiptQuery,
      supabase.from("dashboard_todos").select("*").eq("task_date", selectedDate).order("created_at", { ascending: true }),
      supabase.from("handover_notes").select("*").eq("handover_date", selectedDate).order("created_at", { ascending: false }),
      supabase.from("profiles").select("*")
    ]);

    const firstError = receiptResult.error ?? todoResult.error ?? handoverResult.error ?? profileResult.error;
    if (firstError) {
      setError(
        firstError.message.includes("dashboard_todos") || firstError.message.includes("handover_notes")
          ? "메인페이지용 데이터베이스 업데이트가 필요합니다."
          : firstError.message
      );
    }

    if (!receiptResult.error) {
      if (dashboardView === "today") {
        const grouped = new Map<string, ReceiptItem>();
        ((receiptResult.data ?? []) as unknown as InventoryLog[]).forEach((log) => {
          const current = grouped.get(log.product_id);
          const name = log.products?.name ?? "삭제된 상품";
          grouped.set(log.product_id, {
            productId: log.product_id,
            name,
            quantity: (current?.quantity ?? 0) + (log.quantity ?? 0),
            lastReceivedAt: current?.lastReceivedAt ?? log.created_at
          });
        });
        setReceipts(Array.from(grouped.values()));
      } else {
        setReceipts(
          ((receiptResult.data ?? []) as Product[]).map((product) => ({
            productId: product.id,
            name: product.name,
            quantity: null,
            lastReceivedAt: product.fresh_order_selected_at
          }))
        );
      }
    }

    if (!todoResult.error) setTodos((todoResult.data ?? []) as DashboardTodo[]);
    if (!handoverResult.error) setHandovers((handoverResult.data ?? []) as HandoverNote[]);
    if (!profileResult.error) {
      setProfiles(new Map(((profileResult.data ?? []) as StaffProfile[]).map((profile) => [profile.id, profile.display_name])));
    }
    setLoading(false);
  }, [dashboardView, selectedDate]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  async function addTodo(event: FormEvent) {
    event.preventDefault();
    const content = todoDraft.trim();
    if (!content) return;

    setSaving(true);
    setError("");
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      setError("로그인이 필요합니다.");
      setSaving(false);
      return;
    }

    const { error: insertError } = await supabase.from("dashboard_todos").insert({
      task_date: selectedDate,
      content,
      created_by: userData.user.id
    });
    if (insertError) {
      setError(insertError.message);
    } else {
      setTodoDraft("");
      setShowTodoForm(false);
      await loadDashboard();
    }
    setSaving(false);
  }

  async function toggleTodo(todo: DashboardTodo) {
    const nextCompleted = !todo.is_completed;
    setTodos((current) => current.map((item) => (item.id === todo.id ? { ...item, is_completed: nextCompleted } : item)));
    const { data: userData } = await supabase.auth.getUser();
    const { error: updateError } = await supabase
      .from("dashboard_todos")
      .update({
        is_completed: nextCompleted,
        completed_at: nextCompleted ? new Date().toISOString() : null,
        completed_by: nextCompleted ? userData.user?.id ?? null : null
      })
      .eq("id", todo.id);

    if (updateError) {
      setTodos((current) => current.map((item) => (item.id === todo.id ? todo : item)));
      setError(updateError.message);
    }
  }

  async function deleteTodo(todo: DashboardTodo) {
    if (dashboardView !== "tomorrow") return;
    if (!window.confirm(`"${todo.content}" 할 일을 삭제할까요?`)) return;

    setDeletingIds((current) => new Set(current).add(todo.id));
    setError("");
    const { error: deleteError } = await supabase
      .from("dashboard_todos")
      .delete()
      .eq("id", todo.id)
      .eq("task_date", tomorrowValue);

    if (deleteError) {
      setError(deleteError.message);
    } else {
      setTodos((current) => current.filter((item) => item.id !== todo.id));
    }
    setDeletingIds((current) => {
      const next = new Set(current);
      next.delete(todo.id);
      return next;
    });
  }

  async function addHandover(event: FormEvent) {
    event.preventDefault();
    const content = handoverDraft.trim();
    if (!content) return;

    setSaving(true);
    setError("");
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      setError("로그인이 필요합니다.");
      setSaving(false);
      return;
    }

    const { error: insertError } = await supabase.from("handover_notes").insert({
      handover_date: selectedDate,
      content,
      created_by: userData.user.id
    });
    if (insertError) {
      setError(insertError.message);
    } else {
      setHandoverDraft("");
      setShowHandoverForm(false);
      await loadDashboard();
    }
    setSaving(false);
  }

  async function deleteHandover(note: HandoverNote) {
    if (dashboardView !== "tomorrow") return;
    if (!window.confirm("이 인수인계 내용을 삭제할까요?")) return;

    setDeletingIds((current) => new Set(current).add(note.id));
    setError("");
    const { error: deleteError } = await supabase
      .from("handover_notes")
      .delete()
      .eq("id", note.id)
      .eq("handover_date", tomorrowValue);

    if (deleteError) {
      setError(deleteError.message);
    } else {
      setHandovers((current) => current.filter((item) => item.id !== note.id));
    }
    setDeletingIds((current) => {
      const next = new Set(current);
      next.delete(note.id);
      return next;
    });
  }

  async function openHistory() {
    setShowHistory(true);
    const { data, error: historyError } = await supabase
      .from("handover_notes")
      .select("*")
      .order("handover_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(100);
    if (historyError) {
      setError(historyError.message);
    } else {
      setHistory(
        ((data ?? []) as HandoverNote[]).map((note) => ({
          ...note,
          author_name: profiles.get(note.created_by) ?? "직원"
        }))
      );
    }
  }

  const completedCount = todos.filter((todo) => todo.is_completed).length;
  const isToday = dashboardView === "today";

  function changeDashboardView(nextView: DashboardView) {
    setDashboardView(nextView);
    setShowTodoForm(false);
    setShowHandoverForm(false);
    setTodoDraft("");
    setHandoverDraft("");
    setError("");
  }

  return (
    <section className="flex h-[calc(100dvh-10.5rem)] min-h-[520px] flex-col">
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <p className="text-xs font-bold text-brand-700 dark:text-brand-100">{isToday ? "오늘의 업무" : "내일의 업무"}</p>
          <h1 className="text-xl font-extrabold">{shortDateLabel(selectedDate)}</h1>
        </div>
        <div className="grid grid-cols-2 rounded-lg border border-slate-200 bg-white p-1 dark:border-slate-700 dark:bg-slate-900">
          {(["today", "tomorrow"] as DashboardView[]).map((view) => (
            <button
              key={view}
              type="button"
              onClick={() => changeDashboardView(view)}
              aria-pressed={dashboardView === view}
              className={`min-h-9 rounded-md px-4 text-xs font-extrabold transition-colors ${
                dashboardView === view
                  ? "bg-brand-600 text-white"
                  : "text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
              }`}
            >
              {view === "today" ? "오늘" : "내일"}
            </button>
          ))}
        </div>
      </div>

      {error ? <div className="mb-2"><StatusMessage type="error">{error}</StatusMessage></div> : null}

      <div className="grid min-h-0 flex-1 grid-rows-3 gap-2.5 md:grid-cols-3 md:grid-rows-1">
        <article className="panel flex min-h-0 flex-col overflow-hidden">
          <SectionHeader icon={PackageCheck} title={isToday ? "금일 입고품목" : "내일 입고예정 품목"} badge={`${receipts.length}종`} />
          <div className="min-h-0 flex-1 overflow-y-auto">
            {loading ? <div className="p-3 text-xs text-slate-500">불러오는 중...</div> : null}
            {!loading && receipts.length === 0 ? (
              <div className="grid h-full place-items-center p-3 text-xs text-slate-400">
                {isToday ? "오늘 입고된 품목이 없습니다." : "내일 입고예정 품목이 없습니다."}
              </div>
            ) : null}
            {receipts.map((item) => (
              <button
                key={item.productId}
                type="button"
                onClick={() => navigate({ name: "operation", productId: item.productId })}
                className="flex min-h-11 w-full items-center gap-2 border-b border-slate-100 px-3 text-left last:border-0 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-900"
              >
                <span className="min-w-0 flex-1 truncate text-sm font-bold">{item.name}</span>
                {item.quantity !== null ? <span className="shrink-0 text-xs font-bold text-brand-700 dark:text-brand-100">+{item.quantity}</span> : null}
                {item.lastReceivedAt && isToday ? <span className="shrink-0 text-[10px] text-slate-400">{formatDateTime(item.lastReceivedAt).slice(-5)}</span> : null}
                <ChevronRight className="shrink-0 text-slate-400" size={16} />
              </button>
            ))}
          </div>
        </article>

        <article className="panel flex min-h-0 flex-col overflow-hidden">
          <SectionHeader
            icon={ClipboardCheck}
            title="To do list"
            badge={`${completedCount}/${todos.length}`}
            action={!isToday ? (
              <button type="button" onClick={() => setShowTodoForm((value) => !value)} className="touch-button grid place-items-center text-brand-700 dark:text-brand-100" aria-label="할 일 추가">
                {showTodoForm ? <X size={19} /> : <Plus size={19} />}
              </button>
            ) : undefined}
          />
          {showTodoForm ? (
            <form onSubmit={addTodo} className="grid grid-cols-[1fr_auto] gap-1.5 border-b border-slate-100 p-2 dark:border-slate-800">
              <input className="field min-w-0 px-2 py-2 text-xs" value={todoDraft} onChange={(event) => setTodoDraft(event.target.value)} placeholder="할 일 입력" autoFocus />
              <button className="grid min-h-10 min-w-10 place-items-center rounded-md bg-brand-600 text-white" type="submit" disabled={saving || !todoDraft.trim()} aria-label="저장">
                <Check size={18} />
              </button>
            </form>
          ) : null}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {!loading && todos.length === 0 ? (
              <div className="grid h-full place-items-center p-3 text-xs text-slate-400">
                {isToday ? "오늘 해야 할 일이 없습니다." : "내일 근무자를 위한 할 일이 없습니다."}
              </div>
            ) : null}
            {todos.map((todo) => (
              <div key={todo.id} className="flex min-h-11 items-center gap-2.5 border-b border-slate-100 px-3 last:border-0 dark:border-slate-800">
                <label className={`flex min-w-0 flex-1 items-center gap-2.5 ${isToday ? "cursor-pointer" : ""}`}>
                  <input
                    type="checkbox"
                    checked={todo.is_completed}
                    disabled={!isToday}
                    onChange={() => void toggleTodo(todo)}
                    className="h-5 w-5 shrink-0 accent-teal-700 disabled:cursor-default disabled:opacity-60"
                  />
                  <span className={`min-w-0 flex-1 text-sm font-semibold ${todo.is_completed ? "text-slate-400 line-through" : ""}`}>{todo.content}</span>
                </label>
                {!isToday ? (
                  <button
                    type="button"
                    disabled={deletingIds.has(todo.id)}
                    onClick={() => void deleteTodo(todo)}
                    className="touch-button grid shrink-0 place-items-center text-slate-400 hover:text-red-600 disabled:opacity-40 dark:hover:text-red-400"
                    aria-label={`${todo.content} 삭제`}
                    title="삭제"
                  >
                    <Trash2 size={17} />
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        </article>

        <article className="panel flex min-h-0 flex-col overflow-hidden">
          <SectionHeader
            icon={ArrowRight}
            title="인수인계"
            badge={`${handovers.length}건`}
            action={
              <div className="flex items-center">
                <button type="button" onClick={() => void openHistory()} className="touch-button grid place-items-center text-slate-500 dark:text-slate-300" aria-label="인수인계 히스토리">
                  <History size={18} />
                </button>
                {!isToday ? (
                  <button type="button" onClick={() => setShowHandoverForm((value) => !value)} className="touch-button grid place-items-center text-brand-700 dark:text-brand-100" aria-label="인수인계 추가">
                    {showHandoverForm ? <X size={19} /> : <Plus size={19} />}
                  </button>
                ) : null}
              </div>
            }
          />
          {showHandoverForm ? (
            <form onSubmit={addHandover} className="border-b border-slate-100 p-2 dark:border-slate-800">
              <textarea className="field min-h-16 resize-none px-2 py-2 text-xs" value={handoverDraft} onChange={(event) => setHandoverDraft(event.target.value)} placeholder="내일 근무자에게 전달할 내용을 입력하세요." autoFocus />
              <button className="mt-1.5 min-h-10 w-full rounded-md bg-brand-600 px-3 text-xs font-bold text-white" type="submit" disabled={saving || !handoverDraft.trim()}>
                내일 인수인계 저장
              </button>
            </form>
          ) : null}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {!loading && handovers.length === 0 ? (
              <div className="grid h-full place-items-center p-3 text-xs text-slate-400">
                {isToday ? "오늘 인지할 인수인계가 없습니다." : "내일 근무자를 위한 인수인계가 없습니다."}
              </div>
            ) : null}
            {handovers.map((note) => (
              <div key={note.id} className="flex gap-2 border-b border-slate-100 px-3 py-2.5 last:border-0 dark:border-slate-800">
                <div className="min-w-0 flex-1">
                  <p className="whitespace-pre-wrap break-words text-sm font-semibold leading-snug">{note.content}</p>
                  <p className="mt-1 text-[10px] text-slate-400">{profiles.get(note.created_by) ?? "직원"} · {formatDateTime(note.created_at)}</p>
                </div>
                {!isToday ? (
                  <button
                    type="button"
                    disabled={deletingIds.has(note.id)}
                    onClick={() => void deleteHandover(note)}
                    className="touch-button grid shrink-0 place-items-center self-center text-slate-400 hover:text-red-600 disabled:opacity-40 dark:hover:text-red-400"
                    aria-label="인수인계 삭제"
                    title="삭제"
                  >
                    <Trash2 size={17} />
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        </article>
      </div>

      {showHistory ? (
        <div className="fixed inset-0 z-50 flex items-end bg-slate-950/50 p-0 sm:items-center sm:justify-center sm:p-4" role="dialog" aria-modal="true" aria-label="인수인계 히스토리">
          <div className="flex max-h-[82dvh] w-full flex-col rounded-t-2xl bg-white shadow-2xl dark:bg-slate-950 sm:max-w-lg sm:rounded-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
              <div>
                <h2 className="font-extrabold">인수인계 히스토리</h2>
                <p className="text-xs text-slate-500">날짜별 전달 내용을 확인합니다.</p>
              </div>
              <button type="button" onClick={() => setShowHistory(false)} className="touch-button icon-button" aria-label="닫기"><X size={20} /></button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {history.length === 0 ? <StatusMessage>저장된 인수인계가 없습니다.</StatusMessage> : null}
              <div className="space-y-2">
                {history.map((note) => (
                  <div key={note.id} className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span className="text-xs font-extrabold text-brand-700 dark:text-brand-100">{shortDateLabel(note.handover_date)}</span>
                      <span className="text-[10px] text-slate-400">{note.author_name}</span>
                    </div>
                    <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{note.content}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
