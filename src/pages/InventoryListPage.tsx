import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Search, TriangleAlert } from "lucide-react";
import { PageTitle } from "../components/PageTitle";
import { StatusMessage } from "../components/StatusMessage";
import { VIEW_MODE_STORAGE_KEY } from "../lib/constants";
import { fallbackCategories, loadCategories } from "../lib/categories";
import { normalizeInventoryItem } from "../lib/inventory";
import { supabase } from "../lib/supabase";
import type { AppRoute, CategoryFilter, InventoryItem, SortDirection, SortKey, ViewMode } from "../types/domain";

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

export function InventoryListPage({ navigate }: Props) {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [category, setCategory] = useState<CategoryFilter>("전체");
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>(() => (localStorage.getItem(VIEW_MODE_STORAGE_KEY) as ViewMode) || "compact");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    localStorage.setItem(VIEW_MODE_STORAGE_KEY, viewMode);
  }, [viewMode]);

  useEffect(() => {
    void loadItems();
  }, []);

  async function loadItems() {
    setLoading(true);
    const [categoryResult, productResult] = await Promise.all([
      loadCategories({ activeOnly: true }).catch(() => fallbackCategories()),
      supabase.from("products").select("*, inventory(*)").eq("is_active", true).order("name", { ascending: true })
    ]);
    const { data, error: loadError } = productResult;
    setCategories(categoryResult.map((item) => item.name));
    if (loadError) {
      setError(loadError.message);
    } else {
      setItems((data ?? []).map((row) => normalizeInventoryItem(row as Parameters<typeof normalizeInventoryItem>[0])));
    }
    setLoading(false);
  }

  const filteredItems = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    const filtered = items.filter((item) => {
      const categoryMatch = category === "전체" || item.category === category;
      const keywordMatch = !keyword || item.name.toLowerCase().includes(keyword) || (item.barcode ?? "").toLowerCase().includes(keyword);
      return categoryMatch && keywordMatch;
    });

    return filtered.sort((a, b) => {
      const left = a[sortKey];
      const right = b[sortKey];
      const compare = typeof left === "string" && typeof right === "string" ? left.localeCompare(right, "ko") : Number(left) - Number(right);
      return sortDirection === "asc" ? compare : -compare;
    });
  }, [category, items, search, sortDirection, sortKey]);

  function toggleSort(nextKey: SortKey) {
    if (sortKey === nextKey) {
      setSortDirection((value) => (value === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(nextKey);
      setSortDirection("asc");
    }
  }

  function SortButton({ label, value }: { label: string; value: SortKey }) {
    const active = sortKey === value;
    return (
      <button type="button" onClick={() => toggleSort(value)} className="inline-flex items-center gap-1 font-bold">
        {label}
        {active ? sortDirection === "asc" ? <ChevronUp size={14} /> : <ChevronDown size={14} /> : null}
      </button>
    );
  }

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

      <div className="mb-4 grid gap-3 sm:grid-cols-[1fr_auto]">
        <label className="relative block">
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
          <input className="field pl-10" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="상품명 또는 바코드 검색" />
        </label>
        <div className="grid grid-cols-2 rounded-md border border-slate-200 bg-white p-1 dark:border-slate-800 dark:bg-slate-900">
          <button type="button" onClick={() => setViewMode("compact")} className={`touch-button rounded px-3 text-sm font-bold ${viewMode === "compact" ? "bg-brand-600 text-white" : ""}`}>
            간소화
          </button>
          <button type="button" onClick={() => setViewMode("full")} className={`touch-button rounded px-3 text-sm font-bold ${viewMode === "full" ? "bg-brand-600 text-white" : ""}`}>
            전체
          </button>
        </div>
      </div>

      {loading ? <StatusMessage>재고를 불러오는 중...</StatusMessage> : null}
      {error ? <StatusMessage type="error">{error}</StatusMessage> : null}

      {!loading && !error ? (
        <div className="panel overflow-visible">
          <table className="w-full table-fixed text-left text-sm">
            <thead className="sticky top-[73px] z-20 bg-slate-100 text-xs text-slate-600 shadow-sm dark:bg-slate-900 dark:text-slate-300">
              {viewMode === "compact" ? (
                <tr>
                  <th className="w-[48%] px-3 py-3">상품명</th>
                  <th className="w-[16%] px-2 py-3 text-right">창고</th>
                  <th className="w-[16%] px-2 py-3 text-right">매장</th>
                  <th className="w-[20%] px-2 py-3 text-center">링크</th>
                </tr>
              ) : (
                <tr>
                  <th className="px-3 py-3"><SortButton label="상품명" value="name" /></th>
                  <th className="px-3 py-3 text-right"><SortButton label="창고" value="warehouse_qty" /></th>
                  <th className="px-3 py-3 text-right"><SortButton label="매장" value="store_qty" /></th>
                  <th className="hidden px-3 py-3 text-right sm:table-cell"><SortButton label="총재고" value="total_stock" /></th>
                  <th className="hidden px-3 py-3 text-right md:table-cell">최소</th>
                  <th className="hidden px-3 py-3 md:table-cell">상태</th>
                  <th className="w-[72px] px-2 py-3 text-center">링크</th>
                </tr>
              )}
            </thead>
            <tbody>
              {filteredItems.map((item) => (
                <tr
                  key={item.id}
                  onClick={() => navigate({ name: "operation", productId: item.id })}
                  className={`cursor-pointer border-t border-slate-100 dark:border-slate-900 ${item.is_low_stock && viewMode === "full" ? "bg-red-50 dark:bg-red-950/30" : ""}`}
                >
                  <td className="px-3 py-3 font-semibold">
                    <span className="flex min-w-0 items-center gap-1">
                      {item.is_low_stock ? <TriangleAlert className="shrink-0 text-amber-500" size={17} /> : null}
                      <span className="min-w-0 whitespace-normal break-words leading-snug">{item.name}</span>
                    </span>
                  </td>
                  <td className="px-2 py-3 text-right tabular-nums">{item.warehouse_qty}</td>
                  <td className="px-2 py-3 text-right tabular-nums">{item.store_qty}</td>
                  {viewMode === "full" ? (
                    <>
                      <td className="hidden px-3 py-3 text-right tabular-nums sm:table-cell">{item.total_stock}</td>
                      <td className="hidden px-3 py-3 text-right tabular-nums md:table-cell">{item.minimum_stock}</td>
                      <td className="hidden px-3 py-3 md:table-cell">
                        <span className={`rounded px-2 py-1 text-xs font-bold ${item.is_low_stock ? "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-100" : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-100"}`}>
                          {item.is_low_stock ? "부족" : "정상"}
                        </span>
                      </td>
                    </>
                  ) : null}
                  <td className="px-2 py-2 text-center">
                    <ProductLinkButton url={item.product_url} />
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
