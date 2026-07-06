import { FormEvent, useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { PageTitle } from "../components/PageTitle";
import { StatusMessage } from "../components/StatusMessage";
import { loadSuppliers } from "../lib/suppliers";
import * as Services from "../services";
import type { ProductSupplier } from "../types/domain";

export function SupplierManagementPage() {
  const [suppliers, setSuppliers] = useState<ProductSupplier[]>([]);
  const [name, setName] = useState("");
  const [nameDrafts, setNameDrafts] = useState<Record<string, string>>({});
  const [orderMethodDrafts, setOrderMethodDrafts] = useState<Record<string, "link" | "sms">>({});
  const [smsPhoneDrafts, setSmsPhoneDrafts] = useState<Record<string, string>>({});
  const [smsTemplateDrafts, setSmsTemplateDrafts] = useState<Record<string, string>>({});
  const [editingNameId, setEditingNameId] = useState<string | null>(null);
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
      const nextSuppliers = await loadSuppliers();
      setSuppliers(nextSuppliers);
      setNameDrafts(Object.fromEntries(nextSuppliers.map((supplier) => [supplier.id, supplier.name])));
      setOrderMethodDrafts(Object.fromEntries(nextSuppliers.map((supplier) => [supplier.id, supplier.order_method ?? "link"])));
      setSmsPhoneDrafts(Object.fromEntries(nextSuppliers.map((supplier) => [supplier.id, supplier.sms_phone ?? ""])));
      setSmsTemplateDrafts(Object.fromEntries(nextSuppliers.map((supplier) => [supplier.id, supplier.sms_template ?? ""])));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "발주처를 불러오지 못했습니다.");
    }
    setLoading(false);
  }

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

    const { error: productUpdateError } = await Services.DatabaseService.update("products", { supplier_name: nextName }).eq("supplier_name", supplier.name);
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

    const { count, error: countError } = await Services.DatabaseService.select("products", "id", { count: "exact", head: true }).eq("supplier_name", supplier.name);
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
                      <div className="flex min-w-0 items-center gap-2">
                        <p className="truncate text-base font-bold">{supplier.name}</p>
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
              </div>
            );
          })}
          {suppliers.length === 0 ? <StatusMessage>발주처가 없습니다.</StatusMessage> : null}
        </div>
      ) : null}
    </section>
  );
}
