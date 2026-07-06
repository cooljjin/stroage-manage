import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Search, TriangleAlert } from "lucide-react";
import { PageTitle } from "../components/PageTitle";
import { ProductOrderAction } from "../components/ProductOrderAction";
import { InventoryTableSkeleton } from "../components/Skeleton";
import { StatusMessage } from "../components/StatusMessage";
import { fallbackCategories, loadCategories } from "../lib/categories";
import { formatInventoryQuantity, normalizeInventoryItem } from "../lib/inventory";
import { recordReceiptCheckOnly } from "../lib/receiptCheck";
import { loadSuppliers } from "../lib/suppliers";
import * as Services from "../services";
import type { AppRoute, CategoryFilter, InventoryItem, ProductSupplier } from "../types/domain";

type Props = {
  navigate: (route: AppRoute) => void;
  currentStoreId: string;
};

export function InventoryListPage({ navigate, currentStoreId }: Props) {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [suppliers, setSuppliers] = useState<ProductSupplier[]>([]);
  const [orderQuantities, setOrderQuantities] = useState<Record<string, string>>({});
  const [receiptCompletingIds, setReceiptCompletingIds] = useState<Set<string>>(new Set());
  const [categories, setCategories] = useState<string[]>([]);
  const [category, setCategory] = useState<CategoryFilter>("전체");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const loadItems = useCallback(async () => {
    setLoading(true);
    const [categoryResult, supplierResult, productResult] = await Promise.all([
      loadCategories({ activeOnly: true }).catch(() => fallbackCategories()),
      loadSuppliers({ activeOnly: true }).catch(() => []),
      Services.DatabaseService.select("products", "*, inventory(*)").eq("store_id", currentStoreId).eq("is_active", true).order("name", { ascending: true })
    ]);
    const { data, error: loadError } = productResult;
    setCategories(categoryResult.map((item) => item.name));
    setSuppliers(supplierResult);
    if (loadError) {
      setError(loadError.message);
    } else {
      setItems(((data ?? []) as Parameters<typeof normalizeInventoryItem>[0][]).map((row) => normalizeInventoryItem(row)));
    }
    setLoading(false);
  }, [currentStoreId]);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  const filteredItems = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    const filtered = items.filter((item) => {
      const categoryMatch = category === "전체" || item.category === category;
      const keywordMatch = !keyword || item.name.toLowerCase().includes(keyword) || (item.barcode ?? "").toLowerCase().includes(keyword);
      return categoryMatch && keywordMatch;
    });

    return filtered.sort((left, right) => left.name.localeCompare(right.name, "ko"));
  }, [category, items, search]);

  const suppliersByName = useMemo(() => {
    return new Map(suppliers.map((supplier) => [supplier.name, supplier]));
  }, [suppliers]);

  async function completeReceiptCheckOnly(item: InventoryItem) {
    setError("");
    setMessage("");
    setReceiptCompletingIds((current) => new Set(current).add(item.id));
    const { errorMessage } = await recordReceiptCheckOnly(item.id, currentStoreId);

    if (errorMessage) {
      setError(errorMessage);
    } else {
      setMessage(`${item.name} 입고완료를 기록했습니다.`);
    }

    setReceiptCompletingIds((current) => {
      const next = new Set(current);
      next.delete(item.id);
      return next;
    });
  }

  const stickyHeaderCell = "sticky top-[73px] z-30 bg-slate-100 shadow-sm dark:bg-slate-900";

  return (
    <section>
      <PageTitle title="재고 현황" description="카테고리와 검색으로 빠르게 확인합니다." />

      <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
        {["전체", ...categories].map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => setCategory(name)}
            className={`touch-button shrink-0 whitespace-nowrap rounded-md px-4 text-sm font-bold ${category === name ? "bg-brand-600 text-white" : "border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"}`}
          >
            {name}
          </button>
        ))}
      </div>

      <div className="mb-4">
        <label className="relative block">
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
          <input className="field pl-10" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="상품명 또는 바코드 검색" />
        </label>
      </div>

      {loading ? (
        <div role="status" aria-live="polite" aria-label="재고를 불러오는 중">
          <span className="sr-only">재고를 불러오는 중...</span>
          <InventoryTableSkeleton compact />
        </div>
      ) : null}
      {error ? <StatusMessage type="error">{error}</StatusMessage> : null}
      {message ? <StatusMessage type="success">{message}</StatusMessage> : null}

      {!loading && !error ? (
        <div className="panel relative overflow-visible before:sticky before:top-[73px] before:z-20 before:block before:h-4 before:bg-slate-50 before:content-[''] dark:before:bg-slate-950">
          <table className="w-full table-fixed text-left text-sm">
            <thead className="text-xs text-slate-600 dark:text-slate-300">
              <tr>
                <th className={`${stickyHeaderCell} w-[38%] px-3 py-3`}>상품명</th>
                <th className={`${stickyHeaderCell} w-[13%] px-2 py-3 text-right`}>창고</th>
                <th className={`${stickyHeaderCell} w-[13%] px-2 py-3 text-right`}>매장</th>
                <th className={`${stickyHeaderCell} w-[36%] px-2 py-3 text-center`}>발주</th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.map((item) => (
                <tr
                  key={item.id}
                  onClick={() => navigate({ name: "operation", productId: item.id })}
                  className="cursor-pointer border-t border-slate-100 dark:border-slate-900"
                >
                  <td className="px-3 py-3 font-semibold">
                    <div className="min-w-0">
                      <span className="flex min-w-0 items-center gap-1">
                        {item.is_low_stock ? <TriangleAlert className="shrink-0 text-amber-500" size={17} /> : null}
                        <span className="min-w-0 whitespace-normal break-words leading-snug">{item.name}</span>
                      </span>
                      <span className="mt-1 flex flex-wrap gap-1 text-[11px] font-bold text-slate-500 dark:text-slate-400">
                        {item.storage_type ? <span className="rounded bg-slate-100 px-1.5 py-0.5 dark:bg-slate-800">{item.storage_type}</span> : null}
                        {item.supplier_name ? <span className="rounded bg-slate-100 px-1.5 py-0.5 dark:bg-slate-800">{item.supplier_name}</span> : null}
                        {item.unit_name ? <span className="rounded bg-slate-100 px-1.5 py-0.5 dark:bg-slate-800">{item.unit_name}</span> : null}
                      </span>
                    </div>
                  </td>
                  <td className="px-2 py-3 text-right tabular-nums">{item.receipt_check_only ? "-" : formatInventoryQuantity(item.warehouse_qty)}</td>
                  <td className="px-2 py-3 text-right tabular-nums">{item.receipt_check_only ? "-" : formatInventoryQuantity(item.store_qty)}</td>
                  <td className="px-2 py-2 text-center">
                    {item.receipt_check_only ? (
                      <button
                        type="button"
                        disabled={receiptCompletingIds.has(item.id)}
                        onClick={(event) => {
                          event.stopPropagation();
                          void completeReceiptCheckOnly(item);
                        }}
                        className="mx-auto inline-flex min-h-10 items-center justify-center gap-1 rounded-md bg-brand-600 px-2 text-xs font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500 dark:disabled:bg-slate-800"
                      >
                        <Check size={16} />
                        {receiptCompletingIds.has(item.id) ? "처리중" : "입고완료"}
                      </button>
                    ) : (
                      <ProductOrderAction
                        item={item}
                        supplier={item.supplier_name ? suppliersByName.get(item.supplier_name) ?? null : null}
                        quantity={orderQuantities[item.id] ?? ""}
                        onQuantityChange={(quantity) => setOrderQuantities((current) => ({ ...current, [item.id]: quantity }))}
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filteredItems.length === 0 ? <div className="p-4"><StatusMessage>표시할 상품이 없습니다.</StatusMessage></div> : null}
        </div>
      ) : null}
    </section>
  );
}
