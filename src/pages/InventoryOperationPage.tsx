import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowLeftRight, Check, History, List, Minus, Pencil, Plus, RotateCcw, X } from "lucide-react";
import { StatusMessage } from "../components/StatusMessage";
import { ACTIONS, QUICK_AMOUNTS } from "../lib/constants";
import { getSeoulDateValue } from "../lib/businessCalendar";
import { formatDateTime } from "../lib/date";
import { formatInventoryQuantity, formatLogContent, normalizeInventoryItem } from "../lib/inventory";
import { recordReceiptCheckOnly } from "../lib/receiptCheck";
import { resolveStoreStaffNames } from "../lib/staffNames";
import * as Services from "../services";
import type { AppRoute, InventoryItem, InventoryLog, Location, StockStatus } from "../types/domain";

type Props = {
  productId: string;
  navigate: (route: AppRoute) => void;
  canGoBack?: boolean;
  onBack?: () => void;
  currentStoreId: string;
};

const STOCK_STATUSES: StockStatus[] = ["충분", "절반 이하", "발주 필요"];
const DEFAULT_LOCATION_LONG_PRESS_MS = 700;

type InventoryHistoryPoint = {
  log: InventoryLog;
  warehouseQty: number;
  storeQty: number;
};

type LocationCheckInfo = {
  checkedAt: string | null;
  staffName: string | null;
};

type LocationCheckDates = {
  warehouse: LocationCheckInfo;
  store: LocationCheckInfo;
};

type StockOperationAction = (typeof ACTIONS)[number];

const emptyLocationCheckInfo: LocationCheckInfo = {
  checkedAt: null,
  staffName: null
};

function formatDateOnly(value: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(value));
}

function LastInventoryCheckLabel({ info }: { info: LocationCheckInfo }) {
  if (!info.checkedAt) return <>마지막 확인 -</>;

  const timeLabel = formatDateTime(info.checkedAt).split(" ").slice(1).join(" ");

  return (
    <>
      마지막 확인 {formatDateOnly(info.checkedAt)}
      {timeLabel ? <span className="hidden sm:inline"> {timeLabel}</span> : null}
      {info.staffName ? <> · {info.staffName}</> : null}
    </>
  );
}

function formatStatusUpdateError(message: string) {
  if (message.includes("status_enabled") || message.includes("stock_status") || message.includes("schema cache")) {
    return "상태 기능 DB 업데이트가 아직 적용되지 않았습니다. 관리자에게 products 상태 컬럼 추가를 요청해 주세요.";
  }
  return message;
}

function formatMemoSaveError(message: string) {
  if (message.includes("inventory_logs_action_check") || message.includes("schema cache")) {
    return "메모 기능 DB 업데이트가 아직 적용되지 않았습니다. 관리자에게 inventory_logs 액션 허용값 업데이트를 요청해 주세요.";
  }
  return message;
}

async function completeStaleInventoryTodo(productId: string, storeId: string, userId: string) {
  const todayValue = getSeoulDateValue();
  await Services.DatabaseService.update("dashboard_todos", {
      is_completed: true,
      completed_at: new Date().toISOString(),
      completed_by: userId
    })
    .eq("store_id", storeId)
    .eq("task_date", todayValue)
    .eq("stale_inventory_product_id", productId)
    .eq("is_completed", false);
}

