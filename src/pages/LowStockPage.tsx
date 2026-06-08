import { useEffect, useMemo, useState } from "react";
import { PageTitle } from "../components/PageTitle";
import { StatusMessage } from "../components/StatusMessage";
import { normalizeInventoryItem } from "../lib/inventory";
import { supabase } from "../lib/supabase";
import type { AppRoute, InventoryItem } from "../types/domain";

type Props = {
  navigate: (route: AppRoute) => void;
};

function ProductLinkButton({ url }: { url: string | null }) {
  const hasUrl = Boolean(url);

  return (
    <span className="inline-flex justify-center" onClick={(event) => event.stopPropagation()}>
      <button
        type="button"
        disabled={!hasUrl}
        onClick={() => {
          if (url) {
            window.open(url, "_blank", "noopener,noreferrer");
          }
        }}
        className="min-h-10 min-w-[54px] whitespace-nowrap rounded-md border border-slate-300 px-2 text-xs font-bold text-brand-700 disabled:cursor-not-allowed disabled:text-slate-400 disabled:opacity-45 dark:border-slate-700 dark:text-brand-200 dark:disabled:text-slate-600"
      >
        [링크]
      </button>
    </span>
  );
}

export function LowStockPage({ navigate }: Props) {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [updatingOrderIds, setUpdatingOrderIds] = useState<Set<string>>(new Set());
  const [urgentModalOpen, setUrgentModalOpen] = useState(false);
  const [urgentProductId, setUrgentProductId] = useState("");
  const [urgentQuantity, setUrgentQuantity] = useState("");
  const [savingUrgent, setSavingUrgent] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    void loadItems();
  }, []);

  async function loadItems() {
    setLoading(true);
    const { data, error: loadError } = await supabase.from("products").select("*, inventory(*)").eq("is_active", true).order("name", { ascending: true });
    if (loadError) {
      setError(loadError.message);
    } else {
      setItems((data ?? []).map((row) => normalizeInventoryItem(row as Parameters<typeof normalizeInventoryItem>[0])));
    }
    setLoading(false);
  }

  const lowStockItems = useMemo(() => {
    return items
      .filter((item) => item.is_low_stock)
      .sort((a, b) => {
        if (a.urgent_order_requested !== b.urgent_order_requested) {
          return a.urgent_order_requested ? -1 : 1;
        }
        return a.name.localeCompare(b.name, "ko");
      });
  }, [items]);

  function openUrgentModal() {
    setError("");
    setUrgentProductId(lowStockItems[0]?.id ?? "");
    setUrgentQuantity("");
    setUrgentModalOpen(true);
  }

  async function toggleOrderCompleted(item: InventoryItem, checked: boolean) {
    setError("");
    setUpdatingOrderIds((current) => new Set(current).add(item.id));
    setItems((current) => current.map((product) => (product.id === item.id ? { ...product, order_completed: checked } : product)));

    const { error: updateError } = await supabase.from("products").update({ order_completed: checked }).eq("id", item.id);
    if (updateError) {
      setItems((current) => current.map((product) => (product.id === item.id ? { ...product, order_completed: item.order_completed } : product)));
      setError(updateError.message);
    }

    setUpdatingOrderIds((current) => {
      const next = new Set(current);
      next.delete(item.id);
      return next;
    });
  }

  async function submitUrgentOrder(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const quantity = Number(urgentQuantity);
    if (!urgentProductId) {
      setError("긴급발주할 품목을 선택해 주세요.");
      return;
    }
    if (!Number.isInteger(quantity) || quantity <= 0) {
      setError("발주요청 수량은 1개 이상이어야 합니다.");
      return;
    }

    setSavingUrgent(true);
    setError("");
    const { error: updateError } = await supabase
      .from("products")
      .update({ urgent_order_requested: true, urgent_order_quantity: quantity })
      .eq("id", urgentProductId);

    if (updateError) {
      setError(updateError.message);
    } else {
      setItems((current) =>
        current.map((product) =>
          product.id === urgentProductId ? { ...product, urgent_order_requested: true, urgent_order_quantity: quantity } : product
        )
      );
      setUrgentModalOpen(false);
    }
    setSavingUrgent(false);
  }

  return (
    <section>
      <PageTitle
        title="부족 재고"
        description="총재고가 최소재고 이하인 품목입니다."
        action={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              disabled={lowStockItems.length === 0}
              onClick={openUrgentModal}
              className="touch-button rounded-md bg-red-600 px-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500 dark:disabled:bg-slate-800"
            >
              긴급발주요청
            </button>
            <span className="rounded-full bg-red-100 px-3 py-2 text-sm font-bold text-red-700 dark:bg-red-900 dark:text-red-100">부족재고 ({lowStockItems.length})</span>
          </div>
        }
      />

      {loading ? <StatusMessage>부족 재고를 불러오는 중...</StatusMessage> : null}
      {error ? <StatusMessage type="error">{error}</StatusMessage> : null}

      {!loading && !error ? (
        <>
          <div className="space-y-2 sm:hidden">
            {lowStockItems.map((item) => (
              <div
                key={item.id}
                onClick={() => navigate({ name: "operation", productId: item.id })}
                className="cursor-pointer rounded-md border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900"
              >
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <span className="break-words text-base font-bold leading-snug">{item.name}</span>
                  {item.urgent_order_requested ? (
                    <span className="rounded-full bg-red-600 px-2 py-1 text-xs font-bold text-white">긴급 {item.urgent_order_quantity ?? 0}개</span>
                  ) : null}
                </div>
                <div className="grid grid-cols-[1fr_1fr_auto_auto] items-center gap-2 text-sm">
                  <div>
                    <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">총재고</p>
                    <p className="font-bold tabular-nums text-red-700 dark:text-red-200">{item.total_stock}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">최소</p>
                    <p className="tabular-nums">{item.minimum_stock}</p>
                  </div>
                  <label className="flex min-w-[54px] flex-col items-center gap-1 text-xs font-bold text-slate-600 dark:text-slate-300" onClick={(event) => event.stopPropagation()}>
                    발주 완료
                    <input
                      type="checkbox"
                      checked={item.order_completed}
                      disabled={updatingOrderIds.has(item.id)}
                      onChange={(event) => void toggleOrderCompleted(item, event.target.checked)}
                      aria-label={`${item.name} 발주 완료`}
                      className="h-6 w-6 rounded border-slate-300 accent-brand-600 disabled:opacity-45"
                    />
                  </label>
                  <ProductLinkButton url={item.product_url} />
                </div>
              </div>
            ))}
          </div>

          <div className="panel hidden overflow-visible sm:block">
            <table className="w-full table-fixed text-left text-sm">
              <thead className="sticky top-[73px] z-20 bg-slate-100 text-xs text-slate-600 shadow-sm dark:bg-slate-900 dark:text-slate-300">
                <tr>
                  <th className="px-3 py-3">상품명</th>
                  <th className="w-16 px-2 py-3 text-right">총재고</th>
                  <th className="w-16 px-2 py-3 text-right">최소</th>
                  <th className="w-[76px] px-2 py-3 text-center">발주완료</th>
                  <th className="w-[72px] px-2 py-3 text-center">링크</th>
                </tr>
              </thead>
              <tbody>
                {lowStockItems.map((item) => (
                  <tr key={item.id} onClick={() => navigate({ name: "operation", productId: item.id })} className="cursor-pointer border-t border-slate-100 dark:border-slate-900">
                    <td className="px-3 py-3 font-semibold">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="truncate">{item.name}</span>
                        {item.urgent_order_requested ? (
                          <span className="shrink-0 rounded-full bg-red-600 px-2 py-1 text-xs font-bold text-white">긴급 {item.urgent_order_quantity ?? 0}개</span>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-2 py-3 text-right font-bold tabular-nums text-red-700 dark:text-red-200">{item.total_stock}</td>
                    <td className="px-2 py-3 text-right tabular-nums">{item.minimum_stock}</td>
                    <td className="px-2 py-2 text-center" onClick={(event) => event.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={item.order_completed}
                        disabled={updatingOrderIds.has(item.id)}
                        onChange={(event) => void toggleOrderCompleted(item, event.target.checked)}
                        aria-label={`${item.name} 발주 완료`}
                        className="h-6 w-6 rounded border-slate-300 accent-brand-600 disabled:opacity-45"
                      />
                    </td>
                    <td className="px-2 py-2 text-center">
                      <ProductLinkButton url={item.product_url} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {lowStockItems.length === 0 ? <StatusMessage type="success">부족 재고가 없습니다.</StatusMessage> : null}

          {urgentModalOpen ? (
            <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/55 px-4">
              <form onSubmit={submitUrgentOrder} className="w-full max-w-md rounded-lg bg-white p-4 shadow-xl dark:bg-slate-900">
                <div className="mb-4">
                  <h2 className="text-lg font-bold">긴급발주요청</h2>
                  <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">품목과 요청 수량을 입력합니다.</p>
                </div>

                <label className="mb-3 block">
                  <span className="mb-1 block text-sm font-bold">품목</span>
                  <select className="field" value={urgentProductId} onChange={(event) => setUrgentProductId(event.target.value)}>
                    {lowStockItems.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="mb-4 block">
                  <span className="mb-1 block text-sm font-bold">발주요청 수량</span>
                  <input
                    className="field"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={urgentQuantity}
                    onChange={(event) => setUrgentQuantity(event.target.value.replace(/\D/g, ""))}
                    placeholder="예: 10"
                  />
                </label>

                <div className="grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => setUrgentModalOpen(false)} className="touch-button rounded-md border border-slate-300 px-4 font-bold dark:border-slate-700">
                    취소
                  </button>
                  <button type="submit" disabled={savingUrgent} className="touch-button rounded-md bg-red-600 px-4 font-bold text-white disabled:opacity-50">
                    {savingUrgent ? "저장 중" : "요청 저장"}
                  </button>
                </div>
              </form>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
