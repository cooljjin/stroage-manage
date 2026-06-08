import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeftRight, Minus, Plus } from "lucide-react";
import { PageTitle } from "../components/PageTitle";
import { StatusMessage } from "../components/StatusMessage";
import { ACTIONS, QUICK_AMOUNTS } from "../lib/constants";
import { normalizeInventoryItem } from "../lib/inventory";
import { supabase } from "../lib/supabase";
import type { AppRoute, InventoryAction, InventoryItem, Location, StockStatus } from "../types/domain";

type Props = {
  productId: string;
  navigate: (route: AppRoute) => void;
};

const STOCK_STATUSES: StockStatus[] = ["충분", "절반 이하", "발주 필요"];

export function InventoryOperationPage({ productId, navigate }: Props) {
  const [item, setItem] = useState<InventoryItem | null>(null);
  const [action, setAction] = useState<InventoryAction>("입고");
  const [location, setLocation] = useState<Location>("창고");
  const [moveDirection, setMoveDirection] = useState<"warehouse-to-store" | "store-to-warehouse">("warehouse-to-store");
  const [quantity, setQuantity] = useState("");
  const [note, setNote] = useState("");
  const [editingMinimumStock, setEditingMinimumStock] = useState(false);
  const [minimumStockDraft, setMinimumStockDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
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
      setError(updateError.message);
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
      note: note.trim() || null
    });

    if (logError) {
      setError(logError.message);
    } else {
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
      <PageTitle
        title="재고 작업"
        action={
          <div className="flex items-center gap-2">
            <button className="secondary-button px-3" type="button" onClick={() => navigate({ name: "product-edit", productId: item.id })}>수정</button>
            <button className="secondary-button px-3" type="button" onClick={() => navigate({ name: "inventory" })}>목록</button>
          </div>
        }
      />

      <div className="-mt-2 mb-4">
        <p className="break-words text-2xl font-bold leading-tight text-slate-950 dark:text-slate-100">{item.name}</p>
        <p className="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">{item.barcode ?? "바코드 없음"}</p>
      </div>

      <div className="mb-4 flex flex-wrap gap-2 text-sm">
        <span className="rounded-md border border-slate-200 bg-white px-3 py-2 font-semibold dark:border-slate-800 dark:bg-slate-900">
          <strong className="text-slate-950 dark:text-slate-100">{item.storage_type ?? "미지정"}</strong>
        </span>
        <span className="rounded-md border border-slate-200 bg-white px-3 py-2 font-semibold dark:border-slate-800 dark:bg-slate-900">
          <strong className="text-slate-950 dark:text-slate-100">{item.supplier_name ?? "미지정"}</strong>
        </span>
      </div>

      <div className="grid gap-4 lg:grid-cols-[0.8fr_1.2fr]">
        <div className="panel p-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-md bg-slate-100 p-3 dark:bg-slate-900">
              <p className="text-sm text-slate-500 dark:text-slate-400">창고</p>
              <p className="text-3xl font-bold">{item.warehouse_qty}</p>
            </div>
            <div className="rounded-md bg-slate-100 p-3 dark:bg-slate-900">
              <p className="text-sm text-slate-500 dark:text-slate-400">매장</p>
              <p className="text-3xl font-bold">{item.store_qty}</p>
            </div>
          </div>
          <div className="mt-3 rounded-md border border-slate-200 p-3 text-sm dark:border-slate-800">
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

        <form onSubmit={handleSubmit} className="panel p-4">
          <div className="grid grid-cols-4 gap-2">
            {ACTIONS.map((name) => (
              <label key={name} className={`rounded-md border p-3 text-center text-sm font-bold ${action === name ? "border-brand-600 bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-100" : "border-slate-200 dark:border-slate-800"}`}>
                <input className="sr-only" type="radio" checked={action === name} onChange={() => setAction(name)} />
                {name}
              </label>
            ))}
          </div>

          {action !== "이동" ? (
            <div className="mt-4 grid grid-cols-2 gap-2">
              {(["창고", "매장"] as Location[]).map((name) => (
                <button key={name} type="button" onClick={() => setLocation(name)} className={location === name ? "primary-button" : "secondary-button"}>
                  {name}
                </button>
              ))}
            </div>
          ) : (
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setMoveDirection("warehouse-to-store")} className={moveDirection === "warehouse-to-store" ? "primary-button" : "secondary-button"}>
                창고 → 매장
              </button>
              <button type="button" onClick={() => setMoveDirection("store-to-warehouse")} className={moveDirection === "store-to-warehouse" ? "primary-button" : "secondary-button"}>
                매장 → 창고
              </button>
            </div>
          )}

          <label className="mt-4 block">
            <span className="mb-1 block text-sm font-semibold">{action === "조정" ? "실제 재고 수량" : "수량"}</span>
            <div className="flex gap-2">
              <button type="button" onClick={decreaseQuantity} className="secondary-button inline-flex w-14 items-center justify-center" aria-label="수량 감소">
                <Minus size={20} />
              </button>
              <input
                className="field text-center text-2xl font-bold"
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

          <div className="mt-3 grid grid-cols-3 gap-2">
            {QUICK_AMOUNTS.map((amount) => (
              <button key={amount} type="button" onClick={() => addQuickAmount(amount)} className="secondary-button">
                +{amount}
              </button>
            ))}
          </div>

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

          {quantityStepError ? <div className="mt-4"><StatusMessage type="error">{quantityStepError}</StatusMessage></div> : null}
          {negativeError ? <div className="mt-4"><StatusMessage type="error">{negativeError}</StatusMessage></div> : null}
          {error ? <div className="mt-4"><StatusMessage type="error">{error}</StatusMessage></div> : null}
          {success ? <div className="mt-4"><StatusMessage type="success">{success}</StatusMessage></div> : null}

          <button className="primary-button mt-5 w-full" type="submit" disabled={saving || quantityValue < 0 || Boolean(quantityStepError) || Boolean(negativeError)}>
            {saving ? "저장 중..." : "저장"}
          </button>
        </form>
      </div>
    </section>
  );
}
