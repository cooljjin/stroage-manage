import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowUp, ChefHat, Minus, Plus, RefreshCw, Trash2, Utensils } from "lucide-react";
import { StatusMessage } from "../components/StatusMessage";
import { QUICK_AMOUNTS } from "../lib/constants";
import { formatInventoryQuantity } from "../lib/inventory";
import { supabase } from "../lib/supabase";
import type { AppRoute, Inventory, PrepItem } from "../types/domain";

type Props = {
  navigate: (route: AppRoute) => void;
};

type PrepModeItem = PrepItem & {
  stock: number;
};

type PrepOperation = "제조" | "소진" | "폐기";

const OPERATIONS: Array<{ value: PrepOperation; label: string; icon: typeof ChefHat; className: string }> = [
  { value: "제조", label: "제조", icon: ChefHat, className: "bg-brand-600 text-white" },
  { value: "소진", label: "소진", icon: Utensils, className: "bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-950" },
  { value: "폐기", label: "폐기", icon: Trash2, className: "bg-rose-600 text-white" }
];

function schemaError(message: string) {
  if (message.includes("prep_items") || message.includes("record_prep_operation") || message.includes("reorder_prep_items") || message.includes("schema cache")) {
    return `프랩관리모드용 데이터베이스 업데이트가 필요합니다. (${message})`;
  }
  return message;
}

function quantityNumberOrZero(value: string) {
  const numericValue = Number(value || 0);
  return Number.isFinite(numericValue) ? numericValue : 0;
}

