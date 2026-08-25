import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, Search, Star, TriangleAlert } from "lucide-react";
import { ProductOrderAction } from "../components/ProductOrderAction";
import { InventoryTableSkeleton } from "../components/Skeleton";
import { StatusMessage } from "../components/StatusMessage";
import { fallbackCategories, loadCategories } from "../lib/categories";
import { getSeoulDateValue } from "../lib/businessCalendar";
import { formatInventoryQuantity } from "../lib/inventory";
import { DEFAULT_ABUNDANT_MULTIPLIER, getAutomaticStockState } from "../lib/inventoryStock";
import { loadResolvedInventoryItems, searchResolvedProducts } from "../lib/resolvedProducts";
import { loadSuppliers } from "../lib/suppliers";
import * as Services from "../services";
import type { AppRoute, CategoryFilter, InventoryItem, InventoryOverviewDisplay, InventoryOverviewMode, ProductSupplier } from "../types/domain";

type OverviewStockState = "부족" | "주의" | "넉넉" | "입고 확인";
type InventoryActivityLog = {
  product_id: string;
  created_at: string;
  warehouse_qty_before: number | null;
  store_qty_before: number | null;
  warehouse_qty_after: number | null;
  store_qty_after: number | null;
};

type Props = {
  navigate: (route: AppRoute) => void;
  currentStoreId: string;
  canManageImportantItems: boolean;
  initialState?: InventoryListPageState;
  onStateChange?: (state: InventoryListPageState) => void;
};

export type InventoryListPageState = {
  items: InventoryItem[];
  suppliers: ProductSupplier[];
  orderQuantities: Record<string, string>;
  categories: string[];
  category: CategoryFilter;
  categoryExpanded: boolean;
  search: string;
  overviewMode: InventoryOverviewMode;
  overviewDisplay: InventoryOverviewDisplay;
  overviewCompact: boolean;
  activityCounts: Record<string, number>;
  abundantMultiplier: number;
};

function overviewStockState(item: InventoryItem, abundantMultiplier: number): OverviewStockState {
  if (item.receipt_check_only) return "입고 확인";
  if (item.status_enabled) {
    if (item.stock_status === "발주 필요") return "부족";
    if (item.stock_status === "절반 이하") return "주의";
    return "넉넉";
  }
  return getAutomaticStockState(item.total_stock, item.minimum_stock, abundantMultiplier);
}

function overviewStateClass(state: OverviewStockState) {
  if (state === "부족") return "border-red-200 bg-red-50 text-red-700 dark:border-red-900/70 dark:bg-red-950/40 dark:text-red-200";
  if (state === "주의") return "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/70 dark:bg-amber-950/35 dark:text-amber-200";
  if (state === "넉넉") return "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/70 dark:bg-emerald-950/35 dark:text-emerald-200";
  return "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200";
}

function totalStockAtLog(log: InventoryActivityLog, point: "before" | "after") {
  const warehouseQty = point === "before" ? log.warehouse_qty_before : log.warehouse_qty_after;
  const storeQty = point === "before" ? log.store_qty_before : log.store_qty_after;
  if (warehouseQty === null || storeQty === null) return null;
  return Number(warehouseQty) + Number(storeQty);
}

