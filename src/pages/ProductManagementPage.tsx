import { useEffect, useMemo, useState } from "react";
import { Search, Trash2 } from "lucide-react";
import { PageTitle } from "../components/PageTitle";
import { StatusMessage } from "../components/StatusMessage";
import { supabase } from "../lib/supabase";
import type { AppRoute, Product } from "../types/domain";

type Props = {
  navigate: (route: AppRoute) => void;
};

export function ProductManagementPage({ navigate }: Props) {
  const [products, setProducts] = useState<Product[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    void loadProducts();
  }, []);

  async function loadProducts() {
    setLoading(true);
    setError("");
    const { data, error: loadError } = await supabase.from("products").select("*").order("name", { ascending: true });
    if (loadError) {
      setError(loadError.message);
    } else {
      setProducts((data ?? []) as Product[]);
    }
    setLoading(false);
  }

  const filteredProducts = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return products;
    return products.filter((product) => product.name.toLowerCase().includes(keyword) || (product.barcode ?? "").toLowerCase().includes(keyword));
  }, [products, search]);

  async function setProductActive(product: Product, isActive: boolean) {
    setError("");
    setMessage("");
    const { error: updateError } = await supabase.from("products").update({ is_active: isActive }).eq("id", product.id);
    if (updateError) {
      setError(updateError.message);
    } else {
      setMessage(isActive ? "상품을 활성화했습니다." : "상품을 비활성화했습니다.");
      await loadProducts();
    }
  }

  async function deleteProduct(product: Product) {
    if (product.is_active) {
      setError("활성 상품은 삭제할 수 없습니다. 먼저 비활성화하세요.");
      return;
    }

    const ok = window.confirm(`${product.name} 상품을 삭제할까요? 재고와 관련 로그도 함께 삭제됩니다.`);
    if (!ok) return;

    setError("");
    setMessage("");
    const { error: deleteError } = await supabase.from("products").delete().eq("id", product.id).eq("is_active", false);
    if (deleteError) {
      setError(deleteError.message);
    } else {
      setMessage("상품을 삭제했습니다.");
      await loadProducts();
    }
  }

  return (
    <section>
      <PageTitle title="상품 관리" description="상품은 비활성화한 뒤 삭제할 수 있습니다." />

      <label className="relative mb-4 block">
        <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
        <input className="field pl-10" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="상품명 또는 바코드 검색" />
      </label>

      {loading ? <StatusMessage>상품을 불러오는 중...</StatusMessage> : null}
      {error ? <div className="mb-3"><StatusMessage type="error">{error}</StatusMessage></div> : null}
      {message ? <div className="mb-3"><StatusMessage type="success">{message}</StatusMessage></div> : null}

      {!loading ? (
        <div className="panel overflow-hidden">
          <table className="w-full table-fixed text-left text-sm">
            <thead className="bg-slate-100 text-xs text-slate-600 dark:bg-slate-900 dark:text-slate-300">
              <tr>
                <th className="px-3 py-3">상품</th>
                <th className="hidden w-28 px-3 py-3 sm:table-cell">카테고리</th>
                <th className="w-20 px-3 py-3">상태</th>
                <th className="w-36 px-3 py-3 text-right">작업</th>
              </tr>
            </thead>
            <tbody>
              {filteredProducts.map((product) => (
                <tr key={product.id} className="border-t border-slate-100 dark:border-slate-900">
                  <td className="px-3 py-3">
                    <button type="button" onClick={() => navigate({ name: "operation", productId: product.id })} className="block max-w-full text-left">
                      <span className="block truncate font-semibold">{product.name}</span>
                      <span className="block truncate text-xs text-slate-500 dark:text-slate-400">{product.barcode ?? "바코드 없음"}</span>
                    </button>
                  </td>
                  <td className="hidden px-3 py-3 sm:table-cell">{product.category}</td>
                  <td className="px-3 py-3">
                    <span className={`rounded px-2 py-1 text-xs font-bold ${product.is_active ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-100" : "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-200"}`}>
                      {product.is_active ? "활성" : "비활성"}
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex justify-end gap-2">
                      <button type="button" onClick={() => setProductActive(product, !product.is_active)} className="touch-button rounded-md border border-slate-300 px-2 text-xs font-bold dark:border-slate-700">
                        {product.is_active ? "비활성화" : "활성화"}
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteProduct(product)}
                        disabled={product.is_active}
                        className="touch-button inline-flex items-center justify-center rounded-md border border-red-200 px-2 text-red-700 disabled:opacity-35 dark:border-red-900 dark:text-red-200"
                        aria-label="상품 삭제"
                        title="삭제"
                      >
                        <Trash2 size={17} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filteredProducts.length === 0 ? <div className="p-4"><StatusMessage>표시할 상품이 없습니다.</StatusMessage></div> : null}
        </div>
      ) : null}
    </section>
  );
}