export function PrepModePage({ navigate }: Props) {
  const [items, setItems] = useState<PrepModeItem[]>([]);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [operation, setOperation] = useState<PrepOperation | null>(null);
  const [quantity, setQuantity] = useState("");
  const [orderEditing, setOrderEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const selectedItem = useMemo(() => items.find((item) => item.id === selectedItemId) ?? null, [items, selectedItemId]);
  const quantityValue = quantity.trim() === "" ? 0 : Number(quantity);
  const quantityError = useMemo(() => {
    if (quantity.trim() === "") return "";
    if (!Number.isFinite(quantityValue) || quantityValue <= 0) return "수량은 0보다 커야 합니다.";
    return "";
  }, [quantity, quantityValue]);
  const stockError = selectedItem && operation !== "제조" && quantityValue > selectedItem.stock ? "현재 프랩 재고보다 많이 처리할 수 없습니다." : "";

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    if (!selectedItem) return;

    const previousBodyOverflow = document.body.style.overflow;
    const previousBodyOverscrollBehavior = document.body.style.overscrollBehavior;
    const previousDocumentOverflow = document.documentElement.style.overflow;
    const previousDocumentOverscrollBehavior = document.documentElement.style.overscrollBehavior;

    window.scrollTo({ top: 0, behavior: "auto" });
    document.body.style.overflow = "hidden";
    document.body.style.overscrollBehavior = "none";
    document.documentElement.style.overflow = "hidden";
    document.documentElement.style.overscrollBehavior = "none";

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.body.style.overscrollBehavior = previousBodyOverscrollBehavior;
      document.documentElement.style.overflow = previousDocumentOverflow;
      document.documentElement.style.overscrollBehavior = previousDocumentOverscrollBehavior;
    };
  }, [selectedItem]);

  async function refresh() {
    setLoading(true);
    setError("");

    const { data, error: itemError } = await supabase
      .from("prep_items")
      .select("*")
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });

    if (itemError) {
      setError(schemaError(itemError.message));
      setLoading(false);
      return;
    }

    const nextItems = (data ?? []) as PrepItem[];
    const productIds = nextItems.map((item) => item.product_id);
    const inventoryResult = productIds.length > 0
      ? await supabase.from("inventory").select("*").in("product_id", productIds)
      : { data: [], error: null };

    if (inventoryResult.error) {
      setError(schemaError(inventoryResult.error.message));
      setLoading(false);
      return;
    }

    const inventoryByProductId = new Map(((inventoryResult.data ?? []) as Inventory[]).map((inventory) => [inventory.product_id, inventory]));
    setItems(
      nextItems.map((item) => ({
        ...item,
        stock: inventoryByProductId.get(item.product_id)?.store_qty ?? 0
      }))
    );
    setLoading(false);
  }

  function selectItem(item: PrepModeItem) {
    if (orderEditing) return;
    setSelectedItemId(item.id);
    setOperation("소진");
    setQuantity("");
    setMessage("");
    setError("");
  }

  function closeItem() {
    setSelectedItemId(null);
    setOperation(null);
    setQuantity("");
    setMessage("");
    setError("");
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

  async function moveItem(index: number, direction: "up" | "down") {
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    const current = items[index];
    const target = items[targetIndex];
    if (!current || !target) return;

    const nextItems = [...items];
    nextItems[index] = target;
    nextItems[targetIndex] = current;
    setItems(nextItems);
    setError("");
    setMessage("");

    const { error: reorderError } = await supabase.rpc("reorder_prep_items", {
      ordered_prep_item_ids: nextItems.map((item) => item.id)
    });

    if (reorderError) {
      setError(schemaError(reorderError.message));
      await refresh();
    } else {
      setMessage("품목 순서를 저장했습니다.");
      await refresh();
    }
  }

  async function saveOperation() {
    if (!selectedItem || !operation || quantityError || stockError || quantityValue <= 0) return;

    setSaving(true);
    setError("");
    setMessage("");
    const { error: operationError } = await supabase.rpc("record_prep_operation", {
      target_prep_item_id: selectedItem.id,
      operation_type: operation,
      operation_quantity: quantityValue
    });

    if (operationError) {
      setError(schemaError(operationError.message));
    } else {
      const successMessage = `${selectedItem.name} ${operation} ${formatInventoryQuantity(quantityValue)}개를 저장했습니다.`;
      closeItem();
      await refresh();
      setMessage(successMessage);
    }
    setSaving(false);
  }

  return (
    <section className={`flex flex-col ${selectedItem ? "h-[calc(100dvh-9rem)] min-h-0 overflow-hidden overscroll-none" : "min-h-[calc(100dvh-9rem)]"}`}>
      <div className="mb-3 flex min-w-0 items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-bold text-brand-700 dark:text-brand-100">주방 전용</p>
          <h1 className="truncate text-2xl font-extrabold">프랩관리모드</h1>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button type="button" onClick={() => navigate({ name: "home" })} className="touch-button icon-button" aria-label="홈으로 이동" title="홈">
            <ArrowLeft size={20} />
          </button>
          <button type="button" onClick={() => void refresh()} className="touch-button icon-button" aria-label="새로고침" title="새로고침">
            <RefreshCw size={20} />
          </button>
          <button
            type="button"
            onClick={() => setOrderEditing((value) => !value)}
            className={`touch-button rounded-md border px-3 text-sm font-extrabold ${orderEditing ? "border-brand-600 bg-brand-600 text-white" : "border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-900"}`}
          >
            순서
          </button>
        </div>
      </div>

      {error ? <div className="mb-3"><StatusMessage type="error">{error}</StatusMessage></div> : null}
      {message ? <div className="mb-3"><StatusMessage type="success">{message}</StatusMessage></div> : null}
      {loading ? <StatusMessage>프랩 품목을 불러오는 중...</StatusMessage> : null}

      {!loading && !selectedItem ? (
        <div className="grid gap-3 pb-4 sm:grid-cols-2 lg:grid-cols-4">
          {items.map((item, index) => (
            <div key={item.id} className="relative">
              <button
                type="button"
                onClick={() => selectItem(item)}
                className="min-h-36 w-full rounded-lg border border-slate-200 bg-white p-4 text-left shadow-sm transition-colors hover:border-brand-500 hover:bg-brand-50 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-brand-500 dark:hover:bg-brand-950"
              >
                <span className="block break-words text-2xl font-extrabold leading-tight">{item.name}</span>
                <span className="mt-5 block text-3xl font-black tabular-nums text-brand-700 dark:text-brand-100">{formatInventoryQuantity(item.stock)}개</span>
              </button>
              {orderEditing ? (
                <div className="absolute right-2 top-2 grid gap-1">
                  <button
                    type="button"
                    onClick={() => void moveItem(index, "up")}
                    disabled={index === 0}
                    className="grid h-11 w-11 place-items-center rounded-md bg-white/95 text-slate-900 shadow disabled:opacity-35 dark:bg-slate-950/95 dark:text-slate-100"
                    aria-label="위로 이동"
                    title="위로"
                  >
                    <ArrowUp size={19} />
                  </button>
                  <button
                    type="button"
                    onClick={() => void moveItem(index, "down")}
                    disabled={index === items.length - 1}
                    className="grid h-11 w-11 place-items-center rounded-md bg-white/95 text-slate-900 shadow disabled:opacity-35 dark:bg-slate-950/95 dark:text-slate-100"
                    aria-label="아래로 이동"
                    title="아래로"
                  >
                    <ArrowDown size={19} />
                  </button>
                </div>
              ) : null}
            </div>
          ))}

          {items.length === 0 ? <StatusMessage>등록된 프랩 품목이 없습니다.</StatusMessage> : null}
        </div>
      ) : null}

      {selectedItem ? (
        <div className="mx-auto w-full max-w-3xl">
          <div className="mb-3 flex items-center gap-2">
            <button type="button" onClick={closeItem} className="touch-button icon-button shrink-0" aria-label="목록으로 돌아가기" title="뒤로">
              <ArrowLeft size={20} />
            </button>
            <div className="min-w-0">
              <h2 className="break-words text-3xl font-black leading-tight">{selectedItem.name}</h2>
              <p className="mt-1 text-base font-bold text-slate-500 dark:text-slate-400">현재 수량 {formatInventoryQuantity(selectedItem.stock)}개</p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {OPERATIONS.map((item) => {
              const Icon = item.icon;
              const selected = operation === item.value;
              return (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => setOperation(item.value)}
                  className={`flex min-h-24 flex-col items-center justify-center gap-2 rounded-lg border text-xl font-black ${
                    selected ? item.className : "border-slate-200 bg-white text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
                  }`}
                >
                  <Icon size={28} />
                  {item.label}
                </button>
              );
            })}
          </div>

          <div className="mt-4 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex gap-2">
              <button type="button" onClick={decreaseQuantity} className="secondary-button inline-flex h-16 w-20 items-center justify-center px-2" aria-label="수량 감소">
                <Minus size={28} />
              </button>
              <input
                className="field h-16 text-center text-3xl font-black tabular-nums"
                type="text"
                inputMode="decimal"
                pattern="[0-9]*[.]?[0-9]*"
                value={quantity}
                onChange={(event) => updateQuantityInput(event.target.value)}
              />
              <button type="button" onClick={() => addQuickAmount(1)} className="secondary-button inline-flex h-16 w-20 items-center justify-center px-2" aria-label="수량 증가">
                <Plus size={28} />
              </button>
            </div>

            <div className="mt-2 grid grid-cols-3 gap-2">
              {QUICK_AMOUNTS.map((amount) => (
                <button key={amount} type="button" onClick={() => addQuickAmount(amount)} className="secondary-button h-14 py-2 text-xl font-black">
                  +{amount}
                </button>
              ))}
            </div>
          </div>

          {quantityError ? <div className="mt-3"><StatusMessage type="error">{quantityError}</StatusMessage></div> : null}
          {stockError ? <div className="mt-3"><StatusMessage type="error">{stockError}</StatusMessage></div> : null}

          <button
            type="button"
            onClick={() => void saveOperation()}
            disabled={saving || !operation || quantityValue <= 0 || Boolean(quantityError) || Boolean(stockError)}
            className="primary-button mt-4 h-16 w-full text-xl font-black"
          >
            {saving ? "저장 중..." : "저장"}
          </button>
        </div>
      ) : null}
    </section>
  );
}
