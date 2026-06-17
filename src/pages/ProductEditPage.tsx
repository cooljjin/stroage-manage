import { FormEvent, useCallback, useEffect, useState } from "react";
import { PageTitle } from "../components/PageTitle";
import { StatusMessage } from "../components/StatusMessage";
import { fallbackCategories, loadCategories } from "../lib/categories";
import { fallbackProductUnits, loadProductUnits } from "../lib/productUnits";
import { fallbackSuppliers, loadSuppliers } from "../lib/suppliers";
import { supabase } from "../lib/supabase";
import type { AppRoute, Product, ProductCategory, ProductSupplier, ProductUnit, StorageType } from "../types/domain";

type Props = {
  productId: string;
  navigate: (route: AppRoute) => void;
};

const STORAGE_TYPES: StorageType[] = ["냉장", "냉동", "상온"];

function parseStorageTypes(value: string | null): StorageType[] {
  if (!value) return [];
  return STORAGE_TYPES.filter((type) => value.split(",").map((item) => item.trim()).includes(type));
}

export function ProductEditPage({ productId, navigate }: Props) {
  const [product, setProduct] = useState<Product | null>(null);
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [suppliers, setSuppliers] = useState<ProductSupplier[]>([]);
  const [units, setUnits] = useState<ProductUnit[]>([]);
  const [name, setName] = useState("");
  const [barcode, setBarcode] = useState("");
  const [category, setCategory] = useState("기타");
  const [supplierName, setSupplierName] = useState("");
  const [storageTypes, setStorageTypes] = useState<StorageType[]>([]);
  const [unitName, setUnitName] = useState("");
  const [minimumStock, setMinimumStock] = useState("");
  const [productUrl, setProductUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const loadProduct = useCallback(async () => {
    setLoading(true);
    setError("");

    const [categoryResult, supplierResult, unitResult, productResult] = await Promise.all([
      loadCategories({ activeOnly: true }).catch(() => fallbackCategories()),
      loadSuppliers({ activeOnly: true }).catch(() => fallbackSuppliers()),
      loadProductUnits({ activeOnly: true }).catch(() => fallbackProductUnits()),
      supabase.from("products").select("*").eq("id", productId).single()
    ]);

    const { data, error: loadError } = productResult;
    if (loadError) {
      setError(loadError.message);
    } else {
      const nextProduct = data as Product;
      const nextCategories = categoryResult.some((item) => item.name === nextProduct.category)
        ? categoryResult
        : [...categoryResult, { id: nextProduct.category, name: nextProduct.category, is_active: true, sort_order: categoryResult.length + 1, created_at: new Date(0).toISOString() }];
      const nextSuppliers = nextProduct.supplier_name && !supplierResult.some((item) => item.name === nextProduct.supplier_name)
        ? [...supplierResult, { id: nextProduct.supplier_name, name: nextProduct.supplier_name, is_active: true, created_at: new Date(0).toISOString() }]
        : supplierResult;
      const nextUnits = nextProduct.unit_name && !unitResult.some((item) => item.name === nextProduct.unit_name)
        ? [...unitResult, { id: nextProduct.unit_name, name: nextProduct.unit_name, is_active: true, sort_order: unitResult.length + 1, created_at: new Date(0).toISOString() }]
        : unitResult;

      setProduct(nextProduct);
      setCategories(nextCategories);
      setSuppliers(nextSuppliers);
      setUnits(nextUnits);
      setName(nextProduct.name);
      setBarcode(nextProduct.barcode ?? "");
      setCategory(nextProduct.category);
      setSupplierName(nextProduct.supplier_name ?? "");
      setStorageTypes(parseStorageTypes(nextProduct.storage_type));
      setUnitName(nextProduct.unit_name ?? "");
      setMinimumStock(String(nextProduct.minimum_stock));
      setProductUrl(nextProduct.product_url ?? "");
    }

    setLoading(false);
  }, [productId]);

  useEffect(() => {
    void loadProduct();
  }, [loadProduct]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const nextName = name.trim();
    const nextMinimumStock = Number(minimumStock || 0);

    if (!nextName) {
      setError("상품명은 비워둘 수 없습니다.");
      return;
    }
    if (!Number.isInteger(nextMinimumStock) || nextMinimumStock < 0) {
      setError("최소재고는 0 이상 정수로 입력해 주세요.");
      return;
    }

    setSaving(true);
    setError("");
    const { error: updateError } = await supabase
      .from("products")
      .update({
        name: nextName,
        barcode: barcode.trim() || null,
        category,
        supplier_name: supplierName || null,
        storage_type: storageTypes.length > 0 ? storageTypes.join(", ") : null,
        unit_name: unitName || null,
        minimum_stock: nextMinimumStock,
        product_url: productUrl.trim() || null
      })
      .eq("id", productId);

    setSaving(false);
    if (updateError) {
      setError(updateError.message);
    } else {
      navigate({ name: "operation", productId });
    }
  }

  if (loading) return <StatusMessage>상품 정보를 불러오는 중...</StatusMessage>;
  if (!product) return <StatusMessage type="error">상품을 찾을 수 없습니다.</StatusMessage>;

  return (
    <section className="min-w-0">
      <PageTitle
        title="상품 수정"
        description={product.name}
        action={<button className="secondary-button px-3" type="button" onClick={() => navigate({ name: "operation", productId })}>취소</button>}
      />

      <form onSubmit={handleSubmit} className="panel w-full max-w-2xl overflow-hidden p-4">
        <div className="grid min-w-0 gap-4 sm:grid-cols-2">
          <label className="block min-w-0 sm:col-span-2">
            <span className="mb-1 block text-sm font-semibold">상품명</span>
            <input className="field" value={name} onChange={(event) => setName(event.target.value)} required autoFocus />
          </label>

          <label className="block min-w-0">
            <span className="mb-1 block text-sm font-semibold">바코드</span>
            <input className="field" value={barcode} onChange={(event) => setBarcode(event.target.value)} />
          </label>

          <label className="block min-w-0">
            <span className="mb-1 block text-sm font-semibold">카테고리</span>
            <select className="field" value={category} onChange={(event) => setCategory(event.target.value)}>
              {categories.map((item) => (
                <option key={item.id} value={item.name}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>

          <div className="min-w-0 sm:col-span-2">
            <span className="mb-2 block text-sm font-semibold">보관 구분</span>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {(["", "냉장", "냉동", "상온"] as const).map((type) => (
                <button
                  key={type || "none"}
                  type="button"
                  onClick={() => {
                    if (!type) {
                      setStorageTypes([]);
                      return;
                    }
                    setStorageTypes((current) => (current.includes(type) ? current.filter((item) => item !== type) : [...current, type]));
                  }}
                  className={`touch-button rounded-md px-4 text-sm font-bold ${type ? (storageTypes.includes(type) ? "bg-brand-600 text-white" : "border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900") : storageTypes.length === 0 ? "bg-brand-600 text-white" : "border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"}`}
                >
                  {type || "미지정"}
                </button>
              ))}
            </div>
          </div>

          <label className="block min-w-0 sm:col-span-2">
            <span className="mb-1 block text-sm font-semibold">발주처</span>
            <select className="field" value={supplierName} onChange={(event) => setSupplierName(event.target.value)}>
              <option value="">미지정</option>
              {suppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.name}>
                  {supplier.name}
                </option>
              ))}
            </select>
          </label>

          <label className="block min-w-0">
            <span className="mb-1 block text-sm font-semibold">품목 단위</span>
            <select className="field" value={unitName} onChange={(event) => setUnitName(event.target.value)}>
              <option value="">미지정</option>
              {units.map((unit) => (
                <option key={unit.id} value={unit.name}>
                  {unit.name}
                </option>
              ))}
            </select>
          </label>

          <label className="block min-w-0">
            <span className="mb-1 block text-sm font-semibold">최소 재고</span>
            <input className="field" type="number" inputMode="numeric" min={0} step={1} value={minimumStock} onChange={(event) => setMinimumStock(event.target.value)} />
          </label>

          <label className="block min-w-0 sm:col-span-2">
            <span className="mb-1 block text-sm font-semibold">링크</span>
            <input className="field" type="url" value={productUrl} onChange={(event) => setProductUrl(event.target.value)} placeholder="https://..." />
          </label>
        </div>

        {error ? <div className="mt-4"><StatusMessage type="error">{error}</StatusMessage></div> : null}

        <div className="mt-5 grid grid-cols-2 gap-3">
          <button type="button" onClick={() => navigate({ name: "operation", productId })} className="secondary-button">
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
