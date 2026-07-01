import { FormEvent, useCallback, useEffect, useState } from "react";
import { PageTitle } from "../components/PageTitle";
import { StatusMessage } from "../components/StatusMessage";
import { fallbackCategories, loadCategories } from "../lib/categories";
import { fallbackProductUnits, loadProductUnits } from "../lib/productUnits";
import { fallbackSuppliers, loadSuppliers } from "../lib/suppliers";
import { supabase } from "../lib/supabase";
import type { AppRoute, PrepItemRouteDraft, Product, ProductCategory, ProductSupplier, ProductUnit, StorageType, UnitWeightUnit } from "../types/domain";

type Props = {
  productId: string;
  navigate: (route: AppRoute) => void;
  currentStoreId: string;
  returnTo?: "prep-items";
  prepDraft?: PrepItemRouteDraft;
};

const STORAGE_TYPES: StorageType[] = ["냉장", "냉동", "상온"];
const WEIGHT_UNITS: UnitWeightUnit[] = ["g", "kg"];
const VOLUME_UNITS: UnitWeightUnit[] = ["ml", "L"];

type UnitMeasureType = "weight" | "volume";

function getUnitMeasureType(unit: UnitWeightUnit | null | undefined): UnitMeasureType {
  return unit === "ml" || unit === "L" ? "volume" : "weight";
}

function unitOptionsForType(type: UnitMeasureType): UnitWeightUnit[] {
  return type === "volume" ? VOLUME_UNITS : WEIGHT_UNITS;
}

function normalizeUnitForType(unit: UnitWeightUnit | null | undefined, type: UnitMeasureType): UnitWeightUnit {
  const options = unitOptionsForType(type);
  return unit && options.includes(unit) ? unit : options[0];
}

function parseStorageTypes(value: string | null): StorageType[] {
  if (!value) return [];
  return STORAGE_TYPES.filter((type) => value.split(",").map((item) => item.trim()).includes(type));
}

function formatProductUpdateError(message: string) {
  if (
    message.includes("unit_weight_enabled")
    || message.includes("unit_weight")
    || message.includes("processing_required")
    || message.includes("processed_unit_weight")
    || message.includes("schema cache")
  ) {
    return "단위당 무게 기능 DB 업데이트가 아직 적용되지 않았습니다. 관리자에게 products 단위당 무게 컬럼 추가를 요청해 주세요.";
  }
  return message;
}