export function InventoryListPage({ navigate, currentStoreId, canManageImportantItems, initialState, onStateChange }: Props) {
  const [items, setItems] = useState<InventoryItem[]>(() => initialState?.items ?? []);
  const [suppliers, setSuppliers] = useState<ProductSupplier[]>(() => initialState?.suppliers ?? []);
  const [orderQuantities, setOrderQuantities] = useState<Record<string, string>>(() => initialState?.orderQuantities ?? {});
  const [categories, setCategories] = useState<string[]>(() => initialState?.categories ?? []);
  const [category, setCategory] = useState<CategoryFilter>(() => initialState?.category ?? "전체");
  const [categoryExpanded, setCategoryExpanded] = useState(() => initialState?.categoryExpanded ?? false);
  const [search, setSearch] = useState(() => initialState?.search ?? "");
  const [overviewMode, setOverviewMode] = useState<InventoryOverviewMode>(() => initialState?.overviewMode ?? "overview");
  const [overviewDisplay, setOverviewDisplay] = useState<InventoryOverviewDisplay>(() => initialState?.overviewDisplay ?? "activity");
  const [overviewCompact, setOverviewCompact] = useState(() => initialState?.overviewCompact ?? true);
  const [activityCounts, setActivityCounts] = useState<Record<string, number>>(() => initialState?.activityCounts ?? {});
  const [abundantMultiplier, setAbundantMultiplier] = useState(() => initialState?.abundantMultiplier ?? DEFAULT_ABUNDANT_MULTIPLIER);
  const [loading, setLoading] = useState(() => (initialState?.items.length ?? 0) === 0);
  const [error, setError] = useState("");
  const [importantSavingId, setImportantSavingId] = useState<string | null>(null);
  const [resolvedSearchProductIds, setResolvedSearchProductIds] = useState<Set<string> | null>(null);

  const loadItems = useCallback(async () => {
    setLoading(items.length === 0);
    const activityStart = new Date();
    activityStart.setDate(activityStart.getDate() - 30);
    const [categoryResult, supplierResult, productResult, activityResult, overviewSettingsResult] = await Promise.all([
      loadCategories({ activeOnly: true }).catch(() => fallbackCategories()),
      loadSuppliers({ activeOnly: true }).catch(() => []),
      loadResolvedInventoryItems(currentStoreId),
      Services.DatabaseService.select("inventory_logs", "product_id, created_at, warehouse_qty_before, store_qty_before, warehouse_qty_after, store_qty_after")
        .eq("store_id", currentStoreId)
        .neq("action", "메모")
        .is("reverted_at", null)
        .gte("created_at", activityStart.toISOString())
        .order("created_at", { ascending: true })
        .order("id", { ascending: true }),
      Services.DatabaseService.select("inventory_overview_settings", "abundant_multiplier")
        .eq("store_id", currentStoreId)
        .maybeSingle()
    ]);
    const loadError = productResult.errorMessage;
    setCategories(categoryResult.map((item) => item.name));
    setSuppliers(supplierResult);
    if (loadError) {
      setError(loadError);
    } else {
      setItems(productResult.items);
      const dailyChanges = new Map<string, { productId: string; firstTotal: number; lastTotal: number }>();
      ((activityResult.data ?? []) as InventoryActivityLog[]).forEach((log) => {
        const beforeTotal = totalStockAtLog(log, "before");
        const afterTotal = totalStockAtLog(log, "after");
        if (beforeTotal === null || afterTotal === null) return;
        const key = `${log.product_id}:${getSeoulDateValue(new Date(log.created_at))}`;
        const existing = dailyChanges.get(key);
        if (existing) {
          existing.lastTotal = afterTotal;
        } else {
          dailyChanges.set(key, { productId: log.product_id, firstTotal: beforeTotal, lastTotal: afterTotal });
        }
      });
      const nextActivityCounts = Array.from(dailyChanges.values()).reduce<Record<string, number>>((counts, change) => {
        if (change.firstTotal !== change.lastTotal) {
          counts[change.productId] = (counts[change.productId] ?? 0) + 1;
        }
        return counts;
      }, {});
      setActivityCounts(nextActivityCounts);
      const configuredMultiplier = Number(overviewSettingsResult.data?.abundant_multiplier);
      setAbundantMultiplier(Number.isFinite(configuredMultiplier) && configuredMultiplier > 1 ? configuredMultiplier : DEFAULT_ABUNDANT_MULTIPLIER);
    }
    setLoading(false);
  }, [currentStoreId, items.length]);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  useEffect(() => {
    onStateChange?.({ items, suppliers, orderQuantities, categories, category, categoryExpanded, search, overviewMode, overviewDisplay, overviewCompact, activityCounts, abundantMultiplier });
  }, [abundantMultiplier, activityCounts, categories, category, categoryExpanded, items, onStateChange, orderQuantities, overviewCompact, overviewDisplay, overviewMode, search, suppliers]);

  useEffect(() => {
    const keyword = search.trim();
    if (!keyword) {
      setResolvedSearchProductIds(null);
      return;
    }

    setResolvedSearchProductIds(null);
    let cancelled = false;
    const timeoutId = window.setTimeout(() => {
      void searchResolvedProducts(currentStoreId, keyword, 500).then((result) => {
        if (cancelled) return;
        if (result.errorMessage) {
          setError(result.errorMessage);
          return;
        }
        setResolvedSearchProductIds(new Set(result.products.map((product) => product.id)));
      });
    }, 180);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [currentStoreId, search]);

  const filteredItems = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    const filtered = items.filter((item) => {
      const categoryMatch = category === "전체" || item.category === category;
      const keywordMatch = !keyword
        || resolvedSearchProductIds?.has(item.id)
        || (resolvedSearchProductIds === null
          && (item.name.toLowerCase().includes(keyword) || (item.barcode ?? "").toLowerCase().includes(keyword)));
      return categoryMatch && keywordMatch;
    });

    if (overviewDisplay === "important") {
      return filtered.filter((item) => item.is_important).sort((left, right) => left.name.localeCompare(right.name, "ko"));
    }
    if (overviewDisplay === "activity") {
      return filtered.sort((left, right) => {
        const countDifference = (activityCounts[right.id] ?? 0) - (activityCounts[left.id] ?? 0);
        return countDifference || left.name.localeCompare(right.name, "ko");
      });
    }
    return filtered.sort((left, right) => left.name.localeCompare(right.name, "ko"));
  }, [activityCounts, category, items, overviewDisplay, resolvedSearchProductIds, search]);

  const suppliersByName = useMemo(() => {
    return new Map(suppliers.map((supplier) => [supplier.name, supplier]));
  }, [suppliers]);

  const stickyHeaderCell = "sticky top-[73px] z-30 bg-slate-100 shadow-sm dark:bg-slate-900";

  async function toggleImportantItem(item: InventoryItem) {
    if (!canManageImportantItems || importantSavingId) return;
    const nextImportant = !item.is_important;
    setImportantSavingId(item.id);
    setError("");
    setItems((current) => current.map((currentItem) => currentItem.id === item.id ? { ...currentItem, is_important: nextImportant } : currentItem));
    const { error: updateError } = await Services.DatabaseService.update("products", { is_important: nextImportant })
      .eq("store_id", currentStoreId)
      .eq("id", item.id);
    if (updateError) {
      setItems((current) => current.map((currentItem) => currentItem.id === item.id ? { ...currentItem, is_important: item.is_important } : currentItem));
      setError(updateError.message);
    }
    setImportantSavingId(null);
  }

  return (
    <section>
      <div className="mb-4 grid grid-cols-2 rounded-lg bg-slate-100 p-1 dark:bg-slate-900">
        {(["overview", "list"] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            onClick={() => setOverviewMode(mode)}
            aria-pressed={overviewMode === mode}
            className={`touch-button rounded-md px-3 text-sm font-extrabold ${overviewMode === mode ? "bg-white text-brand-700 shadow-sm dark:bg-slate-800 dark:text-brand-100" : "text-slate-600 dark:text-slate-300"}`}
          >
            {mode === "list" ? "목록" : "오버뷰"}
          </button>
        ))}
      </div>

      <div className="mb-3 grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
        <div className={`flex gap-2 pb-1 ${categoryExpanded ? "flex-wrap overflow-visible" : "overflow-x-auto"}`}>
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
        <button
          type="button"
          onClick={() => setCategoryExpanded((value) => !value)}
          className="touch-button icon-button shrink-0"
          aria-label={categoryExpanded ? "카테고리 접기" : "카테고리 펼치기"}
          title={categoryExpanded ? "카테고리 접기" : "카테고리 펼치기"}
        >
          <ChevronDown className={`transition-transform ${categoryExpanded ? "rotate-180" : ""}`} size={20} />
        </button>
      </div>

      <div className="mb-4">
        <label className="relative block">
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
          <input className="field pl-10" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="상품명 또는 바코드 검색" />
        </label>
      </div>

      {overviewMode === "overview" ? (
        <div className="mb-4 space-y-2">
          <label className="block text-xs font-bold text-slate-600 dark:text-slate-300">
            표시 방식
            <select className="field mt-1" value={overviewDisplay} onChange={(event) => setOverviewDisplay(event.target.value as InventoryOverviewDisplay)}>
              <option value="name">이름순</option>
              <option value="activity">재고 변동 많은 순</option>
              <option value="important">중요 품목만 표시</option>
            </select>
          </label>
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">최근 30일 첫·마지막 총재고가 다른 날짜 수로 정렬합니다.</p>
          <button
            type="button"
            onClick={() => setOverviewCompact((value) => !value)}
            aria-pressed={overviewCompact}
            className="secondary-button"
          >
            {overviewCompact ? "펼치기" : "접기"}
          </button>
        </div>
      ) : null}

      {loading ? (
        <div role="status" aria-live="polite" aria-label="재고를 불러오는 중">
          <span className="sr-only">재고를 불러오는 중...</span>
          <InventoryTableSkeleton compact />
        </div>
      ) : null}
      {error ? <StatusMessage type="error">{error}</StatusMessage> : null}

      {overviewMode === "overview" && (!loading || items.length > 0) && (!error || items.length > 0) ? (
        <div className={`grid gap-3 ${overviewCompact ? "grid-cols-3 sm:grid-cols-4 lg:grid-cols-6" : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4"}`}>
          {filteredItems.map((item) => {
            const state = overviewStockState(item, abundantMultiplier);
            return (
              <article
                key={item.id}
                onClick={() => navigate({ name: "operation", productId: item.id })}
                className={`relative cursor-pointer rounded-lg border text-left shadow-sm transition-shadow hover:shadow-md ${overviewCompact ? "p-2" : "p-3"} ${overviewStateClass(state)}`}
              >
                {canManageImportantItems ? (
                  <button
                    type="button"
                    disabled={importantSavingId !== null}
                    onClick={(event) => {
                      event.stopPropagation();
                      void toggleImportantItem(item);
                    }}
                    className={`icon-button absolute grid h-8 w-8 place-items-center rounded-full bg-white/70 disabled:opacity-50 dark:bg-slate-950/50 ${overviewCompact ? "right-1 top-1" : "right-2 top-2"} ${item.is_important ? "text-amber-500" : "text-slate-400"}`}
                    aria-label={`${item.name} 중요 품목 ${item.is_important ? "해제" : "지정"}`}
                    title={item.is_important ? "중요 품목 해제" : "중요 품목 지정"}
                  >
                    <Star size={17} fill={item.is_important ? "currentColor" : "none"} />
                  </button>
                ) : item.is_important ? <Star className={`absolute text-amber-500 ${overviewCompact ? "right-2 top-2" : "right-3 top-3"}`} size={17} fill="currentColor" aria-label="중요 품목" /> : null}
                <p className={`${overviewCompact ? "min-h-9 pr-7 text-xs" : "min-h-11 pr-8 text-sm"} font-extrabold leading-snug break-words`}>{item.name}</p>
                {overviewCompact ? (
                  <p className="mt-1 text-base font-black tabular-nums">{item.receipt_check_only ? "확인" : `${formatInventoryQuantity(item.total_stock)}${item.unit_name ? ` ${item.unit_name}` : ""}`}</p>
                ) : (
                  <>
                    <span className="mt-2 inline-flex rounded-full bg-white/70 px-2 py-0.5 text-[11px] font-extrabold dark:bg-slate-950/45">{state}</span>
                    {item.receipt_check_only ? (
                      <p className="mt-3 text-xs font-bold">수량 대신 입고 여부를 확인합니다.</p>
                    ) : (
                      <>
                        <p className="mt-3 text-lg font-black tabular-nums">{formatInventoryQuantity(item.total_stock)}{item.unit_name ? ` ${item.unit_name}` : ""}</p>
                        <div className="mt-2 grid grid-cols-2 gap-1 text-xs font-semibold">
                          <p className="rounded bg-white/55 px-2 py-1 dark:bg-slate-950/30">창고 <strong className="tabular-nums">{formatInventoryQuantity(item.warehouse_qty)}</strong></p>
                          <p className="rounded bg-white/55 px-2 py-1 dark:bg-slate-950/30">매장 <strong className="tabular-nums">{formatInventoryQuantity(item.store_qty)}</strong></p>
                        </div>
                        <p className="mt-2 text-xs font-semibold">최소재고 {formatInventoryQuantity(item.minimum_stock)}</p>
                      </>
                    )}
                    {overviewDisplay === "activity" ? <p className="mt-2 text-[11px] font-bold">최근 30일 재고 변동 {activityCounts[item.id] ?? 0}일</p> : null}
                  </>
                )}
              </article>
            );
          })}
          {filteredItems.length === 0 ? <div className="col-span-full"><StatusMessage>{overviewDisplay === "important" ? "지정된 중요 품목이 없습니다." : "표시할 상품이 없습니다."}</StatusMessage></div> : null}
        </div>
      ) : null}

      {overviewMode === "list" && (!loading || items.length > 0) && (!error || items.length > 0) ? (
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
                    <ProductOrderAction
                      item={item}
                      supplier={item.supplier_name ? suppliersByName.get(item.supplier_name) ?? null : null}
                      quantity={orderQuantities[item.id] ?? ""}
                      onQuantityChange={(quantity) => setOrderQuantities((current) => ({ ...current, [item.id]: quantity }))}
                    />
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
