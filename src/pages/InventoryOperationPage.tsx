import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { App as CapacitorApp } from "@capacitor/app";
import { Capacitor, type PluginListenerHandle } from "@capacitor/core";
import { ArrowLeft, ArrowLeftRight, Check, ChevronDown, History, List, Minus, Pencil, Plus, RotateCcw, X } from "lucide-react";
import { StatusMessage } from "../components/StatusMessage";
import { MobileInventoryControls } from "../components/MobileInventoryControls";
import { QuantityKeypadSheet } from "../components/QuantityKeypadSheet";
import { InventoryStockRangeBar } from "../components/InventoryStockRangeBar";
import { ACTIONS, QUICK_AMOUNTS } from "../lib/constants";
import { getSeoulDateValue } from "../lib/businessCalendar";
import { formatDateTime } from "../lib/date";
import { formatInventoryActionLabel, formatInventoryQuantity, formatLogContent, normalizeInventoryItem } from "../lib/inventory";
import { DEFAULT_ABUNDANT_MULTIPLIER } from "../lib/inventoryStock";
import { createMutationRequestId, finishMappedMutationRequest, finishMutationRequest, formatMutationError, getMappedMutationRequestId, getMutationRequestId } from "../lib/mutationRequest";
import { recordReceiptCheckOnly } from "../lib/receiptCheck";
import { applyMobileInventoryChange, finalizeMobileInventorySession, recoverMobileInventorySessions, type MobileInventoryApplyResult } from "../lib/mobileInventorySession";
import { buildAuditTarget, buildAutoAdjustmentTarget, buildMobileHistoryTarget, buildMoveTarget, clampMobileQuantity, getMoveDirectionForQuantities, hasMobileInventoryChange, type MobileInventoryEditPoint, type MobileInventoryTarget, type MobileMoveDirection } from "../lib/mobileInventory";
import { useMobileViewport } from "../hooks/useMobileViewport";
import { resolveStoreStaffNames } from "../lib/staffNames";
import * as Services from "../services";
import type { AppRoute, InventoryItem, InventoryLog, Location, MobileInventoryEntryMode, MobileInventoryMode, StockStatus } from "../types/domain";

type Props = {
  productId: string;
  navigate: (route: AppRoute, options?: { restore?: boolean; resetToRoot?: boolean }) => void;
  canGoBack?: boolean;
  onBack?: () => void;
  currentStoreId: string;
  initialInventoryMode?: MobileInventoryEntryMode;
  registerBeforeLeave?: (handler: () => Promise<void>) => () => void;
};

type ConfirmedInventorySnapshot = {
  warehouseQty: number;
  storeQty: number;
  warehouseVersion: number;
  storeVersion: number;
  updatedAt: string;
};

type MobileInventoryBaseline = Pick<ConfirmedInventorySnapshot, "warehouseQty" | "storeQty">;

const STOCK_STATUSES: StockStatus[] = ["충분", "절반 이하", "발주 필요"];
const DEFAULT_LOCATION_LONG_PRESS_MS = 700;
const MOBILE_INPUT_MODE_STORAGE_KEY = "store-inventory-input-mode";

function readStoredMobileDialMode(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(MOBILE_INPUT_MODE_STORAGE_KEY) !== "button";
  } catch {
    return true;
  }
}

type InventoryHistoryPoint = {
  log: InventoryLog;
  warehouseQty: number;
  storeQty: number;
};

type AliasHistoryLog = InventoryLog & {
  aliasProductName: string;
};

type InventoryQuantityState = {
  warehouseQty: number;
  storeQty: number;
};

