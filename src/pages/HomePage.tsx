import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, Check, ChevronRight, ClipboardCheck, History, PackageCheck, Plus, X } from "lucide-react";
import { StatusMessage } from "../components/StatusMessage";
import { formatDateTime } from "../lib/date";
import { supabase } from "../lib/supabase";
import type { AppRoute, DashboardTodo, HandoverNote, InventoryLog, StaffProfile } from "../types/domain";

type Props = {
  navigate: (route: AppRoute) => void;
};

type ReceiptItem = {
  productId: string;
  name: string;
  quantity: number;
  lastReceivedAt: string;
};

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
  const [receipts, setReceipts] = useState<ReceiptItem[]>([]);
  const [todos, setTodos] = useState<DashboardTodo[]>([]);
  const [handovers, setHandovers] = useState<HandoverNote[]>([]);
  const [history, setHistory] = useState<HandoverNote[]>([]);
  const [profiles, setProfiles] = useState<Map<string, string>>(new Map());
  const [todoDraft, setTodoDraft] = useState("");
  const [todoDate, setTodoDate] = useState(tomorrowValue);
  const [handoverDraft, setHandoverDraft] = useState("");
  const [handoverDate, setHandoverDate] = useState(tomorrowValue);
  const [showTodoForm, setShowTodoForm] = useState(false);
  const [showHandoverForm, setShowHandoverForm] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError("");
    const range = getDayRange(new Date());

    const [receiptResult, todoResult, handoverResult, profileResult] = await Promise.all([
      supabase
        .from("inventory_logs")
        .select("*, products(name, barcode)")
        .eq("action", "입고")
        .gte("created_at", range.start)
        .lt("created_at", range.end)
        .order("created_at", { ascending: false }),
      supabase.from("dashboard_todos").select("*").eq("task_date", todayValue).order("created_at", { ascending: true }),
      supabase.from("handover_notes").select("*").eq("handover_date", todayValue).order("created_at", { ascending: false }),
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
    }

    if (!todoResult.error) setTodos((todoResult.data ?? []) as DashboardTodo[]);
    if (!handoverResult.error) setHandovers((handoverResult.data ?? []) as HandoverNote[]);
    if (!profileResult.error) {
      setProfiles(new Map(((profileResult.data ?? []) as StaffProfile[]).map((profile) => [profile.id, profile.display_name])));
    }
    setLoading(false);
  }, [todayValue]);

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
      task_date: todoDate,
      content,
      created_by: userData.user.id
    });
    if (insertError) {
      setError(insertError.message);
    } else {
      setTodoDraft("");
      setShowTodoForm(false);
      if (todoDate === todayValue) await loadDashboard();
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
      handover_date: handoverDate,
      content,
      created_by: userData.user.id
    });
    if (insertError) {
      setError(insertError.message);
    } else {
      setHandoverDraft("");
      setShowHandoverForm(false);
      if (handoverDate === todayValue) await loadDashboard();
    }
    setSaving(false);
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

  return (
    <section className="flex h-[calc(100dvh-10.5rem)] min-h-[520px] flex-col">
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <p className="text-xs font-bold text-brand-700 dark:text-brand-100">오늘의 업무</p>
          <h1 className="text-xl font-extrabold">{shortDateLabel(todayValue)}</h1>
        </div>
        <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">한눈에 확인하세요</span>
      </div>

      {error ? <div className="mb-2"><StatusMessage type="error">{error}</StatusMessage></div> : null}

      <div className="grid min-h-0 flex-1 grid-rows-3 gap-2.5 md:grid-cols-3 md:grid-rows-1">
        <article className="panel flex min-h-0 flex-col overflow-hidden">
          <SectionHeader icon={PackageCheck} title="금일 입고품목" badge={`${receipts.length}종`} />
          <div className="min-h-0 flex-1 overflow-y-auto">
            {loading ? <div className="p-3 text-xs text-slate-500">불러오는 중...</div> : null}
            {!loading && receipts.length === 0 ? <div className="grid h-full place-items-center p-3 text-xs text-slate-400">오늘 입고된 품목이 없습니다.</div> : null}
            {receipts.map((item) => (
              <button
                key={item.productId}
                type="button"
                onClick={() => navigate({ name: "operation", productId: item.productId })}
                className="flex min-h-11 w-full items-center gap-2 border-b border-slate-100 px-3 text-left last:border-0 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-900"
              >
                <span className="min-w-0 flex-1 truncate text-sm font-bold">{item.name}</span>
                <span className="shrink-0 text-xs font-bold text-brand-700 dark:text-brand-100">+{item.quantity}</span>
                <span className="shrink-0 text-[10px] text-slate-400">{formatDateTime(item.lastReceivedAt).slice(-5)}</span>
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
            action={
              <button type="button" onClick={() => setShowTodoForm((value) => !value)} className="touch-button grid place-items-center text-brand-700 dark:text-brand-100" aria-label="할 일 추가">
                {showTodoForm ? <X size={19} /> : <Plus size={19} />}
              </button>
            }
          />
          {showTodoForm ? (
            <form onSubmit={addTodo} className="grid grid-cols-[112px_1fr_auto] gap-1.5 border-b border-slate-100 p-2 dark:border-slate-800">
              <input className="field min-w-0 px-2 py-2 text-xs" type="date" value={todoDate} onChange={(event) => setTodoDate(event.target.value)} />
              <input className="field min-w-0 px-2 py-2 text-xs" value={todoDraft} onChange={(event) => setTodoDraft(event.target.value)} placeholder="할 일 입력" autoFocus />
              <button className="grid min-h-10 min-w-10 place-items-center rounded-md bg-brand-600 text-white" type="submit" disabled={saving || !todoDraft.trim()} aria-label="저장">
                <Check size={18} />
              </button>
            </form>
          ) : null}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {!loading && todos.length === 0 ? <div className="grid h-full place-items-center p-3 text-xs text-slate-400">오늘 등록된 할 일이 없습니다.</div> : null}
            {todos.map((todo) => (
              <label key={todo.id} className="flex min-h-11 cursor-pointer items-center gap-2.5 border-b border-slate-100 px-3 last:border-0 dark:border-slate-800">
                <input
                  type="checkbox"
                  checked={todo.is_completed}
                  onChange={() => void toggleTodo(todo)}
                  className="h-5 w-5 shrink-0 accent-teal-700"
                />
                <span className={`min-w-0 flex-1 text-sm font-semibold ${todo.is_completed ? "text-slate-400 line-through" : ""}`}>{todo.content}</span>
              </label>
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
                <button type="button" onClick={() => setShowHandoverForm((value) => !value)} className="touch-button grid place-items-center text-brand-700 dark:text-brand-100" aria-label="인수인계 추가">
                  {showHandoverForm ? <X size={19} /> : <Plus size={19} />}
                </button>
              </div>
            }
          />
          {showHandoverForm ? (
            <form onSubmit={addHandover} className="border-b border-slate-100 p-2 dark:border-slate-800">
              <div className="mb-1.5 flex gap-1.5">
                <input className="field w-[128px] shrink-0 px-2 py-2 text-xs" type="date" value={handoverDate} onChange={(event) => setHandoverDate(event.target.value)} />
                <button className="min-h-10 flex-1 rounded-md bg-brand-600 px-3 text-xs font-bold text-white" type="submit" disabled={saving || !handoverDraft.trim()}>
                  전달사항 저장
                </button>
              </div>
              <textarea className="field min-h-16 resize-none px-2 py-2 text-xs" value={handoverDraft} onChange={(event) => setHandoverDraft(event.target.value)} placeholder="다음 근무자에게 전달할 내용을 입력하세요." autoFocus />
            </form>
          ) : null}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {!loading && handovers.length === 0 ? <div className="grid h-full place-items-center p-3 text-xs text-slate-400">오늘 전달받은 인수인계가 없습니다.</div> : null}
            {handovers.map((note) => (
              <div key={note.id} className="border-b border-slate-100 px-3 py-2.5 last:border-0 dark:border-slate-800">
                <p className="whitespace-pre-wrap break-words text-sm font-semibold leading-snug">{note.content}</p>
                <p className="mt-1 text-[10px] text-slate-400">{profiles.get(note.created_by) ?? "직원"} · {formatDateTime(note.created_at)}</p>
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