export function InventoryOperationPage({ productId, navigate, canGoBack = false, onBack, currentStoreId }: Props) {
  const [item, setItem] = useState<InventoryItem | null>(null);
  const [history, setHistory] = useState<InventoryHistoryPoint[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [action, setAction] = useState<StockOperationAction>("조정");
  const [location, setLocation] = useState<Location>("창고");
  const [moveDirection, setMoveDirection] = useState<"warehouse-to-store" | "store-to-warehouse">("warehouse-to-store");
  const [quantity, setQuantity] = useState("");
  const [receiptQuantity, setReceiptQuantity] = useState("1");
  const [memoText, setMemoText] = useState("");
  const [latestMemo, setLatestMemo] = useState<InventoryLog | null>(null);
  const [lastInventoryCheckDates, setLastInventoryCheckDates] = useState<LocationCheckDates>({
    warehouse: emptyLocationCheckInfo,
    store: emptyLocationCheckInfo
  });
  const [memoHistory, setMemoHistory] = useState<InventoryLog[]>([]);
  const [memoStaffNames, setMemoStaffNames] = useState<Map<string, string>>(new Map());
  const [memoHistoryOpen, setMemoHistoryOpen] = useState(false);
  const [memoHistoryLoading, setMemoHistoryLoading] = useState(false);
  const [memoError, setMemoError] = useState("");
  const [memoSuccess, setMemoSuccess] = useState("");
  const [editingMinimumStock, setEditingMinimumStock] = useState(false);
  const [minimumStockDraft, setMinimumStockDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [receiptSaving, setReceiptSaving] = useState(false);
  const [memoSaving, setMemoSaving] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [statusSaving, setStatusSaving] = useState(false);
  const [defaultLocationSaving, setDefaultLocationSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const defaultLocationPressTimerRef = useRef<number | null>(null);

  const loadProduct = useCallback(async () => {
    setLoading(true);
    setError("");
    const { data, error: loadError } = await Services.DatabaseService.select("products", "*, inventory(*)").eq("store_id", currentStoreId).eq("id", productId).single();

    if (loadError) {
      setError(loadError.message);
    } else {
      const nextItem = normalizeInventoryItem(data as Parameters<typeof normalizeInventoryItem>[0]);

      if (!nextItem.inventory) {
        const { data: inventoryData, error: inventoryError } = await Services.DatabaseService.upsert("inventory", { product_id: productId, store_id: currentStoreId }, { onConflict: "product_id" })
          .select()
          .single();

        if (inventoryError) {
          setError(inventoryError.message);
        } else {
          const itemWithInventory = normalizeInventoryItem({
            ...nextItem,
            inventory: inventoryData
          });
          setItem(itemWithInventory);
          setMinimumStockDraft(String(itemWithInventory.minimum_stock));
        }
      } else {
        setItem(nextItem);
        setMinimumStockDraft(String(nextItem.minimum_stock));
      }
    }
    setLoading(false);
  }, [currentStoreId, productId]);

  const loadMemoStaffNames = useCallback(async (memos: InventoryLog[]) => {
    const missingUserIds = Array.from(
      new Set(
        memos
          .map((memo) => memo.user_id)
          .filter((userId) => !memoStaffNames.has(userId))
      )
    );
    if (missingUserIds.length === 0) return;

    const resolvedStaffNames = await resolveStoreStaffNames(currentStoreId, missingUserIds);
    setMemoStaffNames((current) => {
      const next = new Map(current);
      missingUserIds.forEach((userId) => {
        next.set(userId, resolvedStaffNames.get(userId) ?? "직원");
      });
      return next;
    });
  }, [currentStoreId, memoStaffNames]);

  function logAffectsLocation(log: InventoryLog, targetLocation: Location) {
    if (log.source_location === targetLocation || log.destination_location === targetLocation) return true;
    if (targetLocation === "창고" && log.warehouse_qty_before !== null && log.warehouse_qty_after !== null) {
      return log.warehouse_qty_before !== log.warehouse_qty_after;
    }
    if (targetLocation === "매장" && log.store_qty_before !== null && log.store_qty_after !== null) {
      return log.store_qty_before !== log.store_qty_after;
    }
    return false;
  }

  const loadLatestInventoryCheck = useCallback(async () => {
    const { data, error: latestCheckError } = await Services.DatabaseService.select("inventory_logs", "*")
      .eq("store_id", currentStoreId)
      .eq("product_id", productId)
      .neq("action", "메모")
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(100);

    if (latestCheckError) {
      setLastInventoryCheckDates({
        warehouse: emptyLocationCheckInfo,
        store: emptyLocationCheckInfo
      });
      return;
    }

    const logs = (data ?? []) as InventoryLog[];
    const warehouseLog = logs.find((log) => logAffectsLocation(log, "창고")) ?? null;
    const storeLog = logs.find((log) => logAffectsLocation(log, "매장")) ?? null;
    const userIds = Array.from(new Set([warehouseLog?.user_id, storeLog?.user_id].filter(Boolean) as string[]));
    const staffNames = await resolveStoreStaffNames(currentStoreId, userIds);

    setLastInventoryCheckDates({
      warehouse: {
        checkedAt: warehouseLog?.created_at ?? null,
        staffName: warehouseLog ? staffNames.get(warehouseLog.user_id) ?? "직원" : null
      },
      store: {
        checkedAt: storeLog?.created_at ?? null,
        staffName: storeLog ? staffNames.get(storeLog.user_id) ?? "직원" : null
      }
    });
  }, [currentStoreId, productId]);

  const loadLatestMemo = useCallback(async () => {
    setMemoError("");
    setLatestMemo(null);
    const { data, error: latestMemoError } = await Services.DatabaseService.select("inventory_logs", "*")
      .eq("store_id", currentStoreId)
      .eq("product_id", productId)
      .eq("action", "메모")
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latestMemoError) {
      setMemoError(formatMemoSaveError(latestMemoError.message));
    } else {
      const nextMemo = (data as InventoryLog | null) ?? null;
      setLatestMemo(nextMemo);
      if (nextMemo) await loadMemoStaffNames([nextMemo]);
    }
  }, [currentStoreId, loadMemoStaffNames, productId]);

  useEffect(() => {
    void loadProduct();
  }, [loadProduct]);

  useEffect(() => {
    if (!item?.id) return;
    setLocation(item.default_location ?? "창고");
  }, [item?.default_location, item?.id]);

  useEffect(() => {
    return () => {
      if (defaultLocationPressTimerRef.current !== null) {
        window.clearTimeout(defaultLocationPressTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    void loadLatestMemo();
  }, [loadLatestMemo]);

  useEffect(() => {
    void loadLatestInventoryCheck();
  }, [loadLatestInventoryCheck]);

  const quantityValue = quantity.trim() === "" ? 0 : Number(quantity);
  const receiptQuantityValue = receiptQuantity.trim() === "" ? 0 : Number(receiptQuantity);
  const memoIsEmpty = memoText.trim().length === 0;
  const quantityStepError = useMemo(() => {
    if (quantity.trim() === "") return "";
    if (!Number.isFinite(quantityValue) || quantityValue < 0) return "수량은 0 이상이어야 합니다.";
    return "";
  }, [quantity, quantityValue]);

  const negativeError = useMemo(() => {
    if (!item) return "";
    if (action === "입고" || action === "조정") return "";
    if (action === "출고") {
      const current = location === "창고" ? item.warehouse_qty : item.store_qty;
      return current - quantityValue < 0 ? `${location} 재고는 음수가 될 수 없습니다.` : "";
    }
    const sourceQty = moveDirection === "warehouse-to-store" ? item.warehouse_qty : item.store_qty;
    const sourceLabel = moveDirection === "warehouse-to-store" ? "창고" : "매장";
    return sourceQty - quantityValue < 0 ? `${sourceLabel} 재고는 음수가 될 수 없습니다.` : "";
  }, [action, item, location, moveDirection, quantityValue]);

  const receiptQuantityError = useMemo(() => {
    if (receiptQuantity.trim() === "") return "입고 개수를 입력해 주세요.";
    if (!Number.isFinite(receiptQuantityValue) || receiptQuantityValue <= 0) return "입고 개수는 0보다 커야 합니다.";
    return "";
  }, [receiptQuantity, receiptQuantityValue]);

  function quantityNumberOrZero(value: string) {
    const numericValue = Number(value || 0);
    return Number.isFinite(numericValue) ? numericValue : 0;
  }

  function addQuickAmount(amount: number) {
    setQuantity((value) => String(quantityNumberOrZero(value) + amount));
  }

  function decreaseQuantity() {
    setQuantity((value) => String(Math.max(0, quantityNumberOrZero(value) - 1)));
  }

  function updateQuantityInput(value: string) {
    const nextValue = value.replace(",", ".");
    if (/^\d*\.?\d*$/.test(nextValue)) {
      setQuantity(nextValue);
    }
  }

  function updateReceiptQuantityInput(value: string) {
    const nextValue = value.replace(",", ".");
    if (/^\d*\.?\d*$/.test(nextValue)) {
      setReceiptQuantity(nextValue);
    }
  }

  async function updateStockStatus(nextStatusEnabled: boolean, nextStockStatus: StockStatus | null = item?.stock_status ?? "충분") {
    if (!item) return;

    setStatusSaving(true);
    setError("");
    setSuccess("");
    const stockStatus = nextStatusEnabled ? nextStockStatus ?? "충분" : nextStockStatus;
    const { error: updateError } = await Services.DatabaseService.update("products", { status_enabled: nextStatusEnabled, stock_status: stockStatus })
      .eq("store_id", currentStoreId)
      .eq("id", item.id);

    if (updateError) {
      setError(formatStatusUpdateError(updateError.message));
    } else {
      setItem((current) =>
        current
          ? {
              ...current,
              status_enabled: nextStatusEnabled,
              stock_status: stockStatus,
              is_low_stock: nextStatusEnabled ? stockStatus === "발주 필요" : current.total_stock <= current.minimum_stock
            }
          : current
      );
      setSuccess("상태를 저장했습니다.");
    }
    setStatusSaving(false);
  }

  async function saveMinimumStock() {
    if (!item) return;

    setError("");
    setSuccess("");
    const nextMinimumStock = Math.max(0, Number(minimumStockDraft || 0));
    const { error: updateError } = await Services.DatabaseService.update("products", { minimum_stock: nextMinimumStock }).eq("store_id", currentStoreId).eq("id", item.id);

    if (updateError) {
      setError(updateError.message);
    } else {
      setEditingMinimumStock(false);
      setSuccess("최소재고를 수정했습니다.");
      await loadProduct();
    }
  }

  function clearDefaultLocationPressTimer() {
    if (defaultLocationPressTimerRef.current === null) return;
    window.clearTimeout(defaultLocationPressTimerRef.current);
    defaultLocationPressTimerRef.current = null;
  }

  function startDefaultLocationPress(nextLocation: Location) {
    clearDefaultLocationPressTimer();
    defaultLocationPressTimerRef.current = window.setTimeout(() => {
      defaultLocationPressTimerRef.current = null;
      void saveDefaultLocation(nextLocation);
    }, DEFAULT_LOCATION_LONG_PRESS_MS);
  }

  async function saveDefaultLocation(nextLocation: Location) {
    if (!item || defaultLocationSaving) return;

    setLocation(nextLocation);
    setError("");
    setSuccess("");

    if (item.default_location === nextLocation) {
      setSuccess(`${nextLocation}가 기본값으로 선택되어 있습니다.`);
      return;
    }

    setDefaultLocationSaving(true);
    const { error: updateError } = await Services.DatabaseService.update("products", { default_location: nextLocation })
      .eq("store_id", currentStoreId)
      .eq("id", item.id);

    if (updateError) {
      setError(updateError.message);
    } else {
      setItem((current) => current ? { ...current, default_location: nextLocation } : current);
      setSuccess(`다음 재고 작업부터 ${nextLocation}가 기본값으로 선택됩니다.`);
    }
    setDefaultLocationSaving(false);
  }

  function getStateBeforeLog(log: InventoryLog, warehouseQty: number, storeQty: number) {
    if (log.warehouse_qty_before !== null && log.store_qty_before !== null) {
      return { warehouseQty: log.warehouse_qty_before, storeQty: log.store_qty_before };
    }

    if (log.action === "이동" && log.source_location && log.destination_location && log.quantity !== null) {
      if (log.source_location === "창고") {
        return { warehouseQty: warehouseQty + log.quantity, storeQty: storeQty - log.quantity };
      }
      return { warehouseQty: warehouseQty - log.quantity, storeQty: storeQty + log.quantity };
    }

    const targetLocation = log.destination_location ?? log.source_location;
    if (targetLocation === "창고" && log.previous_quantity !== null) {
      return { warehouseQty: log.previous_quantity, storeQty };
    }
    if (targetLocation === "매장" && log.previous_quantity !== null) {
      return { warehouseQty, storeQty: log.previous_quantity };
    }
    return { warehouseQty, storeQty };
  }

  async function openHistory() {
    if (!item) return;

    setHistoryOpen(true);
    setHistoryLoading(true);
    setError("");
    const { data, error: historyError } = await Services.DatabaseService.select("inventory_logs", "*")
      .eq("store_id", currentStoreId)
      .eq("product_id", item.id)
      .neq("action", "메모")
      .is("reverted_at", null)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(200);

    if (historyError) {
      setError(
        historyError.message.includes("reverted_at")
          ? "상세 되돌리기 기능을 위한 데이터베이스 업데이트가 필요합니다."
          : historyError.message
      );
      setHistory([]);
    } else {
      let warehouseQty = item.warehouse_qty;
      let storeQty = item.store_qty;
      const points = ((data ?? []) as InventoryLog[]).map((log) => {
        const point = {
          log,
          warehouseQty: log.warehouse_qty_after ?? warehouseQty,
          storeQty: log.store_qty_after ?? storeQty
        };
        const before = getStateBeforeLog(log, point.warehouseQty, point.storeQty);
        warehouseQty = before.warehouseQty;
        storeQty = before.storeQty;
        return point;
      });
      setHistory(points);
    }
    setHistoryLoading(false);
  }

  async function restoreToHistoryPoint(point: InventoryHistoryPoint) {
    if (!item) return;
    const confirmed = window.confirm(
      `${formatDateTime(point.log.created_at)} 작업 직후 상태로 복원하시겠습니까?\n창고 ${formatInventoryQuantity(point.warehouseQty)} / 매장 ${formatInventoryQuantity(point.storeQty)}\n선택 시점 이후 작업은 히스토리에서 취소 처리됩니다.`
    );
    if (!confirmed) return;

    setRestoring(true);
    setError("");
    setSuccess("");
    const { error: restoreError } = await Services.DatabaseService.rpc("restore_inventory_to_log", {
      target_log_id: point.log.id,
      restored_warehouse_qty: point.warehouseQty,
      restored_store_qty: point.storeQty
    });

    if (restoreError) {
      setError(
        restoreError.message.includes("restore_inventory_to_log")
          ? "상세 되돌리기 기능을 위한 데이터베이스 업데이트가 필요합니다."
          : restoreError.message
      );
    } else {
      setHistoryOpen(false);
      setSuccess(`${formatDateTime(point.log.created_at)} 시점으로 재고를 복원했습니다.`);
      setQuantity("");
      await loadProduct();
      await loadLatestInventoryCheck();
    }
    setRestoring(false);
  }

  async function openMemoHistory() {
    if (!item) return;

    setMemoHistoryOpen(true);
    setMemoHistoryLoading(true);
    setMemoError("");
    const { data, error: memoHistoryError } = await Services.DatabaseService.select("inventory_logs", "*")
      .eq("store_id", currentStoreId)
      .eq("product_id", item.id)
      .eq("action", "메모")
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(100);

    if (memoHistoryError) {
      setMemoError(formatMemoSaveError(memoHistoryError.message));
      setMemoHistory([]);
    } else {
      const nextMemoHistory = (data ?? []) as InventoryLog[];
      setMemoHistory(nextMemoHistory);
      setLatestMemo(nextMemoHistory[0] ?? null);
      await loadMemoStaffNames(nextMemoHistory);
    }
    setMemoHistoryLoading(false);
  }

  function getMemoStaffName(memo: InventoryLog): string {
    return memoStaffNames.get(memo.user_id) ?? "직원";
  }

  async function handleMemoSubmit(event: FormEvent) {
    event.preventDefault();
    if (!item || memoIsEmpty) return;

    setMemoSaving(true);
    setMemoError("");
    setMemoSuccess("");

    const { data: userData, error: userError } = await Services.AuthService.getUser();
    if (userError || !userData.user) {
      setMemoError(userError?.message ?? "로그인이 필요합니다.");
      setMemoSaving(false);
      return;
    }

    const { data: savedMemo, error: logError } = await Services.DatabaseService.insert("inventory_logs", {
        store_id: currentStoreId,
        product_id: item.id,
        user_id: userData.user.id,
        action: "메모",
        source_location: null,
        destination_location: null,
        previous_quantity: null,
        new_quantity: null,
        quantity: null,
        note: memoText.trim(),
        warehouse_qty_before: item.warehouse_qty,
        store_qty_before: item.store_qty,
        warehouse_qty_after: item.warehouse_qty,
        store_qty_after: item.store_qty
      })
      .select("*")
      .single();

    if (logError) {
      setMemoError(formatMemoSaveError(logError.message));
    } else {
      setMemoSuccess("메모를 저장했습니다.");
      setMemoText("");
      if (savedMemo) {
        const nextMemo = savedMemo as InventoryLog;
        setLatestMemo(nextMemo);
        setMemoHistory((current) => [nextMemo, ...current]);
        await loadMemoStaffNames([nextMemo]);
      }
    }
    setMemoSaving(false);
  }

  async function completeReceiptCheckOnly() {
    if (!item || receiptQuantityError) return;

    setReceiptSaving(true);
    setError("");
    setSuccess("");
    const { data: userData } = await Services.AuthService.getUser();
    if (!userData.user) {
      setError("로그인이 필요합니다.");
      setReceiptSaving(false);
      return;
    }

    const { errorMessage } = await recordReceiptCheckOnly(item.id, currentStoreId, receiptQuantityValue);

    if (errorMessage) {
      setError(errorMessage);
    } else {
      await completeStaleInventoryTodo(item.id, currentStoreId, userData.user.id);
      setSuccess(`입고완료 ${formatInventoryQuantity(receiptQuantityValue)}개를 기록했습니다.`);
      setReceiptQuantity("1");
      await loadLatestInventoryCheck();
    }
    setReceiptSaving(false);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!item || negativeError || quantityStepError) return;

    setSaving(true);
    setError("");
    setSuccess("");

    const currentInventory = item.inventory;
    if (!currentInventory) {
      await loadProduct();
      setError("재고 정보를 준비했습니다. 다시 저장해 주세요.");
      setSaving(false);
      return;
    }

    const source = action === "출고" ? location : action === "이동" ? (moveDirection === "warehouse-to-store" ? "창고" : "매장") : action === "조정" ? location : null;
    const destination = action === "입고" ? location : action === "이동" ? (moveDirection === "warehouse-to-store" ? "매장" : "창고") : null;
    let nextWarehouseQty = item.warehouse_qty;
    let nextStoreQty = item.store_qty;
    let previousQuantity = location === "창고" ? item.warehouse_qty : item.store_qty;
    let newQuantity = previousQuantity;

    if (action === "입고") {
      if (location === "창고") {
        previousQuantity = item.warehouse_qty;
        nextWarehouseQty += quantityValue;
        newQuantity = nextWarehouseQty;
      } else {
        previousQuantity = item.store_qty;
        nextStoreQty += quantityValue;
        newQuantity = nextStoreQty;
      }
    } else if (action === "출고") {
      if (location === "창고") {
        previousQuantity = item.warehouse_qty;
        nextWarehouseQty -= quantityValue;
        newQuantity = nextWarehouseQty;
      } else {
        previousQuantity = item.store_qty;
        nextStoreQty -= quantityValue;
        newQuantity = nextStoreQty;
      }
    } else if (action === "이동") {
      if (moveDirection === "warehouse-to-store") {
        previousQuantity = item.warehouse_qty;
        nextWarehouseQty -= quantityValue;
        nextStoreQty += quantityValue;
        newQuantity = nextWarehouseQty;
      } else {
        previousQuantity = item.store_qty;
        nextStoreQty -= quantityValue;
        nextWarehouseQty += quantityValue;
        newQuantity = nextStoreQty;
      }
    } else if (location === "창고") {
      previousQuantity = item.warehouse_qty;
      nextWarehouseQty = quantityValue;
      newQuantity = nextWarehouseQty;
    } else {
      previousQuantity = item.store_qty;
      nextStoreQty = quantityValue;
      newQuantity = nextStoreQty;
    }

    const { data: userData, error: userError } = await Services.AuthService.getUser();
    if (userError || !userData.user) {
      setError(userError?.message ?? "로그인이 필요합니다.");
      setSaving(false);
      return;
    }

    const { error: updateError } = await Services.DatabaseService.update("inventory", { warehouse_qty: nextWarehouseQty, store_qty: nextStoreQty })
      .eq("store_id", currentStoreId)
      .eq("id", currentInventory.id);

    if (updateError) {
      setError(updateError.message);
      setSaving(false);
      return;
    }

    const { error: logError } = await Services.DatabaseService.insert("inventory_logs", {
      store_id: currentStoreId,
      product_id: item.id,
      user_id: userData.user.id,
      action,
      source_location: source,
      destination_location: destination,
      previous_quantity: previousQuantity,
      new_quantity: newQuantity,
      quantity: quantityValue,
      note: null,
      warehouse_qty_before: item.warehouse_qty,
      store_qty_before: item.store_qty,
      warehouse_qty_after: nextWarehouseQty,
      store_qty_after: nextStoreQty
    });

    if (logError) {
      setError(logError.message);
    } else {
      if (action === "입고" && (item.fresh_order_selected || item.urgent_order_requested || item.order_completed)) {
        const { error: freshCompleteError } = await Services.DatabaseService.update("products", {
            fresh_order_selected: false,
            fresh_order_selected_at: null,
            urgent_order_requested: false,
            urgent_order_quantity: null,
            order_completed: false
          })
          .eq("store_id", currentStoreId)
          .eq("id", item.id);

        if (freshCompleteError) {
          setError(freshCompleteError.message);
          setSaving(false);
          return;
        }
      }
      setSuccess("저장되었습니다.");
      setQuantity("");
      await completeStaleInventoryTodo(item.id, currentStoreId, userData.user.id);
      await loadProduct();
      await loadLatestInventoryCheck();
    }
    setSaving(false);
  }

  if (loading) return <StatusMessage>상품 정보를 불러오는 중...</StatusMessage>;
  if (!item) return <StatusMessage type="error">상품을 찾을 수 없습니다.</StatusMessage>;

  return (
    <section>
      <div className="mb-4 flex min-w-0 items-center gap-2">
        {canGoBack && onBack ? (
          <button className="touch-button icon-button shrink-0" type="button" onClick={onBack} aria-label="뒤로가기" title="뒤로가기">
            <ArrowLeft size={18} />
          </button>
        ) : null}
        <h1 className="min-w-0 flex-1 truncate text-2xl font-bold tracking-normal">재고 작업</h1>
        <div className="flex shrink-0 items-center gap-2">
          <button className="touch-button icon-button" type="button" onClick={() => navigate({ name: "product-edit", productId: item.id })} aria-label="상품 수정" title="수정">
            <Pencil size={18} />
          </button>
          <button className="touch-button icon-button" type="button" onClick={() => navigate({ name: "inventory" })} aria-label="목록으로 이동" title="목록">
            <List size={19} />
          </button>
          <button
            className="touch-button icon-button text-rose-700 disabled:cursor-not-allowed disabled:opacity-45 dark:text-rose-300"
            type="button"
            disabled={restoring || saving || item.receipt_check_only}
            onClick={() => void openHistory()}
            aria-label="되돌리기"
            title={item.receipt_check_only ? "입고여부만 확인 품목" : restoring ? "처리 중" : "되돌리기"}
          >
            <History size={19} />
          </button>
        </div>
      </div>

      <div className="-mt-2 mb-2 flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="break-words text-2xl font-bold leading-tight text-slate-950 dark:text-slate-100">{item.name}</p>
        </div>
        <div className="flex max-w-[56%] shrink-0 flex-col items-end gap-1.5 text-xs sm:max-w-none sm:text-sm">
          <div className="flex flex-wrap justify-end gap-1.5">
            <span className="rounded-md border border-slate-200 bg-white px-2 py-1 font-semibold dark:border-slate-800 dark:bg-slate-900">
              <strong className="text-slate-950 dark:text-slate-100">{item.storage_type ?? "미지정"}</strong>
            </span>
            <span className="rounded-md border border-slate-200 bg-white px-2 py-1 font-semibold dark:border-slate-800 dark:bg-slate-900">
              <strong className="text-slate-950 dark:text-slate-100">{item.supplier_name ?? "미지정"}</strong>
            </span>
            {item.unit_name ? (
              <span className="rounded-md border border-slate-200 bg-white px-2 py-1 font-semibold dark:border-slate-800 dark:bg-slate-900">
                <strong className="text-slate-950 dark:text-slate-100">{item.unit_name}</strong>
              </span>
            ) : null}
          </div>
        </div>
      </div>

      {item.receipt_check_only ? (
        <div className="panel p-4">
          <div className="rounded-md border border-sky-200 bg-sky-50 p-3 dark:border-sky-900 dark:bg-sky-950/40">
            <p className="text-sm font-extrabold text-sky-800 dark:text-sky-100">입고여부만 확인</p>
            <p className="mt-1 text-sm font-semibold text-slate-600 dark:text-slate-300">
              이 품목은 재고 수량을 관리하지 않고 입고된 개수만 기록합니다.
            </p>
          </div>
          <label className="mt-3 block">
            <span className="mb-1 block text-sm font-bold">입고 개수</span>
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={() => setReceiptQuantity((value) => String(Math.max(1, quantityNumberOrZero(value) - 1)))}
                className="secondary-button inline-flex min-h-11 w-12 items-center justify-center px-2 py-1.5"
                aria-label="입고 개수 감소"
              >
                <Minus size={18} />
              </button>
              <input
                className="field py-1.5 text-center text-lg font-bold"
                type="text"
                inputMode="decimal"
                pattern="[0-9]*[.]?[0-9]*"
                value={receiptQuantity}
                onChange={(event) => updateReceiptQuantityInput(event.target.value)}
              />
              <button
                type="button"
                onClick={() => setReceiptQuantity((value) => String(quantityNumberOrZero(value) + 1))}
                className="secondary-button inline-flex min-h-11 w-12 items-center justify-center px-2 py-1.5"
                aria-label="입고 개수 증가"
              >
                <Plus size={18} />
              </button>
            </div>
          </label>
          <div className="mt-2 grid grid-cols-3 gap-1.5">
            {QUICK_AMOUNTS.map((amount) => (
              <button
                key={amount}
                type="button"
                onClick={() => setReceiptQuantity((value) => String(quantityNumberOrZero(value) + amount))}
                className="secondary-button min-h-10 px-3 py-1.5 text-sm"
              >
                +{amount}
              </button>
            ))}
          </div>
          {receiptQuantityError ? <div className="mt-3"><StatusMessage type="error">{receiptQuantityError}</StatusMessage></div> : null}
          {error ? <div className="mt-3"><StatusMessage type="error">{error}</StatusMessage></div> : null}
          {success ? <div className="mt-3"><StatusMessage type="success">{success}</StatusMessage></div> : null}
          <button
            type="button"
            disabled={receiptSaving || Boolean(receiptQuantityError)}
            onClick={() => void completeReceiptCheckOnly()}
            className="primary-button mt-3 inline-flex w-full items-center justify-center gap-2"
          >
            <Check size={20} />
            {receiptSaving ? "처리 중..." : "입고완료"}
          </button>
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-[0.8fr_1.2fr]">
          <div className="panel p-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-md bg-slate-100 p-2 dark:bg-slate-900">
                <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">창고</p>
                <p className="text-xl font-bold">{formatInventoryQuantity(item.warehouse_qty)}</p>
                <p className="mt-1 text-[10px] font-semibold leading-snug text-slate-500 dark:text-slate-400">
                  <LastInventoryCheckLabel info={lastInventoryCheckDates.warehouse} />
                </p>
              </div>
              <div className="rounded-md bg-slate-100 p-2 dark:bg-slate-900">
                <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">매장</p>
                <p className="text-xl font-bold">{formatInventoryQuantity(item.store_qty)}</p>
                <p className="mt-1 text-[10px] font-semibold leading-snug text-slate-500 dark:text-slate-400">
                  <LastInventoryCheckLabel info={lastInventoryCheckDates.store} />
                </p>
              </div>
            </div>
            <div className="mt-2 rounded-md border border-slate-200 p-2 text-sm dark:border-slate-800">
              <div className="flex flex-wrap items-center gap-2">
                <span>
                  총재고 <strong>{formatInventoryQuantity(item.total_stock)}</strong> · 최소재고 <strong>{item.minimum_stock}</strong>
                </span>
              {editingMinimumStock ? (
                <span className="inline-flex items-center gap-1">
                  <input
                    className="field min-h-0 w-20 px-2 py-1 text-sm"
                    type="number"
                    min={0}
                    value={minimumStockDraft}
                    onChange={(event) => setMinimumStockDraft(event.target.value)}
                    aria-label="최소재고"
                  />
                  <button type="button" onClick={saveMinimumStock} className="rounded border border-brand-600 px-2 py-1 text-sm font-bold text-brand-700 dark:text-brand-100">
                    저장
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingMinimumStock(false);
                      setMinimumStockDraft(String(item.minimum_stock));
                    }}
                    className="rounded border border-slate-300 px-2 py-1 text-sm font-bold dark:border-slate-700"
                  >
                    취소
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setMinimumStockDraft(String(item.minimum_stock));
                    setEditingMinimumStock(true);
                  }}
                  className="rounded border border-slate-300 px-2 py-1 text-sm font-bold dark:border-slate-700"
                >
                  수정
                </button>
              )}
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="panel p-2.5">
          <div className="grid grid-cols-4 gap-1.5">
            {ACTIONS.map((name) => (
              <label key={name} className={`min-h-10 rounded-md border px-2 py-2 text-center text-sm font-bold ${action === name ? "border-brand-600 bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-100" : "border-slate-200 dark:border-slate-800"}`}>
                <input className="sr-only" type="radio" checked={action === name} onChange={() => setAction(name)} />
                {name}
              </label>
            ))}
          </div>

          {action !== "이동" ? (
            <div className="mt-2 grid grid-cols-2 gap-1.5">
              {(["창고", "매장"] as Location[]).map((name) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => setLocation(name)}
                  onPointerDown={() => startDefaultLocationPress(name)}
                  onPointerUp={clearDefaultLocationPressTimer}
                  onPointerLeave={clearDefaultLocationPressTimer}
                  onPointerCancel={clearDefaultLocationPressTimer}
                  onContextMenu={(event) => event.preventDefault()}
                  disabled={defaultLocationSaving}
                  draggable={false}
                  className={`${location === name ? "primary-button" : "secondary-button"} min-h-10 select-none px-3 py-1.5 text-sm touch-manipulation disabled:cursor-not-allowed disabled:opacity-60`}
                  style={{ WebkitUserSelect: "none", userSelect: "none" }}
                  title="길게 누르면 기본값으로 저장"
                >
                  {name}
                </button>
              ))}
            </div>
          ) : (
            <div className="mt-2 grid grid-cols-2 gap-1.5">
              <button type="button" onClick={() => setMoveDirection("warehouse-to-store")} className={`${moveDirection === "warehouse-to-store" ? "primary-button" : "secondary-button"} min-h-10 px-3 py-1.5 text-sm`}>
                창고 → 매장
              </button>
              <button type="button" onClick={() => setMoveDirection("store-to-warehouse")} className={`${moveDirection === "store-to-warehouse" ? "primary-button" : "secondary-button"} min-h-10 px-3 py-1.5 text-sm`}>
                매장 → 창고
              </button>
            </div>
          )}

          <label className="mt-2 block">
            <span className="mb-0.5 block text-xs font-semibold">{action === "조정" ? "실제 재고 수량" : "수량"}</span>
            <div className="flex gap-1.5">
              <button type="button" onClick={decreaseQuantity} className="secondary-button inline-flex min-h-10 w-12 items-center justify-center px-2 py-1.5" aria-label="수량 감소">
                <Minus size={18} />
              </button>
              <input
                className="field py-1.5 text-center text-lg font-bold"
                type="text"
                inputMode="decimal"
                pattern="[0-9]*[.]?[0-9]*"
                value={quantity}
                onChange={(event) => updateQuantityInput(event.target.value)}
              />
              <button type="button" onClick={() => addQuickAmount(1)} className="secondary-button inline-flex min-h-10 w-12 items-center justify-center px-2 py-1.5" aria-label="수량 증가">
                <Plus size={18} />
              </button>
            </div>
          </label>

          <div className="mt-1.5 grid grid-cols-3 gap-1.5">
            {QUICK_AMOUNTS.map((amount) => (
              <button key={amount} type="button" onClick={() => addQuickAmount(amount)} className="secondary-button min-h-10 px-3 py-1.5 text-sm">
                +{amount}
              </button>
            ))}
          </div>

          {quantityStepError ? <div className="mt-3"><StatusMessage type="error">{quantityStepError}</StatusMessage></div> : null}
          {negativeError ? <div className="mt-3"><StatusMessage type="error">{negativeError}</StatusMessage></div> : null}
          {error ? <div className="mt-3"><StatusMessage type="error">{error}</StatusMessage></div> : null}
          {success ? <div className="mt-3"><StatusMessage type="success">{success}</StatusMessage></div> : null}

          <button className="primary-button mt-2 min-h-11 w-full py-2" type="submit" disabled={saving || quantityValue < 0 || Boolean(quantityStepError) || Boolean(negativeError)}>
            {saving ? "저장 중..." : "저장"}
          </button>

          <div className="mt-4 rounded-md border border-slate-200 p-3 dark:border-slate-800">
            <label className="flex items-center justify-between gap-3 text-sm font-bold">
              <span>상태</span>
              <input
                type="checkbox"
                checked={item.status_enabled}
                disabled={statusSaving}
                onChange={(event) => void updateStockStatus(event.target.checked)}
                className="h-6 w-6 accent-brand-600 disabled:opacity-45"
                aria-label="상태 기능 활성화"
              />
            </label>

            <div className="mt-3 grid grid-cols-3 gap-2">
              {STOCK_STATUSES.map((status) => {
                const selected = item.status_enabled && item.stock_status === status;

                return (
                  <button
                    key={status}
                    type="button"
                    disabled={!item.status_enabled || statusSaving}
                    onClick={() => void updateStockStatus(true, status)}
                    className={`touch-button rounded-md px-2 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-45 ${
                      selected ? "bg-brand-600 text-white" : "border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
                    }`}
                  >
                    {status}
                  </button>
                );
              })}
            </div>
          </div>

          {action === "이동" ? (
            <div className="mt-4 flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
              <ArrowLeftRight size={18} />
              이동은 한쪽 재고를 줄이고 반대쪽 재고를 늘립니다.
            </div>
          ) : null}

        </form>
      </div>
      )}

      <form onSubmit={handleMemoSubmit} className="panel mt-4 p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <label htmlFor="inventory-memo" className="text-sm font-bold">
            메모
          </label>
          <button
            type="button"
            onClick={() => void openMemoHistory()}
            className="touch-button icon-button shrink-0"
            aria-label="메모 히스토리"
            title="메모 히스토리"
          >
            <History size={18} />
          </button>
        </div>
        {latestMemo ? (
          <div className="mb-3 rounded-md border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900">
            <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-extrabold text-brand-700 dark:text-brand-100">최근 메모</span>
              <span className="text-right text-xs font-semibold text-slate-500 dark:text-slate-400">
                <span className="block">{formatDateTime(latestMemo.created_at)}</span>
                <span className="block">{getMemoStaffName(latestMemo)}</span>
              </span>
            </div>
            <p className="whitespace-pre-wrap break-words text-sm font-semibold leading-relaxed">{latestMemo.note}</p>
          </div>
        ) : null}
        <textarea
          id="inventory-memo"
          className="field min-h-28 resize-y"
          value={memoText}
          onChange={(event) => {
            setMemoText(event.target.value);
            setMemoError("");
            setMemoSuccess("");
          }}
          placeholder="메모를 입력하세요"
        />
        {memoError ? <div className="mt-2"><StatusMessage type="error">{memoError}</StatusMessage></div> : null}
        {memoSuccess ? <div className="mt-2"><StatusMessage type="success">{memoSuccess}</StatusMessage></div> : null}
        <button className="primary-button mt-2 min-h-11 w-full py-2" type="submit" disabled={memoSaving || memoIsEmpty}>
          {memoSaving ? "저장 중..." : "저장"}
        </button>
      </form>

      {historyOpen ? (
        <div className="fixed inset-0 z-50 flex items-end bg-slate-950/55 sm:items-center sm:justify-center sm:p-4" role="dialog" aria-modal="true" aria-label="재고 작업 히스토리">
          <div className="flex max-h-[86dvh] w-full flex-col rounded-t-2xl bg-white shadow-2xl dark:bg-slate-950 sm:max-w-xl sm:rounded-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <History className="shrink-0 text-brand-700 dark:text-brand-100" size={20} />
                  <h2 className="truncate font-extrabold">재고 작업 히스토리</h2>
                </div>
                <p className="mt-1 truncate text-xs text-slate-500 dark:text-slate-400">{item.name} · 원하는 작업 시점을 선택하세요.</p>
              </div>
              <button type="button" onClick={() => setHistoryOpen(false)} className="touch-button icon-button shrink-0" aria-label="닫기">
                <X size={20} />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {historyLoading ? <StatusMessage>작업 히스토리를 불러오는 중...</StatusMessage> : null}
              {!historyLoading && history.length === 0 ? <StatusMessage>복원할 작업 히스토리가 없습니다.</StatusMessage> : null}
              <div className="space-y-2">
                {history.map((point, index) => (
                  <button
                    key={point.log.id}
                    type="button"
                    disabled={restoring || index === 0}
                    onClick={() => void restoreToHistoryPoint(point)}
                    className="w-full rounded-lg border border-slate-200 p-3 text-left transition-colors hover:border-brand-500 hover:bg-brand-50 disabled:cursor-default disabled:opacity-60 dark:border-slate-800 dark:hover:border-brand-500 dark:hover:bg-brand-950"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded bg-slate-100 px-2 py-1 text-xs font-extrabold dark:bg-slate-800">{point.log.action}</span>
                          <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">{formatDateTime(point.log.created_at)}</span>
                          {index === 0 ? <span className="rounded bg-brand-100 px-2 py-1 text-[10px] font-extrabold text-brand-700 dark:bg-brand-950 dark:text-brand-100">현재 상태</span> : null}
                        </div>
                        <p className="mt-2 text-sm font-bold">{formatLogContent(point.log)}</p>
                      </div>
                      {index > 0 ? <RotateCcw className="mt-1 shrink-0 text-brand-700 dark:text-brand-100" size={18} /> : null}
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2 text-center">
                      <span className="rounded-md bg-slate-100 px-2 py-2 text-xs dark:bg-slate-900">
                        창고 <strong className="ml-1 text-sm">{formatInventoryQuantity(point.warehouseQty)}</strong>
                      </span>
                      <span className="rounded-md bg-slate-100 px-2 py-2 text-xs dark:bg-slate-900">
                        매장 <strong className="ml-1 text-sm">{formatInventoryQuantity(point.storeQty)}</strong>
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {memoHistoryOpen ? (
        <div className="fixed inset-0 z-50 flex items-end bg-slate-950/55 sm:items-center sm:justify-center sm:p-4" role="dialog" aria-modal="true" aria-label="메모 히스토리">
          <div className="flex max-h-[86dvh] w-full flex-col rounded-t-2xl bg-white shadow-2xl dark:bg-slate-950 sm:max-w-xl sm:rounded-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <History className="shrink-0 text-brand-700 dark:text-brand-100" size={20} />
                  <h2 className="truncate font-extrabold">메모 히스토리</h2>
                </div>
                <p className="mt-1 truncate text-xs text-slate-500 dark:text-slate-400">{item.name} · 최근 메모 100개</p>
              </div>
              <button type="button" onClick={() => setMemoHistoryOpen(false)} className="touch-button icon-button shrink-0" aria-label="닫기">
                <X size={20} />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {memoHistoryLoading ? <StatusMessage>메모 히스토리를 불러오는 중...</StatusMessage> : null}
              {!memoHistoryLoading && memoHistory.length === 0 ? <StatusMessage>저장된 메모가 없습니다.</StatusMessage> : null}
              <div className="space-y-2">
                {memoHistory.map((memo) => (
                  <div key={memo.id} className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                    <p className="whitespace-pre-wrap break-words text-sm font-semibold leading-relaxed">{memo.note}</p>
                    <p className="mt-2 text-xs font-semibold text-slate-500 dark:text-slate-400">
                      <span className="block">{formatDateTime(memo.created_at)}</span>
                      <span className="block">{getMemoStaffName(memo)}</span>
                    </p>
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
