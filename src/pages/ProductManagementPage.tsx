import { useEffect, useMemo, useState } from "react";
import { Save, Search, Trash2 } from "lucide-react";
import { PageTitle } from "../components/PageTitle";
import { StatusMessage } from "../components/StatusMessage";
import { fallbackCategories, loadCategories } from "../lib/categories";
import { supabase } from "../lib/supabase";
import type { AppRoute, Product, ProductCategory } from "../types/domain";

type Props = {
  navigate: (route: AppRoute) => void;
};

function isProductActive(product: Product): boolean {
  return product.is_active !== false;
}

export function ProductManagementPage({ navigate }: Props) {
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [categoryDrafts, setCategoryDrafts] = useState<Record<string, string>>({});
  const [nameDrafts, setNameDrafts] = useState<Record<string, string>>({});
  const [linkDrafts, setLinkDrafts] = useState<Record<string, string>>({});
  const [editingNameId, setEditingNameId] = useState<string | null>(null);
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
    const [categoryResult, productResult] = await Promise.all([
      loadCategories({ activeOnly: true }).catch(() => fallbackCategories()),
      supabase.from("products").select("*").order("name", { ascending: true })
    ]);

    const { data, error: loadError } = productResult;
    if (loadError) {
      setError(loadError.message);
    } else {
      const nextProducts = (data ?? []) as Product[];
      setProducts(nextProducts);
      setCategories(categoryResult);
      setCategoryDrafts(Object.fromEntries(nextProducts.map((product) => [product.id, product.category])));
      setNameDrafts(Object.fromEntries(nextProducts.map((product) => [product.id, product.name])));
      setLinkDrafts(Object.fromEntries(nextProducts.map((product) => [product.id, product.product_url ?? ""])));
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

  async function saveCategory(product: Product) {
    const nextCategory = categoryDrafts[product.id];
    if (!nextCategory || nextCategory === product.category) return;

    setError("");
    setMessage("");
    const { error: updateError } = await supabase.from("products").update({ category: nextCategory }).eq("id", product.id);
    if (updateError) {
      setError(updateError.message);
    } else {
      setMessage("상품 카테고리를 수정했습니다.");
      await loadProducts();
    }
  }

  async function saveName(product: Product) {
    const nextName = nameDrafts[product.id]?.trim();
    if (!nextName) {
      setError("상품 이름은 비워둘 수 없습니다.");
      return;
    }
    if (nextName === product.name) {
      setEditingNameId(null);
      return;
    }

    setError("");
    setMessage("");
    const { error: updateError } = await supabase.from("products").update({ name: nextName }).eq("id", product.id);
    if (updateError) {
      setError(updateError.message);
    } else {
      setEditingNameId(null);
      setMessage("상품 이름을 수정했습니다.");
      await loadProducts();
    }
  }

  async function saveLink(product: Product) {
    const nextLink = linkDrafts[product.id]?.trim() || null;
    if (nextLink === product.product_url) return;

    setError("");
    setMessage("");
    const { error: updateError } = await supabase.from("products").update({ product_url: nextLink }).eq("id", product.id);
    if (updateError) {
      setError(updateError.message);
    } else {
      setMessage("상품 링크를 수정했습니다.");
      await loadProducts();
    }
  }

  async function deleteProduct(product: Product) {
    if (isProductActive(product)) {
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
      <PageTitle title="상품 관리" description="상품 정보와 카테고리를 관리합니다." />

      <label className="relative mb-4 block">
        <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
        <input className="field pl-10" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="상품명 또는 바코드 검색" />
      </label>

      {loading ? <StatusMessage>상품을 불러오는 중...</StatusMessage> : null}
      {error ? <div className="mb-3"><StatusMessage type="error">{error}</StatusMessage></div> : null}
      {message ? <div className="mb-3"><StatusMessage type="success">{message}</StatusMessage></div> : null}

      {!loading ? (
        <div className="space-y-2">
          {filteredProducts.map((product) => {
            const active = isProductActive(product);
            const draftCategory = categoryDrafts[product.id] ?? product.category;
            const categoryChanged = draftCategory !== product.category;
            const draftLink = linkDrafts[product.id] ?? "";
            const linkChanged = draftLink.trim() !== (product.product_url ?? "");
            const editingName = editingNameId === product.id;

            return (
              <div key={product.id} className="panel p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    {editingName ? (
                      <div className="space-y-2">
                        <input
                          className="field min-h-11 py-2 text-base font-bold"
                          value={nameDrafts[product.id] ?? ""}
                          onChange={(event) => setNameDrafts((value) => ({ ...value, [product.id]: event.target.value }))}
                          autoFocus
                        />
                        <div className="flex gap-2">
                          <button type="button" onClick={() => saveName(product)} className="rounded border border-brand-600 px-3 py-1 text-base font-bold text-brand-700 dark:text-brand-100">
                            저장
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setNameDrafts((value) => ({ ...value, [product.id]: product.name }));
                              setEditingNameId(null);
                            }}
                            className="rounded border border-slate-300 px-3 py-1 text-base font-bold dark:border-slate-700"
                          >
                            취소
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="flex min-w-0 items-center gap-2">
                          <button type="button" onClick={() => navigate({ name: "operation", productId: product.id })} className="min-w-0 text-left">
                            <span className="block truncate text-base font-bold">{product.name}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setNameDrafts((value) => ({ ...value, [product.id]: product.name }));
                              setEditingNameId(product.id);
                            }}
                            className="shrink-0 rounded border border-slate-300 px-2 py-1 text-base font-bold dark:border-slate-700"
                          >
                            수정
                          </button>
                        </div>
                        <span className="block truncate text-xs text-slate-500 dark:text-slate-400">{product.barcode ?? "바코드 없음"}</span>
                      </>
                    )}
                  </div>
                  <span className={`shrink-0 rounded px-2 py-1 text-xs font-bold ${active ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-100" : "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-200"}`}>
                    {active ? "활성" : "비활성"}
                  </span>
                </div>

                <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]">
                  <label className="block">
                    <span className="mb-1 block text-xs font-bold text-slate-500 dark:text-slate-400">카테고리</span>
                    <select
                      className="field min-h-11 py-2"
                      value={draftCategory}
                      onChange={(event) => setCategoryDrafts((value) => ({ ...value, [product.id]: event.target.value }))}
                    >
                      {categories.map((category) => (
                        <option key={category.id} value={category.name}>
                          {category.name}
                        </option>
                      ))}
                      {!categories.some((category) => category.name === product.category) ? <option value={product.category}>{product.category}</option> : null}
                    </select>
                  </label>
                  <button
                    type="button"
                    onClick={() => saveCategory(product)}
                    disabled={!categoryChanged}
                    className="touch-button inline-flex items-center justify-center gap-2 rounded-md border border-brand-600 px-3 text-sm font-bold text-brand-700 disabled:opacity-35 dark:text-brand-100"
                  >
                    <Save size={17} />
                    저장
                  </button>
                </div>

                <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]">
                  <label className="block">
                    <span className="mb-1 block text-xs font-bold text-slate-500 dark:text-slate-400">링크</span>
                    <input
                      className="field min-h-11 py-2"
                      type="url"
                      value={draftLink}
                      onChange={(event) => setLinkDrafts((value) => ({ ...value, [product.id]: event.target.value }))}
                      placeholder="https://..."
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => saveLink(product)}
                    disabled={!linkChanged}
                    className="touch-button inline-flex items-center justify-center gap-2 rounded-md border border-brand-600 px-3 text-sm font-bold text-brand-700 disabled:opacity-35 dark:text-brand-100"
                  >
                    <Save size={17} />
                    저장
                  </button>
                </div>

                <div className="mt-3 flex justify-end gap-2">
                  <button type="button" onClick={() => setProductActive(product, !active)} className="touch-button rounded-md border border-slate-300 px-3 text-sm font-bold dark:border-slate-700">
                    {active ? "비활성화" : "활성화"}
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteProduct(product)}
                    disabled={active}
                    className="touch-button inline-flex items-center justify-center rounded-md border border-red-200 px-3 text-red-700 disabled:opacity-35 dark:border-red-900 dark:text-red-200"
                    aria-label="상품 삭제"
                    title="삭제"
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              </div>
            );
          })}
          {filteredProducts.length === 0 ? <StatusMessage>표시할 상품이 없습니다.</StatusMessage> : null}
        </div>
      ) : null}
    </section>
  );
}
