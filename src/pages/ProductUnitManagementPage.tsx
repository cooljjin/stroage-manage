import { FormEvent, useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { PageTitle } from "../components/PageTitle";
import { StatusMessage } from "../components/StatusMessage";
import { loadProductUnits } from "../lib/productUnits";
import * as Services from "../services";
import type { ProductUnit } from "../types/domain";

export function ProductUnitManagementPage() {
  const [units, setUnits] = useState<ProductUnit[]>([]);
  const [nameDrafts, setNameDrafts] = useState<Record<string, string>>({});
  const [editingUnitId, setEditingUnitId] = useState<string | null>(null);
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
      const nextUnits = await loadProductUnits();
      setUnits(nextUnits);
      setNameDrafts(Object.fromEntries(nextUnits.map((unit) => [unit.id, unit.name])));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "품목 단위를 불러오지 못했습니다.");
    }
    setLoading(false);
  }

  async function addUnit(event: FormEvent) {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) return;

    setError("");
    setMessage("");
    const nextSortOrder = units.reduce((max, unit) => Math.max(max, unit.sort_order), 0) + 1;
    const { error: insertError } = await Services.DatabaseService.insert("product_units", { name: trimmedName, sort_order: nextSortOrder });
    if (insertError) {
      setError(insertError.message);
    } else {
      setName("");
      setMessage("품목 단위를 추가했습니다.");
      await refresh();
    }
  }

  async function setUnitActive(unit: ProductUnit, isActive: boolean) {
    setError("");
    setMessage("");
    const { error: updateError } = await Services.DatabaseService.update("product_units", { is_active: isActive }).eq("id", unit.id);
    if (updateError) {
      setError(updateError.message);
    } else {
      setMessage(isActive ? "품목 단위를 활성화했습니다." : "품목 단위를 비활성화했습니다.");
      await refresh();
    }
  }

  async function saveUnitName(unit: ProductUnit) {
    const nextName = nameDrafts[unit.id]?.trim();
    if (!nextName) {
      setError("품목 단위 이름은 비워둘 수 없습니다.");
      return;
    }
    if (nextName === unit.name) {
      setEditingUnitId(null);
      return;
    }

    setError("");
    setMessage("");
    const { error: unitError } = await Services.DatabaseService.update("product_units", { name: nextName }).eq("id", unit.id);
    if (unitError) {
      setError(unitError.message);
      return;
    }

    const { error: productError } = await Services.DatabaseService.update("products", { unit_name: nextName }).eq("unit_name", unit.name);
    if (productError) {
      setError(productError.message);
    } else {
      setEditingUnitId(null);
      setMessage("품목 단위 이름을 수정했습니다.");
      await refresh();
    }
  }

  async function moveUnit(index: number, direction: "up" | "down") {
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    const current = units[index];
    const target = units[targetIndex];
    if (!current || !target) return;

    const nextUnits = [...units];
    nextUnits[index] = target;
    nextUnits[targetIndex] = current;
    setUnits(nextUnits);
    setError("");
    setMessage("");

    const results = await Promise.all(
      nextUnits.map((unit, nextIndex) => Services.DatabaseService.update("product_units", { sort_order: nextIndex + 1 }).eq("id", unit.id))
    );
    const updateError = results.find((result) => result.error)?.error;

    if (updateError) {
      setError(updateError.message);
      await refresh();
    } else {
      setMessage("품목 단위 순서를 저장했습니다.");
    }
  }

  async function deleteUnit(unit: ProductUnit) {
    if (unit.is_active) {
      setError("활성 품목 단위는 삭제할 수 없습니다. 먼저 비활성화하세요.");
      return;
    }

    const { count, error: countError } = await Services.DatabaseService.select("products", "id", { count: "exact", head: true }).eq("unit_name", unit.name);
    if (countError) {
      setError(countError.message);
      return;
    }

    if ((count ?? 0) > 0) {
      setError("이 단위를 사용하는 상품이 있어 삭제할 수 없습니다.");
      return;
    }

    const ok = window.confirm(`${unit.name} 품목 단위를 삭제할까요?`);
    if (!ok) return;

    const { error: deleteError } = await Services.DatabaseService.delete("product_units").eq("id", unit.id).eq("is_active", false);
    if (deleteError) {
      setError(deleteError.message);
    } else {
      setMessage("품목 단위를 삭제했습니다.");
      await refresh();
    }
  }

  return (
    <section>
      <PageTitle title="품목 단위 관리" description="상품 등록 화면의 품목 단위를 관리합니다." />

      <form onSubmit={addUnit} className="mb-4 flex gap-2">
        <input className="field" value={name} onChange={(event) => setName(event.target.value)} placeholder="새 품목 단위" />
        <button type="submit" className="primary-button inline-flex min-w-14 items-center justify-center" aria-label="품목 단위 추가">
          <Plus size={22} />
        </button>
      </form>

      {loading ? <StatusMessage>품목 단위를 불러오는 중...</StatusMessage> : null}
      {error ? <div className="mb-3"><StatusMessage type="error">{error}</StatusMessage></div> : null}
      {message ? <div className="mb-3"><StatusMessage type="success">{message}</StatusMessage></div> : null}

      {!loading ? (
        <div className="space-y-2">
          {units.map((unit, index) => {
            const editingName = editingUnitId === unit.id;

            return (
              <div key={unit.id} className="panel p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    {editingName ? (
                      <div className="space-y-2">
                        <input
                          className="field min-h-11 py-2 text-lg font-bold"
                          value={nameDrafts[unit.id] ?? ""}
                          onChange={(event) => setNameDrafts((value) => ({ ...value, [unit.id]: event.target.value }))}
                          autoFocus
                        />
                        <div className="flex gap-2">
                          <button type="button" onClick={() => saveUnitName(unit)} className="rounded border border-brand-600 px-3 py-1 text-lg font-bold text-brand-700 dark:text-brand-100">
                            저장
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setNameDrafts((value) => ({ ...value, [unit.id]: unit.name }));
                              setEditingUnitId(null);
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
                          <p className="break-keep text-lg font-bold leading-tight">{unit.name}</p>
                          <button
                            type="button"
                            onClick={() => {
                              setNameDrafts((value) => ({ ...value, [unit.id]: unit.name }));
                              setEditingUnitId(unit.id);
                            }}
                            className="rounded border border-slate-300 px-2 py-1 text-lg font-bold dark:border-slate-700"
                          >
                            수정
                          </button>
                          <span
                            className={`rounded px-2 py-1 text-xs font-bold ${
                              unit.is_active ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-100" : "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-200"
                            }`}
                          >
                            {unit.is_active ? "활성" : "비활성"}
                          </span>
                        </div>
                        <p className="mt-1 text-xs font-semibold text-slate-500 dark:text-slate-400">순서 {index + 1}</p>
                      </>
                    )}
                  </div>

                  <div className="flex shrink-0 gap-1">
                    <button
                      type="button"
                      onClick={() => moveUnit(index, "up")}
                      disabled={index === 0}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 disabled:opacity-35 dark:border-slate-700"
                      aria-label="위로 이동"
                      title="위로"
                    >
                      <ArrowUp size={16} />
                    </button>
                    <button
                      type="button"
                      onClick={() => moveUnit(index, "down")}
                      disabled={index === units.length - 1}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 disabled:opacity-35 dark:border-slate-700"
                      aria-label="아래로 이동"
                      title="아래로"
                    >
                      <ArrowDown size={16} />
                    </button>
                  </div>
                </div>

                <div className="mt-3 flex justify-end gap-2">
                  <button type="button" onClick={() => setUnitActive(unit, !unit.is_active)} className="touch-button rounded-md border border-slate-300 px-3 text-sm font-bold dark:border-slate-700">
                    {unit.is_active ? "비활성화" : "활성화"}
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteUnit(unit)}
                    disabled={unit.is_active}
                    className="touch-button inline-flex items-center justify-center rounded-md border border-red-200 px-3 text-red-700 disabled:opacity-35 dark:border-red-900 dark:text-red-200"
                    aria-label="품목 단위 삭제"
                    title="삭제"
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              </div>
            );
          })}
          {units.length === 0 ? <StatusMessage>품목 단위가 없습니다.</StatusMessage> : null}
        </div>
      ) : null}
    </section>
  );
}
