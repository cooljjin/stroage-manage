import { FormEvent, useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { PageTitle } from "../components/PageTitle";
import { StatusMessage } from "../components/StatusMessage";
import { loadCategories } from "../lib/categories";
import * as Services from "../services";
import type { ProductCategory } from "../types/domain";

export function CategoryManagementPage() {
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [nameDrafts, setNameDrafts] = useState<Record<string, string>>({});
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    void refresh();
  }, []);

  async function refresh() {
    setLoading(true);
    setError("");
    try {
      const nextCategories = await loadCategories();
      setCategories(nextCategories);
      setNameDrafts(Object.fromEntries(nextCategories.map((category) => [category.id, category.name])));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "카테고리를 불러오지 못했습니다.");
    }
    setLoading(false);
  }

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

    const { error: productError } = await Services.DatabaseService.update("products", { category: nextName }).eq("category", category.name);
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

    const { count, error: countError } = await Services.DatabaseService.select("products", "id", { count: "exact", head: true }).eq("category", category.name);
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

  return (
    <section>
      <PageTitle title="카테고리 관리" description="카테고리는 비활성화한 뒤 삭제할 수 있습니다." />

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
                        <p className="mt-1 text-xs font-semibold text-slate-500 dark:text-slate-400">순서 {index + 1}</p>
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
              </div>
            );
          })}
          {categories.length === 0 ? <StatusMessage>카테고리가 없습니다.</StatusMessage> : null}
        </div>
      ) : null}
    </section>
  );
}
