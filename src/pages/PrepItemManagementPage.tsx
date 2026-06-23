import { FormEvent, useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2, X } from "lucide-react";
import { PageTitle } from "../components/PageTitle";
import { StatusMessage } from "../components/StatusMessage";
import { supabase } from "../lib/supabase";
import type { Inventory, PrepItem, PrepItemIngredient, Product } from "../types/domain";
import type { Json } from "../types/supabase";

type PrepItemWithDetails = PrepItem & {
  ingredients: PrepItemIngredient[];
  stock: number;
};

type IngredientDraft = {
  productId: string;
  quantity: string;
  search: string;
};

const emptyIngredientDraft: IngredientDraft = {
  productId: "",
  quantity: "",
  search: ""
};

function formatQuantity(value: number) {
  return Number(value).toLocaleString("ko-KR", { maximumFractionDigits: 2 });
}

function buildSchemaError(message: string) {
  if (
    message.includes("prep_items")
    || message.includes("prep_item_ingredients")
    || message.includes("prep_batches")
    || message.includes("schema cache")
  ) {
    return `프랩품목 기능용 데이터베이스 업데이트가 필요합니다. (${message})`;
  }
  return message;
}

export function PrepItemManagementPage() {
  const [prepItems, setPrepItems] = useState<PrepItemWithDetails[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [shelfLifeDays, setShelfLifeDays] = useState("3");
  const [sortOrder, setSortOrder] = useState("");
  const [ingredientDrafts, setIngredientDrafts] = useState<IngredientDraft[]>([{ ...emptyIngredientDraft }]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const productsById = useMemo(() => new Map(products.map((product) => [product.id, product])), [products]);
  const editingItem = useMemo(() => prepItems.find((item) => item.id === editingId) ?? null, [editingId, prepItems]);

  useEffect(() => {
    void refresh();
  }, []);

  async function refresh() {
    setLoading(true);
    setError("");

    const prepResult = await supabase.from("prep_items").select("*").order("sort_order", { ascending: true }).order("name", { ascending: true });
    const productResult = await supabase.from("products").select("*").eq("is_active", true).order("name", { ascending: true });

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
        ? supabase.from("prep_item_ingredients").select("*").in("prep_item_id", prepItemIds).order("sort_order", { ascending: true })
        : Promise.resolve({ data: [], error: null }),
      prepProductIds.length > 0
        ? supabase.from("inventory").select("*").in("product_id", prepProductIds)
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
        ? item.ingredients.map((ingredient) => ({
            productId: ingredient.ingredient_product_id,
            quantity: String(ingredient.quantity_per_unit),
            search: productsById.get(ingredient.ingredient_product_id)?.name ?? ""
          }))
        : [{ ...emptyIngredientDraft }]
    );
    setError("");
    setMessage("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function updateIngredientDraft(index: number, patch: Partial<IngredientDraft>) {
    setIngredientDrafts((current) => current.map((draft, draftIndex) => (draftIndex === index ? { ...draft, ...patch } : draft)));
  }

  function removeIngredientDraft(index: number) {
    setIngredientDrafts((current) => (current.length === 1 ? [{ ...emptyIngredientDraft }] : current.filter((_, draftIndex) => draftIndex !== index)));
  }

  async function savePrepItem(event: FormEvent) {
    event.preventDefault();
    const nextName = name.trim();
    const nextShelfLifeDays = Number(shelfLifeDays);
    const nextSortOrder = Number(sortOrder || prepItems.length + 1);
    const ingredients = ingredientDrafts
      .map((draft, index) => ({
        product_id: draft.productId,
        quantity_per_unit: Number(draft.quantity),
        sort_order: index + 1
      }))
      .filter((ingredient) => ingredient.product_id);

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
    if (ingredients.some((ingredient) => !Number.isFinite(ingredient.quantity_per_unit) || ingredient.quantity_per_unit <= 0)) {
      setError("재료 사용량은 0보다 커야 합니다.");
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");
    const { error: saveError } = await supabase.rpc("save_prep_item", {
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
    const { error: updateError } = await supabase.from("prep_items").update({ is_active: isActive }).eq("id", item.id);
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

    const { error: reorderError } = await supabase.rpc("reorder_prep_items", {
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
            <input className="field" value={name} onChange={(event) => setName(event.target.value)} placeholder="불고기패티" required />
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
            <button
              type="button"
              onClick={() => setIngredientDrafts((current) => [...current, { ...emptyIngredientDraft }])}
              className="touch-button inline-flex items-center gap-2 rounded-md border border-slate-300 px-3 text-sm font-bold dark:border-slate-700"
            >
              <Plus size={18} />
              재료 추가
            </button>
          </div>

          <div className="space-y-2">
            {ingredientDrafts.map((draft, index) => {
              const selectedProduct = productsById.get(draft.productId);
              const ingredientKeyword = draft.search.trim().toLocaleLowerCase("ko");
              const ingredientCandidates = products
                .filter((product) => {
                  if (!ingredientKeyword) return true;
                  return product.name.toLocaleLowerCase("ko").includes(ingredientKeyword) || (product.barcode ?? "").toLocaleLowerCase("ko").includes(ingredientKeyword);
                })
                .slice(0, 8);

              return (
                <div key={index} className="grid gap-2 rounded-md border border-slate-200 p-2 dark:border-slate-800 md:grid-cols-[1fr_10rem_auto]">
                  <div className="block min-w-0">
                    <span className="mb-1 block text-xs font-bold text-slate-500 dark:text-slate-400">재료</span>
                    <input
                      className="field min-h-11 py-2"
                      value={draft.search}
                      onChange={(event) => updateIngredientDraft(index, { search: event.target.value, productId: "" })}
                      placeholder="재료명 또는 바코드 검색"
                    />
                    {selectedProduct ? (
                      <div className="mt-1 flex min-h-8 items-center justify-between gap-2 rounded-md bg-brand-50 px-2 py-1 text-xs font-bold text-brand-700 dark:bg-brand-950 dark:text-brand-100">
                        <span className="min-w-0 truncate">
                          선택됨: {selectedProduct.name}
                          {selectedProduct.unit_name ? ` (${selectedProduct.unit_name})` : ""}
                        </span>
                        <button
                          type="button"
                          onClick={() => updateIngredientDraft(index, { productId: "", search: "" })}
                          className="shrink-0 rounded border border-brand-200 px-2 py-0.5 dark:border-brand-800"
                        >
                          해제
                        </button>
                      </div>
                    ) : draft.search.trim() ? (
                      <div className="mt-1 max-h-44 overflow-y-auto rounded-md border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950">
                        {ingredientCandidates.length > 0 ? (
                          ingredientCandidates.map((product) => (
                            <button
                              key={product.id}
                              type="button"
                              onClick={() => updateIngredientDraft(index, { productId: product.id, search: product.name })}
                              className="flex min-h-10 w-full items-center justify-between gap-2 border-b border-slate-100 px-2 text-left text-sm last:border-0 hover:bg-brand-50 dark:border-slate-800 dark:hover:bg-brand-950"
                            >
                              <span className="min-w-0 truncate font-bold">{product.name}</span>
                              <span className="shrink-0 text-xs font-semibold text-slate-500 dark:text-slate-400">{product.unit_name ?? ""}</span>
                            </button>
                          ))
                        ) : (
                          <div className="px-2 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400">검색 결과가 없습니다.</div>
                        )}
                      </div>
                    ) : null}
                  </div>
                  <label className="block min-w-0">
                    <span className="mb-1 block text-xs font-bold text-slate-500 dark:text-slate-400">1개당 사용량</span>
                    <div className="grid grid-cols-[1fr_auto] items-center gap-2">
                      <input
                        className="field min-h-11 py-2"
                        type="number"
                        min={0}
                        step="0.01"
                        value={draft.quantity}
                        onChange={(event) => updateIngredientDraft(index, { quantity: event.target.value })}
                      />
                      <span className="min-w-8 text-xs font-bold text-slate-500 dark:text-slate-400">{selectedProduct?.unit_name ?? ""}</span>
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
                    현재 {formatQuantity(item.stock)}개 · 유통기한 {item.shelf_life_days}일 · 순서 {index + 1}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {item.ingredients.map((ingredient) => {
                      const product = productsById.get(ingredient.ingredient_product_id);
                      return (
                        <span key={ingredient.id} className="rounded-md bg-slate-100 px-2 py-1 text-xs font-bold dark:bg-slate-900">
                          {product?.name ?? "삭제된 재료"} {formatQuantity(ingredient.quantity_per_unit)}
                          {product?.unit_name ?? ""}
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
