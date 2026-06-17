import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowLeftRight, History, List, Minus, Pencil, Plus, RotateCcw, X } from "lucide-react";
import { StatusMessage } from "../components/StatusMessage";
import { ACTIONS, QUICK_AMOUNTS } from "../lib/constants";
import { formatDateTime } from "../lib/date";
import { formatLogContent, normalizeInventoryItem } from "../lib/inventory";
import { supabase } from "../lib/supabase";
import type { AppRoute, InventoryAction, InventoryItem, InventoryLog, Location, StockStatus } from "../types/domain";

type Props = {
  productId: string;
  navigate: (route: AppRoute) => void;
  canGoBack?: boolean;
  onBack?: () => void;
};

const STOCK_STATUSES: StockStatus[] = ["충분", "절반 이하", "발주 필요"];

type InventoryHistoryPoint = {
  log: InventoryLog;
  warehouseQty: number;
  storeQty: number;
};

function formatStatusUpdateError(message: string) {
  if (message.includes("status_enabled") || message.includes("stock_status") || message.includes("schema cache")) {
    return "상태 기능 DB 업데이트가 아직 적용되지 않았습니다. 관리자에게 products 상태 컬럼 추가를 요청해 주세요.";
  }
  return message;
}

export function InventoryOperationPage({ productId, navigate, canGoBack = false, onBack }: Props) {
  const [item, setItem] = useState<InventoryItem | null>(null);
  const [history, setHistory] = useState<InventoryHistoryPoint[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [action, setAction] = useState<InventoryAction>("조정");
  const [location, setLocation] = useState<Location>("창고");
  const [moveDirection, setMoveDirection] = useState<"warehouse-to-store" | "store-to-warehouse">("warehouse-to-store");
  const [quantity, setQuantity] = useState("");
  const [note, setNote] = useState("");
  const [editingMinimumStock, setEditingMinimumStock] = useState(false);
  const [minimumStockDraft, setMinimumStockDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [statusSaving, setStatusSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const loadProduct = useCallback(async () => {
    setLoading(true);
    setError("");
    const { data, error: loadError } = await supabase.from("products").select("*, inventory(*)").eq("id", productId).single();

    if (loadError) {
      setError(loadError.message);
    } else {
      const nextItem = normalizeInventoryItem(data as Parameters<typeof normalizeInventoryItem>[0]);

      if (!nextItem.inventory) {
        const { data: inventoryData, error: inventoryError } = await supabase
          .from("inventory")
          .upsert({ product_id: productId }, { onConflict: "product_id" })
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
  }, [productId]);

  useEffect(() => {
    void loadProduct();
  }, [loadProduct]);

  const quantityValue = quantity.trim() === "" ? 0 : Number(quantity);
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

  async function updateStockStatus(nextStatusEnabled: boolean, nextStockStatus: StockStatus | null = item?.stock_status ?? "충분") {
    if (!item) return;

    setStatusSaving(true);
    setError("");
    setSuccess("");
    const stockStatus = nextStatusEnabled ? nextStockStatus ?? "충분" : nextStockStatus;
    const { error: updateError } = await supabase
      .from("products")
      .update({ status_enabled: nextStatusEnabled, stock_status: stockStatus })
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
    const { error: updateError } = await supabase.from("products").update({ minimum_stock: nextMinimumStock }).eq("id", item.id);

    if (updateError) {
      setError(updateError.message);
    } else {
      setEditingMinimumStock(false);
      setSuccess("최소재고를 수정했습니다.");
      await loadProduct();
    }
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
    const { data, error: historyError } = await supabase
      .from("inventory_logs")
      .select("*")
      .eq("product_id", item.id)
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
      `${formatDateTime(point.log.created_at)} 작업 직후 상태로 복원하시겠습니까?\n창고 ${point.warehouseQty} / 매장 ${point.storeQty}\n선택 시점 이후 작업은 히스토리에서 취소 처리됩니다.`
    );
    if (!confirmed) return;

    setRestoring(true);
    setError("");
    setSuccess("");
    const { error: restoreError } = await supabase.rpc("restore_inventory_to_log", {
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
      setNote("");
      await loadProduct();
    }
    setRestoring(false);
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

    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      setError(userError?.message ?? "로그인이 필요합니다.");
      setSaving(false);
      return;
    }

    const { error: updateError } = await supabase
      .from("inventory")
      .update({ warehouse_qty: nextWarehouseQty, store_qty: nextStoreQty })
      .eq("id", currentInventory.id);

    if (updateError) {
      setError(updateError.message);
      setSaving(false);
      return;
    }

    const { error: logError } = await supabase.from("inventory_logs").insert({
      product_id: item.id,
      user_id: userData.user.id,
      action,
      source_location: source,
      destination_location: destination,
      previous_quantity: previousQuantity,
      new_quantity: newQuantity,
      quantity: quantityValue,
      note: note.trim() || null,
      warehouse_qty_before: item.warehouse_qty,
      store_qty_before: item.store_qty,
      warehouse_qty_after: nextWarehouseQty,
      store_qty_after: nextStoreQty
    });

    if (logError) {
      setError(logError.message);
    } else {
      if (action === "입고" && item.fresh_order_selected) {
        const { error: freshCompleteError } = await supabase
          .from("products")
          .update({
            fresh_order_selected: false,
            fresh_order_selected_at: null
          })
          .eq("id", item.id);

        if (freshCompleteError) {
          setError(freshCompleteError.message);
          setSaving(false);
          return;
        }
      }
      setSuccess("저장되었습니다.");
      setQuantity("");
      setNote("");
      await loadProduct();
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
            disabled={restoring || saving}
            onClick={() => void openHistory()}
            aria-label="되돌리기"
            title={restoring ? "처리 중" : "되돌리기"}
          >
            <History size={19} />
          </button>
        </div>
      </div>

      <div className="-mt-2 mb-2">
        <p className="break-words text-2xl font-bold leading-tight text-slate-950 dark:text-slate-100">{item.name}</p>
        <p className="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">{item.barcode ?? "바코드 없음"}</p>
      </div>

      <div className="mb-3 flex flex-wrap gap-2 text-sm">
        <span className="rounded-md border border-slate-200 bg-white px-3 py-1.5 font-semibold dark:border-slate-800 dark:bg-slate-900">
          <strong className="text-slate-950 dark:text-slate-100">{item.storage_type ?? "미지정"}</strong>
        </span>
        <span className="rounded-md border border-slate-200 bg-white px-3 py-1.5 font-semibold dark:border-slate-800 dark:bg-slate-900">
          <strong className="text-slate-950 dark:text-slate-100">{item.supplier_name ?? "미지정"}</strong>
        </span>
      </div>

      <div className="grid gap-3 lg:grid-cols-[0.8fr_1.2fr]">
        <div className="panel p-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-md bg-slate-100 p-2.5 dark:bg-slate-900">
              <p className="text-sm text-slate-500 dark:text-slate-400">창고</p>
              <p className="text-2xl font-bold">{item.warehouse_qty}</p>
            </div>
            <div className="rounded-md bg-slate-100 p-2.5 dark:bg-slate-900">
              <p className="text-sm text-slate-500 dark:text-slate-400">매장</p>
              <p className="text-2xl font-bold">{item.store_qty}</p>
            </div>
          </div>
          <div className="mt-3 rounded-md border border-slate-200 p-2.5 text-sm dark:border-slate-800">
            <div className="flex flex-wrap items-center gap-2">
              <span>
                총재고 <strong>{item.total_stock}</strong> · 최소재고 <strong>{item.minimum_stock}</strong>
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

        <form onSubmit={handleSubmit} className="panel p-3">
          <div className="grid grid-cols-4 gap-2">
            {ACTIONS.map((name) => (
              <label key={name} className={`rounded-md border p-2.5 text-center text-sm font-bold ${action === name ? "border-brand-600 bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-100" : "border-slate-200 dark:border-slate-800"}`}>
                <input className="sr-only" type="radio" checked={action === name} onChange={() => setAction(name)} />
                {name}
              </label>
            ))}
          </div>

          {action !== "이동" ? (
            <div className="mt-3 grid grid-cols-2 gap-2">
              {(["창고", "매장"] as Location[]).map((name) => (
                <button key={name} type="button" onClick={() => setLocation(name)} className={location === name ? "primary-button" : "secondary-button"}>
                  {name}
                </button>
              ))}
            </div>
          ) : (
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setMoveDirection("warehouse-to-store")} className={moveDirection === "warehouse-to-store" ? "primary-button" : "secondary-button"}>
                창고 → 매장
              </button>
              <button type="button" onClick={() => setMoveDirection("store-to-warehouse")} className={moveDirection === "store-to-warehouse" ? "primary-button" : "secondary-button"}>
                매장 → 창고
              </button>
            </div>
          )}

          <label className="mt-3 block">
            <span className="mb-1 block text-sm font-semibold">{action === "조정" ? "실제 재고 수량" : "수량"}</span>
            <div className="flex gap-2">
              <button type="button" onClick={decreaseQuantity} className="secondary-button inline-flex w-14 items-center justify-center" aria-label="수량 감소">
                <Minus size={20} />
              </button>
              <input
                className="field text-center text-xl font-bold"
                type="text"
                inputMode="decimal"
                pattern="[0-9]*[.]?[0-9]*"
                value={quantity}
                onChange={(event) => updateQuantityInput(event.target.value)}
              />
              <button type="button" onClick={() => addQuickAmount(1)} className="secondary-button inline-flex w-14 items-center justify-center" aria-label="수량 증가">
                <Plus size={20} />
              </button>
            </div>
          </label>

          <div className="mt-2 grid grid-cols-3 gap-2">
            {QUICK_AMOUNTS.map((amount) => (
              <button key={amount} type="button" onClick={() => addQuickAmount(amount)} className="secondary-button">
                +{amount}
              </button>
            ))}
          </div>

          {quantityStepError ? <div className="mt-3"><StatusMessage type="error">{quantityStepError}</StatusMessage></div> : null}
          {negativeError ? <div className="mt-3"><StatusMessage type="error">{negativeError}</StatusMessage></div> : null}
          {error ? <div className="mt-3"><StatusMessage type="error">{error}</StatusMessage></div> : null}
          {success ? <div className="mt-3"><StatusMessage type="success">{success}</StatusMessage></div> : null}

          <button className="primary-button mt-3 w-full" type="submit" disabled={saving || quantityValue < 0 || Boolean(quantityStepError) || Boolean(negativeError)}>
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

          {action === "조정" ? (
            <label className="mt-4 block">
              <span className="mb-1 block text-sm font-semibold">조정 사유</span>
              <textarea className="field min-h-24" value={note} onChange={(event) => setNote(event.target.value)} placeholder="실사, 파손 발견, 기록 오류 수정" />
            </label>
          ) : null}

          {action === "이동" ? (
            <div className="mt-4 flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
              <ArrowLeftRight size={18} />
              이동은 한쪽 재고를 줄이고 반대쪽 재고를 늘립니다.
            </div>
          ) : null}

        </form>
      </div>

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
                        {point.log.note ? <p className="mt-1 break-words text-xs text-slate-500 dark:text-slate-400">{point.log.note}</p> : null}
                      </div>
                      {index > 0 ? <RotateCcw className="mt-1 shrink-0 text-brand-700 dark:text-brand-100" size={18} /> : null}
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2 text-center">
                      <span className="rounded-md bg-slate-100 px-2 py-2 text-xs dark:bg-slate-900">
                        창고 <strong className="ml-1 text-sm">{point.warehouseQty}</strong>
                      </span>
                      <span className="rounded-md bg-slate-100 px-2 py-2 text-xs dark:bg-slate-900">
                        매장 <strong className="ml-1 text-sm">{point.storeQty}</strong>
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
