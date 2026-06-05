import { FormEvent, useEffect, useState } from "react";
import { PageTitle } from "../components/PageTitle";
import { StatusMessage } from "../components/StatusMessage";
import { fallbackCategories, loadCategories } from "../lib/categories";
import { fallbackSuppliers, loadSuppliers } from "../lib/suppliers";
import type { AppRoute, ProductCategory, ProductSupplier, StorageType } from "../types/domain";
import { supabase } from "../lib/supabase";

type Props = {
  barcode: string;
  navigate: (route: AppRoute) => void;
};

export function ProductRegisterPage({ barcode, navigate }: Props) {
  const [name, setName] = useState("");
  const [barcodeValue, setBarcodeValue] = useState(barcode);
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [category, setCategory] = useState("기타");
  const [suppliers, setSuppliers] = useState<ProductSupplier[]>([]);
  const [supplierName, setSupplierName] = useState("");
  const [storageType, setStorageType] = useState<StorageType | "">("");
  const [minimumStock, setMinimumStock] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([loadCategories({ activeOnly: true }), loadSuppliers({ activeOnly: true })])
      .then(([categoryData, supplierData]) => {
        const nextCategories = categoryData.length > 0 ? categoryData : fallbackCategories();
        const nextSuppliers = supplierData.length > 0 ? supplierData : fallbackSuppliers();
        setCategories(nextCategories);
        setSuppliers(nextSuppliers);
        setCategory((current) => (nextCategories.some((item) => item.name === current) ? current : nextCategories[0]?.name ?? "기타"));
        setSupplierName((current) => (nextSuppliers.some((item) => item.name === current) ? current : nextSuppliers[0]?.name ?? ""));
      })
      .catch(() => {
        const nextCategories = fallbackCategories();
        const nextSuppliers = fallbackSuppliers();
        setCategories(nextCategories);
        setSuppliers(nextSuppliers);
        setCategory(nextCategories[0]?.name ?? "기타");
        setSupplierName(nextSuppliers[0]?.name ?? "");
      });
  }, []);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");

    const { data, error: insertError } = await supabase
      .from("products")
      .insert({
        name: name.trim(),
        barcode: barcodeValue.trim() || null,
        category,
        supplier_name: supplierName || null,
        storage_type: storageType || null,
        minimum_stock: Math.max(0, Number(minimumStock || 0))
      })
      .select()
      .single();

    if (insertError) {
      setError(insertError.message);
    } else {
      const { error: inventoryError } = await supabase.from("inventory").insert({ product_id: data.id });
      if (inventoryError) {
        setError(inventoryError.message);
      } else {
        navigate({ name: "operation", productId: data.id });
      }
    }

    setSaving(false);
  }

  return (
    <section>
      <PageTitle title="상품 등록" description="미등록 상품을 등록한 뒤 바로 재고 작업으로 이동합니다." />

      <form onSubmit={handleSubmit} className="panel max-w-2xl p-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-sm font-semibold">상품명</span>
            <input className="field" value={name} onChange={(event) => setName(event.target.value)} required autoFocus />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-semibold">바코드</span>
            <input className="field" value={barcodeValue} onChange={(event) => setBarcodeValue(event.target.value)} />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-semibold">카테고리</span>
            <select className="field" value={category} onChange={(event) => setCategory(event.target.value)}>
              {categories.map((item) => (
                <option key={item.id} value={item.name}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <div className="sm:col-span-2">
            <span className="mb-2 block text-sm font-semibold">보관 구분</span>
            <div className="grid grid-cols-2 gap-2">
              {(["냉장", "냉동", "상온"] as StorageType[]).map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setStorageType(type)}
                  className={`touch-button rounded-md px-4 text-sm font-bold ${storageType === type ? "bg-brand-600 text-white" : "border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"}`}
                >
                  {type}
                </button>
              ))}
            </div>
          </div>
          <div className="sm:col-span-2">
            <span className="mb-2 block text-sm font-semibold">발주처</span>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {suppliers.map((supplier) => (
                <button
                  key={supplier.id}
                  type="button"
                  onClick={() => setSupplierName(supplier.name)}
                  className={`touch-button shrink-0 whitespace-nowrap rounded-md px-4 text-sm font-bold ${supplierName === supplier.name ? "bg-brand-600 text-white" : "border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"}`}
                >
                  {supplier.name}
                </button>
              ))}
            </div>
          </div>
          <label className="block">
            <span className="mb-1 block text-sm font-semibold">최소 재고</span>
            <input className="field" type="number" min={0} value={minimumStock} onChange={(event) => setMinimumStock(event.target.value)} />
          </label>
        </div>

        {error ? <div className="mt-4"><StatusMessage type="error">{error}</StatusMessage></div> : null}

        <div className="mt-5 grid grid-cols-2 gap-3">
          <button type="button" onClick={() => navigate({ name: "scan" })} className="secondary-button">
            취소
          </button>
          <button type="submit" disabled={saving || !name.trim()} className="primary-button">
            {saving ? "저장 중..." : "저장"}
          </button>
        </div>
      </form>
    </section>
  );
}
