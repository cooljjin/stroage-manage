import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, CalendarDays, Check, ChevronLeft, ChevronRight, ClipboardCheck, History, PackageCheck, Plus, Trash2, Undo2, X } from "lucide-react";
import { AnimatedList, AnimatedListItem } from "../components/AnimatedList";
import { PressableButton } from "../components/PressableButton";
import { StatusMessage } from "../components/StatusMessage";
import { addDateValueDays, getDateValueWeekday, getNextBusinessDate, getSeoulDateValue } from "../lib/businessCalendar";
import { formatDateTime } from "../lib/date";
import { formatInventoryQuantity } from "../lib/inventory";
import * as Services from "../services";
import type { AppRoute, DashboardTodo, HandoverNote, InventoryCheckTodoSetting, InventoryLog, Product, StaffProfile, TodoRoutine } from "../types/domain";

type Props = {
  navigate: (route: AppRoute) => void;
  currentStoreId: string;
};

type ReceiptItem = {
  productId: string;
  name: string;
  quantity: number | null;
  lastReceivedAt: string | null;
  receiptCheckOnly: boolean;
  status: "expected" | "completed";
};
type ConfirmedOrderReceipt = {
  product_id: string;
  product_name: string;
  confirmed_at: string;
  products?: {
    is_active?: boolean | null;
  } | null;
};
type ReceiptHistoryLog = InventoryLog & {
  products?: {
    name?: string | null;
    receipt_check_only?: boolean | null;
  } | null;
};

type DashboardView = "today" | "tomorrow";

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

function getMonthStart(dateValue: string) {
  return `${dateValue.slice(0, 7)}-01`;
}

function addMonths(monthStart: string, amount: number) {
  const [year, month] = monthStart.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1 + amount, 1)).toISOString().slice(0, 10);
}

function getCalendarDates(monthStart: string) {
  const firstDate = addDateValueDays(monthStart, -getDateValueWeekday(monthStart));
  return Array.from({ length: 42 }, (_, index) => addDateValueDays(firstDate, index));
}

function formatMonthLabel(value: string) {
  return new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "long", timeZone: "Asia/Seoul" }).format(new Date(`${value}T00:00:00+09:00`));
}

