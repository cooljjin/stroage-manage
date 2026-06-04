import { useEffect, useMemo, useState } from "react";
import { PageTitle } from "../components/PageTitle";
import { StatusMessage } from "../components/StatusMessage";
import { normalizeInventoryItem } from "../lib/inventory";
import { supabase } from "../lib/supabase";
import type { AppRoute, InventoryItem } from "../types/domain";

type Props = {
  navigate: (route: AppRoute) => void;
};

export function LowStockPage({ navigate }: Props) {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    void loadItems();
  }, []);

  async function loadItems() {
    setLoading(true);
    const { data, error: loadError } = await supabase.from("products").select("*, inventory(*)").order("name", { ascending: true });
    if (loadError) {
      setError(loadError.message);
    } else {
      setItems((data ?? []).map((row) => normalizeInventoryItem(row as Parameters<typeof normalizeInventoryItem>[0])));
    }
    setLoading(false);
  }

  const lowStockItems = useMemo(() => items.filter((item) => item.is_low_stock), [items]);

  return (
    <section>
      <PageTitle
        title="부족 재고"
        description="총재고가 최소재고 이하인 품목입니다."
        action={<span className="rounded-full bg-red-100 px-3 py-2 text-sm font-bold text-red-700 dark:bg-red-900 dark:text-red-100">부족재고 ({lowStockItems.length})</span>}
      />

      {loading ? <StatusMessage>부족 재고를 불러오는 중...</StatusMessage> : null}
      {error ? <StatusMessage type="error">{error}</StatusMessage> : null}

      {!loading && !error ? (
        <div className="panel overflow-hidden">
          <table className="w-full table-fixed text-left text-sm">
            <thead className="bg-slate-100 text-xs text-slate-600 dark:bg-slate-900 dark:text-slate-300">
              <tr>
                <th className="px-3 py-3">상품명</th>
                <th className="w-24 px-3 py-3 text-right">총재고</th>
                <th className="w-24 px-3 py-3 text-right">최소재고</th>
              </tr>
            </thead>
            <tbody>
              {lowStockItems.map((item) => (
                <tr key={item.id} onClick={() => navigate({ name: "operation", productId: item.id })} className="cursor-pointer border-t border-slate-100 dark:border-slate-900">
                  <td className="truncate px-3 py-3 font-semibold">{item.name}</td>
                  <td className="px-3 py-3 text-right font-bold tabular-nums text-red-700 dark:text-red-200">{item.total_stock}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{item.minimum_stock}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {lowStockItems.length === 0 ? <div className="p-4"><StatusMessage type="success">부족 재고가 없습니다.</StatusMessage></div> : null}
        </div>
      ) : null}
    </section>
  );
}
