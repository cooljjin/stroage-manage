import { FormEvent, useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2, X } from "lucide-react";
import { PageTitle } from "../components/PageTitle";
import { StatusMessage } from "../components/StatusMessage";
import { formatInventoryQuantity } from "../lib/inventory";
import * as Services from "../services";
import type { AppRoute, Inventory, PrepItem, PrepItemIngredient, PrepItemRouteDraft, Product } from "../types/domain";
import type { Json } from "../types/supabase";

type PrepItemWithDetails = PrepItem & {
  ingredients: PrepItemIngredient[];
  stock: number;
};

type IngredientDraft = {
  productId: string;
  customName: string;
  quantity: string;
  quantityUnit: PrepUsageUnit;
  search: string;
};

type PrepUsageUnit = "g" | "kg" | "ml" | "L" | "개";

const emptyIngredientDraft: IngredientDraft = {
  productId: "",
  customName: "",
  quantity: "",
  quantityUnit: "g",
  search: ""
};

const weightUsageUnits: PrepUsageUnit[] = ["g", "kg", "개"];
const volumeUsageUnits: PrepUsageUnit[] = ["ml", "L", "개"];
const prepUsageUnits: PrepUsageUnit[] = [...weightUsageUnits, "ml", "L"];

function isVolumeUnit(unit: string | null | undefined): boolean {
  return unit === "ml" || unit === "L";
}

function getEffectiveProductUnit(product: Product | null | undefined): string | null {
  if (!product?.unit_weight_enabled || product.unit_weight === null || product.unit_weight === undefined) return null;
  const usesProcessedWeight = product.processing_required && product.processed_unit_weight !== null && product.processed_unit_weight !== undefined;
  return usesProcessedWeight ? product.processed_unit_weight_unit : product.unit_weight_unit;
}

function getProductUnitBaseAmount(product: Product | null | undefined): number | null {
  if (!product?.unit_weight_enabled || product.unit_weight === null || product.unit_weight === undefined) return null;
  const usesProcessedWeight = product.processing_required && product.processed_unit_weight !== null && product.processed_unit_weight !== undefined;
  const unitAmount = Number(usesProcessedWeight ? product.processed_unit_weight : product.unit_weight);
  if (!Number.isFinite(unitAmount) || unitAmount <= 0) return null;
  const unit = usesProcessedWeight ? product.processed_unit_weight_unit : product.unit_weight_unit;
  return unit === "kg" || unit === "L" ? unitAmount * 1000 : unitAmount;
}

function formatAmountQuantity(value: number): string {
  if (!Number.isFinite(value)) return "";
  return value.toLocaleString("ko-KR", {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 1,
    maximumFractionDigits: 2
  });
}

function formatAmountInput(value: number): string {
  if (!Number.isFinite(value)) return "";
  const roundedValue = Math.round(value * 1000) / 1000;
  return Number.isInteger(roundedValue) ? String(roundedValue) : String(roundedValue).replace(/\.?0+$/, "");
}

function convertUsageToRecipeQuantity(quantity: string, unit: PrepUsageUnit, unitBaseAmount: number): number {
  const numericQuantity = Number(quantity);
  if (!Number.isFinite(numericQuantity)) return Number.NaN;
  if (unit === "개") return numericQuantity;
  const usageBaseAmount = unit === "kg" || unit === "L" ? numericQuantity * 1000 : numericQuantity;
  return usageBaseAmount / unitBaseAmount;
}

function formatQuantityForUnit(valueInEach: number, nextUnit: PrepUsageUnit, unitBaseAmount: number | null): string {
  if (!Number.isFinite(valueInEach)) return "";
  if (nextUnit === "개") return formatAmountInput(valueInEach);
  if (!unitBaseAmount) return "";
  const baseAmount = valueInEach * unitBaseAmount;
  return formatAmountInput(nextUnit === "kg" || nextUnit === "L" ? baseAmount / 1000 : baseAmount);
}

