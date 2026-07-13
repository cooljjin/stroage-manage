import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ChevronDown, Plus, Trash2 } from "lucide-react";
import { PageTitle } from "../components/PageTitle";
import { StatusMessage } from "../components/StatusMessage";
import { loadCategories } from "../lib/categories";
import * as Services from "../services";
import type { Product, ProductCategory } from "../types/domain";

type Props = {
  currentStoreId: string;
};

type CategoryProduct = Pick<Product, "id" | "barcode" | "name" | "category" | "is_active">;

export function CategoryManagementPage({ currentStoreId }: Props) {
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [products, setProducts] = useState<CategoryProduct[]>([]);
  const [nameDrafts, setNameDrafts] = useState<Record<string, string>>({});
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [expandedCategoryIds, setExpandedCategoryIds] = useState<Set<string>>(() => new Set());
  const [selectedProductIds, setSelectedProductIds] = useState<Set<string>>(() => new Set());
  const [bulkTargetCategories, setBulkTargetCategories] = useState<Record<string, string>>({});
  const [bulkProcessingCategoryId, setBulkProcessingCategoryId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const productsByCategory = useMemo(() => {
    const groups = new Map<string, CategoryProduct[]>();
    for (const product of products) {
      const key = product.category || "기타";
      groups.set(key, [...(groups.get(key) ?? []), product]);
    }

    for (const categoryProducts of groups.values()) {
      categoryProducts.sort((left, right) => left.name.localeCompare(right.name, "ko"));
    }

    return groups;
  }, [products]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [nextCategories, productResult] = await Promise.all([
        loadCategories(),
        Services.DatabaseService.select("products", "id, barcode, name, category, is_active")
          .eq("store_id", currentStoreId)
          .eq("is_active", true)
          .order("name", { ascending: true })
      ]);
      if (productResult.error) throw productResult.error;
      setCategories(nextCategories);
      setProducts((productResult.data ?? []) as CategoryProduct[]);
      setNameDrafts(Object.fromEntries(nextCategories.map((category) => [category.id, category.name])));
      setBulkTargetCategories((current) => {
        const nextTargets: Record<string, string> = {};
        for (const category of nextCategories) {
          nextTargets[category.id] = current[category.id] ?? nextCategories.find((item) => item.id !== category.id && item.is_active)?.name ?? "";
        }
        return nextTargets;
      });
      setSelectedProductIds((current) => {
        const activeProductIds = new Set(((productResult.data ?? []) as CategoryProduct[]).map((product) => product.id));
        return new Set([...current].filter((id) => activeProductIds.has(id)));
      });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "카테고리를 불러오지 못했습니다.");
    }
    setLoading(false);
  }, [currentStoreId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function addCategory(event: FormEvent) {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) return;

    setError("");
    setMessage("");
    const nextSortOrder = categories.reduce((max, category) => Math.max(max, category.sort_order), 0) + 1;
    const { error: insertError } = await Services.DatabaseService.insert("categories", { name: trimmedName, sort_order: nextSortOrder });
    if (insertError) {
      setError(insertError.message);
    } else {
      setName("");
      setMessage("카테고리를 추가했습니다.");
      await refresh();
    }
  }

  async function setCategoryActive(category: ProductCategory, isActive: boolean) {
    setError("");
    setMessage("");
    const { error: updateError } = await Services.DatabaseService.update("categories", { is_active: isActive }).eq("id", category.id);
    if (updateError) {
      setError(updateError.message);
    } else {
      setMessage(isActive ? "카테고리를 활성화했습니다." : "카테고리를 비활성화했습니다.");
      await refresh();
    }
  }

  async function saveCategoryName(category: ProductCategory) {
    const nextName = nameDrafts[category.id]?.trim();
    if (!nextName) {
      setError("카테고리 이름은 비워둘 수 없습니다.");
      return;
    }
    if (nextName === category.name) {
      setEditingCategoryId(null);
      return;
    }

    setError("");
    setMessage("");
    const { error: categoryError } = await Services.DatabaseService.update("categories", { name: nextName }).eq("id", category.id);
    if (categoryError) {
      setError(categoryError.message);
      return;
    }

    const { error: productError } = await Services.DatabaseService.update("products", { category: nextName }).eq("store_id", currentStoreId).eq("category", category.name);
    if (productError) {
      setError(productError.message);
    } else {
      setEditingCategoryId(null);
      setMessage("카테고리 이름을 수정했습니다.");
      await refresh();
    }
  }

  async function moveCategory(index: number, direction: "up" | "down") {
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    const current = categories[index];
    const target = categories[targetIndex];
    if (!current || !target) return;

    const nextCategories = [...categories];
    nextCategories[index] = target;
    nextCategories[targetIndex] = current;
    setCategories(nextCategories);
    setError("");
    setMessage("");

    const results = await Promise.all(
      nextCategories.map((category, nextIndex) => Services.DatabaseService.update("categories", { sort_order: nextIndex + 1 }).eq("id", category.id))
    );
    const updateError = results.find((result) => result.error)?.error;

    if (updateError) {
      setError(updateError.message);
      await refresh();
    } else {
      setMessage("카테고리 순서를 저장했습니다.");
    }
  }

  async function deleteCategory(category: ProductCategory) {
    if (category.is_active) {
      setError("활성 카테고리는 삭제할 수 없습니다. 먼저 비활성화하세요.");
      return;
    }

    const { count, error: countError } = await Services.DatabaseService.select("products", "id", { count: "exact", head: true })
      .eq("store_id", currentStoreId)
      .eq("category", category.name)
      .eq("is_active", true);
    if (countError) {
      setError(countError.message);
      return;
    }

    if ((count ?? 0) > 0) {
      setError("이 카테고리를 사용하는 상품이 있어 삭제할 수 없습니다.");
      return;
    }

    const ok = window.confirm(`${category.name} 카테고리를 삭제할까요?`);
    if (!ok) return;

    const { error: deleteError } = await Services.DatabaseService.delete("categories").eq("id", category.id).eq("is_active", false);
    if (deleteError) {
      setError(deleteError.message);
    } else {
      setMessage("카테고리를 삭제했습니다.");
      await refresh();
    }
  }

  function toggleCategoryExpanded(categoryId: string) {
    setExpandedCategoryIds((current) => {
      const next = new Set(current);
      if (next.has(categoryId)) {
        next.delete(categoryId);
      } else {
        next.add(categoryId);
      }
      return next;
    });
  }

  function toggleProductSelection(productId: string, checked: boolean) {
    setSelectedProductIds((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(productId);
      } else {
        next.delete(productId);
      }
      return next;
    });
  }

  function setCategoryProductsSelected(categoryProducts: CategoryProduct[], checked: boolean) {
    setSelectedProductIds((current) => {
      const next = new Set(current);
      for (const product of categoryProducts) {
        if (checked) {
          next.add(product.id);
        } else {
          next.delete(product.id);
        }
      }
      return next;
    });
  }

  async function moveSelectedProducts(category: ProductCategory, categoryProducts: CategoryProduct[]) {
    const selectedIds = categoryProducts.filter((product) => selectedProductIds.has(product.id)).map((product) => product.id);
    const targetCategory = bulkTargetCategories[category.id] ?? "";
    if (selectedIds.length === 0) {
      setError("이동할 품목을 선택하세요.");
      return;
    }
    if (!targetCategory || targetCategory === category.name) {
      setError("이동할 다른 카테고리를 선택하세요.");
      return;
    }

    setError("");
    setMessage("");
    setBulkProcessingCategoryId(category.id);
    const { error: updateError } = await Services.DatabaseService.update("products", { category: targetCategory })
      .eq("store_id", currentStoreId)
      .eq("category", category.name)
      .in("id", selectedIds);

    if (updateError) {
      setError(updateError.message);
    } else {
      setSelectedProductIds((current) => {
        const next = new Set(current);
        selectedIds.forEach((id) => next.delete(id));
        return next;
      });
      setMessage(`${selectedIds.length}개 품목을 ${targetCategory} 카테고리로 이동했습니다.`);
      await refresh();
    }
    setBulkProcessingCategoryId(null);
  }

  async function deleteSelectedProducts(category: ProductCategory, categoryProducts: CategoryProduct[]) {
    const selectedIds = categoryProducts.filter((product) => selectedProductIds.has(product.id)).map((product) => product.id);
    if (selectedIds.length === 0) {
      setError("삭제할 품목을 선택하세요.");
      return;
    }

    const ok = window.confirm(`${category.name} 카테고리에서 선택한 ${selectedIds.length}개 품목을 삭제할까요?`);
    if (!ok) return;

    setError("");
    setMessage("");
    setBulkProcessingCategoryId(category.id);
    const { error: updateError } = await Services.DatabaseService.update("products", { is_active: false })
      .eq("store_id", currentStoreId)
      .eq("category", category.name)
      .in("id", selectedIds);

    if (updateError) {
      setError(updateError.message);
    } else {
      setSelectedProductIds((current) => {
        const next = new Set(current);
        selectedIds.forEach((id) => next.delete(id));
        return next;
      });
      setMessage(`${selectedIds.length}개 품목을 삭제했습니다.`);
      await refresh();
    }
    setBulkProcessingCategoryId(null);
  }

  return (
    <section>
      <PageTitle title="카테고리 관리" description="카테고리별 품목을 확인하고 선택한 품목을 일괄 수정합니다." />

      <form onSubmit={addCategory} className="mb-4 flex gap-2">
        <input className="field" value={name} onChange={(event) => setName(event.target.value)} placeholder="새 카테고리" />
        <button type="submit" className="primary-button inline-flex min-w-14 items-center justify-center" aria-label="카테고리 추가">
          <Plus size={22} />
        </button>
      </form>

      {loading ? <StatusMessage>카테고리를 불러오는 중...</StatusMessage> : null}
      {error ? <div className="mb-3"><StatusMessage type="error">{error}</StatusMessage></div> : null}
      {message ? <div className="mb-3"><StatusMessage type="success">{message}</StatusMessage></div> : null}

      {!loading ? (
        <div className="space-y-2">
          {categories.map((category, index) => {
            const editingName = editingCategoryId === category.id;
            const categoryProducts = productsByCategory.get(category.name) ?? [];
            const selectedCount = categoryProducts.filter((product) => selectedProductIds.has(product.id)).length;
            const allSelected = categoryProducts.length > 0 && selectedCount === categoryProducts.length;
            const expanded = expandedCategoryIds.has(category.id);
            const targetOptions = categories.filter((item) => item.is_active && item.name !== category.name);
            const bulkBusy = bulkProcessingCategoryId === category.id;

            return (
              <div key={category.id} className="panel p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    {editingName ? (
                      <div className="space-y-2">
                        <input
                          className="field min-h-11 py-2 text-lg font-bold"
                          value={nameDrafts[category.id] ?? ""}
                          onChange={(event) => setNameDrafts((value) => ({ ...value, [category.id]: event.target.value }))}
                          autoFocus
                        />
                        <div className="flex gap-2">
                          <button type="button" onClick={() => saveCategoryName(category)} className="rounded border border-brand-600 px-3 py-1 text-lg font-bold text-brand-700 dark:text-brand-100">
                            저장
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setNameDrafts((value) => ({ ...value, [category.id]: category.name }));
                              setEditingCategoryId(null);
                            }}
                            className="rounded border border-slate-300 px-3 py-1 text-lg font-bold dark:border-slate-700"
                          >
                            취소
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <p className="break-keep text-lg font-bold leading-tight">{category.name}</p>
                          <button
                            type="button"
                            onClick={() => toggleCategoryExpanded(category.id)}
                            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 dark:border-slate-700"
                            aria-label={expanded ? "품목 접기" : "품목 펼치기"}
                            title={expanded ? "품목 접기" : "품목 펼치기"}
                          >
                            <ChevronDown className={`transition-transform ${expanded ? "rotate-180" : ""}`} size={18} />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setNameDrafts((value) => ({ ...value, [category.id]: category.name }));
                              setEditingCategoryId(category.id);
                            }}
                            className="rounded border border-slate-300 px-2 py-1 text-lg font-bold dark:border-slate-700"
                          >
                            수정
                          </button>
                          <span
                            className={`rounded px-2 py-1 text-xs font-bold ${
                              category.is_active ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-100" : "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-200"
                            }`}
                          >
                            {category.is_active ? "활성" : "비활성"}
                          </span>
                        </div>
                        <p className="mt-1 text-xs font-semibold text-slate-500 dark:text-slate-400">순서 {index + 1} · 품목 {categoryProducts.length}개</p>
                      </>
                    )}
                  </div>

                  <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    onClick={() => moveCategory(index, "up")}
                    disabled={index === 0}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 disabled:opacity-35 dark:border-slate-700"
                    aria-label="위로 이동"
                    title="위로"
                  >
                    <ArrowUp size={16} />
                  </button>
                  <button
                    type="button"
                    onClick={() => moveCategory(index, "down")}
                    disabled={index === categories.length - 1}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 disabled:opacity-35 dark:border-slate-700"
                    aria-label="아래로 이동"
                    title="아래로"
                  >
                    <ArrowDown size={16} />
                  </button>
                  </div>
                </div>

                <div className="mt-3 flex justify-end gap-2">
                <button type="button" onClick={() => setCategoryActive(category, !category.is_active)} className="touch-button rounded-md border border-slate-300 px-3 text-sm font-bold dark:border-slate-700">
                  {category.is_active ? "비활성화" : "활성화"}
                </button>
                <button
                  type="button"
                  onClick={() => deleteCategory(category)}
                  disabled={category.is_active}
                  className="touch-button inline-flex items-center justify-center rounded-md border border-red-200 px-3 text-red-700 disabled:opacity-35 dark:border-red-900 dark:text-red-200"
                  aria-label="카테고리 삭제"
                  title="삭제"
                >
                  <Trash2 size={18} />
                </button>
                </div>

                {expanded ? (
                  <div className="mt-3 border-t border-slate-200 pt-3 dark:border-slate-800">
                    {categoryProducts.length > 0 ? (
                      <>
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                          <label className="inline-flex min-h-10 items-center gap-2 text-sm font-bold">
                            <input
                              type="checkbox"
                              className="h-4 w-4"
                              checked={allSelected}
                              onChange={(event) => setCategoryProductsSelected(categoryProducts, event.target.checked)}
                            />
                            전체 선택
                          </label>
                          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
                            <select
                              className="field min-h-10 py-2 text-sm"
                              value={bulkTargetCategories[category.id] ?? ""}
                              onChange={(event) => setBulkTargetCategories((current) => ({ ...current, [category.id]: event.target.value }))}
                              disabled={targetOptions.length === 0 || bulkBusy}
                              aria-label="이동할 카테고리"
                            >
                              {targetOptions.length === 0 ? <option value="">이동할 카테고리 없음</option> : null}
                              {targetOptions.map((item) => (
                                <option key={item.id} value={item.name}>{item.name}</option>
                              ))}
                            </select>
                            <button
                              type="button"
                              onClick={() => moveSelectedProducts(category, categoryProducts)}
                              disabled={selectedCount === 0 || targetOptions.length === 0 || bulkBusy}
                              className="touch-button rounded-md border border-brand-600 px-3 text-sm font-bold text-brand-700 disabled:opacity-35 dark:text-brand-100"
                            >
                              이동
                            </button>
                            <button
                              type="button"
                              onClick={() => deleteSelectedProducts(category, categoryProducts)}
                              disabled={selectedCount === 0 || bulkBusy}
                              className="touch-button rounded-md border border-red-200 px-3 text-sm font-bold text-red-700 disabled:opacity-35 dark:border-red-900 dark:text-red-200"
                            >
                              선택 삭제
                            </button>
                          </div>
                        </div>

                        <div className="mt-2 divide-y divide-slate-100 overflow-hidden rounded-md border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
                          {categoryProducts.map((product) => (
                            <label key={product.id} className="flex min-h-11 items-center gap-3 px-3 py-2">
                              <input
                                type="checkbox"
                                className="h-4 w-4 shrink-0"
                                checked={selectedProductIds.has(product.id)}
                                onChange={(event) => toggleProductSelection(product.id, event.target.checked)}
                              />
                              <span className="min-w-0 flex-1">
                                <span className="block break-words text-sm font-bold">{product.name}</span>
                                {product.barcode ? <span className="block text-xs font-semibold text-slate-500 dark:text-slate-400">{product.barcode}</span> : null}
                              </span>
                            </label>
                          ))}
                        </div>
                        <p className="mt-2 text-xs font-semibold text-slate-500 dark:text-slate-400">선택 {selectedCount}개</p>
                      </>
                    ) : (
                      <StatusMessage>이 카테고리에 활성 품목이 없습니다.</StatusMessage>
                    )}
                  </div>
                ) : null}
              </div>
            );
          })}
          {categories.length === 0 ? <StatusMessage>카테고리가 없습니다.</StatusMessage> : null}
        </div>
      ) : null}
    </section>
  );
}