function HistoryReceiptIcon({ size = 18, className = "" }: { size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M9.8 4.2h7.4a2.6 2.6 0 0 1 2.6 2.6v11.4a2.6 2.6 0 0 1-2.6 2.6H7.6A2.6 2.6 0 0 1 5 18.2v-6.4" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M10.9 10.6h5.8M10.9 14.2h5.8M10.9 17.8h4.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="7.6" cy="7.1" r="4.7" fill="white" stroke="currentColor" strokeWidth="2.2" />
      <path d="M7.6 4.7v2.8h2.2" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function daysInMonth(dateValue: string) {
  const [year, month] = dateValue.split("-").map(Number);
  return new Date(year, month, 0).getDate();
}

function daysBetween(startDateValue: string, endDateValue: string) {
  const [startYear, startMonth, startDay] = startDateValue.split("-").map(Number);
  const [endYear, endMonth, endDay] = endDateValue.split("-").map(Number);
  return Math.floor((Date.UTC(endYear, endMonth - 1, endDay) - Date.UTC(startYear, startMonth - 1, startDay)) / 86_400_000);
}

function isRoutineDue(routine: TodoRoutine, dateValue: string) {
  if (!routine.is_active) return false;
  if (dateValue < routine.starts_on) return false;
  if (routine.ends_on && dateValue > routine.ends_on) return false;

  const date = new Date(`${dateValue}T00:00:00`);
  if (routine.schedule_type === "once") return routine.target_date === dateValue;
  if (routine.schedule_type === "daily") return true;
  if (routine.schedule_type === "weekly") return routine.weekday === date.getDay();
  if (routine.schedule_type === "monthly") return Math.min(routine.month_day ?? 1, daysInMonth(dateValue)) === date.getDate();
  if (routine.schedule_type === "interval") {
    const intervalDays = routine.interval_days ?? 0;
    return intervalDays > 0 && daysBetween(routine.starts_on, dateValue) % intervalDays === 0;
  }
  return false;
}

function buildInventoryCheckTodoContent(productName: string) {
  return `${productName} 재고 파악하기`;
}

function isDuplicateStaleInventoryTodoError(message: string) {
  return message.includes("dashboard_todos_store_date_stale_inventory_product_idx")
    || (message.includes("duplicate key") && message.includes("stale_inventory_product_id"));
}

type TodoDisplayType = "manual" | "routine" | "stale-inventory";

function getTodoDisplayType(todo: DashboardTodo): TodoDisplayType {
  if (todo.stale_inventory_product_id) return "stale-inventory";
  if (todo.routine_id) return "routine";
  return "manual";
}

function compareTodos(left: DashboardTodo, right: DashboardTodo) {
  const priority: Record<TodoDisplayType, number> = {
    manual: 0,
    routine: 1,
    "stale-inventory": 2
  };
  const priorityDifference = priority[getTodoDisplayType(left)] - priority[getTodoDisplayType(right)];
  if (priorityDifference !== 0) return priorityDifference;
  return left.created_at.localeCompare(right.created_at);
}

function getPreviousBusinessDate(
  fromDate: string,
  weeklyClosureDays: ReadonlySet<number>,
  specificClosureDates: ReadonlySet<string>
) {
  for (let daysBack = 1; daysBack <= 366; daysBack += 1) {
    const candidate = addDateValueDays(fromDate, -daysBack);
    const weekday = new Date(`${candidate}T00:00:00Z`).getUTCDay();
    if (!weeklyClosureDays.has(weekday) && !specificClosureDates.has(candidate)) {
      return candidate;
    }
  }

  throw new Error("이전 영업일을 계산할 수 없습니다. 휴무일 설정을 확인해 주세요.");
}

function buildCompletedReceipts(logs: ReceiptHistoryLog[]) {
  const grouped = new Map<string, ReceiptItem>();
  logs.forEach((log) => {
    const current = grouped.get(log.product_id);
    const name = log.products?.name ?? "삭제된 상품";
    const nextQuantity = log.quantity === null ? current?.quantity ?? null : (current?.quantity ?? 0) + log.quantity;
    grouped.set(log.product_id, {
      productId: log.product_id,
      name,
      quantity: nextQuantity,
      lastReceivedAt: current?.lastReceivedAt ?? log.created_at,
      receiptCheckOnly: current?.receiptCheckOnly ?? log.products?.receipt_check_only ?? false,
      status: "completed"
    });
  });
  return Array.from(grouped.values());
}

function buildExpectedReceipts(receipts: ConfirmedOrderReceipt[]) {
  return receipts.map((product) => ({
    productId: product.product_id,
    name: product.product_name,
    quantity: null,
    lastReceivedAt: product.confirmed_at,
    receiptCheckOnly: false,
    status: "expected" as const
  }));
}

function mergeExpectedReceipts(delayedItems: ReceiptItem[], expectedItems: ReceiptItem[]) {
  const productIds = new Set<string>();
  return [...delayedItems, ...expectedItems].filter((item) => {
    if (productIds.has(item.productId)) return false;
    productIds.add(item.productId);
    return true;
  });
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

export function HomePage({ navigate, currentStoreId }: Props) {
  const todayValue = useMemo(() => getSeoulDateValue(), []);
  const [nextBusinessDate, setNextBusinessDate] = useState<string | null>(null);
  const [dashboardView, setDashboardView] = useState<DashboardView>("today");
  const [receipts, setReceipts] = useState<ReceiptItem[]>([]);
  const [todos, setTodos] = useState<DashboardTodo[]>([]);
  const [handovers, setHandovers] = useState<HandoverNote[]>([]);
  const [history, setHistory] = useState<HandoverNote[]>([]);
  const [receiptHistoryDate, setReceiptHistoryDate] = useState(todayValue);
  const [receiptHistoryExpected, setReceiptHistoryExpected] = useState<ReceiptItem[]>([]);
  const [receiptHistoryCompleted, setReceiptHistoryCompleted] = useState<ReceiptItem[]>([]);
  const [receiptHistoryOpen, setReceiptHistoryOpen] = useState(false);
  const [receiptHistoryLoading, setReceiptHistoryLoading] = useState(false);
  const [receiptHistoryError, setReceiptHistoryError] = useState("");
  const [profiles, setProfiles] = useState<Map<string, string>>(new Map());
  const [todoDraft, setTodoDraft] = useState("");
  const [scheduledTodoDraft, setScheduledTodoDraft] = useState("");
  const [scheduledTodoDate, setScheduledTodoDate] = useState(todayValue);
  const [scheduledTodoCalendarMonth, setScheduledTodoCalendarMonth] = useState(() => getMonthStart(todayValue));
  const [handoverDraft, setHandoverDraft] = useState("");
  const [showTodoForm, setShowTodoForm] = useState(false);
  const [showScheduledTodoDialog, setShowScheduledTodoDialog] = useState(false);
  const [showScheduledTodoCalendar, setShowScheduledTodoCalendar] = useState(false);
  const [showHandoverForm, setShowHandoverForm] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [receiptActioning, setReceiptActioning] = useState(false);
  const [receiptDeletingIds, setReceiptDeletingIds] = useState<Set<string>>(new Set());
  const [hasReceiptDeletion, setHasReceiptDeletion] = useState(false);
  const [todoActioningIds, setTodoActioningIds] = useState<Set<string>>(new Set());
  const [deletingHandoverIds, setDeletingHandoverIds] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const selectedDate = dashboardView === "today" ? todayValue : nextBusinessDate;
  const scheduledTodoCalendarDates = useMemo(() => getCalendarDates(scheduledTodoCalendarMonth), [scheduledTodoCalendarMonth]);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError("");
    setMessage("");
    const closureLookupStart = addDateValueDays(todayValue, -31);
    const [weeklyClosureResult, specificClosureResult] = await Promise.all([
      Services.DatabaseService.select("weekly_store_closures", "weekday").eq("store_id", currentStoreId),
      Services.DatabaseService.select("store_closure_dates", "closure_date").eq("store_id", currentStoreId).gte("closure_date", closureLookupStart)
    ]);
    const closureError = weeklyClosureResult.error ?? specificClosureResult.error;
    if (closureError) {
      setError(
        closureError.message.includes("weekly_store_closures") || closureError.message.includes("store_closure_dates")
          ? "휴무일용 데이터베이스 업데이트가 필요합니다."
          : closureError.message
      );
      setLoading(false);
      return;
    }

    const weeklyClosureDays = new Set(((weeklyClosureResult.data ?? []) as Array<{ weekday: number }>).map((item) => item.weekday));
    const specificClosureDates = new Set(((specificClosureResult.data ?? []) as Array<{ closure_date: string }>).map((item) => item.closure_date));
    let calculatedNextBusinessDate: string;
    try {
      calculatedNextBusinessDate = getNextBusinessDate(
        todayValue,
        weeklyClosureDays,
        specificClosureDates
      );
    } catch (calendarError) {
      setError(calendarError instanceof Error ? calendarError.message : "내일 날짜를 계산하지 못했습니다.");
      setLoading(false);
      return;
    }

    setNextBusinessDate(calculatedNextBusinessDate);
    const dashboardDate = dashboardView === "today" ? todayValue : calculatedNextBusinessDate;
    let previousBusinessDate: string;
    try {
      previousBusinessDate = getPreviousBusinessDate(dashboardDate, weeklyClosureDays, specificClosureDates);
    } catch (calendarError) {
      setError(calendarError instanceof Error ? calendarError.message : "이전 영업일을 계산하지 못했습니다.");
      setLoading(false);
      return;
    }
    const range = getDayRange(new Date(`${dashboardDate}T00:00:00`));
    let staleInventoryTodoEnabled = false;
    const routineResult = await Services.DatabaseService.select("todo_routines", "*")
      .eq("store_id", currentStoreId)
      .eq("is_active", true);

    if (routineResult.error) {
      setError(routineResult.error.message.includes("todo_routines") ? "To do list 루틴용 데이터베이스 업데이트가 필요합니다." : routineResult.error.message);
      setLoading(false);
      return;
    }

    const dueRoutines = ((routineResult.data ?? []) as TodoRoutine[]).filter((routine) => isRoutineDue(routine, dashboardDate));
    if (dueRoutines.length > 0) {
      const { data: userData } = await Services.AuthService.getUser();
      if (userData.user) {
        const routineIds = dueRoutines.map((routine) => routine.id);
        const existingTodoResult = await Services.DatabaseService.select("dashboard_todos", "routine_id")
          .eq("store_id", currentStoreId)
          .eq("task_date", dashboardDate)
          .in("routine_id", routineIds);

        if (existingTodoResult.error) {
          setError(existingTodoResult.error.message);
          setLoading(false);
          return;
        }

        const existingRoutineIds = new Set(((existingTodoResult.data ?? []) as Array<{ routine_id: string | null }>).map((todo) => todo.routine_id).filter(Boolean));
        const todosToCreate = dueRoutines
          .filter((routine) => !existingRoutineIds.has(routine.id))
          .map((routine) => ({
            store_id: currentStoreId,
            task_date: dashboardDate,
            content: routine.content,
            created_by: userData.user.id,
            routine_id: routine.id
          }));

        if (todosToCreate.length > 0) {
          const { error: materializeError } = await Services.DatabaseService.upsert("dashboard_todos", todosToCreate, {
            onConflict: "store_id,task_date,routine_id",
            ignoreDuplicates: true
          });

          if (materializeError) {
            setError(materializeError.message);
            setLoading(false);
            return;
          }
        }
      }
    }

    if (dashboardDate === todayValue) {
      const { data: settingData, error: settingError } = await Services.DatabaseService.select("inventory_check_todo_settings", "*")
        .eq("store_id", currentStoreId)
        .maybeSingle();

      if (settingError) {
        setError(
          settingError.message.includes("inventory_check_todo_settings")
            || settingError.message.includes("stale_inventory_product_id")
            || settingError.message.includes("schema cache")
            ? "오래된 재고 파악 To do 기능용 데이터베이스 업데이트가 필요합니다."
            : settingError.message
        );
        setLoading(false);
        return;
      }

      const inventoryCheckSetting = (settingData as InventoryCheckTodoSetting | null) ?? null;
      staleInventoryTodoEnabled = inventoryCheckSetting?.is_enabled ?? false;
      if (staleInventoryTodoEnabled) {
        const thresholdDays = Math.max(1, Number(inventoryCheckSetting?.threshold_days || 1));
        const cutoffDate = addDays(new Date(`${dashboardDate}T00:00:00`), -thresholdDays);
        const cutoffIso = cutoffDate.toISOString();
        const productResult = await Services.DatabaseService.select("products", "id, name")
          .eq("store_id", currentStoreId)
          .eq("is_active", true)
          .eq("receipt_check_only", false)
          .order("name", { ascending: true });

        if (productResult.error) {
          setError(productResult.error.message);
          setLoading(false);
          return;
        }

        const productsForCheck = (productResult.data ?? []) as Pick<Product, "id" | "name">[];
        const productIds = productsForCheck.map((product) => product.id);

        if (productIds.length > 0) {
          const [logResult, existingTodoResult] = await Promise.all([
            Services.DatabaseService.select("inventory_logs", "product_id, created_at")
              .eq("store_id", currentStoreId)
              .neq("action", "메모")
              .is("reverted_at", null)
              .in("product_id", productIds)
              .order("created_at", { ascending: false }),
            Services.DatabaseService.select("dashboard_todos", "stale_inventory_product_id")
              .eq("store_id", currentStoreId)
              .eq("task_date", dashboardDate)
              .in("stale_inventory_product_id", productIds)
          ]);

          if (logResult.error || existingTodoResult.error) {
            const staleTodoError = logResult.error ?? existingTodoResult.error;
            setError(
              staleTodoError?.message.includes("stale_inventory_product_id") || staleTodoError?.message.includes("schema cache")
                ? "오래된 재고 파악 To do 기능용 데이터베이스 업데이트가 필요합니다."
                : staleTodoError?.message ?? "오래된 재고 파악 항목을 확인하지 못했습니다."
            );
            setLoading(false);
            return;
          }

          const latestLogByProductId = new Map<string, string>();
          ((logResult.data ?? []) as Array<{ product_id: string; created_at: string }>).forEach((log) => {
            if (!latestLogByProductId.has(log.product_id)) latestLogByProductId.set(log.product_id, log.created_at);
          });
          const existingProductIds = new Set(
            ((existingTodoResult.data ?? []) as Array<{ stale_inventory_product_id: string | null }>)
              .map((todo) => todo.stale_inventory_product_id)
              .filter(Boolean) as string[]
          );
          const staleProducts = productsForCheck.filter((product) => {
            if (existingProductIds.has(product.id)) return false;
            const latestCheckedAt = latestLogByProductId.get(product.id);
            return !latestCheckedAt || latestCheckedAt < cutoffIso;
          });

          if (staleProducts.length > 0) {
            const { data: userData } = await Services.AuthService.getUser();
            if (userData.user) {
              const { error: insertStaleTodosError } = await Services.DatabaseService.insert(
                "dashboard_todos",
                staleProducts.map((product) => ({
                  store_id: currentStoreId,
                  task_date: dashboardDate,
                  content: buildInventoryCheckTodoContent(product.name),
                  created_by: userData.user.id,
                  stale_inventory_product_id: product.id
                }))
              );

              if (insertStaleTodosError && !isDuplicateStaleInventoryTodoError(insertStaleTodosError.message)) {
                setError(insertStaleTodosError.message);
                setLoading(false);
                return;
              }
            }
          }
        }
      }
    }

    const receiptLogQuery = Services.DatabaseService.select("inventory_logs", "*, products(name, barcode, receipt_check_only)")
      .eq("store_id", currentStoreId)
      .eq("action", "입고")
      .is("reverted_at", null)
      .gte("created_at", range.start)
      .lt("created_at", range.end)
      .order("created_at", { ascending: false });
    const expectedReceiptQuery = Services.DatabaseService.select("confirmed_order_items", "product_id, product_name, confirmed_at, products(is_active)")
      .eq("store_id", currentStoreId)
      .eq("order_date", previousBusinessDate)
      .order("urgent_order_requested", { ascending: false })
      .order("product_name", { ascending: true });

    const [receiptLogResult, expectedReceiptResult, todoResult, handoverResult, profileResult, receiptDeletionResult] = await Promise.all([
      receiptLogQuery,
      expectedReceiptQuery,
      Services.DatabaseService.select("dashboard_todos", "*")
        .eq("store_id", currentStoreId)
        .eq("task_date", dashboardDate)
        .is("deleted_at", null)
        .order("created_at", { ascending: true }),
      Services.DatabaseService.select("handover_notes", "*").eq("store_id", currentStoreId).eq("handover_date", dashboardDate).order("created_at", { ascending: false }),
      Services.DatabaseService.select("profiles", "*"),
      Services.DatabaseService.select("dashboard_receipt_deletions", "id")
        .is("restored_at", null)
        .gte("deleted_at", range.start)
        .lt("deleted_at", range.end)
        .order("deleted_at", { ascending: false })
        .limit(1)
        .maybeSingle()
    ]);

    let delayedSourceDate: string;
    try {
      delayedSourceDate = getPreviousBusinessDate(previousBusinessDate, weeklyClosureDays, specificClosureDates);
    } catch (calendarError) {
      setError(calendarError instanceof Error ? calendarError.message : "지연 입고 날짜를 계산하지 못했습니다.");
      setLoading(false);
      return;
    }
    const delayedRange = getDayRange(new Date(`${previousBusinessDate}T00:00:00`));
    const [delayedExpectedResult, delayedLogResult] = await Promise.all([
      Services.DatabaseService.select("confirmed_order_items", "product_id, product_name, confirmed_at, products(is_active)")
        .eq("store_id", currentStoreId)
        .eq("order_date", delayedSourceDate)
        .order("urgent_order_requested", { ascending: false })
        .order("product_name", { ascending: true }),
      Services.DatabaseService.select("inventory_logs", "*, products(name, barcode, receipt_check_only)")
        .eq("store_id", currentStoreId)
        .eq("action", "입고")
        .is("reverted_at", null)
        .gte("created_at", delayedRange.start)
        .lt("created_at", delayedRange.end)
    ]);
    const delayedExpectedReceiptResult = delayedExpectedResult as { data: ConfirmedOrderReceipt[] | null; error: null | { message: string } };
    const delayedReceiptLogResult = delayedLogResult as { data: ReceiptHistoryLog[] | null; error: null | { message: string } };

    const firstError = receiptLogResult.error ?? expectedReceiptResult.error ?? delayedExpectedReceiptResult.error ?? delayedReceiptLogResult.error ?? todoResult.error ?? handoverResult.error ?? profileResult.error ?? receiptDeletionResult.error;
    if (firstError) {
      setError(
        firstError.message.includes("dashboard_todos")
          || firstError.message.includes("handover_notes")
          || firstError.message.includes("dashboard_receipt_deletions")
          || firstError.message.includes("confirmed_order_items")
          ? "메인페이지용 데이터베이스 업데이트가 필요합니다."
          : firstError.message
      );
    }

    if (!receiptLogResult.error && !expectedReceiptResult.error && !delayedExpectedReceiptResult.error && !delayedReceiptLogResult.error) {
      const completedItems = buildCompletedReceipts((receiptLogResult.data ?? []) as unknown as ReceiptHistoryLog[]);
      const completedProductIds = new Set(completedItems.map((item) => item.productId));
      const previousBusinessDayCompletedProductIds = new Set(
        buildCompletedReceipts((delayedReceiptLogResult.data ?? []) as unknown as ReceiptHistoryLog[]).map((item) => item.productId)
      );
      const expectedItems = buildExpectedReceipts(
        ((expectedReceiptResult.data ?? []) as ConfirmedOrderReceipt[]).filter((item) => item.products?.is_active !== false)
      )
        .filter((item) => !previousBusinessDayCompletedProductIds.has(item.productId));
      const delayedItems = buildExpectedReceipts(
        ((delayedExpectedReceiptResult.data ?? []) as ConfirmedOrderReceipt[]).filter((item) => item.products?.is_active !== false)
      )
        .filter((item) => !previousBusinessDayCompletedProductIds.has(item.productId));
      const nextExpectedItems = mergeExpectedReceipts(delayedItems, expectedItems);

      if (dashboardView === "today") {
        setReceipts([...nextExpectedItems.filter((item) => !completedProductIds.has(item.productId)), ...completedItems]);
      } else {
        setReceipts(nextExpectedItems);
      }
    }

    if (!todoResult.error) {
      const nextTodos = (todoResult.data ?? []) as DashboardTodo[];
      setTodos(staleInventoryTodoEnabled ? nextTodos : nextTodos.filter((todo) => !todo.stale_inventory_product_id));
    }
    if (!handoverResult.error) setHandovers((handoverResult.data ?? []) as HandoverNote[]);
    if (!profileResult.error) {
      setProfiles(new Map(((profileResult.data ?? []) as StaffProfile[]).map((profile) => [profile.id, profile.display_name])));
    }
    if (!receiptDeletionResult.error) setHasReceiptDeletion(Boolean(receiptDeletionResult.data));
    setLoading(false);
  }, [currentStoreId, dashboardView, todayValue]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  function receiptActionError(message: string) {
    return message.includes("delete_today_product_receipts")
      || message.includes("restore_latest_dashboard_receipt_deletion")
      || message.includes("dashboard_receipt_deletions")
      ? "금일 입고 삭제 기능을 위한 데이터베이스 업데이트가 필요합니다."
      : message;
  }

  async function deleteTodayReceipt(item: ReceiptItem) {
    if (!isToday || item.status !== "completed") return;
    const confirmMessage =
      item.quantity === null
        ? `${item.name}의 오늘 입고확인 기록을 삭제할까요?`
        : item.receiptCheckOnly
          ? `${item.name}의 오늘 입고 수량 ${formatInventoryQuantity(item.quantity)}개 기록을 삭제할까요?`
          : `${item.name}의 오늘 입고 수량 ${formatInventoryQuantity(item.quantity)}개를 삭제할까요?\n재고에서도 해당 수량이 차감됩니다.`;
    if (!window.confirm(confirmMessage)) return;

    setReceiptDeletingIds((current) => new Set(current).add(item.productId));
    setError("");
    setMessage("");
    const { error: deleteError } = await Services.DatabaseService.rpc("delete_today_product_receipts", {
      target_product_id: item.productId
    });

    if (deleteError) {
      setError(receiptActionError(deleteError.message));
    } else {
      setMessage(`${item.name}의 금일 입고 기록을 삭제했습니다.`);
      await loadDashboard();
      setMessage(`${item.name}의 금일 입고 기록을 삭제했습니다.`);
    }

    setReceiptDeletingIds((current) => {
      const next = new Set(current);
      next.delete(item.productId);
      return next;
    });
  }

  async function restoreLatestReceiptDeletion() {
    if (!isToday || !hasReceiptDeletion) return;
    if (!window.confirm("가장 최근에 삭제한 금일 입고 기록을 되돌릴까요?")) return;

    setReceiptActioning(true);
    setError("");
    setMessage("");
    const { error: restoreError } = await Services.DatabaseService.rpc("restore_latest_dashboard_receipt_deletion");

    if (restoreError) {
      setError(receiptActionError(restoreError.message));
    } else {
      await loadDashboard();
      setMessage("가장 최근 금일 입고 삭제를 되돌렸습니다.");
    }
    setReceiptActioning(false);
  }

  async function addTodo(event: FormEvent) {
    event.preventDefault();
    const content = todoDraft.trim();
    if (!content || !selectedDate) return;

    setSaving(true);
    setError("");
    const { data: userData } = await Services.AuthService.getUser();
    if (!userData.user) {
      setError("로그인이 필요합니다.");
      setSaving(false);
      return;
    }

    const { error: insertError } = await Services.DatabaseService.insert("dashboard_todos", {
      store_id: currentStoreId,
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

  async function addScheduledTodo(event: FormEvent) {
    event.preventDefault();
    const content = scheduledTodoDraft.trim();
    if (!content || !scheduledTodoDate) return;

    setSaving(true);
    setError("");
    setMessage("");
    const { data: userData } = await Services.AuthService.getUser();
    if (!userData.user) {
      setError("로그인이 필요합니다.");
      setSaving(false);
      return;
    }

    const { error: insertError } = await Services.DatabaseService.insert("dashboard_todos", {
      store_id: currentStoreId,
      task_date: scheduledTodoDate,
      content,
      created_by: userData.user.id
    });

    if (insertError) {
      setError(insertError.message);
    } else {
      const addedDate = scheduledTodoDate;
      setScheduledTodoDraft("");
      setScheduledTodoDate(todayValue);
      setShowScheduledTodoDialog(false);
      await loadDashboard();
      setMessage(`${shortDateLabel(addedDate)} To do list에 추가했습니다.`);
    }
    setSaving(false);
  }

  async function toggleTodo(todo: DashboardTodo) {
    if (todoActioningIds.has(todo.id)) return;
    const nextCompleted = !todo.is_completed;
    setTodoActioningIds((current) => new Set(current).add(todo.id));
    setError("");
    const { data: userData } = await Services.AuthService.getUser();
    const { data: updatedTodo, error: updateError } = await Services.DatabaseService.update("dashboard_todos", {
        is_completed: nextCompleted,
        completed_at: nextCompleted ? new Date().toISOString() : null,
        completed_by: nextCompleted ? userData.user?.id ?? null : null
      })
      .eq("store_id", currentStoreId)
      .eq("id", todo.id)
      .is("deleted_at", null)
      .select("id")
      .maybeSingle();

    if (updateError || !updatedTodo) {
      setError(updateError?.message ?? "할 일 완료 상태를 반영하지 못했습니다. 새로고침 후 다시 시도해 주세요.");
    } else {
      setTodos((current) => current.map((item) => (item.id === todo.id ? { ...item, is_completed: nextCompleted } : item)));
    }
    setTodoActioningIds((current) => {
      const next = new Set(current);
      next.delete(todo.id);
      return next;
    });
  }

  async function deleteTodo(todo: DashboardTodo) {
    if (!selectedDate) return;
    if (!window.confirm(`"${todo.content}" 할 일을 삭제할까요?`)) return;

    if (todoActioningIds.has(todo.id)) return;
    setTodoActioningIds((current) => new Set(current).add(todo.id));
    setError("");
    const { data: deletedTodo, error: deleteError } = await Services.DatabaseService.update("dashboard_todos", {
      deleted_at: new Date().toISOString(),
      deleted_by: (await Services.AuthService.getUser()).data.user?.id ?? null
    })
      .eq("store_id", currentStoreId)
      .eq("id", todo.id)
      .eq("task_date", selectedDate)
      .is("deleted_at", null)
      .select("id")
      .maybeSingle();

    if (deleteError || !deletedTodo) {
      setError(deleteError?.message ?? "할 일을 삭제하지 못했습니다. 새로고침 후 다시 시도해 주세요.");
    } else {
      setTodos((current) => current.filter((item) => item.id !== todo.id));
    }
    setTodoActioningIds((current) => {
      const next = new Set(current);
      next.delete(todo.id);
      return next;
    });
  }

  async function addHandover(event: FormEvent) {
    event.preventDefault();
    const content = handoverDraft.trim();
    if (!content || !selectedDate) return;

    setSaving(true);
    setError("");
    const { data: userData } = await Services.AuthService.getUser();
    if (!userData.user) {
      setError("로그인이 필요합니다.");
      setSaving(false);
      return;
    }

    const { error: insertError } = await Services.DatabaseService.insert("handover_notes", {
      store_id: currentStoreId,
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
    if (dashboardView !== "tomorrow" || !nextBusinessDate) return;
    if (!window.confirm("이 인수인계 내용을 삭제할까요?")) return;

    setDeletingHandoverIds((current) => new Set(current).add(note.id));
    setError("");
    const { error: deleteError } = await Services.DatabaseService.delete("handover_notes")
      .eq("id", note.id)
      .eq("store_id", currentStoreId)
      .eq("handover_date", nextBusinessDate);

    if (deleteError) {
      setError(deleteError.message);
    } else {
      setHandovers((current) => current.filter((item) => item.id !== note.id));
    }
    setDeletingHandoverIds((current) => {
      const next = new Set(current);
      next.delete(note.id);
      return next;
    });
  }

  async function openHistory() {
    setShowHistory(true);
    const { data, error: historyError } = await Services.DatabaseService.select("handover_notes", "*")
      .eq("store_id", currentStoreId)
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

  async function loadReceiptHistory(targetDate = receiptHistoryDate) {
    setReceiptHistoryLoading(true);
    setReceiptHistoryError("");

    const closureLookupStart = addDateValueDays(targetDate, -366);
    const [weeklyClosureResult, specificClosureResult] = await Promise.all([
      Services.DatabaseService.select("weekly_store_closures", "weekday").eq("store_id", currentStoreId),
      Services.DatabaseService.select("store_closure_dates", "closure_date").eq("store_id", currentStoreId).gte("closure_date", closureLookupStart)
    ]);
    const closureError = weeklyClosureResult.error ?? specificClosureResult.error;
    if (closureError) {
      setReceiptHistoryError(
        closureError.message.includes("weekly_store_closures") || closureError.message.includes("store_closure_dates")
          ? "휴무일용 데이터베이스 업데이트가 필요합니다."
          : closureError.message
      );
      setReceiptHistoryLoading(false);
      return;
    }

    const weeklyClosureDays = new Set(((weeklyClosureResult.data ?? []) as Array<{ weekday: number }>).map((item) => item.weekday));
    const specificClosureDates = new Set(((specificClosureResult.data ?? []) as Array<{ closure_date: string }>).map((item) => item.closure_date));
    let previousBusinessDate: string;
    try {
      previousBusinessDate = getPreviousBusinessDate(targetDate, weeklyClosureDays, specificClosureDates);
    } catch (calendarError) {
      setReceiptHistoryError(calendarError instanceof Error ? calendarError.message : "이전 영업일을 계산하지 못했습니다.");
      setReceiptHistoryLoading(false);
      return;
    }

    const range = getDayRange(new Date(`${targetDate}T00:00:00`));
    const [expectedResult, completedResult] = await Promise.all([
      Services.DatabaseService.select("confirmed_order_items", "product_id, product_name, confirmed_at, products(is_active)")
        .eq("store_id", currentStoreId)
        .eq("order_date", previousBusinessDate)
        .order("urgent_order_requested", { ascending: false })
        .order("product_name", { ascending: true }),
      Services.DatabaseService.select("inventory_logs", "*, products(name, receipt_check_only)")
        .eq("store_id", currentStoreId)
        .eq("action", "입고")
        .is("reverted_at", null)
        .gte("created_at", range.start)
        .lt("created_at", range.end)
        .order("created_at", { ascending: false })
    ]);

    const historyError = expectedResult.error ?? completedResult.error;
    if (historyError) {
      setReceiptHistoryError(
        historyError.message.includes("confirmed_order_items") || historyError.message.includes("inventory_logs")
          ? "입고 히스토리용 데이터베이스 업데이트가 필요합니다."
          : historyError.message
      );
    } else {
      const completedItems = buildCompletedReceipts((completedResult.data ?? []) as unknown as ReceiptHistoryLog[]);
      const completedProductIds = new Set(completedItems.map((item) => item.productId));
      setReceiptHistoryExpected(
        buildExpectedReceipts(
          ((expectedResult.data ?? []) as ConfirmedOrderReceipt[]).filter((item) => item.products?.is_active !== false)
        )
          .filter((item) => !completedProductIds.has(item.productId))
      );
      setReceiptHistoryCompleted(completedItems);
    }

    setReceiptHistoryLoading(false);
  }

  async function openReceiptHistory() {
    const initialDate = selectedDate ?? nextBusinessDate ?? todayValue;
    setReceiptHistoryDate(initialDate);
    setReceiptHistoryOpen(true);
    await loadReceiptHistory(initialDate);
  }

  const completedCount = todos.filter((todo) => todo.is_completed).length;
  const displayedTodos = useMemo(() => [...todos].sort(compareTodos), [todos]);
  const isToday = dashboardView === "today";

  function changeDashboardView(nextView: DashboardView) {
    setDashboardView(nextView);
    setShowTodoForm(false);
    setShowScheduledTodoDialog(false);
    setShowHandoverForm(false);
    setTodoDraft("");
    setScheduledTodoDraft("");
    setHandoverDraft("");
    setError("");
  }

  return (
    <section className="flex h-[calc(100dvh-10.5rem)] min-h-[520px] flex-col">
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <p className="text-xs font-bold text-brand-700 dark:text-brand-100">{isToday ? "오늘의 업무" : "내일의 업무"}</p>
          <h1 className="text-xl font-extrabold">{selectedDate ? shortDateLabel(selectedDate) : "날짜 계산 중..."}</h1>
        </div>
        <div className="flex items-center gap-1">
          <PressableButton
            type="button"
            onClick={() => navigate({ name: "timeline-calendar" })}
            className="touch-button grid place-items-center rounded-lg border border-slate-200 bg-white text-brand-700 dark:border-slate-700 dark:bg-slate-900 dark:text-brand-100"
            aria-label="매장 타임라인 캘린더 열기"
            title="매장 타임라인 캘린더"
          >
            <CalendarDays size={18} />
          </PressableButton>
          <div className="grid grid-cols-2 rounded-lg border border-slate-200 bg-white p-1 dark:border-slate-700 dark:bg-slate-900">
          {(["today", "tomorrow"] as DashboardView[]).map((view) => (
            <PressableButton
              key={view}
              type="button"
              onClick={() => changeDashboardView(view)}
              aria-pressed={dashboardView === view}
              surfaceFeedback={false}
              className={`min-h-9 rounded-md px-4 text-xs font-extrabold transition-colors ${
                dashboardView === view
                  ? "bg-brand-600 text-white"
                  : "text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
              }`}
            >
              {view === "today" ? "오늘" : "내일"}
            </PressableButton>
          ))}
          </div>
        </div>
      </div>

      {error ? <div className="mb-2"><StatusMessage type="error">{error}</StatusMessage></div> : null}
      {message ? <div className="mb-2"><StatusMessage type="success">{message}</StatusMessage></div> : null}

      <div className="grid min-h-0 flex-1 grid-rows-3 gap-2.5 md:grid-cols-3 md:grid-rows-1">
        <article className="panel flex min-h-0 flex-col overflow-hidden">
          <SectionHeader
            icon={PackageCheck}
            title={isToday ? "금일 입고품목" : "내일 입고예정 품목"}
            badge={`${receipts.length}종`}
            action={isToday ? (
              <div className="flex items-center gap-1">
                <PressableButton
                  type="button"
                  onClick={() => void openReceiptHistory()}
                  className="touch-button grid shrink-0 place-items-center rounded-md text-brand-700 dark:text-brand-100"
                  aria-label="입고 예정 및 완료 히스토리"
                  title="입고 히스토리"
                >
                  <HistoryReceiptIcon size={19} />
                </PressableButton>
                <PressableButton
                  type="button"
                  disabled={!hasReceiptDeletion || receiptActioning}
                  onClick={() => void restoreLatestReceiptDeletion()}
                  className="touch-button grid shrink-0 place-items-center text-brand-700 disabled:cursor-default disabled:opacity-30 dark:text-brand-100"
                  aria-label="최근 금일 입고 삭제 되돌리기"
                  title="최근 삭제 되돌리기"
                >
                  <Undo2 size={18} />
                </PressableButton>
              </div>
            ) : (
              <PressableButton
                type="button"
                onClick={() => void openReceiptHistory()}
                className="touch-button grid shrink-0 place-items-center rounded-md text-brand-700 dark:text-brand-100"
                aria-label="입고 예정 및 완료 히스토리"
                title="입고 히스토리"
              >
                <HistoryReceiptIcon size={19} />
              </PressableButton>
            )}
          />
          <AnimatedList className="min-h-0 flex-1 overflow-y-auto">
            {loading ? <div className="p-3 text-xs text-slate-500">불러오는 중...</div> : null}
            {!loading && receipts.length === 0 ? (
              <div className="grid h-full place-items-center p-3 text-xs text-slate-400">
                {isToday ? "오늘 입고 예정이거나 완료된 품목이 없습니다." : "내일 입고예정 품목이 없습니다."}
              </div>
            ) : null}
            {receipts.map((item) => (
              <AnimatedListItem key={item.productId} className="flex min-h-11 items-center gap-1 border-b border-slate-100 px-2 last:border-0 dark:border-slate-800">
                <PressableButton
                  type="button"
                  onClick={() => navigate({ name: "operation", productId: item.productId })}
                  className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-1 text-left hover:text-brand-700 dark:hover:text-brand-100"
                >
                  <span
                    className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-extrabold ${
                      item.status === "completed"
                        ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-200"
                        : "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-200"
                    }`}
                  >
                    {item.status === "completed" ? "입고완료" : "입고예정"}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-bold">{item.name}</span>
                  {item.lastReceivedAt && item.status === "completed" && isToday ? <span className="shrink-0 text-[10px] text-slate-400">{formatDateTime(item.lastReceivedAt).slice(-5)}</span> : null}
                  <ChevronRight className="shrink-0 text-slate-400" size={16} />
                </PressableButton>
                {item.quantity !== null ? <span className="shrink-0 text-xs font-bold text-brand-700 dark:text-brand-100">+{formatInventoryQuantity(item.quantity)}</span> : null}
                {isToday && item.status === "completed" ? (
                  <PressableButton
                    type="button"
                    disabled={receiptDeletingIds.has(item.productId) || receiptActioning}
                    onClick={() => void deleteTodayReceipt(item)}
                    className="touch-button grid shrink-0 place-items-center text-slate-400 hover:text-red-600 disabled:opacity-40 dark:hover:text-red-400"
                    aria-label={`${item.name} 금일 입고 삭제`}
                    title="금일 입고 삭제"
                  >
                    <Trash2 size={17} />
                  </PressableButton>
                ) : null}
              </AnimatedListItem>
            ))}
          </AnimatedList>
        </article>

        <article className="panel flex min-h-0 flex-col overflow-hidden">
          <SectionHeader
            icon={ClipboardCheck}
            title="To do list"
            badge={`${completedCount}/${todos.length}`}
            action={(
              <div className="flex items-center gap-1">
                <PressableButton
                  type="button"
                  onClick={() => {
                    setScheduledTodoDate(selectedDate ?? todayValue);
                    setShowScheduledTodoDialog(true);
                    setShowTodoForm(false);
                  }}
                  className="touch-button grid place-items-center rounded-md text-brand-700 dark:text-brand-100"
                  aria-label="날짜 지정 할 일 추가"
                  title="날짜 지정"
                >
                  <CalendarDays size={18} />
                </PressableButton>
                <PressableButton type="button" onClick={() => setShowTodoForm((value) => !value)} className="touch-button grid place-items-center rounded-md text-brand-700 dark:text-brand-100" aria-label="할 일 추가">
                  {showTodoForm ? <X size={19} /> : <Plus size={19} />}
                </PressableButton>
              </div>
            )}
          />
          {showTodoForm ? (
            <form onSubmit={addTodo} className="grid grid-cols-[1fr_auto] gap-1.5 border-b border-slate-100 p-2 dark:border-slate-800">
              <input className="field min-w-0 px-2 py-2 text-xs" value={todoDraft} onChange={(event) => setTodoDraft(event.target.value)} placeholder="할 일 입력" autoFocus />
              <PressableButton className="grid min-h-10 min-w-10 place-items-center rounded-md bg-brand-600 text-white" type="submit" disabled={saving || !todoDraft.trim()} surfaceFeedback={false} aria-label="저장">
                <Check size={18} />
              </PressableButton>
            </form>
          ) : null}
          <AnimatedList className="min-h-0 flex-1 overflow-y-auto">
            {!loading && todos.length === 0 ? (
              <div className="grid h-full place-items-center p-3 text-xs text-slate-400">
                {isToday ? "오늘 해야 할 일이 없습니다." : "내일 근무자를 위한 할 일이 없습니다."}
              </div>
            ) : null}
            {displayedTodos.map((todo) => {
              const staleInventoryProductId = todo.stale_inventory_product_id;
              const todoDisplayType = getTodoDisplayType(todo);
              const todoContainerClassName = todoDisplayType === "manual"
                ? "mx-2 my-1 rounded-lg border border-violet-100 bg-violet-50/90 px-2 dark:border-violet-900/70 dark:bg-violet-950/35"
                : todoDisplayType === "routine"
                  ? "mx-2 my-1 rounded-lg border border-slate-200 bg-slate-100/90 px-2 dark:border-slate-700 dark:bg-slate-800/80"
                  : "border-b border-slate-100 px-3 last:border-0 dark:border-slate-800";
              return (
                <AnimatedListItem key={todo.id} className={`flex min-h-11 items-center gap-2.5 ${todoContainerClassName}`}>
                  <label className={`${isToday ? "cursor-pointer" : ""}`}>
                    <input
                      type="checkbox"
                      checked={todo.is_completed}
                      disabled={!isToday || todoActioningIds.has(todo.id)}
                      onChange={() => void toggleTodo(todo)}
                      className="h-5 w-5 shrink-0 accent-brand-600 disabled:cursor-default disabled:opacity-60"
                      aria-label={`${todo.content} 완료`}
                    />
                  </label>
                  {staleInventoryProductId ? (
                    <PressableButton
                      type="button"
                      onClick={() => navigate({ name: "operation", productId: staleInventoryProductId })}
                      className={`flex min-w-0 flex-1 items-center gap-1 rounded-md px-1 py-1 text-left text-sm font-semibold hover:text-brand-700 dark:hover:text-brand-100 ${todo.is_completed ? "text-slate-400 line-through" : ""}`}
                    >
                      <span className="min-w-0 flex-1 truncate">{todo.content}</span>
                      <ChevronRight className="shrink-0 text-slate-400" size={15} />
                    </PressableButton>
                  ) : (
                    <span className={`min-w-0 flex-1 text-sm font-semibold ${todo.is_completed ? "text-slate-400 line-through" : ""}`}>{todo.content}</span>
                  )}
                  <PressableButton
                    type="button"
                    disabled={todoActioningIds.has(todo.id)}
                    onClick={() => void deleteTodo(todo)}
                    className="touch-button grid shrink-0 place-items-center text-slate-400 hover:text-red-600 disabled:opacity-40 dark:hover:text-red-400"
                    aria-label={`${todo.content} 삭제`}
                    title="삭제"
                  >
                    <Trash2 size={17} />
                  </PressableButton>
                </AnimatedListItem>
              );
            })}
          </AnimatedList>
        </article>

        <article className="panel flex min-h-0 flex-col overflow-hidden">
          <SectionHeader
            icon={ArrowRight}
            title="인수인계"
            badge={`${handovers.length}건`}
            action={
              <div className="flex items-center">
                <PressableButton type="button" onClick={() => void openHistory()} className="touch-button grid place-items-center rounded-md text-slate-500 dark:text-slate-300" aria-label="인수인계 히스토리">
                  <History size={18} />
                </PressableButton>
                {!isToday ? (
                  <PressableButton type="button" onClick={() => setShowHandoverForm((value) => !value)} className="touch-button grid place-items-center rounded-md text-brand-700 dark:text-brand-100" aria-label="인수인계 추가">
                    {showHandoverForm ? <X size={19} /> : <Plus size={19} />}
                  </PressableButton>
                ) : null}
              </div>
            }
          />
          {showHandoverForm ? (
            <form onSubmit={addHandover} className="border-b border-slate-100 p-2 dark:border-slate-800">
              <textarea className="field min-h-16 resize-none px-2 py-2 text-xs" value={handoverDraft} onChange={(event) => setHandoverDraft(event.target.value)} placeholder="내일 근무자에게 전달할 내용을 입력하세요." autoFocus />
              <PressableButton className="mt-1.5 min-h-10 w-full rounded-md bg-brand-600 px-3 text-xs font-bold text-white" type="submit" disabled={saving || !handoverDraft.trim()} surfaceFeedback={false}>
                내일 인수인계 저장
              </PressableButton>
            </form>
          ) : null}
          <AnimatedList className="min-h-0 flex-1 overflow-y-auto">
            {!loading && handovers.length === 0 ? (
              <div className="grid h-full place-items-center p-3 text-xs text-slate-400">
                {isToday ? "오늘 인지할 인수인계가 없습니다." : "내일 근무자를 위한 인수인계가 없습니다."}
              </div>
            ) : null}
            {handovers.map((note) => (
              <AnimatedListItem key={note.id} className="flex gap-2 border-b border-slate-100 px-3 py-2.5 last:border-0 dark:border-slate-800">
                <div className="min-w-0 flex-1">
                  <p className="whitespace-pre-wrap break-words text-sm font-semibold leading-snug">{note.content}</p>
                  <p className="mt-1 text-[10px] text-slate-400">{profiles.get(note.created_by) ?? "직원"} · {formatDateTime(note.created_at)}</p>
                </div>
                {!isToday ? (
                  <PressableButton
                    type="button"
                    disabled={deletingHandoverIds.has(note.id)}
                    onClick={() => void deleteHandover(note)}
                    className="touch-button grid shrink-0 place-items-center self-center text-slate-400 hover:text-red-600 disabled:opacity-40 dark:hover:text-red-400"
                    aria-label="인수인계 삭제"
                    title="삭제"
                  >
                    <Trash2 size={17} />
                  </PressableButton>
                ) : null}
              </AnimatedListItem>
            ))}
          </AnimatedList>
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
              <PressableButton type="button" onClick={() => setShowHistory(false)} className="touch-button icon-button" aria-label="닫기"><X size={20} /></PressableButton>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {history.length === 0 ? <StatusMessage>저장된 인수인계가 없습니다.</StatusMessage> : null}
              <AnimatedList className="space-y-2">
                {history.map((note) => (
                  <AnimatedListItem key={note.id} className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span className="text-xs font-extrabold text-brand-700 dark:text-brand-100">{shortDateLabel(note.handover_date)}</span>
                      <span className="text-[10px] text-slate-400">{note.author_name}</span>
                    </div>
                    <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{note.content}</p>
                  </AnimatedListItem>
                ))}
              </AnimatedList>
            </div>
          </div>
        </div>
      ) : null}

      {receiptHistoryOpen ? (
        <div className="fixed inset-0 z-50 flex items-end bg-slate-950/50 p-0 sm:items-center sm:justify-center sm:p-4" role="dialog" aria-modal="true" aria-label="입고 히스토리">
          <div className="flex max-h-[86dvh] w-full flex-col rounded-t-2xl bg-white shadow-2xl dark:bg-slate-950 sm:max-w-xl sm:rounded-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <HistoryReceiptIcon className="shrink-0 text-brand-700 dark:text-brand-100" size={21} />
                  <h2 className="truncate font-extrabold">입고 히스토리</h2>
                </div>
                <p className="mt-1 truncate text-xs text-slate-500 dark:text-slate-400">날짜별 입고 예정 품목과 실제 입고 품목을 확인합니다.</p>
              </div>
              <PressableButton type="button" onClick={() => setReceiptHistoryOpen(false)} className="touch-button icon-button shrink-0" aria-label="닫기">
                <X size={20} />
              </PressableButton>
            </div>

            <form
              className="grid grid-cols-[1fr_auto] gap-2 border-b border-slate-100 p-3 dark:border-slate-800"
              onSubmit={(event) => {
                event.preventDefault();
                void loadReceiptHistory(receiptHistoryDate);
              }}
            >
              <label className="min-w-0">
                <span className="sr-only">조회 날짜</span>
                <input className="field min-h-10" type="date" value={receiptHistoryDate} onChange={(event) => setReceiptHistoryDate(event.target.value)} />
              </label>
              <PressableButton type="submit" disabled={receiptHistoryLoading || !receiptHistoryDate} className="min-h-10 rounded-md bg-brand-600 px-4 text-xs font-extrabold text-white disabled:opacity-50" surfaceFeedback={false}>
                조회
              </PressableButton>
            </form>

            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {receiptHistoryError ? <StatusMessage type="error">{receiptHistoryError}</StatusMessage> : null}
              {receiptHistoryLoading ? <StatusMessage>입고 히스토리를 불러오는 중...</StatusMessage> : null}
              {!receiptHistoryLoading && !receiptHistoryError ? (
                <div className="space-y-3">
                  <section>
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <h3 className="text-sm font-extrabold text-slate-900 dark:text-slate-50">{shortDateLabel(receiptHistoryDate)} 입고 예정</h3>
                      <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-700 dark:bg-amber-950 dark:text-amber-200">{receiptHistoryExpected.length}종</span>
                    </div>
                    {receiptHistoryExpected.length === 0 ? (
                      <StatusMessage>해당 날짜에 입고 예정으로 확정된 품목이 없습니다.</StatusMessage>
                    ) : (
                      <AnimatedList className="space-y-2">
                        {receiptHistoryExpected.map((item) => (
                          <AnimatedListItem key={`expected-${item.productId}`} className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                            <div className="flex items-center justify-between gap-3">
                              <span className="min-w-0 truncate text-sm font-bold">{item.name}</span>
                              <span className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-extrabold text-amber-700 dark:bg-amber-950 dark:text-amber-200">입고예정</span>
                            </div>
                          </AnimatedListItem>
                        ))}
                      </AnimatedList>
                    )}
                  </section>

                  <section>
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <h3 className="text-sm font-extrabold text-slate-900 dark:text-slate-50">{shortDateLabel(receiptHistoryDate)} 입고 완료</h3>
                      <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-bold text-brand-700 dark:bg-brand-950 dark:text-brand-100">{receiptHistoryCompleted.length}종</span>
                    </div>
                    {receiptHistoryCompleted.length === 0 ? (
                      <StatusMessage>해당 날짜에 실제 입고된 품목이 없습니다.</StatusMessage>
                    ) : (
                      <AnimatedList className="space-y-2">
                        {receiptHistoryCompleted.map((item) => (
                          <AnimatedListItem key={`completed-${item.productId}`} className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                            <div className="flex items-center justify-between gap-3">
                              <div className="min-w-0">
                                <p className="truncate text-sm font-bold">{item.name}</p>
                                {item.lastReceivedAt ? <p className="mt-1 text-[11px] font-semibold text-slate-500 dark:text-slate-400">{formatDateTime(item.lastReceivedAt)}</p> : null}
                              </div>
                              <div className="flex shrink-0 items-center gap-2">
                                {item.quantity !== null ? <span className="text-xs font-extrabold text-brand-700 dark:text-brand-100">+{formatInventoryQuantity(item.quantity)}</span> : null}
                                <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-extrabold text-brand-700 dark:bg-brand-950 dark:text-brand-100">입고완료</span>
                              </div>
                            </div>
                          </AnimatedListItem>
                        ))}
                      </AnimatedList>
                    )}
                  </section>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {showScheduledTodoDialog ? (
        <div className="fixed inset-0 z-50 flex items-end bg-slate-950/50 p-0 sm:items-center sm:justify-center sm:p-4" role="dialog" aria-modal="true" aria-label="날짜 지정 할 일 추가">
          <div className="flex max-h-[82dvh] w-full flex-col rounded-t-2xl bg-white shadow-2xl dark:bg-slate-950 sm:max-w-md sm:rounded-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
              <div>
                <h2 className="font-extrabold">날짜 지정 할 일</h2>
                <p className="text-xs text-slate-500">선택한 날짜의 홈 To do list에 추가합니다.</p>
              </div>
              <PressableButton type="button" onClick={() => setShowScheduledTodoDialog(false)} className="touch-button icon-button" aria-label="닫기">
                <X size={20} />
              </PressableButton>
            </div>
            <form onSubmit={addScheduledTodo} className="space-y-3 p-4">
              <label className="block">
                <span className="mb-1 block text-sm font-bold">날짜</span>
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
                  <input
                    className="field min-w-0 tabular-nums"
                    type="date"
                    value={scheduledTodoDate}
                    onChange={(event) => setScheduledTodoDate(event.target.value)}
                    autoFocus
                  />
                  <PressableButton
                    type="button"
                    onClick={() => {
                      setScheduledTodoCalendarMonth(getMonthStart(scheduledTodoDate || todayValue));
                      setShowScheduledTodoCalendar(true);
                    }}
                    className="touch-button grid place-items-center rounded-md border border-slate-200 bg-white text-brand-700 dark:border-slate-700 dark:bg-slate-900 dark:text-brand-100"
                    aria-label="달력에서 날짜 선택"
                    title="달력에서 날짜 선택"
                  >
                    <CalendarDays size={19} />
                  </PressableButton>
                </div>
              </label>
              <label className="block">
                <span className="mb-1 block text-sm font-bold">할 일</span>
                <input className="field" value={scheduledTodoDraft} onChange={(event) => setScheduledTodoDraft(event.target.value)} placeholder="할 일 입력" />
              </label>
              <button type="submit" disabled={saving || !scheduledTodoDraft.trim() || !scheduledTodoDate} className="primary-button inline-flex w-full items-center justify-center gap-2">
                <Check size={18} />
                {saving ? "저장 중..." : "추가"}
              </button>
            </form>
          </div>
        </div>
      ) : null}

      {showScheduledTodoCalendar ? (
        <div className="fixed inset-0 z-[60] flex items-end bg-slate-950/50 sm:items-center sm:justify-center sm:p-4" role="dialog" aria-modal="true" aria-label="날짜 선택 달력">
          <button type="button" onClick={() => setShowScheduledTodoCalendar(false)} className="absolute inset-0 cursor-default" aria-label="날짜 선택 달력 닫기" />
          <section className="relative z-10 w-full rounded-t-2xl bg-white p-3 shadow-2xl dark:bg-slate-950 sm:max-w-md sm:rounded-2xl">
            <div className="mb-3 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setScheduledTodoCalendarMonth((current) => addMonths(current, -1))}
                className="touch-button icon-button"
                aria-label="이전 달"
                title="이전 달"
              >
                <ChevronLeft size={19} />
              </button>
              <div className="flex min-w-0 items-center gap-2">
                <CalendarDays className="shrink-0 text-brand-700 dark:text-brand-100" size={20} />
                <h2 className="truncate text-lg font-extrabold">{formatMonthLabel(scheduledTodoCalendarMonth)}</h2>
              </div>
              <button
                type="button"
                onClick={() => setScheduledTodoCalendarMonth((current) => addMonths(current, 1))}
                className="touch-button icon-button"
                aria-label="다음 달"
                title="다음 달"
              >
                <ChevronRight size={19} />
              </button>
            </div>
            <div className="grid grid-cols-7 border-b border-slate-100 pb-2 text-center text-xs font-extrabold text-slate-500 dark:border-slate-800 dark:text-slate-400">
              {["일", "월", "화", "수", "목", "금", "토"].map((weekday) => <span key={weekday}>{weekday}</span>)}
            </div>
            <div className="mt-2 grid grid-cols-7 gap-1">
              {scheduledTodoCalendarDates.map((date) => {
                const isCurrentMonth = date.slice(0, 7) === scheduledTodoCalendarMonth.slice(0, 7);
                const isSelected = date === scheduledTodoDate;
                const isToday = date === todayValue;
                return (
                  <button
                    key={date}
                    type="button"
                    onClick={() => {
                      setScheduledTodoDate(date);
                      setShowScheduledTodoCalendar(false);
                    }}
                    className={`min-h-12 rounded-md border p-1.5 text-left transition-colors hover:bg-slate-50 dark:hover:bg-slate-900 ${
                      isSelected ? "border-brand-600 bg-brand-50 dark:border-brand-500 dark:bg-brand-950/40" : "border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950"
                    } ${isCurrentMonth ? "" : "opacity-45"}`}
                    aria-label={`${shortDateLabel(date)} 선택`}
                    aria-pressed={isSelected}
                  >
                    <span className={`grid h-6 w-6 place-items-center rounded-full text-xs font-extrabold ${isToday ? "bg-brand-600 text-white" : ""}`}>{Number(date.slice(-2))}</span>
                  </button>
                );
              })}
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
