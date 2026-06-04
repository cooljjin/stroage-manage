import { FormEvent, useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { PageTitle } from "../components/PageTitle";
import { StatusMessage } from "../components/StatusMessage";
import { loadCategories } from "../lib/categories";
import { supabase } from "../lib/supabase";
import type { ProductCategory } from "../types/domain";

export function CategoryManagementPage() {
  const [categories, setCategories] = useState<ProductCategory[]>([]);
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
      setCategories(await loadCategories());
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
    const { error: insertError } = await supabase.from("categories").insert({ name: trimmedName, sort_order: nextSortOrder });
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
    const { error: updateError } = await supabase.from("categories").update({ is_active: isActive }).eq("id", category.id);
    if (updateError) {
      setError(updateError.message);
    } else {
      setMessage(isActive ? "카테고리를 활성화했습니다." : "카테고리를 비활성화했습니다.");
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

    const updates = nextCategories.map((category, nextIndex) =>
      supabase.from("categories").update({ sort_order: nextIndex + 1 }).eq("id", category.id)
    );
    const results = await Promise.all(updates);
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

    const { count, error: countError } = await supabase.from("products").select("id", { count: "exact", head: true }).eq("category", category.name);
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

    const { error: deleteError } = await supabase.from("categories").delete().eq("id", category.id).eq("is_active", false);
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
        <div className="panel overflow-hidden">
          <table className="w-full table-fixed text-left text-sm">
            <thead className="bg-slate-100 text-xs text-slate-600 dark:bg-slate-900 dark:text-slate-300">
              <tr>
                <th className="w-24 px-3 py-3">순서</th>
                <th className="px-3 py-3">카테고리</th>
                <th className="w-20 px-3 py-3">상태</th>
                <th className="w-36 px-3 py-3 text-right">작업</th>
              </tr>
            </thead>
            <tbody>
              {categories.map((category, index) => (
                <tr key={category.id} className="border-t border-slate-100 dark:border-slate-900">
                  <td className="px-3 py-3">
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => moveCategory(index, "up")}
                        disabled={index === 0}
                        className="touch-button inline-flex items-center justify-center rounded-md border border-slate-300 px-2 disabled:opacity-35 dark:border-slate-700"
                        aria-label="위로 이동"
                        title="위로"
                      >
                        <ArrowUp size={17} />
                      </button>
                      <button
                        type="button"
                        onClick={() => moveCategory(index, "down")}
                        disabled={index === categories.length - 1}
                        className="touch-button inline-flex items-center justify-center rounded-md border border-slate-300 px-2 disabled:opacity-35 dark:border-slate-700"
                        aria-label="아래로 이동"
                        title="아래로"
                      >
                        <ArrowDown size={17} />
                      </button>
                    </div>
                  </td>
                  <td className="px-3 py-3 font-semibold">{category.name}</td>
                  <td className="px-3 py-3">
                    <span className={`rounded px-2 py-1 text-xs font-bold ${category.is_active ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-100" : "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-200"}`}>
                      {category.is_active ? "활성" : "비활성"}
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex justify-end gap-2">
                      <button type="button" onClick={() => setCategoryActive(category, !category.is_active)} className="touch-button rounded-md border border-slate-300 px-2 text-xs font-bold dark:border-slate-700">
                        {category.is_active ? "비활성화" : "활성화"}
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteCategory(category)}
                        disabled={category.is_active}
                        className="touch-button inline-flex items-center justify-center rounded-md border border-red-200 px-2 text-red-700 disabled:opacity-35 dark:border-red-900 dark:text-red-200"
                        aria-label="카테고리 삭제"
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
          {categories.length === 0 ? <div className="p-4"><StatusMessage>카테고리가 없습니다.</StatusMessage></div> : null}
        </div>
      ) : null}
    </section>
  );
}