export function ProductEditPage({ productId, navigate, currentStoreId, returnTo, prepDraft }: Props) {
  const [product, setProduct] = useState<Product | null>(null);
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [suppliers, setSuppliers] = useState<ProductSupplier[]>([]);
  const [units, setUnits] = useState<ProductUnit[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [name, setName] = useState("");
  const [barcode, setBarcode] = useState("");
  const [category, setCategory] = useState("기타");
  const [supplierName, setSupplierName] = useState("");
  const [storageTypes, setStorageTypes] = useState<StorageType[]>([]);
  const [unitName, setUnitName] = useState("");
  const [unitWeightEnabled, setUnitWeightEnabled] = useState(false);
  const [unitWeight, setUnitWeight] = useState("");
  const [unitWeightUnit, setUnitWeightUnit] = useState<UnitWeightUnit>("g");
  const [processingRequired, setProcessingRequired] = useState(false);
  const [processedUnitWeight, setProcessedUnitWeight] = useState("");
  const [processedUnitWeightUnit, setProcessedUnitWeightUnit] = useState<UnitWeightUnit>("g");
  const [minimumStock, setMinimumStock] = useState("");
  const [receiptCheckOnly, setReceiptCheckOnly] = useState(false);
  const [productUrl, setProductUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [mergeSearch, setMergeSearch] = useState("");
  const [merging, setMerging] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const loadProduct = useCallback(async () => {
    setLoading(true);
    setError("");
    setMessage("");

    const [categoryResult, supplierResult, unitResult, productResult, productsResult] = await Promise.all([
      loadCategories({ activeOnly: true }).catch(() => fallbackCategories()),
      loadSuppliers({ activeOnly: true }).catch(() => fallbackSuppliers()),
      loadProductUnits({ activeOnly: true }).catch(() => fallbackProductUnits()),
      supabase.from("products").select("*").eq("store_id", currentStoreId).eq("id", productId).single(),
      supabase.from("products").select("*").eq("store_id", currentStoreId).order("name", { ascending: true })
    ]);

    const { data, error: loadError } = productResult;
    if (loadError || productsResult.error) {
      setError(loadError?.message ?? productsResult.error?.message ?? "상품 정보를 불러오지 못했습니다.");
    } else {
      const nextProduct = data as Product;
      const nextCategories = categoryResult.some((item) => item.name === nextProduct.category)
        ? categoryResult
        : [...categoryResult, { id: nextProduct.category, name: nextProduct.category, is_active: true, sort_order: categoryResult.length + 1, created_at: new Date(0).toISOString() }];
      const nextSuppliers = nextProduct.supplier_name && !supplierResult.some((item) => item.name === nextProduct.supplier_name)
        ? [
            ...supplierResult,
            {
              id: nextProduct.supplier_name,
              name: nextProduct.supplier_name,
              order_method: "link" as const,
              sms_phone: null,
              sms_template: null,
              is_active: true,
              created_at: new Date(0).toISOString()
            }
          ]
        : supplierResult;
      const nextUnits = nextProduct.unit_name && !unitResult.some((item) => item.name === nextProduct.unit_name)
        ? [...unitResult, { id: nextProduct.unit_name, name: nextProduct.unit_name, is_active: true, sort_order: unitResult.length + 1, created_at: new Date(0).toISOString() }]
        : unitResult;

      setProduct(nextProduct);
      setCategories(nextCategories);
      setSuppliers(nextSuppliers);
      setUnits(nextUnits);
      setProducts((productsResult.data ?? []) as Product[]);
      setName(nextProduct.name);
      setBarcode(nextProduct.barcode ?? "");
      setCategory(nextProduct.category);
      setSupplierName(nextProduct.supplier_name ?? "");
      setStorageTypes(parseStorageTypes(nextProduct.storage_type));
      setUnitName(nextProduct.unit_name ?? "");
      setUnitWeightEnabled(nextProduct.unit_weight_enabled ?? false);
      setUnitWeight(nextProduct.unit_weight !== null && nextProduct.unit_weight !== undefined ? String(nextProduct.unit_weight) : "");
      const nextUnitWeightUnit = nextProduct.unit_weight_unit ?? "g";
      const nextMeasureType = getUnitMeasureType(nextUnitWeightUnit);
      setUnitWeightUnit(nextUnitWeightUnit);
      setProcessingRequired(nextProduct.processing_required ?? false);
      setProcessedUnitWeight(nextProduct.processed_unit_weight !== null && nextProduct.processed_unit_weight !== undefined ? String(nextProduct.processed_unit_weight) : "");
      setProcessedUnitWeightUnit(normalizeUnitForType(nextProduct.processed_unit_weight_unit, nextMeasureType));
      setMinimumStock(String(nextProduct.minimum_stock));
      setReceiptCheckOnly(nextProduct.receipt_check_only ?? false);
      setProductUrl(nextProduct.product_url ?? "");
    }

    setLoading(false);
  }, [currentStoreId, productId]);

  useEffect(() => {
    void loadProduct();
  }, [loadProduct]);

  const unitMeasureType = getUnitMeasureType(unitWeightUnit);
  const unitMeasureLabel = unitMeasureType === "volume" ? "부피" : "무게";
  const unitOptions = unitOptionsForType(unitMeasureType);

  function setUnitMeasureType(nextType: UnitMeasureType) {
    const nextDefaultUnit = nextType === "volume" ? "ml" : "g";
    setUnitWeightUnit(nextDefaultUnit);
    setProcessedUnitWeightUnit(nextDefaultUnit);
  }

  function getExitRoute(): AppRoute {
    if (returnTo === "prep-items") {
      return { name: "prep-items", prepDraft };
    }
    return { name: "operation", productId };
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!product) return;

    const nextName = name.trim();
    const nextMinimumStock = receiptCheckOnly ? 0 : Number(minimumStock || 0);
    const parsedUnitWeight = Number(unitWeight || 0);
    const nextUnitWeight = unitWeightEnabled ? parsedUnitWeight : null;
    const nextProcessingRequired = unitWeightEnabled && processingRequired;
    const parsedProcessedUnitWeight = Number(processedUnitWeight || 0);
    const nextProcessedUnitWeight = nextProcessingRequired ? parsedProcessedUnitWeight : null;

    if (!nextName) {
      setError("상품명은 비워둘 수 없습니다.");
      return;
    }
    if (!Number.isInteger(nextMinimumStock) || nextMinimumStock < 0) {
      setError("최소재고는 0 이상 정수로 입력해 주세요.");
      return;
    }
    if (unitWeightEnabled && (!Number.isFinite(parsedUnitWeight) || parsedUnitWeight <= 0)) {
      setError("단위당 무게/부피는 0보다 큰 숫자로 입력해 주세요.");
      return;
    }
    if (nextProcessingRequired && (!Number.isFinite(parsedProcessedUnitWeight) || parsedProcessedUnitWeight <= 0)) {
      setError("손질 후 단위당 무게/부피는 0보다 큰 숫자로 입력해 주세요.");
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
        unit_weight_enabled: unitWeightEnabled,
        unit_weight: unitWeightEnabled ? nextUnitWeight : null,
        unit_weight_unit: unitWeightEnabled ? unitWeightUnit : null,
        processing_required: nextProcessingRequired,
        processed_unit_weight: nextProcessedUnitWeight,
        processed_unit_weight_unit: nextProcessingRequired ? processedUnitWeightUnit : null,
        minimum_stock: nextMinimumStock,
        receipt_check_only: receiptCheckOnly,
        status_enabled: receiptCheckOnly ? false : product.status_enabled,
        stock_status: receiptCheckOnly ? null : product.stock_status,
        product_url: productUrl.trim() || null
      })
      .eq("store_id", currentStoreId)
      .eq("id", productId);

    setSaving(false);
    if (updateError) {
      setError(formatProductUpdateError(updateError.message));
    } else {
      navigate(getExitRoute());
    }
  }

  async function deleteProduct() {
    if (!product) return;

    const ok = window.confirm(`${product.name} 품목을 삭제할까요? 삭제한 품목은 재고 현황과 검색에서 보이지 않습니다.`);
    if (!ok) return;

    setDeleting(true);
    setError("");
    setMessage("");

    const { error: deleteError } = await supabase.from("products").update({ is_active: false }).eq("store_id", currentStoreId).eq("id", product.id);

    setDeleting(false);
    if (deleteError) {
      setError(deleteError.message);
      return;
    }

    navigate({ name: "inventory" });
  }

  const mergeCandidates = product
    ? products
        .filter((candidate) => candidate.id !== product.id && candidate.is_active !== false)
        .filter((candidate) => {
          const keyword = mergeSearch.trim().toLowerCase();
          return keyword && (candidate.name.toLowerCase().includes(keyword) || (candidate.barcode ?? "").toLowerCase().includes(keyword));
        })
        .slice(0, 5)
    : [];

  function formatMergeError(errorMessage: string) {
    if (errorMessage.includes("merge_products") || errorMessage.includes("product_barcodes") || errorMessage.includes("schema cache")) {
      return "병합 기능 DB 업데이트가 아직 적용되지 않았습니다. 관리자에게 product_barcodes 테이블과 merge_products 함수 추가를 요청해 주세요.";
    }
    return errorMessage;
  }

  async function mergeProduct(sourceProduct: Product) {
    if (!product) return;

    const ok = window.confirm(`${sourceProduct.name} 상품을 ${product.name} 상품으로 병합할까요? 병합 후 ${sourceProduct.name}은 비활성화됩니다.`);
    if (!ok) return;

    setError("");
    setMessage("");
    setMerging(true);
    const { error: mergeError } = await supabase.rpc("merge_products", {
      target_product_id: product.id,
      source_product_id: sourceProduct.id
    });
    setMerging(false);

    if (mergeError) {
      setError(formatMergeError(mergeError.message));
      return;
    }

    setMergeSearch("");
    await loadProduct();
    setMessage("상품을 병합했습니다.");
  }

  if (loading) return <StatusMessage>상품 정보를 불러오는 중...</StatusMessage>;
  if (!product) return <StatusMessage type="error">상품을 찾을 수 없습니다.</StatusMessage>;

  return (
    <section className="min-w-0">
      <PageTitle
        title="상품 수정"
        description={product.name}
        action={<button className="secondary-button px-3" type="button" onClick={() => navigate(getExitRoute())}>취소</button>}
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
            <input className="field" type="number" inputMode="numeric" min={0} step={1} value={receiptCheckOnly ? "0" : minimumStock} disabled={receiptCheckOnly} onChange={(event) => setMinimumStock(event.target.value)} />
          </label>

          <label className="block min-w-0 sm:col-span-2">
            <span className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold">
              <span>링크</span>
              <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">링크를 추가하면 간편하게 발주가 가능합니다</span>
            </span>
            <input className="field" type="url" value={productUrl} onChange={(event) => setProductUrl(event.target.value)} placeholder="https://..." />
          </label>

          <div className="min-w-0 rounded-md border border-slate-200 p-3 dark:border-slate-800 sm:col-span-2">
            <label className="flex min-w-0 items-center gap-3">
              <input
                type="checkbox"
                checked={unitWeightEnabled}
                onChange={(event) => setUnitWeightEnabled(event.target.checked)}
                className="h-5 w-5 shrink-0 accent-brand-600"
              />
              <span className="min-w-0 text-sm font-bold">단위당 무게 사용</span>
            </label>
            <p className="mt-1 pl-8 text-xs font-semibold text-slate-500 dark:text-slate-400">자동재고파악을 위해 입력하는 정보입니다</p>
            <div className="mt-2 min-w-0">
              <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                <span className="block text-sm font-semibold">단위당</span>
                <div className="grid grid-cols-2 gap-1">
                  {(["weight", "volume"] as UnitMeasureType[]).map((type) => (
                    <button
                      key={type}
                      type="button"
                      disabled={!unitWeightEnabled}
                      onClick={() => setUnitMeasureType(type)}
                      className={`touch-button rounded-md px-3 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-45 ${
                        unitMeasureType === type ? "bg-brand-600 text-white" : "border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
                      }`}
                      aria-pressed={unitMeasureType === type}
                    >
                      {type === "volume" ? "부피" : "무게"}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)_112px] gap-2">
                <input
                  className="field"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  value={unitWeight}
                  disabled={!unitWeightEnabled}
                  onChange={(event) => setUnitWeight(event.target.value)}
                  aria-label={`단위당 ${unitMeasureLabel}`}
                />
                <div className="grid grid-cols-2 gap-1">
                  {unitOptions.map((weightUnit) => (
                    <button
                      key={weightUnit}
                      type="button"
                      disabled={!unitWeightEnabled}
                      onClick={() => setUnitWeightUnit(weightUnit)}
                      className={`touch-button rounded-md px-2 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-45 ${
                        unitWeightUnit === weightUnit ? "bg-brand-600 text-white" : "border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
                      }`}
                      aria-pressed={unitWeightUnit === weightUnit}
                    >
                      {weightUnit}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="mt-3 rounded-md border border-slate-200 p-3 dark:border-slate-800">
              <label className="flex min-w-0 items-center gap-3">
                <input
                  type="checkbox"
                  checked={processingRequired}
                  disabled={!unitWeightEnabled}
                  onChange={(event) => setProcessingRequired(event.target.checked)}
                  className="h-5 w-5 shrink-0 accent-brand-600 disabled:opacity-45"
                />
                <span className="min-w-0 text-sm font-bold text-slate-900 dark:text-slate-100">손질 필요 품목</span>
              </label>
              {processingRequired ? (
                <div className="mt-3 min-w-0">
                  <span className="mb-1 block text-sm font-semibold">손질 후 단위당 {unitMeasureLabel}</span>
                  <div className="grid grid-cols-[minmax(0,1fr)_112px] gap-2">
                    <input
                      className="field"
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step="0.01"
                      value={processedUnitWeight}
                      disabled={!unitWeightEnabled}
                      onChange={(event) => setProcessedUnitWeight(event.target.value)}
                      aria-label={`손질 후 단위당 ${unitMeasureLabel}`}
                    />
                    <div className="grid grid-cols-2 gap-1">
                      {unitOptions.map((weightUnit) => (
                        <button
                          key={weightUnit}
                          type="button"
                          disabled={!unitWeightEnabled}
                          onClick={() => setProcessedUnitWeightUnit(weightUnit)}
                          className={`touch-button rounded-md px-2 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-45 ${
                            processedUnitWeightUnit === weightUnit ? "bg-brand-600 text-white" : "border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
                          }`}
                          aria-pressed={processedUnitWeightUnit === weightUnit}
                        >
                          {weightUnit}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          <label className="flex min-w-0 items-start gap-3 rounded-md border border-slate-200 p-3 dark:border-slate-800 sm:col-span-2">
            <input
              type="checkbox"
              checked={receiptCheckOnly}
              onChange={(event) => setReceiptCheckOnly(event.target.checked)}
              className="mt-1 h-5 w-5 shrink-0 accent-brand-600"
            />
            <span className="min-w-0">
              <span className="block text-sm font-bold">입고여부만 확인</span>
              <span className="mt-1 block text-xs font-semibold text-slate-500 dark:text-slate-400">
                재고 수량을 관리하지 않고 입고완료 기록만 홈과 작업 로그에 남깁니다.
              </span>
            </span>
          </label>
        </div>

        {error ? <div className="mt-4"><StatusMessage type="error">{error}</StatusMessage></div> : null}
        {message ? <div className="mt-4"><StatusMessage type="success">{message}</StatusMessage></div> : null}

        <div className="mt-5 grid grid-cols-2 gap-3">
          <button type="button" onClick={() => navigate(getExitRoute())} className="secondary-button">
            취소
          </button>
          <button type="submit" disabled={saving || !name.trim()} className="primary-button">
            {saving ? "저장 중..." : "저장"}
          </button>
        </div>
      </form>

      <div className="panel mt-4 w-full max-w-2xl p-4">
        <h2 className="text-base font-bold">상품 병합</h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">중복 상품을 현재 상품으로 합치고, 선택한 상품은 비활성화합니다.</p>

        <label className="mt-3 block">
          <span className="mb-1 block text-sm font-semibold">병합할 품목 검색</span>
          <input
            className="field"
            value={mergeSearch}
            onChange={(event) => setMergeSearch(event.target.value)}
            placeholder="상품명 또는 바코드"
          />
        </label>

        {mergeCandidates.length > 0 ? (
          <div className="mt-3 space-y-2">
            {mergeCandidates.map((candidate) => (
              <button
                key={candidate.id}
                type="button"
                disabled={merging}
                onClick={() => void mergeProduct(candidate)}
                className="w-full rounded-md border border-slate-200 bg-white p-3 text-left text-sm disabled:opacity-45 dark:border-slate-800 dark:bg-slate-900"
              >
                <span className="block font-bold">{candidate.name}</span>
                <span className="text-xs text-slate-500 dark:text-slate-400">{candidate.barcode ?? "바코드 없음"}</span>
              </button>
            ))}
          </div>
        ) : mergeSearch.trim() ? (
          <p className="mt-3 text-sm font-semibold text-slate-500 dark:text-slate-400">병합할 품목이 없습니다.</p>
        ) : null}
      </div>

      <div className="mt-4 w-full max-w-2xl">
        <button
          type="button"
          disabled={deleting}
          onClick={() => void deleteProduct()}
          className="touch-button w-full rounded-md bg-red-600 px-4 font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500 dark:disabled:bg-slate-800"
        >
          {deleting ? "삭제 중..." : "품목 삭제"}
        </button>
      </div>
    </section>
  );
}
