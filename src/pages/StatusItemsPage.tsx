import { useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import { PageTitle } from "../components/PageTitle";
import { StatusMessage } from "../components/StatusMessage";
import { normalizeInventoryItem } from "../lib/inventory";
import { supabase } from "../lib/supabase";
import type { AppRoute, InventoryItem, StockStatus } from "../types/domain";

type Props = {
  navigate: (route: AppRoute) => void;
};

const STATUS_STYLES: Record<StockStatus, string> = {
  충분: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-200",
  "절반 이하": "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-200",
  "발주 필요": "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-200"
};

export function StatusItemsPage({ navigate }: Props) {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadItems() {
      setLoading(true);
      setError("");

      const { data, error: loadError } = await supabase
        .from("products")
        .select("*, inventory(*)")
        .eq("is_active", true)
        .eq("status_enabled", true)
        .order("name", { ascending: true });

      if (loadError) {
        setError(loadError.message);
      } else {
        setItems((data ?? []).map((row) => normalizeInventoryItem(row as Parameters<typeof normalizeInventoryItem>[0])));
      }

      setLoading(false);
    }

    void loadItems();
  }, []);

  return (
    <section>
      <PageTitle
        title="최소재고 품목"
        description="재고 작업에서 상태를 체크한 품목만 모아 보여줍니다."
        action={
          <span className="rounded-full bg-brand-100 px-3 py-2 text-sm font-bold text-brand-700 dark:bg-brand-950 dark:text-brand-100">
            품목 ({items.length})
          </span>
        }
      />

      {loading ? <StatusMessage>품목을 불러오는 중...</StatusMessage> : null}
      {error ? <StatusMessage type="error">{error}</StatusMessage> : null}

      {!loading && !error ? (
        <div className="space-y-2">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => navigate({ name: "operation", productId: item.id })}
              className="panel flex min-h-[76px] w-full items-center gap-3 p-3 text-left transition-colors hover:bg-slate-50 active:bg-slate-100 dark:hover:bg-slate-900 dark:active:bg-slate-800"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="break-words text-base font-bold leading-snug">{item.name}</span>
                  {item.stock_status ? (
                    <span className={`rounded-full px-2 py-1 text-xs font-bold ${STATUS_STYLES[item.stock_status]}`}>
                      {item.stock_status}
                    </span>
                  ) : null}
                </div>
                <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                  총재고 <strong className="tabular-nums">{item.total_stock}</strong>
                  <span className="mx-2 text-slate-300 dark:text-slate-700">·</span>
                  최소재고 <strong className="tabular-nums">{item.minimum_stock}</strong>
                </p>
              </div>
              <ChevronRight className="shrink-0 text-slate-400" size={22} aria-hidden="true" />
            </button>
          ))}

          {items.length === 0 ? <StatusMessage>상태를 체크한 품목이 없습니다.</StatusMessage> : null}
        </div>
      ) : null}
    </section>
  );
}