function normalizeUsageUnit(unit: string | null | undefined): PrepUsageUnit | null {
  return prepUsageUnits.includes(unit as PrepUsageUnit) ? (unit as PrepUsageUnit) : null;
}

function getUsagePlaceholder(unit: PrepUsageUnit): string {
  if (unit === "kg" || unit === "L") return "예: 0.5";
  if (unit === "개") return "예: 1";
  return "예: 500";
}

function availableUsageUnits(product: Product | null | undefined): PrepUsageUnit[] {
  const unit = getEffectiveProductUnit(product);
  if (!unit || !getProductUnitBaseAmount(product)) return prepUsageUnits;
  return isVolumeUnit(unit) ? volumeUsageUnits : weightUsageUnits;
}

function keepCurrentUnitAvailable(units: PrepUsageUnit[], currentUnit: PrepUsageUnit): PrepUsageUnit[] {
  return units.includes(currentUnit) ? units : [...units, currentUnit];
}

function formatProductUnitWeight(product: Product): string {
  if (!product.unit_weight_enabled || product.unit_weight === null || product.unit_weight === undefined) return "단위당 무게 미설정";
  const unit = getEffectiveProductUnit(product);
  const label = isVolumeUnit(unit) ? "부피" : "무게";
  if (product.processing_required && product.processed_unit_weight !== null && product.processed_unit_weight !== undefined) {
    return `손질 후 단위당 ${label} ${formatAmountQuantity(Number(product.processed_unit_weight))}${product.processed_unit_weight_unit ?? "g"}`;
  }
  return `단위당 ${label} ${formatAmountQuantity(Number(product.unit_weight))}${product.unit_weight_unit ?? "g"}`;
}

function formatIngredientUsage(ingredient: PrepItemIngredient, product: Product | undefined): string {
  const unitBaseAmount = getProductUnitBaseAmount(product);
  const unit = getEffectiveProductUnit(product);
  if (!unitBaseAmount || !unit) {
    return `${formatInventoryQuantity(ingredient.quantity_per_unit)}${ingredient.ingredient_unit ?? product?.unit_name ?? ""}`;
  }
  const savedUnit = normalizeUsageUnit(ingredient.ingredient_unit);
  if (savedUnit) {
    return `${formatAmountQuantity(Number(formatQuantityForUnit(ingredient.quantity_per_unit, savedUnit, unitBaseAmount)))}${savedUnit}`;
  }
  const baseUnit = isVolumeUnit(unit) ? "ml" : "g";
  return `${formatAmountQuantity(ingredient.quantity_per_unit * unitBaseAmount)}${baseUnit}`;
}

function buildSchemaError(message: string) {
  if (
    message.includes("prep_items")
    || message.includes("prep_item_ingredients")
    || message.includes("prep_batches")
    || message.includes("delete_prep_item")
    || message.includes("schema cache")
  ) {
    return `프랩품목 기능용 데이터베이스 업데이트가 필요합니다. (${message})`;
  }
  return message;
}

type Props = {
  navigate: (route: AppRoute) => void;
  restoreDraft?: PrepItemRouteDraft;
};