function getStateBeforeInventoryLog(log: InventoryLog, warehouseQty: number, storeQty: number): InventoryQuantityState {
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

function buildInventoryHistoryPoints(logs: InventoryLog[], warehouseQty: number, storeQty: number): InventoryHistoryPoint[] {
  let currentWarehouseQty = warehouseQty;
  let currentStoreQty = storeQty;

  return logs.map((log) => {
    const point = {
      log,
      warehouseQty: log.warehouse_qty_after ?? currentWarehouseQty,
      storeQty: log.store_qty_after ?? currentStoreQty
    };
    const before = getStateBeforeInventoryLog(log, point.warehouseQty, point.storeQty);
    currentWarehouseQty = before.warehouseQty;
    currentStoreQty = before.storeQty;
    return point;
  });
}

function buildMobileEditPointFromLog(
  log: InventoryLog,
  after: InventoryQuantityState,
  before: InventoryQuantityState
): MobileInventoryEditPoint {
  const warehouseChanged = after.warehouseQty !== before.warehouseQty;
  const storeChanged = after.storeQty !== before.storeQty;
  const totalUnchanged = after.warehouseQty + after.storeQty === before.warehouseQty + before.storeQty;
  const mode: MobileInventoryEditPoint["mode"] = log.action === "이동" || (warehouseChanged && storeChanged && totalUnchanged)
    ? "move"
    : log.action === "입고" || log.action === "출고"
      ? "auto"
      : "audit";
  const inferredMoveDirection = getMoveDirectionForQuantities(
    after.warehouseQty,
    after.storeQty,
    before.warehouseQty,
    before.storeQty
  );
  const moveDirection: MobileMoveDirection | null = mode === "move"
    ? log.source_location === "창고"
      ? "warehouse-to-store"
      : log.source_location === "매장"
        ? "store-to-warehouse"
        : inferredMoveDirection
    : null;
  const targetLocation: Location = mode === "move"
    ? moveDirection === "warehouse-to-store" ? "창고" : "매장"
    : log.destination_location ?? log.source_location ?? (warehouseChanged ? "창고" : "매장");

  return {
    warehouseQty: after.warehouseQty,
    storeQty: after.storeQty,
    editAt: log.created_at,
    mode,
    targetLocation,
    moveDirection
  };
}

function buildMobileEditHistoryPoints(logs: InventoryLog[], snapshot: ConfirmedInventorySnapshot): MobileInventoryEditPoint[] {
  const latestLog = logs[0] ?? null;
  const latestBefore = latestLog
    ? getStateBeforeInventoryLog(latestLog, snapshot.warehouseQty, snapshot.storeQty)
    : snapshot;
  const reversePoints: MobileInventoryEditPoint[] = [latestLog
    ? buildMobileEditPointFromLog(latestLog, snapshot, latestBefore)
    : {
        warehouseQty: snapshot.warehouseQty,
        storeQty: snapshot.storeQty,
        editAt: snapshot.updatedAt,
        mode: "auto",
        targetLocation: null,
        moveDirection: null
      }];
  let currentWarehouseQty = snapshot.warehouseQty;
  let currentStoreQty = snapshot.storeQty;

  logs.forEach((log) => {
    const after = {
      warehouseQty: log.warehouse_qty_after ?? currentWarehouseQty,
      storeQty: log.store_qty_after ?? currentStoreQty
    };
    const before = getStateBeforeInventoryLog(log, after.warehouseQty, after.storeQty);
    reversePoints.push(buildMobileEditPointFromLog(log, after, before));
    currentWarehouseQty = before.warehouseQty;
    currentStoreQty = before.storeQty;
  });

  return reversePoints.reverse().reduce<MobileInventoryEditPoint[]>((points, point) => {
    const previous = points[points.length - 1];
    if (previous && previous.warehouseQty === point.warehouseQty && previous.storeQty === point.storeQty) {
      points[points.length - 1] = point;
      return points;
    }
    points.push(point);
    return points;
  }, []);
}

function collapseMobileHistoryLogs(logs: InventoryLog[]): InventoryLog[] {
  const seenSessions = new Set<string>();
  const collapsed: InventoryLog[] = [];

  logs.forEach((log) => {
    if (!log.mobile_session_id) {
      collapsed.push(log);
      return;
    }
    if (seenSessions.has(log.mobile_session_id)) return;
    seenSessions.add(log.mobile_session_id);
    const sessionLogs = logs
      .filter((candidate) => candidate.mobile_session_id === log.mobile_session_id)
      .sort((left, right) => (left.mobile_session_sequence ?? 0) - (right.mobile_session_sequence ?? 0));
    const first = sessionLogs[0] ?? log;
    const last = sessionLogs[sessionLogs.length - 1] ?? log;
    const modes = Array.from(new Set(sessionLogs.map((candidate) => candidate.action === "이동" ? "이동" : candidate.action === "조정" ? "실사" : "자동")));
    collapsed.push({
      ...last,
      action: sessionLogs.length > 1 ? "조정" : last.action,
      previous_quantity: null,
      new_quantity: null,
      quantity: null,
      note: modes.join("/"),
      warehouse_qty_before: first.warehouse_qty_before,
      store_qty_before: first.store_qty_before,
      warehouse_qty_after: last.warehouse_qty_after,
      store_qty_after: last.store_qty_after
    });
  });

  return collapsed;
}

function formatHistoryPointAction(log: InventoryLog): string {
  if (!log.mobile_session_id) return formatInventoryActionLabel(log.action);
  return log.note?.split(" · ")[0] || formatInventoryActionLabel(log.action);
}

function formatHistoryPointContent(log: InventoryLog): string {
  if (!log.mobile_session_id) return formatLogContent(log);
  return `${log.note ?? "재고 작업"} · 창고 ${formatInventoryQuantity(log.warehouse_qty_before)} → ${formatInventoryQuantity(log.warehouse_qty_after)} · 매장 ${formatInventoryQuantity(log.store_qty_before)} → ${formatInventoryQuantity(log.store_qty_after)}`;
}

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
  if (!info.checkedAt) return <>마지막 실사 -</>;

  const timeLabel = formatDateTime(info.checkedAt).split(" ").slice(1).join(" ");

  return (
    <>
      마지막 실사 {formatDateOnly(info.checkedAt)}
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

export function InventoryOperationPage({
  productId,
  navigate,
  canGoBack = false,
  onBack,
  currentStoreId,
  initialInventoryMode = "auto",
  registerBeforeLeave
}: Props) {
  const [item, setItem] = useState<InventoryItem | null>(null);
  const [history, setHistory] = useState<InventoryHistoryPoint[]>([]);
  const [aliasHistoryLogs, setAliasHistoryLogs] = useState<AliasHistoryLog[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [action, setAction] = useState<StockOperationAction>(initialInventoryMode === "audit" ? "조정" : "입고");
  const [location, setLocation] = useState<Location>("창고");
  const [moveDirection, setMoveDirection] = useState<"warehouse-to-store" | "store-to-warehouse">("warehouse-to-store");
  const [quantity, setQuantity] = useState("");
  const [receiptQuantity, setReceiptQuantity] = useState("1");
  const [memoText, setMemoText] = useState("");
  const [memoOpen, setMemoOpen] = useState(true);
  const [editingMemoId, setEditingMemoId] = useState<string | null>(null);
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
  const [abundantMultiplier, setAbundantMultiplier] = useState(DEFAULT_ABUNDANT_MULTIPLIER);
  const [minimumStockSaving, setMinimumStockSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [receiptSaving, setReceiptSaving] = useState(false);
  const [memoSaving, setMemoSaving] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [statusSaving, setStatusSaving] = useState(false);
  const [defaultLocationSaving, setDefaultLocationSaving] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const defaultLocationPressTimerRef = useRef<number | null>(null);
  const inventoryMutationRequestRef = useRef<string | null>(null);
  const receiptMutationRequestRef = useRef<string | null>(null);
  const restoreMutationRequestRef = useRef(new Map<string, string>());
  const isMobileViewport = useMobileViewport();
  const mobileTouchEnabled = import.meta.env.VITE_MOBILE_INVENTORY_TOUCH_ENABLED !== "false";
  const [mobileDialMode, setMobileDialMode] = useState(() => readStoredMobileDialMode());
  const [mobileInputModeSwitching, setMobileInputModeSwitching] = useState(false);
  const [mobileMode, setMobileMode] = useState<MobileInventoryMode>(initialInventoryMode === "audit" ? "audit" : "auto");
  const [mobileWarehouseQty, setMobileWarehouseQty] = useState(0);
  const [mobileStoreQty, setMobileStoreQty] = useState(0);
  const [mobileAutoBaseline, setMobileAutoBaseline] = useState<MobileInventoryBaseline>({ warehouseQty: 0, storeQty: 0 });
  const [mobileAutoRebaseSequence, setMobileAutoRebaseSequence] = useState(0);
  const [mobileConfirmedSnapshot, setMobileConfirmedSnapshot] = useState<ConfirmedInventorySnapshot>({ warehouseQty: 0, storeQty: 0, warehouseVersion: 0, storeVersion: 0, updatedAt: "" });
  const [mobileSaveState, setMobileSaveState] = useState<"idle" | "dragging" | "pending" | "saved" | "error">("idle");
  const [mobileSaveStatusLabel, setMobileSaveStatusLabel] = useState<"서버에 저장됨" | "수정 시점" | "수량 확인 완료">("서버에 저장됨");
  const [mobileSaveError, setMobileSaveError] = useState("");
  const [mobileEditPointAt, setMobileEditPointAt] = useState("");
  const [mobileEditHistory, setMobileEditHistory] = useState<MobileInventoryEditPoint[]>([]);
  const [mobileEditHistoryIndex, setMobileEditHistoryIndex] = useState(-1);
  const [mobileKeypadTarget, setMobileKeypadTarget] = useState<"warehouse" | "store" | null>(null);
  const mobileSessionIdRef = useRef<string | null>(null);
  const mobileSaveInFlightRef = useRef(false);
  const mobileQueuedTargetRef = useRef<MobileInventoryTarget | null>(null);
  const mobileDraftTargetRef = useRef<MobileInventoryTarget | null>(null);
  const mobileConflictTargetRef = useRef<MobileInventoryTarget | null>(null);
  const mobileSavePromiseRef = useRef<Promise<void> | null>(null);
  const mobileFinalizeRef = useRef<() => Promise<void>>(async () => undefined);
  const mobileConfirmedRef = useRef<ConfirmedInventorySnapshot>({ warehouseQty: 0, storeQty: 0, warehouseVersion: 0, storeVersion: 0, updatedAt: "" });
  const mobileAutoBaselineRef = useRef<MobileInventoryBaseline>({ warehouseQty: 0, storeQty: 0 });
  const mobileAutoRebaseSequenceRef = useRef(0);
  const mobileModeRef = useRef<MobileInventoryMode>(initialInventoryMode === "audit" ? "audit" : "auto");
  const mobileEditPointAtRef = useRef<string | null>(null);
  const mobileEditHistoryRef = useRef<MobileInventoryEditPoint[]>([]);
  const mobileEditHistoryIndexRef = useRef(-1);
  const mobileHistoryNavigationRef = useRef<number | null>(null);
  const mobileEditHistoryLoadedRef = useRef(false);
  const mobileEditHistoryLoadingRef = useRef(false);
  const mobileInventoryCheckRequestRef = useRef<string | null>(null);
  const [mobileInventoryCheckSaving, setMobileInventoryCheckSaving] = useState(false);
  const memoRequestRef = useRef<string | null>(null);

  const loadProduct = useCallback(async () => {
    setLoading(true);
    setError("");
    const { data: referenceRows, error: referenceError } = await Services.DatabaseService.rpc("resolve_product_references", {
      target_product_ids: [productId]
    });
    const resolvedProductId = referenceRows?.[0]?.canonical_product_id ?? productId;
    const { data, error: loadError } = referenceError
      ? { data: null, error: referenceError }
      : await Services.DatabaseService.select("products", "*, inventory(*)")
        .eq("store_id", currentStoreId)
        .eq("id", resolvedProductId)
        .single();

    if (loadError) {
      setError(loadError.message);
    } else {
      const nextItem = normalizeInventoryItem(data as Parameters<typeof normalizeInventoryItem>[0]);

      if (!nextItem.inventory) {
        const { data: inventoryData, error: inventoryError } = await Services.DatabaseService.rpc("ensure_inventory_row", {
          target_product_id: resolvedProductId
        });

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

  const loadOverviewMultiplier = useCallback(async () => {
    const { data } = await Services.DatabaseService.select("inventory_overview_settings", "abundant_multiplier")
      .eq("store_id", currentStoreId)
      .maybeSingle();
    const nextMultiplier = Number(data?.abundant_multiplier);
    setAbundantMultiplier(Number.isFinite(nextMultiplier) && nextMultiplier > 1 ? nextMultiplier : DEFAULT_ABUNDANT_MULTIPLIER);
  }, [currentStoreId]);

  const mobileTouchUI = mobileTouchEnabled && isMobileViewport && mobileDialMode;

  function isMissingMobileSessionError(message: string | null | undefined): boolean {
    return message?.includes("모바일 재고 작업 세션을 찾을 수 없습니다.") ?? false;
  }

  function updateMobileConfirmedSnapshot(nextSnapshot: ConfirmedInventorySnapshot) {
    mobileConfirmedRef.current = nextSnapshot;
    setMobileConfirmedSnapshot(nextSnapshot);
    setMobileEditPointAt(mobileEditPointAtRef.current ?? nextSnapshot.updatedAt);
  }

  function resetMobileAutoBaseline(snapshot: MobileInventoryBaseline = mobileConfirmedRef.current) {
    const nextBaseline = { warehouseQty: snapshot.warehouseQty, storeQty: snapshot.storeQty };
    mobileAutoBaselineRef.current = nextBaseline;
    setMobileAutoBaseline(nextBaseline);
  }

  function handleMobileAutoBaselineRebase(location: Location) {
    const baseline = mobileAutoBaselineRef.current;
    const warehouseDelta = mobileWarehouseQty - baseline.warehouseQty;
    const storeDelta = mobileStoreQty - baseline.storeQty;
    if (warehouseDelta === 0 && storeDelta === 0) {
      setMobileKeypadTarget(location === "창고" ? "store" : "warehouse");
      return;
    }

    resetMobileAutoBaseline({ warehouseQty: mobileWarehouseQty, storeQty: mobileStoreQty });
    mobileAutoRebaseSequenceRef.current += 1;
    setMobileAutoRebaseSequence(mobileAutoRebaseSequenceRef.current);
  }

  function syncMobileEditHistory(nextHistory: MobileInventoryEditPoint[], nextIndex: number) {
    mobileEditHistoryRef.current = nextHistory;
    mobileEditHistoryIndexRef.current = nextIndex;
    setMobileEditHistory(nextHistory);
    setMobileEditHistoryIndex(nextIndex);
  }

  function recordMobileEditResult(result: MobileInventoryApplyResult, target: MobileInventoryTarget) {
    const navigationIndex = mobileHistoryNavigationRef.current;
    mobileHistoryNavigationRef.current = null;
    const history = mobileEditHistoryRef.current;

    if (navigationIndex !== null && history[navigationIndex]) {
      const currentPoint = history[navigationIndex];
      const nextHistory = [...history];
      nextHistory[navigationIndex] = {
        ...currentPoint,
        warehouseQty: result.warehouse_qty,
        storeQty: result.store_qty
      };
      syncMobileEditHistory(nextHistory, navigationIndex);
      setMobileEditPointAt(currentPoint.editAt);
      setMobileSaveStatusLabel("수정 시점");
      return;
    }

    const currentIndex = mobileEditHistoryIndexRef.current;
    const nextHistory = history.slice(0, Math.max(0, currentIndex + 1));
    const nextPoint: MobileInventoryEditPoint = {
      warehouseQty: result.warehouse_qty,
      storeQty: result.store_qty,
      editAt: result.inventory_updated_at,
      mode: target.mode,
      targetLocation: target.targetLocation,
      moveDirection: target.moveDirection
    };
    nextHistory.push(nextPoint);
    syncMobileEditHistory(nextHistory, nextHistory.length - 1);
    setMobileEditPointAt(nextPoint.editAt);
    setMobileSaveStatusLabel("서버에 저장됨");
  }

  const loadMobileEditHistory = useCallback(async (snapshot: ConfirmedInventorySnapshot) => {
    if (!mobileTouchUI || mobileEditHistoryLoadedRef.current || mobileEditHistoryLoadingRef.current || mobileSessionIdRef.current) return;

    mobileEditHistoryLoadingRef.current = true;
    try {
      const { data, error: historyError } = await Services.DatabaseService.select("inventory_logs", "*")
        .eq("store_id", currentStoreId)
        .eq("product_id", productId)
        .neq("action", "메모")
        .is("reverted_at", null)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(200);

      if (historyError || mobileSaveInFlightRef.current || mobileDraftTargetRef.current || mobileSessionIdRef.current) return;

      const nextHistory = buildMobileEditHistoryPoints((data ?? []) as InventoryLog[], snapshot);
      if (nextHistory.length === 0) return;

      mobileEditHistoryRef.current = nextHistory;
      mobileEditHistoryIndexRef.current = nextHistory.length - 1;
      setMobileEditHistory(nextHistory);
      setMobileEditHistoryIndex(nextHistory.length - 1);
      setMobileEditPointAt(nextHistory[nextHistory.length - 1].editAt || snapshot.updatedAt);
      mobileEditHistoryLoadedRef.current = true;
    } finally {
      mobileEditHistoryLoadingRef.current = false;
    }
  }, [currentStoreId, mobileTouchUI, productId]);

  function updateItemInventory(nextResult: MobileInventoryApplyResult) {
    setItem((current) => {
      if (!current?.inventory) return current;
      return normalizeInventoryItem({
        ...current,
        inventory: {
          ...current.inventory,
          warehouse_qty: nextResult.warehouse_qty,
          store_qty: nextResult.store_qty,
          warehouse_version: nextResult.warehouse_version,
          store_version: nextResult.store_version,
          updated_at: nextResult.inventory_updated_at
        }
      });
    });
  }

  useEffect(() => {
    mobileEditPointAtRef.current = null;
    mobileHistoryNavigationRef.current = null;
    mobileEditHistoryRef.current = [];
    mobileEditHistoryIndexRef.current = -1;
    mobileEditHistoryLoadedRef.current = false;
    mobileEditHistoryLoadingRef.current = false;
    setMobileEditHistory([]);
    setMobileEditHistoryIndex(-1);
    setMobileSaveStatusLabel("서버에 저장됨");
    setMobileEditPointAt("");
    const nextMode = initialInventoryMode === "audit" ? "audit" : "auto";
    setAction(nextMode === "audit" ? "조정" : "입고");
    mobileModeRef.current = nextMode;
    setMobileMode(nextMode);
    resetMobileAutoBaseline({ warehouseQty: 0, storeQty: 0 });
  }, [initialInventoryMode, productId]);

  useEffect(() => {
    if (!item?.inventory) return;
    if (mobileSessionIdRef.current) return;
    const nextSnapshot = {
      warehouseQty: item.warehouse_qty,
      storeQty: item.store_qty,
      warehouseVersion: item.inventory.warehouse_version,
      storeVersion: item.inventory.store_version,
      updatedAt: item.inventory.updated_at
    };
    updateMobileConfirmedSnapshot(nextSnapshot);
    resetMobileAutoBaseline(nextSnapshot);
    if (mobileEditHistoryRef.current.length === 0) {
      const editAt = mobileEditPointAtRef.current ?? nextSnapshot.updatedAt;
      const initialHistory: MobileInventoryEditPoint[] = [{
        warehouseQty: nextSnapshot.warehouseQty,
        storeQty: nextSnapshot.storeQty,
        editAt,
        mode: "auto",
        targetLocation: null,
        moveDirection: null
      }];
      mobileEditHistoryRef.current = initialHistory;
      mobileEditHistoryIndexRef.current = 0;
      setMobileEditHistory(initialHistory);
      setMobileEditHistoryIndex(0);
      setMobileEditPointAt(editAt);
    }
    const conflictTarget = mobileConflictTargetRef.current;
    if (conflictTarget) {
      const preservedTarget = conflictTarget.mode === "move"
        ? conflictTarget
        : {
            ...conflictTarget,
            warehouseQty: conflictTarget.targetLocation === "창고" ? conflictTarget.warehouseQty : item.warehouse_qty,
            storeQty: conflictTarget.targetLocation === "매장" ? conflictTarget.storeQty : item.store_qty
          };
      mobileConflictTargetRef.current = null;
      mobileDraftTargetRef.current = preservedTarget;
      setMobileWarehouseQty(preservedTarget.warehouseQty);
      setMobileStoreQty(preservedTarget.storeQty);
    } else {
      setMobileWarehouseQty(item.warehouse_qty);
      setMobileStoreQty(item.store_qty);
    }
    void loadMobileEditHistory(nextSnapshot);
  }, [item, loadMobileEditHistory]);

  useEffect(() => {
    if (!mobileTouchEnabled) return;
    void recoverMobileInventorySessions();
  }, [mobileTouchEnabled]);

  function resetMobileDraft(preserveQueuedTarget = false) {
    if (!preserveQueuedTarget) mobileQueuedTargetRef.current = null;
    mobileDraftTargetRef.current = null;
    const snapshot = mobileConfirmedRef.current;
    setMobileWarehouseQty(snapshot.warehouseQty);
    setMobileStoreQty(snapshot.storeQty);
    setMobileSaveError("");
    setMobileSaveState("idle");
    setMobileSaveStatusLabel("서버에 저장됨");
  }

  function commitUnsettledMobileDraft() {
    const target = mobileDraftTargetRef.current;
    if (!target || !hasMobileInventoryChange(
      target.warehouseQty,
      target.storeQty,
      mobileConfirmedRef.current.warehouseQty,
      mobileConfirmedRef.current.storeQty
    )) return;
    queueMobileTarget(target);
  }

  function applyMobileResult(result: MobileInventoryApplyResult, target: MobileInventoryTarget) {
    mobileEditPointAtRef.current = null;
    const nextSnapshot = {
      warehouseQty: result.warehouse_qty,
      storeQty: result.store_qty,
      warehouseVersion: result.warehouse_version,
      storeVersion: result.store_version,
      updatedAt: result.inventory_updated_at
    };
    mobileSessionIdRef.current = result.session_id;
    updateMobileConfirmedSnapshot(nextSnapshot);
    if (target.mode !== mobileModeRef.current) resetMobileAutoBaseline(nextSnapshot);
    setMobileWarehouseQty(result.warehouse_qty);
    setMobileStoreQty(result.store_qty);
    updateItemInventory(result);
    recordMobileEditResult(result, target);
  }

  async function flushMobileTargets() {
    if (mobileSaveInFlightRef.current) return;
    mobileSaveInFlightRef.current = true;
    setMobileSaveState("pending");
    setMobileSaveError("");

    const savePromise = (async () => {
      let hadError = false;
      try {
        while (mobileQueuedTargetRef.current) {
          const target = mobileQueuedTargetRef.current;
          mobileQueuedTargetRef.current = null;
          const snapshot = mobileConfirmedRef.current;
          if (!hasMobileInventoryChange(target.warehouseQty, target.storeQty, snapshot.warehouseQty, snapshot.storeQty)) {
            if (mobileDraftTargetRef.current === target) mobileDraftTargetRef.current = null;
            continue;
          }

          const requestId = crypto.randomUUID();
          const applyInput = {
            targetSessionId: mobileSessionIdRef.current,
            targetProductId: productId,
            operationMode: target.mode,
            targetLocation: target.targetLocation,
            moveDirection: target.moveDirection,
            requestedWarehouseQty: target.warehouseQty,
            requestedStoreQty: target.storeQty,
            expectedWarehouseVersion: snapshot.warehouseVersion,
            expectedStoreVersion: snapshot.storeVersion,
            requestId,
            entrySource: initialInventoryMode === "audit" ? "scan_audit" as const : "operation" as const
          };
          let applyResult = await applyMobileInventoryChange(applyInput);

          if (isMissingMobileSessionError(applyResult.error?.message) && applyInput.targetSessionId) {
            mobileSessionIdRef.current = null;
            applyResult = await applyMobileInventoryChange({
              ...applyInput,
              targetSessionId: null
            });
          }

          const { data, error: saveError } = applyResult;

          if (saveError || !data) {
            mobileHistoryNavigationRef.current = null;
            const isInventoryConflict = saveError?.message.includes("다른 직원이") ?? false;
            if (isInventoryConflict) {
              await finalizeMobileInventorySession(mobileSessionIdRef.current);
              mobileSessionIdRef.current = null;
              mobileQueuedTargetRef.current = null;
              mobileConflictTargetRef.current = target;
              await loadProduct();
            } else {
              resetMobileDraft();
            }
            setMobileSaveState("error");
            setMobileSaveError(saveError?.message ?? "재고를 저장하지 못했습니다.");
            hadError = true;
            break;
          }

          applyMobileResult(data, target);
          if (mobileDraftTargetRef.current === target) mobileDraftTargetRef.current = null;
          setMobileSaveState("saved");
        }
      } finally {
        mobileSaveInFlightRef.current = false;
        mobileSavePromiseRef.current = null;
        if (!mobileQueuedTargetRef.current && !hadError) {
          setMobileSaveState("saved");
        }
      }
    })();

    mobileSavePromiseRef.current = savePromise;
    await savePromise;
  }

  function queueMobileTarget(target: MobileInventoryTarget) {
    mobileDraftTargetRef.current = target;
    mobileQueuedTargetRef.current = target;
    setMobileSaveState("pending");
    if (!mobileSaveInFlightRef.current) void flushMobileTargets();
  }

  async function finalizeMobileSession() {
    const pendingDraft = mobileDraftTargetRef.current;
    if (pendingDraft && hasMobileInventoryChange(
      pendingDraft.warehouseQty,
      pendingDraft.storeQty,
      mobileConfirmedRef.current.warehouseQty,
      mobileConfirmedRef.current.storeQty
    )) {
      mobileQueuedTargetRef.current = pendingDraft;
      if (!mobileSaveInFlightRef.current) void flushMobileTargets();
    }
    if (mobileSavePromiseRef.current) await mobileSavePromiseRef.current;
    const sessionId = mobileSessionIdRef.current;
    if (!sessionId) return;
    const { error: finalizeError } = await finalizeMobileInventorySession(sessionId);
    if (finalizeError) {
      if (isMissingMobileSessionError(finalizeError.message)) {
        mobileSessionIdRef.current = null;
        setMobileSaveError("");
        setMobileSaveState("idle");
        return;
      }
      setMobileSaveState("error");
      setMobileSaveError(finalizeError.message);
      return;
    }
    mobileSessionIdRef.current = null;
    setMobileSaveState("idle");
  }

  async function changeMobileInputMode(nextDialMode: boolean) {
    if (nextDialMode === mobileDialMode || mobileInputModeSwitching) return;
    setMobileInputModeSwitching(true);
    try {
      if (!nextDialMode) {
        setMobileKeypadTarget(null);
        commitUnsettledMobileDraft();
        if (mobileSavePromiseRef.current) await mobileSavePromiseRef.current;
        await finalizeMobileSession();
      }
      setMobileDialMode(nextDialMode);
      try {
        window.localStorage.setItem(MOBILE_INPUT_MODE_STORAGE_KEY, nextDialMode ? "dial" : "button");
      } catch {
        // Keep the current session selection even when storage is unavailable.
      }
    } finally {
      setMobileInputModeSwitching(false);
    }
  }

  mobileFinalizeRef.current = finalizeMobileSession;

  function handleMobileDraft(target: MobileInventoryTarget) {
    mobileHistoryNavigationRef.current = null;
    mobileDraftTargetRef.current = target;
    setMobileWarehouseQty(target.warehouseQty);
    setMobileStoreQty(target.storeQty);
    setMobileSaveState("dragging");
    setMobileSaveStatusLabel("서버에 저장됨");
  }

  function handleMobileCommit(target: MobileInventoryTarget, historyNavigationIndex: number | null = null) {
    mobileHistoryNavigationRef.current = historyNavigationIndex;
    mobileDraftTargetRef.current = target;
    setMobileWarehouseQty(target.warehouseQty);
    setMobileStoreQty(target.storeQty);
    setMobileSaveStatusLabel(historyNavigationIndex === null ? "서버에 저장됨" : "수정 시점");
    queueMobileTarget(target);
  }

  async function recordMobileInventoryCheck(targetLocation: Location) {
    if (!item?.inventory || mobileInventoryCheckSaving) return;

    setMobileInventoryCheckSaving(true);
    try {
      commitUnsettledMobileDraft();
      if (mobileSavePromiseRef.current) await mobileSavePromiseRef.current;
      await finalizeMobileSession();
      if (mobileSessionIdRef.current) return;

      const { data: userData, error: userError } = await Services.AuthService.getUser();
      if (userError || !userData.user) {
        setMobileSaveState("error");
        setMobileSaveError(userError?.message ?? "로그인이 필요합니다.");
        return;
      }

      const snapshot = mobileConfirmedRef.current;
      setMobileSaveState("pending");
      setMobileSaveError("");

      const requestId = getMutationRequestId(mobileInventoryCheckRequestRef);
      const { data, error: checkError } = await Services.DatabaseService.rpc("record_inventory_check", {
        target_product_id: item.id,
        target_location: targetLocation,
        expected_warehouse_version: snapshot.warehouseVersion,
        expected_store_version: snapshot.storeVersion,
        request_id: requestId
      });

      if (checkError) {
        finishMutationRequest(mobileInventoryCheckRequestRef, checkError);
        if (checkError.message.includes("다른 직원이")) await loadProduct();
        setMobileSaveState("error");
        setMobileSaveError(formatMutationError(checkError));
      } else {
        mobileInventoryCheckRequestRef.current = null;
        const result = (Array.isArray(data) ? data[0] : data) as { checked_at?: string } | null;
        setMobileEditPointAt(result?.checked_at ?? "");
        setMobileSaveState("saved");
        setMobileSaveStatusLabel("수량 확인 완료");
        await completeStaleInventoryTodo(item.id, currentStoreId, userData.user.id);
        await loadLatestInventoryCheck();
      }
    } finally {
      setMobileInventoryCheckSaving(false);
    }
  }

  function handleMobileHistoryNavigation(direction: "undo" | "redo") {
    if (mobileSaveInFlightRef.current || mobileQueuedTargetRef.current || mobileDraftTargetRef.current) return;

    const history = mobileEditHistoryRef.current;
    const currentIndex = mobileEditHistoryIndexRef.current;
    const targetIndex = direction === "undo" ? currentIndex - 1 : currentIndex + 1;
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= history.length) return;

    const targetPoint = history[targetIndex];
    const operationPoint = direction === "undo" ? history[currentIndex] : targetPoint;
    const snapshot = mobileConfirmedRef.current;
    const target = buildMobileHistoryTarget(
      snapshot.warehouseQty,
      snapshot.storeQty,
      targetPoint,
      operationPoint
    );

    if (!hasMobileInventoryChange(
      target.warehouseQty,
      target.storeQty,
      snapshot.warehouseQty,
      snapshot.storeQty
    )) {
      mobileHistoryNavigationRef.current = null;
      syncMobileEditHistory(history, targetIndex);
      setMobileEditPointAt(targetPoint.editAt);
      setMobileSaveState("saved");
      setMobileSaveStatusLabel("수정 시점");
      return;
    }

    handleMobileCommit(target, targetIndex);
  }

  function handleMobileKeypadConfirm(value: number) {
    const snapshot = mobileConfirmedRef.current;
    if (mobileKeypadTarget === "warehouse") {
      if (mobileMode === "move") {
        handleMobileCommit(buildMoveTarget("창고", clampMobileQuantity(snapshot.warehouseQty + value), snapshot.warehouseQty, snapshot.storeQty));
      } else {
        const target = mobileMode === "audit"
          ? buildAuditTarget("창고", value, mobileWarehouseQty, mobileStoreQty)
          : buildAutoAdjustmentTarget("창고", value, mobileAutoBaselineRef.current.warehouseQty, mobileAutoBaselineRef.current.storeQty);
        handleMobileCommit({ ...target, storeQty: mobileStoreQty });
      }
    } else if (mobileKeypadTarget === "store") {
      if (mobileMode === "move") {
        handleMobileCommit(buildMoveTarget("매장", clampMobileQuantity(snapshot.storeQty + value), snapshot.warehouseQty, snapshot.storeQty));
      } else {
        const target = mobileMode === "audit"
          ? buildAuditTarget("매장", value, mobileWarehouseQty, mobileStoreQty)
          : buildAutoAdjustmentTarget("매장", value, mobileAutoBaselineRef.current.warehouseQty, mobileAutoBaselineRef.current.storeQty);
        handleMobileCommit({ ...target, warehouseQty: mobileWarehouseQty });
      }
    }
    setMobileKeypadTarget(null);
  }

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
      .eq("action", "조정")
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
    void loadOverviewMultiplier();
  }, [loadOverviewMultiplier, loadProduct]);

  useEffect(() => {
    let active = true;

    void Services.AuthService.getUser().then(({ data }) => {
      if (active) setCurrentUserId(data.user?.id ?? null);
    });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!item?.id) return;
    setLocation(item.default_location ?? "창고");
  }, [item?.default_location, item?.id]);

  useEffect(() => {
    return () => {
      if (defaultLocationPressTimerRef.current !== null) {
        window.clearTimeout(defaultLocationPressTimerRef.current);
      }
      void mobileFinalizeRef.current();
    };
  }, []);

  useEffect(() => {
    if (!registerBeforeLeave) return;
    return registerBeforeLeave(() => mobileFinalizeRef.current());
  }, [registerBeforeLeave]);

  useEffect(() => {
    function handleVisibilityChange() {
      if (document.visibilityState === "hidden") void mobileFinalizeRef.current();
    }
    function handlePageHide() {
      void mobileFinalizeRef.current();
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pagehide", handlePageHide);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pagehide", handlePageHide);
    };
  }, []);

  useEffect(() => {
    if (!mobileTouchEnabled || !Capacitor.isNativePlatform()) return;

    let listenerHandle: PluginListenerHandle | null = null;
    let cancelled = false;
    CapacitorApp.addListener("appStateChange", ({ isActive }) => {
      if (!isActive) void mobileFinalizeRef.current();
    })
      .then((handle) => {
        if (cancelled) {
          void handle.remove();
        } else {
          listenerHandle = handle;
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      if (listenerHandle) void listenerHandle.remove();
    };
  }, [mobileTouchEnabled]);

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

  function fillActualQuantity(currentQuantity: number) {
    setQuantity(String(currentQuantity));
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
    const isLowStockAfterStatusUpdate = nextStatusEnabled ? stockStatus === "발주 필요" : item.total_stock <= item.minimum_stock;
    const { error: updateError } = await Services.DatabaseService.update("products", {
        status_enabled: nextStatusEnabled,
        stock_status: stockStatus,
        ...(item.confirmed_order_pending && !isLowStockAfterStatusUpdate ? { confirmed_order_pending: false, order_completed: false } : {})
      })
      .eq("store_id", currentStoreId)
      .eq("id", item.id);

    if (updateError) {
      setError(formatStatusUpdateError(updateError.message));
    } else {
      if (nextStatusEnabled) {
        setEditingMinimumStock(false);
        setMinimumStockDraft(String(item.minimum_stock));
      }
      setItem((current) =>
        current
          ? {
              ...current,
              status_enabled: nextStatusEnabled,
              stock_status: stockStatus,
              is_low_stock: isLowStockAfterStatusUpdate,
              ...(current.confirmed_order_pending && !isLowStockAfterStatusUpdate ? { confirmed_order_pending: false, order_completed: false } : {})
            }
          : current
      );
    }
    setStatusSaving(false);
  }

  async function saveMinimumStock() {
    if (!item || item.status_enabled || minimumStockSaving) return;

    setError("");
    setSuccess("");
    const parsedMinimumStock = Number(minimumStockDraft || 0);
    if (!Number.isFinite(parsedMinimumStock) || parsedMinimumStock < 0) {
      setError("최소재고는 0 이상 숫자로 입력해 주세요.");
      return;
    }
    const nextMinimumStock = parsedMinimumStock;
    setMinimumStockSaving(true);
    const { error: updateError } = await Services.DatabaseService.update("products", { minimum_stock: nextMinimumStock }).eq("store_id", currentStoreId).eq("id", item.id);

    if (updateError) {
      setError(updateError.message);
    } else {
      setEditingMinimumStock(false);
      setSuccess("최소재고를 수정했습니다.");
      await loadProduct();
    }
    setMinimumStockSaving(false);
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
    const locationSubject = nextLocation === "매장" ? "매장이" : "창고가";

    if (item.default_location === nextLocation) {
      setSuccess(`${locationSubject} 기본값으로 선택되어 있습니다.`);
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
      setSuccess(`다음 재고 작업부터 ${locationSubject} 기본값으로 선택됩니다.`);
    }
    setDefaultLocationSaving(false);
  }

  async function openHistory() {
    if (!item) return;

    if (mobileTouchUI) {
      commitUnsettledMobileDraft();
      if (mobileSavePromiseRef.current) await mobileSavePromiseRef.current;
    }

    setHistoryOpen(true);
    setHistoryLoading(true);
    setError("");
    const [historyResult, aliasResult] = await Promise.all([
      Services.DatabaseService.select("inventory_logs", "*")
        .eq("store_id", currentStoreId)
        .eq("product_id", item.id)
        .neq("action", "메모")
        .is("reverted_at", null)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(200),
      Services.DatabaseService.rpc("list_product_aliases", { target_product_id: item.id })
    ]);
    const { data, error: historyError } = historyResult;

    if (historyError) {
      setError(
        historyError.message.includes("reverted_at")
          ? "상세 되돌리기 기능을 위한 데이터베이스 업데이트가 필요합니다."
          : historyError.message
      );
      setHistory([]);
    } else {
      const points = buildInventoryHistoryPoints(
        collapseMobileHistoryLogs((data ?? []) as InventoryLog[]),
        item.warehouse_qty,
        item.store_qty
      );
      setHistory(points);
    }

    if (aliasResult.error) {
      setAliasHistoryLogs([]);
    } else {
      const activeAliases = (aliasResult.data ?? []).filter((alias) => alias.merge_status === "active");
      const aliasNames = new Map(activeAliases.map((alias) => [alias.alias_product_id, alias.alias_name]));
      const aliasProductIds = [...aliasNames.keys()];
      if (aliasProductIds.length === 0) {
        setAliasHistoryLogs([]);
      } else {
        const aliasLogsResult = await Services.DatabaseService.select("inventory_logs", "*")
          .eq("store_id", currentStoreId)
          .in("product_id", aliasProductIds)
          .neq("action", "메모")
          .is("reverted_at", null)
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .limit(200);
        setAliasHistoryLogs(aliasLogsResult.error
          ? []
          : ((aliasLogsResult.data ?? []) as InventoryLog[]).map((log) => ({
              ...log,
              aliasProductName: aliasNames.get(log.product_id) ?? "병합된 원본"
            })));
      }
    }
    setHistoryLoading(false);
  }

  async function restoreToHistoryPoint(point: InventoryHistoryPoint) {
    if (!item?.inventory) return;
    const confirmed = window.confirm(
      `${formatDateTime(point.log.created_at)} 작업 직후 상태로 복원하시겠습니까?\n창고 ${formatInventoryQuantity(point.warehouseQty)} / 매장 ${formatInventoryQuantity(point.storeQty)}\n선택 시점 이후 작업은 히스토리에서 취소 처리됩니다.`
    );
    if (!confirmed) return;

    setRestoring(true);
    setError("");
    setSuccess("");
    const restoreKey = point.log.mobile_session_id ? `session:${point.log.mobile_session_id}` : `log:${point.log.id}`;
    const requestId = getMappedMutationRequestId(restoreMutationRequestRef, restoreKey);
    const { error: restoreError } = point.log.mobile_session_id
      ? await Services.DatabaseService.rpc("restore_inventory_to_mobile_session_v2", {
          target_session_id: point.log.mobile_session_id,
          restored_warehouse_qty: point.warehouseQty,
          restored_store_qty: point.storeQty,
          expected_warehouse_version: item.inventory.warehouse_version,
          expected_store_version: item.inventory.store_version,
          request_id: requestId
        })
      : await Services.DatabaseService.rpc("restore_inventory_to_log_v2", {
          target_log_id: point.log.id,
          restored_warehouse_qty: point.warehouseQty,
          restored_store_qty: point.storeQty,
          expected_warehouse_version: item.inventory.warehouse_version,
          expected_store_version: item.inventory.store_version,
          request_id: requestId
        });

    if (restoreError) {
      finishMappedMutationRequest(restoreMutationRequestRef, restoreKey, restoreError);
      setError(
        restoreError.message.includes("restore_inventory_to_log_v2") || restoreError.message.includes("restore_inventory_to_mobile_session_v2")
          ? "상세 되돌리기 기능을 위한 데이터베이스 업데이트가 필요합니다."
          : restoreError.message
      );
      if (restoreError.message.includes("복원 대상 이후 재고가 변경되었습니다")) await loadProduct();
    } else {
      restoreMutationRequestRef.current.delete(restoreKey);
      if (mobileTouchUI) mobileEditPointAtRef.current = point.log.created_at;
      setHistoryOpen(false);
      setSuccess(`${formatDateTime(point.log.created_at)} 시점으로 재고를 복원했습니다.`);
      setQuantity("");
      await loadProduct();
      await loadLatestInventoryCheck();
      if (mobileTouchUI) setMobileEditPointAt(point.log.created_at);
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

  function isOwnMemo(memo: InventoryLog): boolean {
    return currentUserId === memo.user_id;
  }

  function startMemoEdit(memo: InventoryLog) {
    if (!isOwnMemo(memo)) return;

    setMemoText(memo.note ?? "");
    setEditingMemoId(memo.id);
    setMemoError("");
    setMemoSuccess("");
  }

  function cancelMemoEdit() {
    setMemoText("");
    setEditingMemoId(null);
    setMemoError("");
  }

  async function handleMemoSubmit(event: FormEvent) {
    event.preventDefault();
    if (!item || memoIsEmpty) return;

    setMemoSaving(true);
    setMemoError("");
    setMemoSuccess("");

    if (editingMemoId) {
      const { data: updatedMemo, error: updateError } = await Services.DatabaseService.rpc("update_inventory_memo", {
        target_log_id: editingMemoId,
        memo_text: memoText.trim()
      });

      if (updateError) {
        setMemoError(formatMemoSaveError(updateError.message));
      } else if (!updatedMemo) {
        setMemoError("본인이 작성한 메모만 수정할 수 있습니다.");
      } else {
        const nextMemo = updatedMemo as InventoryLog;
        setLatestMemo((current) => (current?.id === nextMemo.id ? nextMemo : current));
        setMemoHistory((current) => current.map((memo) => (memo.id === nextMemo.id ? nextMemo : memo)));
        setMemoSuccess("메모를 수정했습니다.");
        setMemoText("");
        setEditingMemoId(null);
      }
      setMemoSaving(false);
      return;
    }

    memoRequestRef.current ??= createMutationRequestId();
    const { data: savedMemo, error: logError } = await Services.DatabaseService.rpc("record_inventory_memo", {
      target_product_id: item.id,
      memo_text: memoText.trim(),
      request_id: memoRequestRef.current
    });

    if (logError) {
      finishMutationRequest(memoRequestRef, logError);
      setMemoError(formatMemoSaveError(logError.message));
    } else {
      memoRequestRef.current = null;
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

    const requestId = getMutationRequestId(receiptMutationRequestRef);
    const { errorMessage, uncertain } = await recordReceiptCheckOnly(item.id, currentStoreId, receiptQuantityValue, requestId);

    if (errorMessage) {
      setError(errorMessage);
      if (!uncertain) receiptMutationRequestRef.current = null;
    } else {
      receiptMutationRequestRef.current = null;
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

    const { data: userData, error: userError } = await Services.AuthService.getUser();
    if (userError || !userData.user) {
      setError(userError?.message ?? "로그인이 필요합니다.");
      setSaving(false);
      return;
    }

    const requestId = getMutationRequestId(inventoryMutationRequestRef);
    const { error: operationError } = await Services.DatabaseService.rpc("record_inventory_operation_idempotent_v2", {
      target_product_id: item.id,
      operation_action: action,
      target_location: location,
      move_direction: moveDirection,
      operation_quantity: quantityValue,
      expected_warehouse_version: currentInventory.warehouse_version,
      expected_store_version: currentInventory.store_version,
      request_id: requestId
    });

    if (operationError) {
      const operationErrorMessage = formatMutationError(operationError);
      finishMutationRequest(inventoryMutationRequestRef, operationError);
      if (operationError.message.includes("다른 직원이")) {
        await loadProduct();
      }
      setError(operationErrorMessage);
    } else {
      inventoryMutationRequestRef.current = null;
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
    <section className={isMobileViewport ? "mobile-inventory-page" : undefined}>
      <div className="inventory-operation-header mb-2 flex min-w-0 items-center gap-1.5 sm:mb-4 sm:gap-2">
        {canGoBack && onBack ? (
          <button className="touch-button shrink-0 border-0 bg-transparent p-1 text-slate-600 shadow-none hover:bg-transparent dark:bg-transparent dark:text-slate-300" type="button" onClick={onBack} aria-label="뒤로가기" title="뒤로가기">
            <ArrowLeft size={18} />
          </button>
        ) : null}
        <h1 className="min-w-0 flex-1 truncate text-[23px] font-extrabold tracking-normal sm:text-[27px]">{item.name}</h1>
        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          <button className="touch-button icon-button" type="button" onClick={() => navigate({ name: "product-edit", productId: item.id })} aria-label="상품 수정" title="수정">
            <Pencil size={18} />
          </button>
          <button className="touch-button icon-button" type="button" onClick={() => navigate({ name: "inventory" }, { resetToRoot: true })} aria-label="재고현황으로 이동" title="재고현황">
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

      {mobileTouchEnabled && isMobileViewport ? (
        <div className="mobile-input-mode-switch mb-2 flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-white px-3 py-2 dark:border-slate-800 dark:bg-slate-900">
          <span className="text-xs font-extrabold text-slate-700 dark:text-slate-200">{mobileDialMode ? "다이얼 방식" : "버튼 방식"}</span>
          <button
            type="button"
            role="switch"
            aria-label="재고 작업 입력 방식"
            aria-checked={mobileDialMode}
            disabled={mobileInputModeSwitching}
            onClick={() => void changeMobileInputMode(!mobileDialMode)}
            className={`relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${mobileDialMode ? "bg-brand-600" : "bg-slate-300 dark:bg-slate-700"}`}
          >
            <span className={`absolute left-0 top-1 h-5 w-5 rounded-full bg-white shadow transition-transform ${mobileDialMode ? "translate-x-6" : "translate-x-1"}`} />
          </button>
        </div>
      ) : null}

      <div className="inventory-product-summary mb-2 flex min-w-0 items-start justify-between gap-1.5 sm:mb-3 sm:gap-2">
        <div className="flex max-w-[58%] shrink-0 flex-col items-end gap-1 text-[11px] sm:max-w-none sm:gap-1.5 sm:text-sm">
          <div className="flex flex-wrap justify-end gap-1">
            <span className="inventory-product-badge rounded-md border border-slate-200 bg-white px-1.5 py-0.5 font-semibold dark:border-slate-800 dark:bg-slate-900 sm:px-2 sm:py-1">
              <strong className="text-slate-950 dark:text-slate-100">{item.storage_type ?? "미지정"}</strong>
            </span>
            <span className="inventory-product-badge rounded-md border border-slate-200 bg-white px-1.5 py-0.5 font-semibold dark:border-slate-800 dark:bg-slate-900 sm:px-2 sm:py-1">
              <strong className="text-slate-950 dark:text-slate-100">{item.supplier_name ?? "미지정"}</strong>
            </span>
            {item.unit_name ? (
              <span className="inventory-product-badge rounded-md border border-slate-200 bg-white px-1.5 py-0.5 font-semibold dark:border-slate-800 dark:bg-slate-900 sm:px-2 sm:py-1">
                <strong className="text-slate-950 dark:text-slate-100">{item.unit_name}</strong>
              </span>
            ) : null}
          </div>
        </div>
      </div>

      {item.receipt_check_only ? (
        <div className="panel p-3 sm:p-4">
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
      ) : mobileTouchUI ? (
        <div className="space-y-1.5 sm:space-y-4">
          <MobileInventoryControls
            mode={mobileMode}
            warehouseQty={mobileWarehouseQty}
            storeQty={mobileStoreQty}
            confirmedWarehouseQty={mobileConfirmedSnapshot.warehouseQty}
            confirmedStoreQty={mobileConfirmedSnapshot.storeQty}
            autoBaselineWarehouseQty={mobileAutoBaseline.warehouseQty}
            autoBaselineStoreQty={mobileAutoBaseline.storeQty}
            lastInventoryCheckDates={lastInventoryCheckDates}
            disabled={mobileInventoryCheckSaving || mobileSaveState === "pending"}
            rebaseDisabled={mobileInventoryCheckSaving || mobileSaveState === "dragging" || mobileSaveState === "pending"}
            autoRebaseSequence={mobileAutoRebaseSequence}
            saveState={mobileSaveState}
            saveError={mobileSaveError}
            savedAtLabel={mobileEditPointAt ? formatDateTime(mobileEditPointAt) : null}
            saveStatusLabel={mobileSaveStatusLabel}
            canUndo={mobileEditHistoryIndex > 0}
            canRedo={mobileEditHistoryIndex >= 0 && mobileEditHistoryIndex < mobileEditHistory.length - 1}
            onModeChange={(nextMode) => {
              if (nextMode === mobileModeRef.current) return;
              commitUnsettledMobileDraft();
              mobileModeRef.current = nextMode;
              setMobileMode(nextMode);
              resetMobileAutoBaseline();
              resetMobileDraft(true);
            }}
            onDraftChange={handleMobileDraft}
            onCommit={handleMobileCommit}
            onRebaseAutoBaseline={handleMobileAutoBaselineRebase}
            onInventoryCheck={(targetLocation) => void recordMobileInventoryCheck(targetLocation)}
            onOpenKeypad={setMobileKeypadTarget}
            onUndo={() => handleMobileHistoryNavigation("undo")}
            onRedo={() => handleMobileHistoryNavigation("redo")}
          />

          <div className="mobile-inventory-summary panel p-2 sm:p-4">
            {!item.status_enabled ? (
              <InventoryStockRangeBar
                totalStock={mobileWarehouseQty + mobileStoreQty}
                minimumStock={item.minimum_stock}
                abundantMultiplier={abundantMultiplier}
                editing={editingMinimumStock}
                minimumStockDraft={minimumStockDraft}
                saving={minimumStockSaving}
                onStartEdit={() => {
                  setMinimumStockDraft(String(item.minimum_stock));
                  setEditingMinimumStock(true);
                }}
                onDraftChange={setMinimumStockDraft}
                onSave={() => void saveMinimumStock()}
                onCancel={() => {
                  setEditingMinimumStock(false);
                  setMinimumStockDraft(String(item.minimum_stock));
                }}
              />
            ) : null}
            <div className={`${item.status_enabled ? "" : "mt-2"} flex items-center justify-between gap-2 text-sm`}>
              <label className="mobile-inventory-status-row flex shrink-0 items-center gap-2 text-sm font-bold">
                <span>상태</span>
                <input
                  type="checkbox"
                  checked={item.status_enabled}
                  disabled={statusSaving}
                  onChange={(event) => void updateStockStatus(event.target.checked)}
                  className="h-5 w-5 accent-brand-600 disabled:opacity-45 sm:h-6 sm:w-6"
                  aria-label="상태 기능 활성화"
                  aria-controls="mobile-inventory-status-options"
                  aria-expanded={item.status_enabled}
                />
              </label>
            </div>
            <div id="mobile-inventory-status-options" className={`status-options ${item.status_enabled ? "status-options-open" : ""}`} aria-hidden={!item.status_enabled}>
              <div className="status-options-inner">
                <div className="mt-2 grid grid-cols-3 gap-1.5 sm:mt-3 sm:gap-2">
                  {STOCK_STATUSES.map((status) => {
                    const selected = item.status_enabled && item.stock_status === status;
                    return (
                      <button
                        key={status}
                        type="button"
                        disabled={!item.status_enabled || statusSaving}
                        onClick={() => void updateStockStatus(true, status)}
                        className={`touch-button rounded-md px-2 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-45 ${selected ? "bg-brand-600 text-white" : "border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"}`}
                      >
                        {status}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
            {error ? <div className="mt-2"><StatusMessage type="error">{error}</StatusMessage></div> : null}
            {success ? <div className="mt-2"><StatusMessage type="success">{success}</StatusMessage></div> : null}
          </div>
        </div>
      ) : (
        <div className="grid gap-3 sm:gap-4 md:grid-cols-[0.8fr_1.2fr]">
          <div className="panel p-3 sm:p-4">
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  setLocation("창고");
                  fillActualQuantity(item.warehouse_qty);
                }}
                onPointerDown={() => {
                  if (action !== "이동") startDefaultLocationPress("창고");
                }}
                onPointerUp={clearDefaultLocationPressTimer}
                onPointerLeave={clearDefaultLocationPressTimer}
                onPointerCancel={clearDefaultLocationPressTimer}
                onContextMenu={(event) => event.preventDefault()}
                disabled={defaultLocationSaving}
                draggable={false}
                className={`rounded-md border-2 p-2 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:cursor-not-allowed disabled:opacity-60 ${location === "창고" ? "border-violet-500 bg-violet-50 hover:bg-violet-100 dark:border-violet-400 dark:bg-violet-950/40 dark:hover:bg-violet-950/60" : "border-slate-200 bg-slate-100 hover:bg-slate-200 dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800"}`}
                aria-label={`창고 현재 수량 ${formatInventoryQuantity(item.warehouse_qty)} 선택`}
                aria-pressed={location === "창고"}
                title="짧게 눌러 창고 선택 · 길게 누르면 기본값으로 저장"
                style={{ WebkitUserSelect: "none", userSelect: "none" }}
              >
                <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">창고</p>
                <p className="text-xl font-bold">{formatInventoryQuantity(item.warehouse_qty)}</p>
                <p className="mt-1 text-[10px] font-semibold leading-snug text-slate-500 dark:text-slate-400">
                  <LastInventoryCheckLabel info={lastInventoryCheckDates.warehouse} />
                </p>
              </button>
              <button
                type="button"
                onClick={() => {
                  setLocation("매장");
                  fillActualQuantity(item.store_qty);
                }}
                onPointerDown={() => {
                  if (action !== "이동") startDefaultLocationPress("매장");
                }}
                onPointerUp={clearDefaultLocationPressTimer}
                onPointerLeave={clearDefaultLocationPressTimer}
                onPointerCancel={clearDefaultLocationPressTimer}
                onContextMenu={(event) => event.preventDefault()}
                disabled={defaultLocationSaving}
                draggable={false}
                className={`rounded-md border-2 p-2 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:cursor-not-allowed disabled:opacity-60 ${location === "매장" ? "border-violet-500 bg-violet-50 hover:bg-violet-100 dark:border-violet-400 dark:bg-violet-950/40 dark:hover:bg-violet-950/60" : "border-slate-200 bg-slate-100 hover:bg-slate-200 dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800"}`}
                aria-label={`매장 현재 수량 ${formatInventoryQuantity(item.store_qty)} 선택`}
                aria-pressed={location === "매장"}
                title="짧게 눌러 매장 선택 · 길게 누르면 기본값으로 저장"
                style={{ WebkitUserSelect: "none", userSelect: "none" }}
              >
                <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">매장</p>
                <p className="text-xl font-bold">{formatInventoryQuantity(item.store_qty)}</p>
                <p className="mt-1 text-[10px] font-semibold leading-snug text-slate-500 dark:text-slate-400">
                  <LastInventoryCheckLabel info={lastInventoryCheckDates.store} />
                </p>
              </button>
            </div>
            {!item.status_enabled ? (
              <InventoryStockRangeBar
                totalStock={item.total_stock}
                minimumStock={item.minimum_stock}
                abundantMultiplier={abundantMultiplier}
                editing={editingMinimumStock}
                minimumStockDraft={minimumStockDraft}
                saving={minimumStockSaving}
                onStartEdit={() => {
                  setMinimumStockDraft(String(item.minimum_stock));
                  setEditingMinimumStock(true);
                }}
                onDraftChange={setMinimumStockDraft}
                onSave={() => void saveMinimumStock()}
                onCancel={() => {
                  setEditingMinimumStock(false);
                  setMinimumStockDraft(String(item.minimum_stock));
                }}
              />
            ) : null}
          </div>

        <form onSubmit={handleSubmit} className="panel flex flex-col p-3 sm:p-4">
          <div className="grid grid-cols-4 gap-1.5">
            {ACTIONS.map((name) => (
              <label key={name} className={`min-h-10 rounded-md border px-2 py-2 text-center text-sm font-bold ${action === name ? "border-brand-600 bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-100" : "border-slate-200 dark:border-slate-800"}`}>
                <input className="sr-only" type="radio" checked={action === name} onChange={() => setAction(name)} />
                {formatInventoryActionLabel(name)}
              </label>
            ))}
          </div>

          {action === "이동" ? (
            <div className="mt-2 grid grid-cols-2 gap-1.5">
              <button type="button" onClick={() => setMoveDirection("warehouse-to-store")} className={`${moveDirection === "warehouse-to-store" ? "primary-button" : "secondary-button"} min-h-10 px-3 py-1.5 text-sm`}>
                창고 → 매장
              </button>
              <button type="button" onClick={() => setMoveDirection("store-to-warehouse")} className={`${moveDirection === "store-to-warehouse" ? "primary-button" : "secondary-button"} min-h-10 px-3 py-1.5 text-sm`}>
                매장 → 창고
              </button>
            </div>
          ) : null}

          <label className="mt-3 block">
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

          <div className="mt-2 grid grid-cols-3 gap-1.5">
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

          <button className="primary-button order-12 mt-4 min-h-11 w-full py-2 sm:order-none sm:mt-3" type="submit" disabled={saving || quantityValue < 0 || Boolean(quantityStepError) || Boolean(negativeError)}>
            {saving ? "저장 중..." : "저장"}
          </button>

          <div className="order-10 mt-5 rounded-md border border-slate-200 p-3 dark:border-slate-800 sm:order-none">
            <label className="flex items-center justify-between gap-3 text-sm font-bold">
              <span>상태</span>
              <input
                type="checkbox"
                checked={item.status_enabled}
                disabled={statusSaving}
                onChange={(event) => void updateStockStatus(event.target.checked)}
                className="h-5 w-5 accent-brand-600 disabled:opacity-45 sm:h-6 sm:w-6"
                aria-label="상태 기능 활성화"
                aria-controls="inventory-status-options"
                aria-expanded={item.status_enabled}
              />
            </label>

            <div
              id="inventory-status-options"
              className={`status-options ${item.status_enabled ? "status-options-open" : ""}`}
              aria-hidden={!item.status_enabled}
            >
              <div className="status-options-inner">
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
            </div>
          </div>

          {action === "이동" ? (
            <div className="order-11 mt-4 flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400 sm:order-none">
              <ArrowLeftRight size={18} />
              이동은 한쪽 재고를 줄이고 반대쪽 재고를 늘립니다.
            </div>
          ) : null}

        </form>
      </div>
      )}

      <form onSubmit={handleMemoSubmit} className="inventory-memo-panel panel mt-2 p-3 sm:mt-4 sm:p-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <label htmlFor="inventory-memo" className="text-sm font-bold">
            메모
          </label>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setMemoOpen((open) => !open)}
              className="touch-button icon-button shrink-0"
              aria-label={memoOpen ? "메모 접기" : "메모 펼치기"}
              aria-expanded={memoOpen}
              aria-controls="inventory-memo-content"
              title={memoOpen ? "메모 접기" : "메모 펼치기"}
            >
              <ChevronDown className={`transition-transform ${memoOpen ? "rotate-0" : "-rotate-90"}`} size={18} />
            </button>
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
        </div>
        <div id="inventory-memo-content" hidden={!memoOpen}>
        {latestMemo ? (
          <div className="mb-3 rounded-md border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900">
            <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-extrabold text-brand-700 dark:text-brand-100">최근 메모</span>
              <div className="flex items-center gap-1.5">
                <span className="text-right text-xs font-semibold text-slate-500 dark:text-slate-400">
                  <span className="block">{formatDateTime(latestMemo.created_at)}</span>
                  <span className="block">{getMemoStaffName(latestMemo)}</span>
                </span>
                {isOwnMemo(latestMemo) ? (
                  <button type="button" onClick={() => startMemoEdit(latestMemo)} className="touch-button icon-button" aria-label="최근 메모 수정" title="메모 수정">
                    <Pencil size={16} />
                  </button>
                ) : null}
              </div>
            </div>
            <p className="whitespace-pre-wrap break-words text-sm font-semibold leading-relaxed">{latestMemo.note}</p>
          </div>
        ) : null}
        {editingMemoId ? (
          <div className="mb-2 flex items-center justify-between gap-2 rounded-md bg-brand-50 px-3 py-2 text-xs font-bold text-brand-700 dark:bg-brand-950 dark:text-brand-100">
            <span>내 메모 수정 중</span>
            <button type="button" onClick={cancelMemoEdit} className="underline underline-offset-2">수정 취소</button>
          </div>
        ) : null}
        <textarea
          id="inventory-memo"
          className="field min-h-20 resize-y sm:min-h-28"
          value={memoText}
          onChange={(event) => {
            setMemoText(event.target.value);
            setMemoError("");
            setMemoSuccess("");
          }}
          placeholder={editingMemoId ? "수정할 메모를 입력하세요" : "메모를 입력하세요"}
        />
        {memoError ? <div className="mt-2"><StatusMessage type="error">{memoError}</StatusMessage></div> : null}
        {memoSuccess ? <div className="mt-2"><StatusMessage type="success">{memoSuccess}</StatusMessage></div> : null}
        <button className="primary-button mt-2 min-h-10 w-full py-2 sm:min-h-11" type="submit" disabled={memoSaving || memoIsEmpty}>
          {memoSaving ? "저장 중..." : editingMemoId ? "수정 저장" : "저장"}
        </button>
        </div>
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
                          <span className="rounded bg-slate-100 px-2 py-1 text-xs font-extrabold dark:bg-slate-800">{formatHistoryPointAction(point.log)}</span>
                          <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">{formatDateTime(point.log.created_at)}</span>
                          {index === 0 ? <span className="rounded bg-brand-100 px-2 py-1 text-[10px] font-extrabold text-brand-700 dark:bg-brand-950 dark:text-brand-100">현재 상태</span> : null}
                        </div>
                        <p className="mt-2 text-sm font-bold">{formatHistoryPointContent(point.log)}</p>
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
              {!historyLoading && aliasHistoryLogs.length > 0 ? (
                <section className="mt-5 border-t border-slate-200 pt-4 dark:border-slate-800">
                  <h3 className="text-sm font-extrabold">병합된 원본의 과거 기록</h3>
                  <p className="mt-1 text-xs font-semibold text-slate-500 dark:text-slate-400">원래 상품 ID와 상품명을 보존한 읽기 전용 기록입니다. 대표 상품 재고 복원 대상으로 사용하지 않습니다.</p>
                  <div className="mt-3 space-y-2">
                    {aliasHistoryLogs.map((log) => (
                      <div key={log.id} className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded bg-slate-100 px-2 py-1 text-xs font-extrabold dark:bg-slate-800">{log.aliasProductName}</span>
                          <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">{formatDateTime(log.created_at)}</span>
                        </div>
                        <p className="mt-2 text-sm font-bold">{formatInventoryActionLabel(log.action)} · {formatLogContent(log)}</p>
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      <QuantityKeypadSheet
        open={mobileTouchUI && mobileKeypadTarget !== null}
        title={`${mobileKeypadTarget === "warehouse" ? "창고" : "매장"} ${mobileMode === "auto" || mobileMode === "move" ? "조정값" : "수량"} 입력`}
        initialValue={mobileKeypadTarget === "warehouse"
          ? mobileMode === "auto"
            ? mobileWarehouseQty - mobileAutoBaseline.warehouseQty
            : mobileMode === "move"
              ? mobileWarehouseQty - mobileConfirmedSnapshot.warehouseQty
              : mobileWarehouseQty
          : mobileMode === "auto"
            ? mobileStoreQty - mobileAutoBaseline.storeQty
            : mobileMode === "move"
              ? mobileStoreQty - mobileConfirmedSnapshot.storeQty
              : mobileStoreQty}
        min={mobileMode === "auto"
          ? mobileKeypadTarget === "warehouse" ? -mobileAutoBaseline.warehouseQty : -mobileAutoBaseline.storeQty
          : mobileMode === "move"
            ? mobileKeypadTarget === "warehouse" ? -mobileConfirmedSnapshot.warehouseQty : -mobileConfirmedSnapshot.storeQty
            : undefined}
        max={mobileMode === "move"
          ? mobileKeypadTarget === "warehouse" ? mobileConfirmedSnapshot.storeQty : mobileConfirmedSnapshot.warehouseQty
          : undefined}
        signed={mobileMode === "auto" || mobileMode === "move"}
        onClose={() => setMobileKeypadTarget(null)}
        onConfirm={handleMobileKeypadConfirm}
        formatValue={formatInventoryQuantity}
      />

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
                    <div className="flex items-start justify-between gap-2">
                      <p className="whitespace-pre-wrap break-words text-sm font-semibold leading-relaxed">{memo.note}</p>
                      {isOwnMemo(memo) ? (
                        <button
                          type="button"
                          onClick={() => {
                            startMemoEdit(memo);
                            setMemoHistoryOpen(false);
                          }}
                          className="touch-button icon-button shrink-0"
                          aria-label="메모 수정"
                          title="메모 수정"
                        >
                          <Pencil size={16} />
                        </button>
                      ) : null}
                    </div>
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
