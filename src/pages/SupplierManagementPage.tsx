import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, Plus, Trash2 } from "lucide-react";
import { PageTitle } from "../components/PageTitle";
import { StatusMessage } from "../components/StatusMessage";
import { loadSuppliers } from "../lib/suppliers";
import * as Services from "../services";
import type { Product, ProductSupplier } from "../types/domain";

type Props = {
  currentStoreId: string;
};

type SupplierProduct = Pick<Product, "id" | "barcode" | "name" | "supplier_name" | "is_active">;

export function SupplierManagementPage({ currentStoreId }: Props) {
  const [suppliers, setSuppliers] = useState<ProductSupplier[]>([]);
  const [products, setProducts] = useState<SupplierProduct[]>([]);
  const [name, setName] = useState("");
  const [nameDrafts, setNameDrafts] = useState<Record<string, string>>({});
  const [orderMethodDrafts, setOrderMethodDrafts] = useState<Record<string, "link" | "sms">>({});
  const [smsPhoneDrafts, setSmsPhoneDrafts] = useState<Record<string, string>>({});
  const [smsTemplateDrafts, setSmsTemplateDrafts] = useState<Record<string, string>>({});
  const [editingNameId, setEditingNameId] = useState<string | null>(null);
  const [expandedSupplierIds, setExpandedSupplierIds] = useState<Set<string>>(() => new Set());
  const [selectedProductIds, setSelectedProductIds] = useState<Set<string>>(() => new Set());
  const [bulkTargetSuppliers, setBulkTargetSuppliers] = useState<Record<string, string>>({});
  const [bulkProcessingSupplierId, setBulkProcessingSupplierId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const productsBySupplier = useMemo(() => {
    const groups = new Map<string, SupplierProduct[]>();
    for (const product of products) {
      const key = product.supplier_name ?? "미지정";
      groups.set(key, [...(groups.get(key) ?? []), product]);
    }

    for (const supplierProducts of groups.values()) {
      supplierProducts.sort((left, right) => left.name.localeCompare(right.name, "ko"));
    }

    return groups;
  }, [products]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [nextSuppliers, productResult] = await Promise.all([
        loadSuppliers(),
        Services.DatabaseService.select("products", "id, barcode, name, supplier_name, is_active")
          .eq("store_id", currentStoreId)
          .eq("is_active", true)
          .order("name", { ascending: true })
      ]);
      if (productResult.error) throw productResult.error;
      setSuppliers(nextSuppliers);
      setProducts((productResult.data ?? []) as SupplierProduct[]);
      setNameDrafts(Object.fromEntries(nextSuppliers.map((supplier) => [supplier.id, supplier.name])));
      setOrderMethodDrafts(Object.fromEntries(nextSuppliers.map((supplier) => [supplier.id, supplier.order_method ?? "link"])));
      setSmsPhoneDrafts(Object.fromEntries(nextSuppliers.map((supplier) => [supplier.id, supplier.sms_phone ?? ""])));
      setSmsTemplateDrafts(Object.fromEntries(nextSuppliers.map((supplier) => [supplier.id, supplier.sms_template ?? ""])));
      setBulkTargetSuppliers((current) => {
        const nextTargets: Record<string, string> = {};
        for (const supplier of nextSuppliers) {
          nextTargets[supplier.id] = current[supplier.id] ?? nextSuppliers.find((item) => item.id !== supplier.id && item.is_active)?.name ?? "";
        }
        return nextTargets;
      });
      setSelectedProductIds((current) => {
        const activeProductIds = new Set(((productResult.data ?? []) as SupplierProduct[]).map((product) => product.id));
        return new Set([...current].filter((id) => activeProductIds.has(id)));
      });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "발주처를 불러오지 못했습니다.");
    }
    setLoading(false);
  }, [currentStoreId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function addSupplier(event: FormEvent) {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) return;

    setError("");
    setMessage("");
    const { error: insertError } = await Services.DatabaseService.insert("suppliers", { name: trimmedName });
    if (insertError) {
      setError(insertError.message);
    } else {
      setName("");
      setMessage("발주처를 추가했습니다.");
      await refresh();
    }
  }

  async function saveSupplierName(supplier: ProductSupplier) {
    const nextName = nameDrafts[supplier.id]?.trim();
    const nextOrderMethod = orderMethodDrafts[supplier.id] ?? "link";
    const nextSmsPhone = smsPhoneDrafts[supplier.id]?.trim() ?? "";
    const nextSmsTemplate = smsTemplateDrafts[supplier.id]?.trim() ?? "";
    if (!nextName) {
      setError("발주처 이름은 비워둘 수 없습니다.");
      return;
    }
    if (nextOrderMethod === "sms" && !nextSmsPhone) {
      setError("문자 발주는 발주처 전화번호가 필요합니다.");
      return;
    }
    if (
      nextName === supplier.name &&
      nextOrderMethod === supplier.order_method &&
      nextSmsPhone === (supplier.sms_phone ?? "") &&
      nextSmsTemplate === (supplier.sms_template ?? "")
    ) {
      setEditingNameId(null);
      return;
    }

    setError("");
    setMessage("");
    const { error: updateError } = await Services.DatabaseService.update("suppliers", {
        name: nextName,
        order_method: nextOrderMethod,
        sms_phone: nextOrderMethod === "sms" ? nextSmsPhone : null,
        sms_template: nextOrderMethod === "sms" ? nextSmsTemplate || null : null
      })
      .eq("id", supplier.id);
    if (updateError) {
      setError(updateError.message);
      return;
    }

    const { error: productUpdateError } = await Services.DatabaseService.update("products", { supplier_name: nextName })
      .eq("store_id", currentStoreId)
      .eq("supplier_name", supplier.name);
    if (productUpdateError) {
      setError(`발주처 이름은 변경됐지만 상품 연결 수정에 실패했습니다: ${productUpdateError.message}`);
      return;
    }

    setEditingNameId(null);
    setMessage("발주처를 수정했습니다.");
    await refresh();
  }

  async function setSupplierActive(supplier: ProductSupplier, isActive: boolean) {
    setError("");
    setMessage("");
    const { error: updateError } = await Services.DatabaseService.update("suppliers", { is_active: isActive }).eq("id", supplier.id);
    if (updateError) {
      setError(updateError.message);
    } else {
      setMessage(isActive ? "발주처를 활성화했습니다." : "발주처를 비활성화했습니다.");
      await refresh();
    }
  }

  async function deleteSupplier(supplier: ProductSupplier) {
    if (supplier.is_active) {
      setError("활성 발주처는 삭제할 수 없습니다. 먼저 비활성화하세요.");
      return;
    }

    const { count, error: countError } = await Services.DatabaseService.select("products", "id", { count: "exact", head: true })
      .eq("store_id", currentStoreId)
      .eq("supplier_name", supplier.name);
    if (countError) {
      setError(countError.message);
      return;
    }

    if ((count ?? 0) > 0) {
      setError("이 발주처를 사용하는 상품이 있어 삭제할 수 없습니다.");
      return;
    }

    const ok = window.confirm(`${supplier.name} 발주처를 삭제할까요?`);
    if (!ok) return;

    const { error: deleteError } = await Services.DatabaseService.delete("suppliers").eq("id", supplier.id).eq("is_active", false);
    if (deleteError) {
      setError(deleteError.message);
    } else {
      setMessage("발주처를 삭제했습니다.");
      await refresh();
    }
  }

  function toggleSupplierExpanded(supplierId: string) {
    setExpandedSupplierIds((current) => {
      const next = new Set(current);
      if (next.has(supplierId)) {
        next.delete(supplierId);
      } else {
        next.add(supplierId);
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

  function setSupplierProductsSelected(supplierProducts: SupplierProduct[], checked: boolean) {
    setSelectedProductIds((current) => {
      const next = new Set(current);
      for (const product of supplierProducts) {
        if (checked) {
          next.add(product.id);
        } else {
          next.delete(product.id);
        }
      }
      return next;
    });
  }

  async function moveSelectedProducts(supplier: ProductSupplier, supplierProducts: SupplierProduct[]) {
    const selectedIds = supplierProducts.filter((product) => selectedProductIds.has(product.id)).map((product) => product.id);
    const targetSupplier = bulkTargetSuppliers[supplier.id] ?? "";
    if (selectedIds.length === 0) {
      setError("이동할 품목을 선택하세요.");
      return;
    }
    if (!targetSupplier || targetSupplier === supplier.name) {
      setError("이동할 다른 발주처를 선택하세요.");
      return;
    }

    setError("");
    setMessage("");
    setBulkProcessingSupplierId(supplier.id);
    const { error: updateError } = await Services.DatabaseService.update("products", { supplier_name: targetSupplier })
      .eq("store_id", currentStoreId)
      .eq("supplier_name", supplier.name)
      .in("id", selectedIds);

    if (updateError) {
      setError(updateError.message);
    } else {
      setSelectedProductIds((current) => {
        const next = new Set(current);
        selectedIds.forEach((id) => next.delete(id));
        return next;
      });
      setMessage(`${selectedIds.length}개 품목을 ${targetSupplier} 발주처로 이동했습니다.`);
      await refresh();
    }
    setBulkProcessingSupplierId(null);
  }

  return (
    <section>
      <PageTitle title="발주처 관리" description="상품 등록 화면의 발주처 버튼을 관리합니다." />

      <form onSubmit={addSupplier} className="mb-4 flex gap-2">
        <input className="field" value={name} onChange={(event) => setName(event.target.value)} placeholder="새 발주처" />
        <button type="submit" className="primary-button inline-flex min-w-14 items-center justify-center" aria-label="발주처 추가">
          <Plus size={22} />
        </button>
      </form>

      {loading ? <StatusMessage>발주처를 불러오는 중...</StatusMessage> : null}
      {error ? <div className="mb-3"><StatusMessage type="error">{error}</StatusMessage></div> : null}
      {message ? <div className="mb-3"><StatusMessage type="success">{message}</StatusMessage></div> : null}

      {!loading ? (
        <div className="space-y-2">
          {suppliers.map((supplier) => {
            const editingName = editingNameId === supplier.id;
            const supplierProducts = productsBySupplier.get(supplier.name) ?? [];
            const selectedCount = supplierProducts.filter((product) => selectedProductIds.has(product.id)).length;
            const allSelected = supplierProducts.length > 0 && selectedCount === supplierProducts.length;
            const expanded = expandedSupplierIds.has(supplier.id);
            const targetOptions = suppliers.filter((item) => item.is_active && item.name !== supplier.name);
            const bulkBusy = bulkProcessingSupplierId === supplier.id;

            return (
              <div key={supplier.id} className="panel p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    {editingName ? (
                      <div className="space-y-2">
                        <input
                          className="field min-h-11 py-2 text-base font-bold"
                          value={nameDrafts[supplier.id] ?? ""}
                          onChange={(event) => setNameDrafts((value) => ({ ...value, [supplier.id]: event.target.value }))}
                          autoFocus
                        />
                        <div className="flex gap-2">
                          <button type="button" onClick={() => saveSupplierName(supplier)} className="rounded border border-brand-600 px-3 py-1 text-base font-bold text-brand-700 dark:text-brand-100">
                            저장
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setNameDrafts((value) => ({ ...value, [supplier.id]: supplier.name }));
                              setOrderMethodDrafts((value) => ({ ...value, [supplier.id]: supplier.order_method }));
                              setSmsPhoneDrafts((value) => ({ ...value, [supplier.id]: supplier.sms_phone ?? "" }));
                              setSmsTemplateDrafts((value) => ({ ...value, [supplier.id]: supplier.sms_template ?? "" }));
                              setEditingNameId(null);
                            }}
                            className="rounded border border-slate-300 px-3 py-1 text-base font-bold dark:border-slate-700"
                          >
                            취소
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <p className="truncate text-base font-bold">{supplier.name}</p>
                        <button
                          type="button"
                          onClick={() => toggleSupplierExpanded(supplier.id)}
                          className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 dark:border-slate-700"
                          aria-label={expanded ? "품목 접기" : "품목 펼치기"}
                          title={expanded ? "품목 접기" : "품목 펼치기"}
                        >
                          <ChevronDown className={`transition-transform ${expanded ? "rotate-180" : ""}`} size={18} />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setNameDrafts((value) => ({ ...value, [supplier.id]: supplier.name }));
                            setOrderMethodDrafts((value) => ({ ...value, [supplier.id]: supplier.order_method }));
                            setSmsPhoneDrafts((value) => ({ ...value, [supplier.id]: supplier.sms_phone ?? "" }));
                            setSmsTemplateDrafts((value) => ({ ...value, [supplier.id]: supplier.sms_template ?? "" }));
                            setEditingNameId(supplier.id);
                          }}
                          className="shrink-0 rounded border border-slate-300 px-2 py-1 text-base font-bold dark:border-slate-700"
                        >
                          수정
                        </button>
                      </div>
                    )}
                    {editingName ? (
                      <div className="mt-3 space-y-3">
                        <label className="block">
                          <span className="mb-1 block text-sm font-bold text-slate-600 dark:text-slate-300">발주 방식</span>
                          <select
                            className="field py-2"
                            value={orderMethodDrafts[supplier.id] ?? "link"}
                            onChange={(event) => setOrderMethodDrafts((value) => ({ ...value, [supplier.id]: event.target.value as "link" | "sms" }))}
                          >
                            <option value="link">링크 발주</option>
                            <option value="sms">문자 발주</option>
                          </select>
                        </label>

                        {(orderMethodDrafts[supplier.id] ?? "link") === "sms" ? (
                          <>
                            <label className="block">
                              <span className="mb-1 block text-sm font-bold text-slate-600 dark:text-slate-300">문자 받을 번호</span>
                              <input
                                className="field py-2"
                                inputMode="tel"
                                value={smsPhoneDrafts[supplier.id] ?? ""}
                                onChange={(event) => setSmsPhoneDrafts((value) => ({ ...value, [supplier.id]: event.target.value }))}
                                placeholder="예: 01012345678"
                              />
                            </label>
                            <label className="block">
                              <span className="mb-1 block text-sm font-bold text-slate-600 dark:text-slate-300">문자 양식</span>
                              <textarea
                                className="field min-h-32 py-2"
                                value={smsTemplateDrafts[supplier.id] ?? ""}
                                onChange={(event) => setSmsTemplateDrafts((value) => ({ ...value, [supplier.id]: event.target.value }))}
                                placeholder={"안녕하세요! 카페 낙입니다.\n{product}\n{quantity}{unit} 부탁드립니다.\n\n감사합니다."}
                              />
                              <span className="mt-1 block text-xs font-semibold text-slate-500 dark:text-slate-400">
                                상품명은 {"{product}"}, 발주량은 {"{quantity}"}, 단위는 {"{unit}"}로 넣을 수 있습니다.
                              </span>
                            </label>
                          </>
                        ) : null}
                      </div>
                    ) : supplier.order_method === "sms" ? (
                      <p className="mt-2 text-sm font-semibold text-slate-500 dark:text-slate-400">문자 발주 · {supplier.sms_phone ?? "번호 없음"}</p>
                    ) : (
                      <p className="mt-2 text-sm font-semibold text-slate-500 dark:text-slate-400">링크 발주</p>
                    )}
                    <p className="mt-1 text-xs font-semibold text-slate-500 dark:text-slate-400">품목 {supplierProducts.length}개</p>
                  </div>
                  <span
                    className={`shrink-0 rounded px-2 py-1 text-xs font-bold ${
                      supplier.is_active ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-100" : "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-200"
                    }`}
                  >
                    {supplier.is_active ? "활성" : "비활성"}
                  </span>
                </div>

                <div className="mt-3 flex justify-end gap-2">
                  <button type="button" onClick={() => setSupplierActive(supplier, !supplier.is_active)} className="touch-button rounded-md border border-slate-300 px-3 text-sm font-bold dark:border-slate-700">
                    {supplier.is_active ? "비활성화" : "활성화"}
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteSupplier(supplier)}
                    disabled={supplier.is_active}
                    className="touch-button inline-flex items-center justify-center rounded-md border border-red-200 px-3 text-red-700 disabled:opacity-35 dark:border-red-900 dark:text-red-200"
                    aria-label="발주처 삭제"
                    title="삭제"
                  >
                    <Trash2 size={18} />
                  </button>
                </div>

                {expanded ? (
                  <div className="mt-3 border-t border-slate-200 pt-3 dark:border-slate-800">
                    {supplierProducts.length > 0 ? (
                      <>
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                          <label className="inline-flex min-h-10 items-center gap-2 text-sm font-bold">
                            <input
                              type="checkbox"
                              className="h-4 w-4"
                              checked={allSelected}
                              onChange={(event) => setSupplierProductsSelected(supplierProducts, event.target.checked)}
                            />
                            전체 선택
                          </label>
                          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                            <select
                              className="field min-h-10 py-2 text-sm"
                              value={bulkTargetSuppliers[supplier.id] ?? ""}
                              onChange={(event) => setBulkTargetSuppliers((current) => ({ ...current, [supplier.id]: event.target.value }))}
                              disabled={targetOptions.length === 0 || bulkBusy}
                              aria-label="이동할 발주처"
                            >
                              {targetOptions.length === 0 ? <option value="">이동할 발주처 없음</option> : null}
                              {targetOptions.map((item) => (
                                <option key={item.id} value={item.name}>{item.name}</option>
                              ))}
                            </select>
                            <button
                              type="button"
                              onClick={() => moveSelectedProducts(supplier, supplierProducts)}
                              disabled={selectedCount === 0 || targetOptions.length === 0 || bulkBusy}
                              className="touch-button rounded-md border border-brand-600 px-3 text-sm font-bold text-brand-700 disabled:opacity-35 dark:text-brand-100"
                            >
                              이동
                            </button>
                          </div>
                        </div>

                        <div className="mt-2 divide-y divide-slate-100 overflow-hidden rounded-md border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
                          {supplierProducts.map((product) => (
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
                      <StatusMessage>이 발주처에 활성 품목이 없습니다.</StatusMessage>
                    )}
                  </div>
                ) : null}
              </div>
            );
          })}
          {suppliers.length === 0 ? <StatusMessage>발주처가 없습니다.</StatusMessage> : null}
        </div>
      ) : null}
    </section>
  );
}