export function PrepItemManagementPage({ navigate, restoreDraft }: Props) {
  const [prepItems, setPrepItems] = useState<PrepItemWithDetails[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [shelfLifeDays, setShelfLifeDays] = useState("3");
  const [sortOrder, setSortOrder] = useState("");
  const [ingredientDrafts, setIngredientDrafts] = useState<IngredientDraft[]>([{ ...emptyIngredientDraft }]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const productsById = useMemo(() => new Map(products.map((product) => [product.id, product])), [products]);
  const editingItem = useMemo(() => prepItems.find((item) => item.id === editingId) ?? null, [editingId, prepItems]);

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    if (!restoreDraft) return;
    setEditingId(restoreDraft.editingId);
    setName(restoreDraft.name);
    setShelfLifeDays(restoreDraft.shelfLifeDays);
    setSortOrder(restoreDraft.sortOrder);
    setIngredientDrafts(
      restoreDraft.ingredientDrafts.length > 0
        ? restoreDraft.ingredientDrafts.map((draft) => ({ ...draft, customName: draft.customName ?? "", quantityUnit: draft.quantityUnit ?? "g" }))
        : [{ ...emptyIngredientDraft }]
    );
    setError("");
    setMessage("");
  }, [restoreDraft]);

  async function refresh() {
    setLoading(true);
    setError("");

    const prepResult = await Services.DatabaseService.select("prep_items", "*").order("sort_order", { ascending: true }).order("name", { ascending: true });
    const productResult = await Services.DatabaseService.select("products", "*").eq("is_active", true).order("name", { ascending: true });

    if (prepResult.error || productResult.error) {
      setError(buildSchemaError(prepResult.error?.message ?? productResult.error?.message ?? "프랩 품목을 불러오지 못했습니다."));
      setLoading(false);
      return;
    }

    const nextPrepItems = (prepResult.data ?? []) as PrepItem[];
    const prepItemIds = nextPrepItems.map((item) => item.id);
    const prepProductIds = nextPrepItems.map((item) => item.product_id);
    const [ingredientResult, inventoryResult] = await Promise.all([
      prepItemIds.length > 0
        ? Services.DatabaseService.select("prep_item_ingredients", "*").in("prep_item_id", prepItemIds).order("sort_order", { ascending: true })
        : Promise.resolve({ data: [], error: null }),
      prepProductIds.length > 0
        ? Services.DatabaseService.select("inventory", "*").in("product_id", prepProductIds)
        : Promise.resolve({ data: [], error: null })
    ]);

    if (ingredientResult.error || inventoryResult.error) {
      setError(buildSchemaError(ingredientResult.error?.message ?? inventoryResult.error?.message ?? "프랩 품목을 불러오지 못했습니다."));
      setLoading(false);
      return;
    }

    const ingredients = (ingredientResult.data ?? []) as PrepItemIngredient[];
    const inventoryByProductId = new Map(((inventoryResult.data ?? []) as Inventory[]).map((inventory) => [inventory.product_id, inventory]));

    setProducts((productResult.data ?? []) as Product[]);
    setPrepItems(
      nextPrepItems.map((item) => ({
        ...item,
        ingredients: ingredients.filter((ingredient) => ingredient.prep_item_id === item.id),
        stock: inventoryByProductId.get(item.product_id)?.store_qty ?? 0
      }))
    );
    setLoading(false);
  }

  function resetForm() {
    setEditingId(null);
    setName("");
    setShelfLifeDays("3");
    setSortOrder(String((prepItems[prepItems.length - 1]?.sort_order ?? 0) + 1));
    setIngredientDrafts([{ ...emptyIngredientDraft }]);
    setError("");
    setMessage("");
  }

  function startEdit(item: PrepItemWithDetails) {
    setEditingId(item.id);
    setName(item.name);
    setShelfLifeDays(String(item.shelf_life_days));
    setSortOrder(String(item.sort_order));
    setIngredientDrafts(
      item.ingredients.length > 0
        ? item.ingredients.map((ingredient) => {
            const product = ingredient.ingredient_product_id ? productsById.get(ingredient.ingredient_product_id) : undefined;
            const unitBaseAmount = getProductUnitBaseAmount(product);
            const unit = getEffectiveProductUnit(product);
            const savedQuantityUnit = normalizeUsageUnit(ingredient.ingredient_unit);
            const nextQuantityUnit: PrepUsageUnit = savedQuantityUnit ?? (unitBaseAmount ? (isVolumeUnit(unit) ? "ml" : "g") : "개");
            return {
              productId: ingredient.ingredient_product_id ?? "",
              customName: ingredient.ingredient_product_id ? "" : ingredient.ingredient_name ?? "",
              quantity: unitBaseAmount ? formatQuantityForUnit(ingredient.quantity_per_unit, nextQuantityUnit, unitBaseAmount) : formatAmountInput(ingredient.quantity_per_unit),
              quantityUnit: nextQuantityUnit,
              search: product?.name ?? ingredient.ingredient_name ?? ""
            };
          })
        : [{ ...emptyIngredientDraft }]
    );
    setError("");
    setMessage("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function updateIngredientDraft(index: number, patch: Partial<IngredientDraft>) {
    setIngredientDrafts((current) => current.map((draft, draftIndex) => (draftIndex === index ? { ...draft, ...patch } : draft)));
  }

  function selectIngredientProduct(index: number, product: Product) {
    updateIngredientDraft(index, {
      productId: product.id,
      customName: "",
      search: product.name,
      quantityUnit: ingredientDrafts[index]?.quantityUnit ?? availableUsageUnits(product)[0]
    });
  }

  function selectCustomIngredient(index: number, name: string) {
    updateIngredientDraft(index, {
      productId: "",
      customName: name.trim(),
      search: name.trim(),
      quantityUnit: ingredientDrafts[index]?.quantityUnit ?? "개"
    });
  }

  function updateIngredientQuantityInput(index: number, value: string) {
    const nextValue = value.replace(",", ".");
    if (/^\d*\.?\d{0,3}$/.test(nextValue)) {
      updateIngredientDraft(index, { quantity: nextValue });
    }
  }

  function updateIngredientQuantityUnit(index: number, nextUnit: PrepUsageUnit) {
    updateIngredientDraft(index, { quantityUnit: nextUnit });
  }

  function removeIngredientDraft(index: number) {
    setIngredientDrafts((current) => (current.length === 1 ? [{ ...emptyIngredientDraft }] : current.filter((_, draftIndex) => draftIndex !== index)));
  }

  function buildCurrentDraft(): PrepItemRouteDraft {
    return {
      editingId,
      name,
      shelfLifeDays,
      sortOrder,
      ingredientDrafts: ingredientDrafts.map((draft) => ({ ...draft }))
    };
  }

  async function savePrepItem(event: FormEvent) {
    event.preventDefault();
    const nextName = name.trim();
    const nextShelfLifeDays = Number(shelfLifeDays);
    const nextSortOrder = Number(sortOrder || prepItems.length + 1);
    const ingredients: { product_id: string | null; ingredient_name: string | null; ingredient_unit: PrepUsageUnit | null; quantity_per_unit: number; sort_order: number }[] = [];

    for (const [index, draft] of ingredientDrafts.entries()) {
      const customName = draft.customName.trim() || (!draft.productId ? draft.search.trim() : "");
      if (!draft.productId && !customName) continue;
      const product = productsById.get(draft.productId);
      const unitBaseAmount = getProductUnitBaseAmount(product);
      const recipeQuantity = draft.productId && unitBaseAmount ? convertUsageToRecipeQuantity(draft.quantity, draft.quantityUnit, unitBaseAmount) : Number(draft.quantity);

      if (!Number.isFinite(recipeQuantity) || recipeQuantity <= 0) {
        setError("재료 사용량은 0보다 큰 숫자로 입력해 주세요.");
        return;
      }
      ingredients.push({
        product_id: draft.productId || null,
        ingredient_name: draft.productId ? null : customName,
        ingredient_unit: draft.quantityUnit,
        quantity_per_unit: Number(recipeQuantity.toFixed(6)),
        sort_order: index + 1
      });
    }

    if (!nextName) {
      setError("프랩 품목명은 비워둘 수 없습니다.");
      return;
    }
    if (!Number.isInteger(nextShelfLifeDays) || nextShelfLifeDays < 1) {
      setError("유통기한은 1일 이상 정수로 입력해 주세요.");
      return;
    }
    if (!Number.isFinite(nextSortOrder) || nextSortOrder < 1) {
      setError("표시 순서는 1 이상 숫자로 입력해 주세요.");
      return;
    }
    if (ingredients.length === 0) {
      setError("사용 재료를 1개 이상 등록해 주세요.");
      return;
    }
    setSaving(true);
    setError("");
    setMessage("");
    const { data: savedItem, error: saveError } = await Services.DatabaseService.rpc("save_prep_item", {
      target_prep_item_id: editingId,
      item_name: nextName,
      item_shelf_life_days: nextShelfLifeDays,
      item_sort_order: nextSortOrder,
      ingredient_rows: ingredients as Json,
      item_is_active: editingItem?.is_active ?? true
    });

    if (saveError) {
      setError(buildSchemaError(saveError.message));
    } else {
      const savedPrepItemId = ((savedItem as PrepItem | null)?.id ?? editingId) || null;
      if (savedPrepItemId) {
        const unitUpdateErrors = await Promise.all(
          ingredients.map((ingredient) =>
            Services.DatabaseService.update("prep_item_ingredients", { ingredient_unit: ingredient.ingredient_unit })
              .eq("prep_item_id", savedPrepItemId)
              .eq("sort_order", ingredient.sort_order)
          )
        );
        const firstUnitUpdateError = unitUpdateErrors.find((result) => result.error)?.error;
        if (firstUnitUpdateError) {
          setError(buildSchemaError(firstUnitUpdateError.message));
          setSaving(false);
          return;
        }
      }
      const successMessage = editingId ? "프랩 품목을 수정했습니다." : "프랩 품목을 추가했습니다.";
      resetForm();
      await refresh();
      setMessage(successMessage);
    }
    setSaving(false);
  }

  async function setPrepItemActive(item: PrepItemWithDetails, isActive: boolean) {
    setError("");
    setMessage("");
    const { error: updateError } = await Services.DatabaseService.update("prep_items", { is_active: isActive }).eq("id", item.id);
    if (updateError) {
      setError(buildSchemaError(updateError.message));
    } else {
      setMessage(isActive ? "프랩 품목을 활성화했습니다." : "프랩 품목을 비활성화했습니다.");
      await refresh();
    }
  }

  async function movePrepItem(index: number, direction: "up" | "down") {
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    const current = prepItems[index];
    const target = prepItems[targetIndex];
    if (!current || !target) return;

    const nextItems = [...prepItems];
    nextItems[index] = target;
    nextItems[targetIndex] = current;
    setPrepItems(nextItems);
    setError("");
    setMessage("");

    const { error: reorderError } = await Services.DatabaseService.rpc("reorder_prep_items", {
      ordered_prep_item_ids: nextItems.map((item) => item.id)
    });

    if (reorderError) {
      setError(buildSchemaError(reorderError.message));
      await refresh();
    } else {
      setMessage("프랩 품목 순서를 저장했습니다.");
      await refresh();
    }
  }

  async function deletePrepItem(item: PrepItemWithDetails) {
    setError("");
    setMessage("");

    if (!window.confirm(`${item.name} 프랩 품목을 삭제할까요?\n현재 재고가 남아 있으면 삭제할 수 없습니다.`)) {
      return;
    }

    setDeletingIds((current) => new Set(current).add(item.id));
    const { error: deleteError } = await Services.DatabaseService.rpc("delete_prep_item", {
      target_prep_item_id: item.id
    });

    if (deleteError) {
      setError(buildSchemaError(deleteError.message));
    } else {
      if (editingId === item.id) {
        resetForm();
      }
      setMessage("프랩 품목을 삭제했습니다.");
      await refresh();
    }

    setDeletingIds((current) => {
      const next = new Set(current);
      next.delete(item.id);
      return next;
    });
  }

  return (
    <section className="min-w-0">
      <PageTitle
        title="프랩품목 관리"
        description="반제품 레시피와 표시 순서를 관리합니다."
        action={
          editingId ? (
            <button type="button" onClick={resetForm} className="secondary-button inline-flex items-center gap-2 px-3">
              <X size={18} />
              새로 등록
            </button>
          ) : undefined
        }
      />

      <form onSubmit={savePrepItem} className="panel mb-4 w-full overflow-hidden p-4">
        <div className="grid gap-4 md:grid-cols-[1.2fr_0.8fr_0.8fr]">
          <label className="block min-w-0">
            <span className="mb-1 block text-sm font-semibold">프랩 품목명</span>
            <input className="field" value={name} onChange={(event) => setName(event.target.value)} placeholder="품목명" required />
          </label>
          <label className="block min-w-0">
            <span className="mb-1 block text-sm font-semibold">유통기한</span>
            <input className="field" type="number" min={1} step={1} value={shelfLifeDays} onChange={(event) => setShelfLifeDays(event.target.value)} />
          </label>
          <label className="block min-w-0">
            <span className="mb-1 block text-sm font-semibold">표시 순서</span>
            <input className="field" type="number" min={1} step={1} value={sortOrder} onChange={(event) => setSortOrder(event.target.value)} placeholder="자동" />
          </label>
        </div>

        <div className="mt-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="text-sm font-extrabold">사용 재료</h2>
          </div>

          <div className="space-y-2">
            {ingredientDrafts.map((draft, index) => {
              const selectedProduct = productsById.get(draft.productId);
              const selectedCustomName = draft.customName.trim();
              const selectedProductUnitBaseAmount = getProductUnitBaseAmount(selectedProduct);
              const selectableUnits = keepCurrentUnitAvailable(selectedProduct ? availableUsageUnits(selectedProduct) : prepUsageUnits, draft.quantityUnit);
              const ingredientKeyword = draft.search.trim().toLocaleLowerCase("ko");
              const ingredientCandidates = products
                .filter((product) => {
                  if (!ingredientKeyword) return true;
                  return product.name.toLocaleLowerCase("ko").includes(ingredientKeyword) || (product.barcode ?? "").toLocaleLowerCase("ko").includes(ingredientKeyword);
                })
                .slice(0, 8);

              return (
                <div key={index} className="grid gap-2 rounded-md border border-slate-200 p-2 dark:border-slate-800 md:grid-cols-[1fr_14rem_auto]">
                  <div className="block min-w-0">
                    <span className="mb-1 block text-xs font-bold text-slate-500 dark:text-slate-400">재료</span>
                    <input
                      className="field min-h-11 py-2"
                      value={draft.search}
                      onChange={(event) => updateIngredientDraft(index, { search: event.target.value, productId: "", customName: "" })}
                      placeholder="재료명 또는 바코드 검색"
                    />
                    {selectedProduct ? (
                      <div className="mt-1 flex min-h-8 items-center justify-between gap-2 rounded-md bg-brand-50 px-2 py-1 text-xs font-bold text-brand-700 dark:bg-brand-950 dark:text-brand-100">
                        <span className="min-w-0 truncate">
                          선택됨: {selectedProduct.name}
                          {selectedProduct.unit_name ? ` (${selectedProduct.unit_name})` : ""}
                        </span>
                        <span className={`shrink-0 rounded px-1.5 py-0.5 ${selectedProductUnitBaseAmount ? "bg-white/80 dark:bg-slate-900" : "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-100"}`}>
                          {formatProductUnitWeight(selectedProduct)}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            if (selectedProductUnitBaseAmount) {
                              updateIngredientDraft(index, { productId: "", search: "" });
                              return;
                            }
                            navigate({
                              name: "product-edit",
                              productId: selectedProduct.id,
                              returnTo: "prep-items",
                              prepDraft: buildCurrentDraft()
                            });
                          }}
                          className="shrink-0 rounded border border-brand-200 px-2 py-0.5 dark:border-brand-800"
                        >
                          {selectedProductUnitBaseAmount ? "해제" : "품목 관리"}
                        </button>
                      </div>
                    ) : selectedCustomName ? (
                      <div className="mt-1 flex min-h-8 items-center justify-between gap-2 rounded-md bg-slate-100 px-2 py-1 text-xs font-bold text-slate-700 dark:bg-slate-900 dark:text-slate-100">
                        <span className="min-w-0 truncate">임의 재료: {selectedCustomName}</span>
                        <span className="shrink-0 rounded bg-white/80 px-1.5 py-0.5 dark:bg-slate-950">재고 미연동</span>
                        <button
                          type="button"
                          onClick={() => updateIngredientDraft(index, { customName: "", search: "" })}
                          className="shrink-0 rounded border border-slate-300 px-2 py-0.5 dark:border-slate-700"
                        >
                          해제
                        </button>
                      </div>
                    ) : draft.search.trim() ? (
                      <div className="mt-1 max-h-44 overflow-y-auto rounded-md border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950">
                        {ingredientCandidates.length > 0 ? (
                          <>
                            {ingredientCandidates.map((product) => (
                              <button
                                key={product.id}
                                type="button"
                                onClick={() => selectIngredientProduct(index, product)}
                                className="flex min-h-10 w-full items-center justify-between gap-2 border-b border-slate-100 px-2 text-left text-sm last:border-0 hover:bg-brand-50 dark:border-slate-800 dark:hover:bg-brand-950"
                              >
                                <span className="min-w-0 truncate font-bold">{product.name}</span>
                                <span className="shrink-0 text-xs font-semibold text-slate-500 dark:text-slate-400">
                                  {formatProductUnitWeight(product)}
                                </span>
                              </button>
                            ))}
                            <button
                              type="button"
                              onClick={() => selectCustomIngredient(index, draft.search)}
                              className="flex min-h-10 w-full items-center justify-between gap-2 px-2 text-left text-sm font-bold text-brand-700 hover:bg-brand-50 dark:text-brand-100 dark:hover:bg-brand-950"
                            >
                              <span className="min-w-0 truncate">"{draft.search.trim()}" 임의 재료로 등록</span>
                              <span className="shrink-0 text-xs">임의 등록</span>
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            onClick={() => selectCustomIngredient(index, draft.search)}
                            className="flex min-h-10 w-full items-center justify-between gap-2 px-2 text-left text-sm font-bold text-brand-700 hover:bg-brand-50 dark:text-brand-100 dark:hover:bg-brand-950"
                          >
                            <span className="min-w-0 truncate">"{draft.search.trim()}" 임의 재료로 등록</span>
                            <span className="shrink-0 text-xs">임의 등록</span>
                          </button>
                        )}
                      </div>
                    ) : null}
                  </div>
                  <label className="block min-w-0">
                    <span className="mb-1 block text-xs font-bold text-slate-500 dark:text-slate-400">1개당 사용량</span>
                    <div className="grid grid-cols-[minmax(0,1fr)_5rem] items-center gap-2">
                      <input
                        className="field min-h-11 py-2"
                        type="text"
                        inputMode="decimal"
                        pattern="[0-9]*[.]?[0-9]{0,3}"
                        value={draft.quantity}
                        onChange={(event) => updateIngredientQuantityInput(index, event.target.value)}
                        placeholder={getUsagePlaceholder(draft.quantityUnit)}
                      />
                      <select
                        className="field min-h-11 py-2 text-sm font-bold"
                        value={draft.quantityUnit}
                        onChange={(event) => updateIngredientQuantityUnit(index, event.target.value as PrepUsageUnit)}
                        aria-label="1개당 사용량 단위"
                      >
                        {selectableUnits.map((unit) => (
                          <option key={unit} value={unit}>
                            {unit}
                          </option>
                        ))}
                      </select>
                    </div>
                  </label>
                  <button
                    type="button"
                    onClick={() => removeIngredientDraft(index)}
                    className="touch-button icon-button self-end text-rose-600 dark:text-rose-300"
                    aria-label="재료 삭제"
                    title="삭제"
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {error ? <div className="mt-4"><StatusMessage type="error">{error}</StatusMessage></div> : null}
        {message ? <div className="mt-4"><StatusMessage type="success">{message}</StatusMessage></div> : null}

        <button
          type="button"
          onClick={() => setIngredientDrafts((current) => [...current, { ...emptyIngredientDraft }])}
          className="secondary-button mt-5 inline-flex w-full items-center justify-center gap-2"
        >
          <Plus size={18} />
          재료 추가
        </button>

        <button type="submit" disabled={saving || !name.trim()} className="primary-button mt-5 w-full">
          {saving ? "저장 중..." : editingId ? "프랩 품목 수정" : "프랩 품목 등록"}
        </button>
      </form>

      {loading ? <StatusMessage>프랩 품목을 불러오는 중...</StatusMessage> : null}

      {!loading ? (
        <div className="space-y-2">
          {prepItems.map((item, index) => (
            <div key={item.id} className="panel p-3">
              <div className="flex min-w-0 items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="break-words text-lg font-extrabold">{item.name}</p>
                    <span className={`rounded px-2 py-1 text-xs font-bold ${item.is_active ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-100" : "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-200"}`}>
                      {item.is_active ? "활성" : "비활성"}
                    </span>
                  </div>
                  <p className="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">
                    현재 {formatInventoryQuantity(item.stock)}개 · 유통기한 {item.shelf_life_days}일 · 순서 {index + 1}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {item.ingredients.map((ingredient) => {
                      const product = ingredient.ingredient_product_id ? productsById.get(ingredient.ingredient_product_id) : undefined;
                      return (
                        <span key={ingredient.id} className="rounded-md bg-slate-100 px-2 py-1 text-xs font-bold dark:bg-slate-900">
                          {product?.name ?? ingredient.ingredient_name ?? "삭제된 재료"} {formatIngredientUsage(ingredient, product)}
                        </span>
                      );
                    })}
                  </div>
                </div>

                <div className="flex shrink-0 flex-wrap justify-end gap-1">
                  <button
                    type="button"
                    onClick={() => void movePrepItem(index, "up")}
                    disabled={index === 0}
                    className="touch-button icon-button disabled:opacity-35"
                    aria-label="위로 이동"
                    title="위로"
                  >
                    <ArrowUp size={18} />
                  </button>
                  <button
                    type="button"
                    onClick={() => void movePrepItem(index, "down")}
                    disabled={index === prepItems.length - 1}
                    className="touch-button icon-button disabled:opacity-35"
                    aria-label="아래로 이동"
                    title="아래로"
                  >
                    <ArrowDown size={18} />
                  </button>
                  <button type="button" onClick={() => startEdit(item)} className="touch-button icon-button" aria-label="프랩 품목 수정" title="수정">
                    <Pencil size={18} />
                  </button>
                  <button
                    type="button"
                    onClick={() => void setPrepItemActive(item, !item.is_active)}
                    className="touch-button whitespace-nowrap rounded-md border border-slate-300 px-3 text-sm font-bold dark:border-slate-700"
                  >
                    {item.is_active ? "비활성" : "활성"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void deletePrepItem(item)}
                    disabled={deletingIds.has(item.id)}
                    className="touch-button icon-button text-rose-600 disabled:opacity-35 dark:text-rose-300"
                    aria-label="프랩 품목 삭제"
                    title="삭제"
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              </div>
            </div>
          ))}

          {prepItems.length === 0 ? <StatusMessage>등록된 프랩 품목이 없습니다.</StatusMessage> : null}
        </div>
      ) : null}
    </section>
  );
}
