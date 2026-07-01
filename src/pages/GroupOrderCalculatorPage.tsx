import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, PointerEvent } from "react";
import { Calculator, CalendarDays, ChevronLeft, ChevronRight, Clock, Pencil, Plus, Trash2, X } from "lucide-react";
import { PageTitle } from "../components/PageTitle";
import { ProductOrderAction } from "../components/ProductOrderAction";
import { StatusMessage } from "../components/StatusMessage";
import { formatInventoryQuantity, normalizeInventoryItem } from "../lib/inventory";
import { loadSuppliers } from "../lib/suppliers";
import { supabase } from "../lib/supabase";
import type { AppRoute, GroupOrderEvent, GroupOrderEventItem, GroupOrderMenu, GroupOrderRecipeIngredient, GroupOrderRouteDraft, InventoryItem, Product, ProductSupplier, ProfileRole, RecipeUsageUnit, UnitWeightUnit } from "../types/domain";

type Props = {
  mode: "recipes" | "calculator";
  navigate: (route: AppRoute) => void;
  currentStoreId: string;
  currentRole: ProfileRole;
  restoreDraft?: GroupOrderRouteDraft;
};

type GroupOrderMenuWithIngredients = GroupOrderMenu & {
  ingredients: GroupOrderRecipeIngredient[];
};

type IngredientDraft = {
  productId: string;
  quantity: string;
  quantityUnit: RecipeUsageUnit;
  search: string;
};

type OrderDraft = {
  menuId: string;
  menuSearch: string;
  quantity: string;
};

type ResultMode = "order" | "usage";
type MeasureKind = "weight" | "volume";
type CalculatorStep = "calendar" | "orders";

type CalculationResult = {
  product: InventoryItem;
  requiredOrderUnits: number | null;
  orderUnits: number | null;
  requiredUsageBaseAmount: number | null;
  currentUsageBaseAmount: number | null;
  requiredEachAmount: number;
  baseKind: MeasureKind | null;
  missingSetup: boolean;
};

type AggregateResult = {
  product: InventoryItem;
  baseKind: MeasureKind | null;
  baseRequired: number;
  eachRequired: number;
};

type PendingTouchRange = {
  pointerId: number;
  startX: number;
  startY: number;
  dateValue: string;
  grid: HTMLDivElement;
  timerId: number;
  cancelled: boolean;
};

type CalculationBuildResult = {
  results: CalculationResult[];
  errorMessage: string;
};

const recipeUsageUnits: RecipeUsageUnit[] = ["g", "kg", "ml", "L", "개"];
const weightUsageUnits: RecipeUsageUnit[] = ["g", "kg", "개"];
const volumeUsageUnits: RecipeUsageUnit[] = ["ml", "L", "개"];

const emptyIngredientDraft: IngredientDraft = {
  productId: "",
  quantity: "",
  quantityUnit: "g",
  search: ""
};

function isVolumeUnit(unit: string | null | undefined): boolean {
  return unit === "ml" || unit === "L";
}

function isVolumeUsageUnit(unit: RecipeUsageUnit): boolean {
  return unit === "ml" || unit === "L";
}

function getEffectiveProductUnit(product: Product | null | undefined): UnitWeightUnit | null {
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

function availableUsageUnits(product: Product | null | undefined): RecipeUsageUnit[] {
  const unit = getEffectiveProductUnit(product);
  if (!unit || !getProductUnitBaseAmount(product)) return ["개"];
  return isVolumeUnit(unit) ? volumeUsageUnits : weightUsageUnits;
}

function keepCurrentUnitAvailable(units: RecipeUsageUnit[], currentUnit: RecipeUsageUnit): RecipeUsageUnit[] {
  return units.includes(currentUnit) ? units : [...units, currentUnit];
}

function normalizeRecipeUnit(unit: string | null | undefined): RecipeUsageUnit {
  return recipeUsageUnits.includes(unit as RecipeUsageUnit) ? (unit as RecipeUsageUnit) : "개";
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

function parseQuantityInput(value: string): string {
  const nextValue = value.replace(",", ".");
  return /^\d*\.?\d{0,3}$/.test(nextValue) ? nextValue : "";
}

function getUsagePlaceholder(unit: RecipeUsageUnit): string {
  if (unit === "kg" || unit === "L") return "예: 0.5";
  if (unit === "개") return "예: 1";
  return "예: 500";
}

function getProductUnitLabel(product: Product): string {
  return product.unit_name || "개";
}

function formatOrderUnitAmount(value: number, product: Product): string {
  return `${formatInventoryQuantity(value)}${getProductUnitLabel(product)}`;
}

function formatBaseAmount(value: number, kind: MeasureKind): string {
  if (kind === "volume") {
    return Math.abs(value) >= 1000 ? `${formatAmountQuantity(value / 1000)}L` : `${formatAmountQuantity(value)}ml`;
  }
  return Math.abs(value) >= 1000 ? `${formatAmountQuantity(value / 1000)}kg` : `${formatAmountQuantity(value)}g`;
}

function formatProductUnitWeight(product: Product): string {
  if (!product.unit_weight_enabled || product.unit_weight === null || product.unit_weight === undefined) return "발주 단위만 사용";
  const unit = getEffectiveProductUnit(product);
  const label = isVolumeUnit(unit) ? "부피" : "무게";
  if (product.processing_required && product.processed_unit_weight !== null && product.processed_unit_weight !== undefined) {
    return `손질 후 ${formatAmountQuantity(Number(product.processed_unit_weight))}${product.processed_unit_weight_unit ?? "g"}`;
  }
  return `단위당 ${label} ${formatAmountQuantity(Number(product.unit_weight))}${product.unit_weight_unit ?? "g"}`;
}

function toBaseAmount(quantity: number, unit: RecipeUsageUnit): number {
  return unit === "kg" || unit === "L" ? quantity * 1000 : quantity;
}

function buildSchemaError(message: string) {
  if (message.includes("group_order_menus") || message.includes("group_order_recipe_ingredients") || message.includes("group_order_events") || message.includes("group_order_event_items") || message.includes("schema cache")) {
    return `단체주문 계산 기능용 데이터베이스 업데이트가 필요합니다. (${message})`;
  }
  return message;
}

function toDateValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateFromValue(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function addMonths(date: Date, months: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + months, 1);
}

function normalizeDateRange(startDate: string, endDate: string): { start: string; end: string } {
  return startDate <= endDate ? { start: startDate, end: endDate } : { start: endDate, end: startDate };
}

function getMonthStart(value: string): Date {
  const date = dateFromValue(value);
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function formatMonthLabel(date: Date): string {
  return new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "long" }).format(date);
}

function formatDateLabel(value: string): string {
  return new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", weekday: "short" }).format(dateFromValue(value));
}

function formatTimeLabel(value: string): string {
  return value.slice(0, 5);
}

function getCalendarDates(monthDate: Date): Date[] {
  const firstDate = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
  const startDate = new Date(firstDate);
  startDate.setDate(firstDate.getDate() - firstDate.getDay());
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(startDate);
    date.setDate(startDate.getDate() + index);
    return date;
  });
}

export function GroupOrderCalculatorPage({ mode, navigate, currentStoreId, currentRole, restoreDraft }: Props) {
  const canManageRecipes = currentRole !== "staff";
  const isRecipeMode = mode === "recipes";
  const isCalculatorMode = mode === "calculator";
  const [menus, setMenus] = useState<GroupOrderMenuWithIngredients[]>([]);
  const [products, setProducts] = useState<InventoryItem[]>([]);
  const [suppliers, setSuppliers] = useState<ProductSupplier[]>([]);
  const [events, setEvents] = useState<GroupOrderEvent[]>([]);
  const [eventItems, setEventItems] = useState<GroupOrderEventItem[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [recipeName, setRecipeName] = useState("");
  const [sortOrder, setSortOrder] = useState("");
  const [ingredientDrafts, setIngredientDrafts] = useState<IngredientDraft[]>([{ ...emptyIngredientDraft }]);
  const [calculatorStep, setCalculatorStep] = useState<CalculatorStep>("calendar");
  const [calendarMonth, setCalendarMonth] = useState<Date>(() => getMonthStart(toDateValue(new Date())));
  const [selectedDate, setSelectedDate] = useState(() => toDateValue(new Date()));
  const [rangeStartDate, setRangeStartDate] = useState(() => toDateValue(new Date()));
  const [rangeEndDate, setRangeEndDate] = useState(() => toDateValue(new Date()));
  const [selectedEvent, setSelectedEvent] = useState<GroupOrderEvent | null>(null);
  const [organizationName, setOrganizationName] = useState("");
  const [requestedTime, setRequestedTime] = useState("");
  const [eventNote, setEventNote] = useState("");
  const [orderDrafts, setOrderDrafts] = useState<OrderDraft[]>([{ menuId: "", menuSearch: "", quantity: "" }]);
  const [resultMode, setResultMode] = useState<ResultMode>("order");
  const [results, setResults] = useState<CalculationResult[] | null>(null);
  const [orderActionQuantities, setOrderActionQuantities] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [eventSaving, setEventSaving] = useState(false);
  const [eventDeleting, setEventDeleting] = useState(false);
  const [orderSaving, setOrderSaving] = useState(false);
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const calendarGridRef = useRef<HTMLDivElement | null>(null);
  const eventFormRef = useRef<HTMLFormElement | null>(null);
  const draggingRangeRef = useRef(false);
  const rangeDragMovedRef = useRef(false);
  const pendingTouchRangeRef = useRef<PendingTouchRange | null>(null);

  const productsById = useMemo(() => new Map(products.map((product) => [product.id, product])), [products]);
  const menusById = useMemo(() => new Map(menus.map((menu) => [menu.id, menu])), [menus]);
  const suppliersByName = useMemo(() => new Map(suppliers.map((supplier) => [supplier.name, supplier])), [suppliers]);
  const editingMenu = useMemo(() => menus.find((menu) => menu.id === editingId) ?? null, [editingId, menus]);
  const activeMenus = useMemo(() => menus.filter((menu) => menu.is_active && menu.ingredients.length > 0), [menus]);
  const eventsByDate = useMemo(() => {
    const nextMap = new Map<string, GroupOrderEvent[]>();
    events.forEach((event) => {
      const nextEvents = nextMap.get(event.order_date) ?? [];
      nextEvents.push(event);
      nextMap.set(event.order_date, nextEvents);
    });
    nextMap.forEach((items) => items.sort((a, b) => a.requested_time.localeCompare(b.requested_time)));
    return nextMap;
  }, [events]);
  const eventItemsByEventId = useMemo(() => {
    const nextMap = new Map<string, GroupOrderEventItem[]>();
    eventItems.forEach((item) => {
      const nextItems = nextMap.get(item.event_id) ?? [];
      nextItems.push(item);
      nextMap.set(item.event_id, nextItems);
    });
    nextMap.forEach((items) => items.sort((left, right) => left.created_at.localeCompare(right.created_at)));
    return nextMap;
  }, [eventItems]);
  const selectedDateEvents = eventsByDate.get(selectedDate) ?? [];
  const calendarDates = useMemo(() => getCalendarDates(calendarMonth), [calendarMonth]);
  const selectedRange = normalizeDateRange(rangeStartDate, rangeEndDate);
  const selectedRangeEvents = useMemo(
    () => events.filter((event) => event.order_date >= selectedRange.start && event.order_date <= selectedRange.end),
    [events, selectedRange.end, selectedRange.start]
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");

    const [supplierResult, productResult, menuResult, eventResult, eventItemResult] = await Promise.all([
      loadSuppliers({ activeOnly: true }).catch(() => []),
      supabase.from("products").select("*, inventory(*)").eq("store_id", currentStoreId).eq("is_active", true).order("name", { ascending: true }),
      supabase.from("group_order_menus").select("*").eq("store_id", currentStoreId).order("sort_order", { ascending: true }).order("name", { ascending: true }),
      supabase.from("group_order_events").select("*").eq("store_id", currentStoreId).order("order_date", { ascending: true }).order("requested_time", { ascending: true }),
      supabase.from("group_order_event_items").select("*").eq("store_id", currentStoreId)
    ]);

    if (productResult.error || menuResult.error || eventResult.error || eventItemResult.error) {
      setError(buildSchemaError(productResult.error?.message ?? menuResult.error?.message ?? eventResult.error?.message ?? eventItemResult.error?.message ?? "단체주문 정보를 불러오지 못했습니다."));
      setLoading(false);
      return;
    }

    const nextMenus = (menuResult.data ?? []) as GroupOrderMenu[];
    const menuIds = nextMenus.map((menu) => menu.id);
    const ingredientResult =
      menuIds.length > 0
        ? await supabase
            .from("group_order_recipe_ingredients")
            .select("*")
            .eq("store_id", currentStoreId)
            .in("menu_id", menuIds)
            .order("sort_order", { ascending: true })
        : { data: [], error: null };

    if (ingredientResult.error) {
      setError(buildSchemaError(ingredientResult.error.message));
      setLoading(false);
      return;
    }

    const ingredients = (ingredientResult.data ?? []) as GroupOrderRecipeIngredient[];
    setSuppliers(supplierResult);
    setProducts((productResult.data ?? []).map((row) => normalizeInventoryItem(row as Parameters<typeof normalizeInventoryItem>[0])));
    setEvents((eventResult.data ?? []) as GroupOrderEvent[]);
    setEventItems((eventItemResult.data ?? []) as GroupOrderEventItem[]);
    setMenus(
      nextMenus.map((menu) => ({
        ...menu,
        ingredients: ingredients.filter((ingredient) => ingredient.menu_id === menu.id)
      }))
    );
    setLoading(false);
  }, [currentStoreId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!restoreDraft) return;
    setEditingId(restoreDraft.editingId);
    setRecipeName(restoreDraft.recipeName);
    setSortOrder(restoreDraft.sortOrder);
    setIngredientDrafts(restoreDraft.ingredientDrafts.length > 0 ? restoreDraft.ingredientDrafts.map((draft) => ({ ...draft })) : [{ ...emptyIngredientDraft }]);
    setOrderDrafts(
      restoreDraft.orderDrafts.length > 0
        ? restoreDraft.orderDrafts.map((draft) => ({
            ...draft,
            menuSearch: draft.menuSearch ?? menusById.get(draft.menuId)?.name ?? ""
          }))
        : [{ menuId: "", menuSearch: "", quantity: "" }]
    );
    setResults(null);
    setError("");
    setMessage("");
  }, [menusById, restoreDraft]);

  function resetRecipeForm() {
    setEditingId(null);
    setRecipeName("");
    setSortOrder(String((menus[menus.length - 1]?.sort_order ?? 0) + 1));
    setIngredientDrafts([{ ...emptyIngredientDraft }]);
    setError("");
    setMessage("");
  }

  function startEdit(menu: GroupOrderMenuWithIngredients) {
    setEditingId(menu.id);
    setRecipeName(menu.name);
    setSortOrder(String(menu.sort_order));
    setIngredientDrafts(
      menu.ingredients.length > 0
        ? menu.ingredients.map((ingredient) => {
            const product = productsById.get(ingredient.product_id);
            return {
              productId: ingredient.product_id,
              quantity: formatAmountInput(Number(ingredient.quantity_per_item)),
              quantityUnit: normalizeRecipeUnit(ingredient.quantity_unit),
              search: product?.name ?? ""
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

  function selectIngredientProduct(index: number, product: InventoryItem) {
    updateIngredientDraft(index, {
      productId: product.id,
      search: product.name,
      quantityUnit: availableUsageUnits(product)[0] ?? "개"
    });
  }

  function updateIngredientQuantityInput(index: number, value: string) {
    const nextValue = parseQuantityInput(value);
    if (nextValue || value === "") updateIngredientDraft(index, { quantity: nextValue });
  }

  function removeIngredientDraft(index: number) {
    setIngredientDrafts((current) => (current.length === 1 ? [{ ...emptyIngredientDraft }] : current.filter((_, draftIndex) => draftIndex !== index)));
  }

  function buildCurrentDraft(): GroupOrderRouteDraft {
    return {
      editingId,
      recipeName,
      sortOrder,
      ingredientDrafts: ingredientDrafts.map((draft) => ({ ...draft })),
      orderDrafts: orderDrafts.map((draft) => ({ ...draft }))
    };
  }

  function updateOrderDraft(index: number, patch: Partial<OrderDraft>) {
    setOrderDrafts((current) => current.map((draft, draftIndex) => (draftIndex === index ? { ...draft, ...patch } : draft)));
    setResults(null);
  }

  function selectOrderMenu(index: number, menu: GroupOrderMenuWithIngredients) {
    updateOrderDraft(index, {
      menuId: menu.id,
      menuSearch: menu.name
    });
  }

  function clearOrderMenu(index: number) {
    updateOrderDraft(index, {
      menuId: "",
      menuSearch: ""
    });
  }

  function updateOrderQuantity(index: number, value: string) {
    const nextValue = parseQuantityInput(value);
    if (nextValue || value === "") updateOrderDraft(index, { quantity: nextValue });
  }

  function getOrderDraftsForEvent(eventId: string): OrderDraft[] {
    const savedItems = eventItems.filter((item) => item.event_id === eventId);
    if (savedItems.length === 0) return [{ menuId: "", menuSearch: "", quantity: "" }];

    const drafts = savedItems
      .map((item) => {
        const menu = menusById.get(item.menu_id);
        return {
          menuId: item.menu_id,
          menuSearch: menu?.name ?? "",
          quantity: formatAmountInput(Number(item.quantity))
        };
      })
      .filter((draft) => Boolean(draft.menuSearch));
    return drafts.length > 0 ? drafts : [{ menuId: "", menuSearch: "", quantity: "" }];
  }

  function buildCalculationResults(drafts: OrderDraft[], emptyMessage: string): CalculationBuildResult {
    const aggregates = new Map<string, AggregateResult>();
    let hasOrder = false;

    for (const draft of drafts) {
      if (!draft.menuId && !draft.quantity) continue;
      const menu = menusById.get(draft.menuId);
      const orderQuantity = Number(draft.quantity);

      if (!menu) {
        return { results: [], errorMessage: "주문 메뉴를 선택해 주세요." };
      }
      if (!Number.isFinite(orderQuantity) || orderQuantity <= 0) {
        return { results: [], errorMessage: "주문수량은 0보다 큰 숫자로 입력해 주세요." };
      }

      hasOrder = true;
      for (const ingredient of menu.ingredients) {
        const product = productsById.get(ingredient.product_id);
        const perItemQuantity = Number(ingredient.quantity_per_item);
        if (!product || !Number.isFinite(perItemQuantity) || perItemQuantity <= 0) {
          return { results: [], errorMessage: `${menu.name} 레시피에 사용할 수 없는 재료가 있습니다.` };
        }

        const unit = normalizeRecipeUnit(ingredient.quantity_unit);
        const totalQuantity = perItemQuantity * orderQuantity;
        const current = aggregates.get(product.id) ?? {
          product,
          baseKind: null,
          baseRequired: 0,
          eachRequired: 0
        };

        if (unit === "개") {
          current.eachRequired += totalQuantity;
        } else {
          const baseKind: MeasureKind = isVolumeUsageUnit(unit) ? "volume" : "weight";
          if (current.baseKind && current.baseKind !== baseKind) {
            return { results: [], errorMessage: `${product.name} 재료의 레시피 단위가 무게와 부피로 섞여 있습니다.` };
          }
          current.baseKind = baseKind;
          current.baseRequired += toBaseAmount(totalQuantity, unit);
        }

        aggregates.set(product.id, current);
      }
    }

    if (!hasOrder) {
      return { results: [], errorMessage: emptyMessage };
    }

    const nextResults: CalculationResult[] = Array.from(aggregates.values()).map((aggregate) => {
      const baseAmount = getProductUnitBaseAmount(aggregate.product);
      const hasBaseUsage = aggregate.baseKind !== null && aggregate.baseRequired > 0;
      const missingSetup = hasBaseUsage && !baseAmount;
      const baseOrderUnits = hasBaseUsage && baseAmount ? aggregate.baseRequired / baseAmount : 0;
      const requiredOrderUnitsExact = missingSetup ? null : baseOrderUnits + aggregate.eachRequired;
      const requiredUsageBaseAmount =
        aggregate.baseKind && baseAmount
          ? aggregate.baseRequired + aggregate.eachRequired * baseAmount
          : aggregate.baseKind
            ? aggregate.baseRequired
            : null;
      const currentUsageBaseAmount = aggregate.baseKind && baseAmount ? aggregate.product.total_stock * baseAmount : null;

      return {
        product: aggregate.product,
        requiredOrderUnits: requiredOrderUnitsExact === null ? null : Math.ceil(requiredOrderUnitsExact),
        orderUnits: requiredOrderUnitsExact === null ? null : Math.ceil(Math.max(0, requiredOrderUnitsExact - aggregate.product.total_stock)),
        requiredUsageBaseAmount,
        currentUsageBaseAmount,
        requiredEachAmount: aggregate.baseKind && baseAmount ? 0 : aggregate.eachRequired,
        baseKind: aggregate.baseKind,
        missingSetup
      };
    });

    nextResults.sort((left, right) => {
      if (left.missingSetup !== right.missingSetup) return left.missingSetup ? -1 : 1;
      const orderCompare = (right.orderUnits ?? 0) - (left.orderUnits ?? 0);
      return orderCompare || left.product.name.localeCompare(right.product.name, "ko");
    });

    return { results: nextResults, errorMessage: "" };
  }

  function selectCalendarDate(dateValue: string) {
    setSelectedDate(dateValue);
    setRangeStartDate(dateValue);
    setRangeEndDate(dateValue);
    setSelectedEvent(null);
    setOrganizationName("");
    setRequestedTime("");
    setEventNote("");
    setCalendarMonth(getMonthStart(dateValue));
    setResults(null);
    setError("");
    setMessage("");
  }

  function editEvent(event: GroupOrderEvent, scrollToForm = false) {
    setSelectedDate(event.order_date);
    setRangeStartDate(event.order_date);
    setRangeEndDate(event.order_date);
    setSelectedEvent(event);
    setOrganizationName(event.organization_name);
    setRequestedTime(formatTimeLabel(event.requested_time));
    setEventNote(event.note ?? "");
    setCalendarMonth(getMonthStart(event.order_date));
    setCalculatorStep("calendar");
    setResults(null);
    setError("");
    setMessage("");

    if (scrollToForm) {
      window.setTimeout(() => {
        eventFormRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 0);
    }
  }

  function continueWithEvent(event: GroupOrderEvent) {
    setSelectedDate(event.order_date);
    setRangeStartDate(event.order_date);
    setRangeEndDate(event.order_date);
    setSelectedEvent(event);
    setOrganizationName(event.organization_name);
    setRequestedTime(formatTimeLabel(event.requested_time));
    setEventNote(event.note ?? "");
    setOrderDrafts(getOrderDraftsForEvent(event.id));
    setCalculatorStep("orders");
    setResults(null);
    setError("");
    setMessage("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function startCalendarRange(dateValue: string) {
    draggingRangeRef.current = true;
    rangeDragMovedRef.current = false;
    setSelectedDate(dateValue);
    setRangeStartDate(dateValue);
    setRangeEndDate(dateValue);
    setSelectedEvent(null);
    setOrganizationName("");
    setRequestedTime("");
    setEventNote("");
    setResults(null);
    setError("");
    setMessage("");
  }

  function extendCalendarRange(dateValue: string) {
    if (!draggingRangeRef.current) return;
    if (dateValue !== rangeStartDate) {
      rangeDragMovedRef.current = true;
    }
    setRangeEndDate(dateValue);
    setSelectedDate(dateValue);
  }

  function finishCalendarRange(dateValue: string) {
    if (!draggingRangeRef.current) return;
    setRangeEndDate(dateValue);
    setSelectedDate(dateValue);
    draggingRangeRef.current = false;
  }

  function getCalendarDateFromPointer(event: PointerEvent<HTMLDivElement>): string | null {
    const target = document.elementFromPoint(event.clientX, event.clientY);
    const dateElement = target?.closest<HTMLElement>("[data-calendar-date]");
    if (!dateElement || !calendarGridRef.current?.contains(dateElement)) return null;
    return dateElement.dataset.calendarDate ?? null;
  }

  function clearPendingTouchRange() {
    const pending = pendingTouchRangeRef.current;
    if (!pending) return;
    window.clearTimeout(pending.timerId);
    pendingTouchRangeRef.current = null;
  }

  function handleCalendarPointerDown(event: PointerEvent<HTMLDivElement>) {
    const dateValue = getCalendarDateFromPointer(event);
    if (!dateValue) return;

    if (event.pointerType === "touch") {
      clearPendingTouchRange();
      const grid = event.currentTarget;
      const timerId = window.setTimeout(() => {
        const pending = pendingTouchRangeRef.current;
        if (!pending || pending.cancelled || pending.pointerId !== event.pointerId) return;
        if (!pending.grid.hasPointerCapture(pending.pointerId)) {
          pending.grid.setPointerCapture(pending.pointerId);
        }
        startCalendarRange(pending.dateValue);
      }, 260);

      pendingTouchRangeRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        dateValue,
        grid,
        timerId,
        cancelled: false
      };
      return;
    }

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    startCalendarRange(dateValue);
  }

  function handleCalendarPointerMove(event: PointerEvent<HTMLDivElement>) {
    const pending = pendingTouchRangeRef.current;
    if (pending && pending.pointerId === event.pointerId && !draggingRangeRef.current) {
      const deltaX = Math.abs(event.clientX - pending.startX);
      const deltaY = Math.abs(event.clientY - pending.startY);
      if (deltaX > 8 || deltaY > 8) {
        pending.cancelled = true;
        clearPendingTouchRange();
      }
      return;
    }

    if (!draggingRangeRef.current) return;
    event.preventDefault();
    const dateValue = getCalendarDateFromPointer(event);
    if (dateValue) extendCalendarRange(dateValue);
  }

  function handleCalendarPointerUp(event: PointerEvent<HTMLDivElement>) {
    const pending = pendingTouchRangeRef.current;
    if (pending && pending.pointerId === event.pointerId && !draggingRangeRef.current) {
      const deltaX = Math.abs(event.clientX - pending.startX);
      const deltaY = Math.abs(event.clientY - pending.startY);
      clearPendingTouchRange();
      if (deltaX <= 8 && deltaY <= 8) {
        const dateValue = getCalendarDateFromPointer(event) ?? pending.dateValue;
        selectCalendarDate(dateValue);
      }
      return;
    }

    if (!draggingRangeRef.current) return;
    event.preventDefault();
    const dateValue = getCalendarDateFromPointer(event) ?? selectedDate;
    finishCalendarRange(dateValue);
    if (!rangeDragMovedRef.current) {
      selectCalendarDate(dateValue);
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function handleCalendarPointerCancel(event: PointerEvent<HTMLDivElement>) {
    clearPendingTouchRange();
    draggingRangeRef.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  async function saveGroupOrderEvent(event: FormEvent) {
    event.preventDefault();
    const nextOrganizationName = organizationName.trim();
    const nextRequestedTime = requestedTime.trim();

    if (!selectedDate) {
      setError("일자를 선택해 주세요.");
      return;
    }
    if (!nextOrganizationName) {
      setError("단체명을 입력해 주세요.");
      return;
    }
    if (!nextRequestedTime) {
      setError("요청 시간을 입력해 주세요.");
      return;
    }

    setEventSaving(true);
    setError("");
    setMessage("");

    const eventPayload = {
      order_date: selectedDate,
      organization_name: nextOrganizationName,
      requested_time: nextRequestedTime,
      note: eventNote.trim() || null
    };

    const saveResult = selectedEvent
      ? await supabase
          .from("group_order_events")
          .update(eventPayload)
          .eq("store_id", currentStoreId)
          .eq("id", selectedEvent.id)
          .select()
          .single()
      : await supabase
          .from("group_order_events")
          .insert({ store_id: currentStoreId, ...eventPayload })
          .select()
          .single();

    if (saveResult.error) {
      setError(buildSchemaError(saveResult.error.message));
      setEventSaving(false);
      return;
    }

    const savedEvent = saveResult.data as GroupOrderEvent;
    await refresh();
    setSelectedEvent(savedEvent);
    setOrganizationName(savedEvent.organization_name);
    setRequestedTime(formatTimeLabel(savedEvent.requested_time));
    setEventNote(savedEvent.note ?? "");
    setCalculatorStep("orders");
    setResults(null);
    setMessage("단체주문 일정을 저장했습니다.");
    setEventSaving(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function deleteSelectedEvent() {
    if (!selectedEvent) return;
    if (!window.confirm(`${selectedEvent.organization_name} 단체주문 일정을 삭제할까요?`)) return;

    setEventDeleting(true);
    setError("");
    setMessage("");

    const { error: deleteError } = await supabase
      .from("group_order_events")
      .delete()
      .eq("store_id", currentStoreId)
      .eq("id", selectedEvent.id);

    if (deleteError) {
      setError(buildSchemaError(deleteError.message));
      setEventDeleting(false);
      return;
    }

    setSelectedEvent(null);
    setOrganizationName("");
    setRequestedTime("");
    setEventNote("");
    setCalculatorStep("calendar");
    setResults(null);
    await refresh();
    setMessage("단체주문 일정을 삭제했습니다.");
    setEventDeleting(false);
  }

  async function saveRecipe(event: FormEvent) {
    event.preventDefault();
    if (!canManageRecipes) return;

    const nextName = recipeName.trim();
    const nextSortOrder = Number(sortOrder || menus.length + 1);
    const ingredientRows: {
      product_id: string;
      quantity_per_item: number;
      quantity_unit: RecipeUsageUnit;
      sort_order: number;
    }[] = [];
    const seenProductIds = new Set<string>();

    if (!nextName) {
      setError("메뉴명은 비워둘 수 없습니다.");
      return;
    }
    if (!Number.isFinite(nextSortOrder) || nextSortOrder < 1) {
      setError("표시 순서는 1 이상 숫자로 입력해 주세요.");
      return;
    }

    for (const [index, draft] of ingredientDrafts.entries()) {
      if (!draft.productId && !draft.search.trim()) continue;
      const product = productsById.get(draft.productId);
      const quantity = Number(draft.quantity);

      if (!product) {
        setError("재료는 재고 품목에서 선택해 주세요.");
        return;
      }
      if (seenProductIds.has(product.id)) {
        setError("같은 재료가 중복되어 있습니다.");
        return;
      }
      if (!Number.isFinite(quantity) || quantity <= 0) {
        setError("재료 사용량은 0보다 큰 숫자로 입력해 주세요.");
        return;
      }
      if (!availableUsageUnits(product).includes(draft.quantityUnit)) {
        setError(`${product.name} 품목은 ${draft.quantityUnit} 단위로 계산할 수 없습니다.`);
        return;
      }

      seenProductIds.add(product.id);
      ingredientRows.push({
        product_id: product.id,
        quantity_per_item: Number(quantity.toFixed(3)),
        quantity_unit: draft.quantityUnit,
        sort_order: index + 1
      });
    }

    if (ingredientRows.length === 0) {
      setError("레시피 재료를 1개 이상 등록해 주세요.");
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");

    const saveResult = editingId
      ? await supabase
          .from("group_order_menus")
          .update({
            name: nextName,
            sort_order: Math.trunc(nextSortOrder),
            is_active: editingMenu?.is_active ?? true
          })
          .eq("store_id", currentStoreId)
          .eq("id", editingId)
          .select()
          .single()
      : await supabase
          .from("group_order_menus")
          .insert({
            store_id: currentStoreId,
            name: nextName,
            sort_order: Math.trunc(nextSortOrder)
          })
          .select()
          .single();

    if (saveResult.error) {
      setError(buildSchemaError(saveResult.error.message));
      setSaving(false);
      return;
    }

    const savedMenu = saveResult.data as GroupOrderMenu;
    const deleteResult = await supabase.from("group_order_recipe_ingredients").delete().eq("store_id", currentStoreId).eq("menu_id", savedMenu.id);
    if (deleteResult.error) {
      setError(buildSchemaError(deleteResult.error.message));
      setSaving(false);
      return;
    }

    const insertResult = await supabase.from("group_order_recipe_ingredients").insert(
      ingredientRows.map((ingredient) => ({
        store_id: currentStoreId,
        menu_id: savedMenu.id,
        ...ingredient
      }))
    );
    if (insertResult.error) {
      setError(buildSchemaError(insertResult.error.message));
      setSaving(false);
      return;
    }

    const successMessage = editingId ? "메뉴 레시피를 수정했습니다." : "메뉴 레시피를 등록했습니다.";
    resetRecipeForm();
    await refresh();
    setMessage(successMessage);
    setSaving(false);
  }

  async function setMenuActive(menu: GroupOrderMenuWithIngredients, isActive: boolean) {
    if (!canManageRecipes) return;
    setError("");
    setMessage("");
    const { error: updateError } = await supabase.from("group_order_menus").update({ is_active: isActive }).eq("store_id", currentStoreId).eq("id", menu.id);
    if (updateError) {
      setError(buildSchemaError(updateError.message));
      return;
    }
    setMessage(isActive ? "메뉴 레시피를 활성화했습니다." : "메뉴 레시피를 비활성화했습니다.");
    await refresh();
  }

  async function deleteMenu(menu: GroupOrderMenuWithIngredients) {
    if (!canManageRecipes) return;
    if (!window.confirm(`${menu.name} 레시피를 삭제할까요?`)) return;

    setDeletingIds((current) => new Set(current).add(menu.id));
    setError("");
    setMessage("");
    const { error: deleteError } = await supabase.from("group_order_menus").delete().eq("store_id", currentStoreId).eq("id", menu.id);
    if (deleteError) {
      setError(buildSchemaError(deleteError.message));
    } else {
      if (editingId === menu.id) resetRecipeForm();
      setMessage("메뉴 레시피를 삭제했습니다.");
      await refresh();
    }
    setDeletingIds((current) => {
      const next = new Set(current);
      next.delete(menu.id);
      return next;
    });
  }

  function calculateOrder() {
    setError("");
    setMessage("");
    const buildResult = buildCalculationResults(orderDrafts, "계산할 주문 메뉴와 수량을 입력해 주세요.");

    if (buildResult.errorMessage) {
      setError(buildResult.errorMessage);
      return;
    }

    setOrderActionQuantities(
      Object.fromEntries(
        buildResult.results.map((result) => [
          result.product.id,
          result.orderUnits !== null && result.orderUnits > 0 ? String(result.orderUnits) : ""
        ])
      )
    );
    setResultMode("order");
    setResults(buildResult.results);
  }

  async function saveOrderQuantities() {
    if (!selectedEvent || !results) return;
    const quantitiesByMenuId = new Map<string, number>();
    orderDrafts.forEach((draft) => {
      const quantityNumber = Number(draft.quantity);
      if (!draft.menuId || !Number.isFinite(quantityNumber) || quantityNumber <= 0) return;
      quantitiesByMenuId.set(draft.menuId, (quantitiesByMenuId.get(draft.menuId) ?? 0) + quantityNumber);
    });

    if (quantitiesByMenuId.size === 0) {
      setError("저장할 주문 메뉴와 수량을 입력해 주세요.");
      return;
    }

    setOrderSaving(true);
    setError("");
    setMessage("");

    const deleteResult = await supabase
      .from("group_order_event_items")
      .delete()
      .eq("store_id", currentStoreId)
      .eq("event_id", selectedEvent.id);

    if (deleteResult.error) {
      setError(buildSchemaError(deleteResult.error.message));
      setOrderSaving(false);
      return;
    }

    const insertResult = await supabase.from("group_order_event_items").insert(
      Array.from(quantitiesByMenuId.entries()).map(([menuId, quantity]) => ({
        store_id: currentStoreId,
        event_id: selectedEvent.id,
        menu_id: menuId,
        quantity: Number(quantity.toFixed(3))
      }))
    );

    if (insertResult.error) {
      setError(buildSchemaError(insertResult.error.message));
      setOrderSaving(false);
      return;
    }

    await refresh();
    setMessage("주문 수량 계산 결과를 저장했습니다.");
    setOrderSaving(false);
  }

  function formatUsageCurrent(result: CalculationResult): string {
    if (result.baseKind && result.currentUsageBaseAmount !== null) {
      return formatBaseAmount(result.currentUsageBaseAmount, result.baseKind);
    }
    return formatOrderUnitAmount(result.product.total_stock, result.product);
  }

  function formatUsageRequired(result: CalculationResult): string {
    const parts: string[] = [];
    if (result.baseKind && result.requiredUsageBaseAmount !== null) {
      parts.push(formatBaseAmount(result.requiredUsageBaseAmount, result.baseKind));
    }
    if (result.requiredEachAmount > 0) {
      parts.push(formatOrderUnitAmount(result.requiredEachAmount, result.product));
    }
    return parts.length > 0 ? parts.join(" + ") : "0";
  }

  const selectedRangeEventIds = new Set(selectedRangeEvents.map((event) => event.id));
  const selectedRangeOrderDrafts = eventItems
    .filter((item) => selectedRangeEventIds.has(item.event_id))
    .map((item) => {
      const menu = menusById.get(item.menu_id);
      return {
        menuId: item.menu_id,
        menuSearch: menu?.name ?? "",
        quantity: formatAmountInput(Number(item.quantity))
      };
    })
    .filter((draft) => Boolean(draft.menuSearch));
  const selectedRangeBuildResult = buildCalculationResults(selectedRangeOrderDrafts, "선택한 기간에 저장된 주문 수량이 없습니다.");
  const selectedRangeResults = selectedRangeBuildResult.errorMessage ? [] : selectedRangeBuildResult.results;

  return (
    <section className="min-w-0">
      <PageTitle
        title={isRecipeMode ? "메뉴 레시피 등록" : "단체주문 계산"}
        description={isRecipeMode ? "단체주문 계산에 사용할 메뉴별 재료와 사용량을 관리합니다." : "메뉴별 주문수량으로 품목별 필요량과 발주량을 계산합니다."}
      />

      {isRecipeMode && canManageRecipes ? (
        <form onSubmit={saveRecipe} className="panel mb-4 w-full overflow-hidden p-4">
          <div className="mb-3 flex min-w-0 items-center justify-between gap-2">
            <h2 className="text-base font-extrabold">메뉴 레시피 등록</h2>
            {editingId ? (
              <button type="button" onClick={resetRecipeForm} className="secondary-button inline-flex min-h-11 items-center gap-2 px-3">
                <X size={18} />
                새로 등록
              </button>
            ) : null}
          </div>

          <div className="grid gap-4 md:grid-cols-[1fr_10rem]">
            <label className="block min-w-0">
              <span className="mb-1 block text-sm font-semibold">메뉴명</span>
              <input className="field" value={recipeName} onChange={(event) => setRecipeName(event.target.value)} placeholder="딸기라떼" required />
            </label>
            <label className="block min-w-0">
              <span className="mb-1 block text-sm font-semibold">표시 순서</span>
              <input className="field" type="number" min={1} step={1} value={sortOrder} onChange={(event) => setSortOrder(event.target.value)} placeholder="자동" />
            </label>
          </div>

          <div className="mt-4 space-y-2">
            {ingredientDrafts.map((draft, index) => {
              const selectedProduct = productsById.get(draft.productId);
              const selectedProductUnitBaseAmount = getProductUnitBaseAmount(selectedProduct);
              const selectableUnits = keepCurrentUnitAvailable(selectedProduct ? availableUsageUnits(selectedProduct) : recipeUsageUnits, draft.quantityUnit);
              const keyword = draft.search.trim().toLocaleLowerCase("ko");
              const candidates = products
                .filter((product) => {
                  if (!keyword) return true;
                  return product.name.toLocaleLowerCase("ko").includes(keyword) || (product.barcode ?? "").toLocaleLowerCase("ko").includes(keyword);
                })
                .slice(0, 8);

              return (
                <div key={index} className="grid gap-2 rounded-md border border-slate-200 p-2 dark:border-slate-800 md:grid-cols-[1fr_14rem_auto]">
                  <div className="block min-w-0">
                    <span className="mb-1 block text-xs font-bold text-slate-500 dark:text-slate-400">재료</span>
                    <input
                      className="field min-h-11 py-2"
                      value={draft.search}
                      onChange={(event) => updateIngredientDraft(index, { search: event.target.value, productId: "" })}
                      placeholder="품목명 또는 바코드 검색"
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
                              returnTo: "group-order-recipes",
                              groupOrderDraft: buildCurrentDraft()
                            });
                          }}
                          className="shrink-0 rounded border border-brand-200 px-2 py-0.5 dark:border-brand-800"
                        >
                          {selectedProductUnitBaseAmount ? "해제" : "품목 관리"}
                        </button>
                      </div>
                    ) : draft.search.trim() ? (
                      <div className="mt-1 max-h-44 overflow-y-auto rounded-md border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950">
                        {candidates.length > 0 ? (
                          candidates.map((product) => (
                            <button
                              key={product.id}
                              type="button"
                              onClick={() => selectIngredientProduct(index, product)}
                              className="flex min-h-10 w-full items-center justify-between gap-2 border-b border-slate-100 px-2 text-left text-sm last:border-0 hover:bg-brand-50 dark:border-slate-800 dark:hover:bg-brand-950"
                            >
                              <span className="min-w-0 truncate font-bold">{product.name}</span>
                              <span className="shrink-0 text-xs font-semibold text-slate-500 dark:text-slate-400">{formatProductUnitWeight(product)}</span>
                            </button>
                          ))
                        ) : (
                          <div className="px-2 py-3 text-sm font-semibold text-slate-500 dark:text-slate-400">검색 결과가 없습니다.</div>
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
                        onChange={(event) => updateIngredientDraft(index, { quantityUnit: event.target.value as RecipeUsageUnit })}
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

          <button type="button" onClick={() => setIngredientDrafts((current) => [...current, { ...emptyIngredientDraft }])} className="secondary-button mt-5 inline-flex w-full items-center justify-center gap-2">
            <Plus size={18} />
            재료 추가
          </button>

          <button type="submit" disabled={saving || !recipeName.trim()} className="primary-button mt-5 w-full">
            {saving ? "저장 중..." : editingId ? "레시피 수정" : "레시피 등록"}
          </button>
        </form>
      ) : null}

      {error ? <div className="mb-4"><StatusMessage type="error">{error}</StatusMessage></div> : null}
      {message ? <div className="mb-4"><StatusMessage type="success">{message}</StatusMessage></div> : null}

      {loading ? <StatusMessage>단체주문 정보를 불러오는 중...</StatusMessage> : null}

      {!loading ? (
        <>
          {isRecipeMode && canManageRecipes ? (
            <div className="mb-4 space-y-2">
              {menus.map((menu) => (
                <div key={menu.id} className="panel p-3">
                  <div className="flex min-w-0 items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="break-words text-lg font-extrabold">{menu.name}</p>
                        <span className={`rounded px-2 py-1 text-xs font-bold ${menu.is_active ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-100" : "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-200"}`}>
                          {menu.is_active ? "활성" : "비활성"}
                        </span>
                      </div>
                      <p className="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">순서 {menu.sort_order}</p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {menu.ingredients.map((ingredient) => {
                          const product = productsById.get(ingredient.product_id);
                          return (
                            <span key={ingredient.id} className="rounded-md bg-slate-100 px-2 py-1 text-xs font-bold dark:bg-slate-900">
                              {product?.name ?? "삭제된 품목"} {formatAmountQuantity(Number(ingredient.quantity_per_item))}
                              {ingredient.quantity_unit}
                            </span>
                          );
                        })}
                      </div>
                    </div>

                    <div className="flex shrink-0 flex-wrap justify-end gap-1">
                      <button type="button" onClick={() => startEdit(menu)} className="touch-button icon-button" aria-label="메뉴 레시피 수정" title="수정">
                        <Pencil size={18} />
                      </button>
                      <button type="button" onClick={() => void setMenuActive(menu, !menu.is_active)} className="touch-button whitespace-nowrap rounded-md border border-slate-300 px-3 text-sm font-bold dark:border-slate-700">
                        {menu.is_active ? "비활성" : "활성"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void deleteMenu(menu)}
                        disabled={deletingIds.has(menu.id)}
                        className="touch-button icon-button text-rose-600 disabled:opacity-35 dark:text-rose-300"
                        aria-label="메뉴 레시피 삭제"
                        title="삭제"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}

              {menus.length === 0 ? <StatusMessage>등록된 메뉴 레시피가 없습니다.</StatusMessage> : null}
            </div>
          ) : null}

          {isCalculatorMode && calculatorStep === "calendar" ? (
            <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
              <div className="panel overflow-hidden p-4">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => setCalendarMonth((current) => addMonths(current, -1))}
                    className="touch-button icon-button"
                    aria-label="이전 달"
                    title="이전 달"
                  >
                    <ChevronLeft size={18} />
                  </button>
                  <div className="flex min-w-0 items-center gap-2">
                    <CalendarDays className="shrink-0 text-brand-700 dark:text-brand-100" size={20} />
                    <h2 className="truncate text-lg font-extrabold">{formatMonthLabel(calendarMonth)}</h2>
                  </div>
                  <button
                    type="button"
                    onClick={() => setCalendarMonth((current) => addMonths(current, 1))}
                    className="touch-button icon-button"
                    aria-label="다음 달"
                    title="다음 달"
                  >
                    <ChevronRight size={18} />
                  </button>
                </div>

                <div className="grid grid-cols-7 border-b border-slate-100 pb-2 text-center text-xs font-extrabold text-slate-500 dark:border-slate-800 dark:text-slate-400">
                  {["일", "월", "화", "수", "목", "금", "토"].map((weekday) => (
                    <div key={weekday}>{weekday}</div>
                  ))}
                </div>
                <div
                  ref={calendarGridRef}
                  className="mt-2 grid touch-pan-y select-none grid-cols-7 gap-1"
                  onPointerDown={handleCalendarPointerDown}
                  onPointerMove={handleCalendarPointerMove}
                  onPointerUp={handleCalendarPointerUp}
                  onPointerCancel={handleCalendarPointerCancel}
                >
                  {calendarDates.map((date) => {
                    const dateValue = toDateValue(date);
                    const dayEvents = eventsByDate.get(dateValue) ?? [];
                    const isCurrentMonth = date.getMonth() === calendarMonth.getMonth();
                    const isSelected = selectedDate === dateValue;
                    const isInSelectedRange = dateValue >= selectedRange.start && dateValue <= selectedRange.end;
                    const isToday = dateValue === toDateValue(new Date());

                    return (
                      <button
                        key={dateValue}
                        data-calendar-date={dateValue}
                        type="button"
                        className={`min-h-[76px] rounded-md border p-1.5 text-left transition ${
                          isSelected
                            ? "border-brand-600 bg-brand-50 text-brand-900 dark:bg-brand-950 dark:text-brand-50"
                            : isInSelectedRange
                              ? "border-brand-200 bg-brand-50/60 text-brand-900 dark:border-brand-800 dark:bg-brand-950/40 dark:text-brand-50"
                            : "border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-950 dark:hover:bg-slate-900"
                        } ${isCurrentMonth ? "" : "opacity-45"}`}
                      >
                        <span className={`inline-flex h-6 min-w-6 items-center justify-center rounded text-xs font-extrabold ${isToday ? "bg-brand-600 text-white" : ""}`}>
                          {date.getDate()}
                        </span>
                        <span className="mt-1 block space-y-1">
                          {dayEvents.slice(0, 2).map((event) => (
                            <span key={event.id} className="block truncate rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] font-bold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-100">
                              {formatTimeLabel(event.requested_time)} {event.organization_name}
                            </span>
                          ))}
                          {dayEvents.length > 2 ? (
                            <span className="block rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                              +{dayEvents.length - 2}
                            </span>
                          ) : null}
                        </span>
                      </button>
                    );
                  })}
                </div>

                <div className="mt-4 border-t border-slate-100 pt-4 dark:border-slate-800">
                  <div className="mb-3 flex min-w-0 flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="text-base font-extrabold">선택 기간 필요 재고</h3>
                      <p className="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">
                        {selectedRange.start === selectedRange.end
                          ? formatDateLabel(selectedRange.start)
                          : `${formatDateLabel(selectedRange.start)} - ${formatDateLabel(selectedRange.end)}`}
                        {" · "}
                        일정 {selectedRangeEvents.length}건
                      </p>
                    </div>
                  </div>

                  {selectedRangeResults.length > 0 ? (
                    <>
                      <div className="space-y-2 sm:hidden">
                        {selectedRangeResults.map((result) => (
                          <div key={result.product.id} className="rounded-md border border-slate-200 p-3 text-sm dark:border-slate-800">
                            <div className="font-extrabold leading-snug break-words whitespace-normal">
                              {result.product.name}
                            </div>
                            {result.missingSetup ? <div className="mt-1 text-xs font-bold text-amber-600 dark:text-amber-300">단위당 무게/부피 필요</div> : null}
                            <div className="mt-3 grid grid-cols-[repeat(3,minmax(0,1fr))_5.75rem] gap-2 text-center">
                              <div className="min-w-0">
                                <div className="text-[11px] font-bold text-slate-500 dark:text-slate-400">현재재고</div>
                                <div className="mt-1 break-words font-bold tabular-nums">{formatOrderUnitAmount(result.product.total_stock, result.product)}</div>
                              </div>
                              <div className="min-w-0">
                                <div className="text-[11px] font-bold text-slate-500 dark:text-slate-400">필요</div>
                                <div className="mt-1 break-words font-bold tabular-nums">{result.requiredOrderUnits === null ? "설정 필요" : formatOrderUnitAmount(result.requiredOrderUnits, result.product)}</div>
                              </div>
                              <div className="min-w-0">
                                <div className="text-[11px] font-bold text-slate-500 dark:text-slate-400">발주</div>
                                <div className="mt-1 break-words font-extrabold tabular-nums">
                                  {result.orderUnits === null ? "설정 필요" : result.orderUnits > 0 ? formatOrderUnitAmount(result.orderUnits, result.product) : "없음"}
                                </div>
                              </div>
                              <div className="min-w-0">
                                <div className="text-[11px] font-bold text-slate-500 dark:text-slate-400">발주하기</div>
                                <div className="mt-1">
                                  <ProductOrderAction
                                    item={result.product}
                                    supplier={result.product.supplier_name ? suppliersByName.get(result.product.supplier_name) ?? null : null}
                                    quantity={orderActionQuantities[result.product.id] ?? ""}
                                    onQuantityChange={(quantity) => setOrderActionQuantities((current) => ({ ...current, [result.product.id]: quantity }))}
                                  />
                                </div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>

                      <table className="hidden w-full table-fixed text-left text-sm sm:table">
                        <thead className="text-xs text-slate-600 dark:text-slate-300">
                          <tr>
                            <th className="w-[28%] px-3 py-2">품목</th>
                            <th className="w-[18%] px-3 py-2 text-right">현재재고</th>
                            <th className="w-[18%] px-3 py-2 text-right">필요</th>
                            <th className="w-[18%] px-3 py-2 text-right">발주</th>
                            <th className="w-[18%] px-3 py-2 text-center">발주하기</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedRangeResults.map((result) => (
                            <tr key={result.product.id} className="border-t border-slate-100 dark:border-slate-900">
                              <td className="px-3 py-3 font-bold">
                                <span className="break-words">{result.product.name}</span>
                                {result.missingSetup ? <span className="mt-1 block text-xs text-amber-600 dark:text-amber-300">단위당 무게/부피 필요</span> : null}
                              </td>
                              <td className="px-3 py-3 text-right tabular-nums">{formatOrderUnitAmount(result.product.total_stock, result.product)}</td>
                              <td className="px-3 py-3 text-right tabular-nums">{result.requiredOrderUnits === null ? "설정 필요" : formatOrderUnitAmount(result.requiredOrderUnits, result.product)}</td>
                              <td className="px-3 py-3 text-right font-extrabold tabular-nums">
                                {result.orderUnits === null ? "설정 필요" : result.orderUnits > 0 ? formatOrderUnitAmount(result.orderUnits, result.product) : "없음"}
                              </td>
                              <td className="px-2 py-2 text-center">
                                <ProductOrderAction
                                  item={result.product}
                                  supplier={result.product.supplier_name ? suppliersByName.get(result.product.supplier_name) ?? null : null}
                                  quantity={orderActionQuantities[result.product.id] ?? ""}
                                  onQuantityChange={(quantity) => setOrderActionQuantities((current) => ({ ...current, [result.product.id]: quantity }))}
                                />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </>
                  ) : (
                    <StatusMessage>{selectedRangeBuildResult.errorMessage}</StatusMessage>
                  )}
                </div>
              </div>

              <div className="space-y-4">
                <form ref={eventFormRef} onSubmit={saveGroupOrderEvent} className="panel scroll-mt-20 overflow-hidden p-4">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <h2 className="text-base font-extrabold">{formatDateLabel(selectedDate)}</h2>
                    {selectedEvent ? (
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedEvent(null);
                            setOrganizationName("");
                            setRequestedTime("");
                            setEventNote("");
                          }}
                          className="secondary-button inline-flex min-h-10 items-center gap-2 px-3 text-sm"
                        >
                          <Plus size={16} />
                          새 일정
                        </button>
                        <button
                          type="button"
                          disabled={eventDeleting}
                          onClick={() => void deleteSelectedEvent()}
                          className="touch-button icon-button text-rose-600 disabled:opacity-35 dark:text-rose-300"
                          aria-label="일정 삭제"
                          title="삭제"
                        >
                          <Trash2 size={17} />
                        </button>
                      </div>
                    ) : null}
                  </div>

                  <div className="space-y-3">
                    <label className="block min-w-0">
                      <span className="mb-1 block text-sm font-semibold">단체명</span>
                      <input className="field" value={organizationName} onChange={(event) => setOrganizationName(event.target.value)} placeholder="단체명" required />
                    </label>
                    <label className="block min-w-0">
                      <span className="mb-1 block text-sm font-semibold">요청 시간</span>
                      <input className="field" type="time" value={requestedTime} onChange={(event) => setRequestedTime(event.target.value)} required />
                    </label>
                    <label className="block min-w-0">
                      <span className="mb-1 block text-sm font-semibold">내용</span>
                      <textarea className="field min-h-24 resize-y" value={eventNote} onChange={(event) => setEventNote(event.target.value)} placeholder="요청 내용" />
                    </label>
                  </div>

                  <button type="submit" disabled={eventSaving || !organizationName.trim() || !requestedTime.trim()} className="primary-button mt-5 w-full">
                    {eventSaving ? "저장 중..." : selectedEvent ? "일정 수정 후 주문 입력" : "일정 저장 후 주문 입력"}
                  </button>
                </form>

                <div className="space-y-2">
                  {selectedDateEvents.map((event) => {
                    const savedOrderItems = eventItemsByEventId.get(event.id) ?? [];

                    return (
                      <div
                        key={event.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => editEvent(event, true)}
                        onKeyDown={(keyboardEvent) => {
                          if (keyboardEvent.key === "Enter" || keyboardEvent.key === " ") {
                            keyboardEvent.preventDefault();
                            editEvent(event, true);
                          }
                        }}
                        className="panel cursor-pointer p-3 transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-brand-600/25 dark:hover:bg-slate-900"
                      >
                        <div className="flex min-w-0 items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="break-words text-sm font-extrabold">{event.organization_name}</p>
                            <p className="mt-1 flex items-center gap-1 text-xs font-bold text-slate-500 dark:text-slate-400">
                              <Clock size={14} />
                              {formatTimeLabel(event.requested_time)}
                            </p>
                            {savedOrderItems.length > 0 ? (
                              <div className="mt-2 space-y-1 rounded-md bg-slate-50 px-2 py-2 text-xs font-bold text-slate-700 dark:bg-slate-900 dark:text-slate-200">
                                {savedOrderItems.map((item) => {
                                  const menu = menusById.get(item.menu_id);
                                  return (
                                    <div key={item.id} className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
                                      <span className="min-w-0 break-words leading-snug">{menu?.name ?? "삭제된 메뉴"}</span>
                                      <span className="shrink-0 tabular-nums">{formatAmountInput(Number(item.quantity))}개</span>
                                    </div>
                                  );
                                })}
                              </div>
                            ) : null}
                            {event.note ? <p className="mt-2 whitespace-pre-wrap break-words text-sm text-slate-600 dark:text-slate-300">{event.note}</p> : null}
                          </div>
                          <div className="flex shrink-0 gap-1">
                            <button
                              type="button"
                              onClick={(clickEvent) => {
                                clickEvent.stopPropagation();
                                continueWithEvent(event);
                              }}
                              className="touch-button rounded-md border border-brand-600 px-3 text-sm font-bold text-brand-700 dark:text-brand-100"
                            >
                              주문 입력
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}

                  {selectedDateEvents.length === 0 ? <StatusMessage>선택한 날짜의 단체주문 일정이 없습니다.</StatusMessage> : null}
                </div>
              </div>
            </div>
          ) : null}

          {isCalculatorMode && calculatorStep === "orders" ? (
            <>
              <div className="panel mb-4 p-4">
                <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-slate-500 dark:text-slate-400">{formatDateLabel(selectedDate)}</p>
                    <h2 className="mt-1 break-words text-lg font-extrabold">
                      {selectedEvent ? `${selectedEvent.organization_name} · ${formatTimeLabel(selectedEvent.requested_time)}` : "단체주문"}
                    </h2>
                    {selectedEvent?.note ? <p className="mt-2 whitespace-pre-wrap break-words text-sm text-slate-600 dark:text-slate-300">{selectedEvent.note}</p> : null}
                  </div>
                  <button type="button" onClick={() => setCalculatorStep("calendar")} className="secondary-button min-h-11 px-3">
                    캘린더
                  </button>
                </div>
              </div>

              <div className="panel overflow-hidden p-4">
              <div className="mb-3 flex min-w-0 items-center justify-between gap-2">
                <h2 className="text-base font-extrabold">주문 수량</h2>
              </div>

              <div className="space-y-2">
                {orderDrafts.map((draft, index) => {
                  const selectedMenu = menusById.get(draft.menuId);
                  const keyword = draft.menuSearch.trim().toLocaleLowerCase("ko");
                  const menuCandidates = activeMenus
                    .filter((menu) => {
                      if (!keyword) return true;
                      return menu.name.toLocaleLowerCase("ko").includes(keyword);
                    })
                    .slice(0, 8);

                  return (
                    <div key={index} className="grid gap-2 md:grid-cols-[minmax(0,1fr)_10rem_auto]">
                      <div className="block min-w-0">
                        <span className="mb-1 block text-xs font-bold text-slate-500 dark:text-slate-400">메뉴</span>
                        <input
                          className="field"
                          value={draft.menuSearch}
                          onChange={(event) => updateOrderDraft(index, { menuId: "", menuSearch: event.target.value })}
                          placeholder="메뉴명 검색"
                        />
                        {selectedMenu ? (
                          <div className="mt-1 flex min-h-8 items-center justify-between gap-2 rounded-md bg-brand-50 px-2 py-1 text-xs font-bold text-brand-700 dark:bg-brand-950 dark:text-brand-100">
                            <span className="min-w-0 truncate">선택됨: {selectedMenu.name}</span>
                            <button type="button" onClick={() => clearOrderMenu(index)} className="shrink-0 rounded border border-brand-200 px-2 py-0.5 dark:border-brand-800">
                              해제
                            </button>
                          </div>
                        ) : draft.menuSearch.trim() ? (
                          <div className="mt-1 max-h-44 overflow-y-auto rounded-md border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950">
                            {menuCandidates.length > 0 ? (
                              menuCandidates.map((menu) => (
                                <button
                                  key={menu.id}
                                  type="button"
                                  onClick={() => selectOrderMenu(index, menu)}
                                  className="flex min-h-10 w-full items-center justify-between gap-2 border-b border-slate-100 px-2 text-left text-sm last:border-0 hover:bg-brand-50 dark:border-slate-800 dark:hover:bg-brand-950"
                                >
                                  <span className="min-w-0 truncate font-bold">{menu.name}</span>
                                  <span className="shrink-0 text-xs font-semibold text-slate-500 dark:text-slate-400">{menu.ingredients.length}개 재료</span>
                                </button>
                              ))
                            ) : (
                              <div className="px-2 py-3 text-sm font-semibold text-slate-500 dark:text-slate-400">검색 결과가 없습니다.</div>
                            )}
                          </div>
                        ) : null}
                      </div>
                      <label className="block min-w-0">
                        <span className="mb-1 block text-xs font-bold text-slate-500 dark:text-slate-400">주문수량</span>
                        <input
                          className="field"
                          type="text"
                          inputMode="decimal"
                          pattern="[0-9]*[.]?[0-9]{0,3}"
                          value={draft.quantity}
                          onChange={(event) => updateOrderQuantity(index, event.target.value)}
                          placeholder="0"
                        />
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          setOrderDrafts((current) => (current.length === 1 ? [{ menuId: "", menuSearch: "", quantity: "" }] : current.filter((_, draftIndex) => draftIndex !== index)));
                          setResults(null);
                        }}
                        className="touch-button icon-button self-end text-rose-600 dark:text-rose-300"
                        aria-label="주문 메뉴 삭제"
                        title="삭제"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  );
                })}
              </div>

              <button type="button" onClick={() => setOrderDrafts((current) => [...current, { menuId: "", menuSearch: "", quantity: "" }])} className="secondary-button mt-5 inline-flex w-full items-center justify-center gap-2">
                <Plus size={18} />
                메뉴 추가
              </button>

              <button type="button" onClick={calculateOrder} disabled={activeMenus.length === 0} className="primary-button mt-5 inline-flex w-full items-center justify-center gap-2">
                <Calculator size={19} />
                계산
              </button>
              </div>
            </>
          ) : null}

          {isCalculatorMode && calculatorStep === "orders" && results ? (
            <div className="panel mt-4 overflow-hidden p-4">
              <div className="mb-4 grid gap-3 md:grid-cols-[1fr_auto]">
                <div className="grid grid-cols-2 rounded-md border border-slate-200 bg-white p-1 dark:border-slate-800 dark:bg-slate-900">
                  <button type="button" onClick={() => setResultMode("order")} className={`touch-button rounded px-3 text-sm font-bold ${resultMode === "order" ? "bg-brand-600 text-white" : ""}`}>
                    발주량 보기
                  </button>
                  <button type="button" onClick={() => setResultMode("usage")} className={`touch-button rounded px-3 text-sm font-bold ${resultMode === "usage" ? "bg-brand-600 text-white" : ""}`}>
                    사용량 보기
                  </button>
                </div>
                <button type="button" onClick={() => void saveOrderQuantities()} disabled={orderSaving || !selectedEvent} className="primary-button min-h-11 px-4">
                  {orderSaving ? "저장 중..." : "계산 결과 저장"}
                </button>
              </div>

              <div className="overflow-x-auto">
                {resultMode === "order" ? (
                  <table className="w-full min-w-[760px] table-fixed text-left text-sm">
                    <thead className="text-xs text-slate-600 dark:text-slate-300">
                      <tr>
                        <th className="w-[28%] px-3 py-2">품목</th>
                        <th className="w-[18%] px-3 py-2 text-right">현재재고</th>
                        <th className="w-[18%] px-3 py-2 text-right">필요</th>
                        <th className="w-[18%] px-3 py-2 text-right">발주</th>
                        <th className="w-[18%] px-3 py-2 text-center">발주하기</th>
                      </tr>
                    </thead>
                    <tbody>
                      {results.map((result) => (
                        <tr key={result.product.id} className="border-t border-slate-100 dark:border-slate-900">
                          <td className="px-3 py-3 font-bold">
                            <span className="break-words">{result.product.name}</span>
                            {result.missingSetup ? <span className="mt-1 block text-xs text-amber-600 dark:text-amber-300">단위당 무게/부피 필요</span> : null}
                          </td>
                          <td className="px-3 py-3 text-right tabular-nums">{formatOrderUnitAmount(result.product.total_stock, result.product)}</td>
                          <td className="px-3 py-3 text-right tabular-nums">{result.requiredOrderUnits === null ? "설정 필요" : formatOrderUnitAmount(result.requiredOrderUnits, result.product)}</td>
                          <td className="px-3 py-3 text-right font-extrabold tabular-nums">
                            {result.orderUnits === null ? "설정 필요" : result.orderUnits > 0 ? formatOrderUnitAmount(result.orderUnits, result.product) : "없음"}
                          </td>
                          <td className="px-2 py-2 text-center">
                            <ProductOrderAction
                              item={result.product}
                              supplier={result.product.supplier_name ? suppliersByName.get(result.product.supplier_name) ?? null : null}
                              quantity={orderActionQuantities[result.product.id] ?? ""}
                              onQuantityChange={(quantity) => setOrderActionQuantities((current) => ({ ...current, [result.product.id]: quantity }))}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <table className="w-full min-w-[680px] table-fixed text-left text-sm">
                    <thead className="text-xs text-slate-600 dark:text-slate-300">
                      <tr>
                        <th className="w-[34%] px-3 py-2">품목</th>
                        <th className="w-[22%] px-3 py-2 text-right">현재재고</th>
                        <th className="w-[22%] px-3 py-2 text-right">필요량</th>
                        <th className="w-[22%] px-3 py-2 text-center">발주하기</th>
                      </tr>
                    </thead>
                    <tbody>
                      {results.map((result) => (
                        <tr key={result.product.id} className="border-t border-slate-100 dark:border-slate-900">
                          <td className="px-3 py-3 font-bold">
                            <span className="break-words">{result.product.name}</span>
                            {result.missingSetup ? <span className="mt-1 block text-xs text-amber-600 dark:text-amber-300">단위당 무게/부피 필요</span> : null}
                          </td>
                          <td className="px-3 py-3 text-right tabular-nums">{formatUsageCurrent(result)}</td>
                          <td className="px-3 py-3 text-right font-extrabold tabular-nums">{formatUsageRequired(result)}</td>
                          <td className="px-2 py-2 text-center">
                            <ProductOrderAction
                              item={result.product}
                              supplier={result.product.supplier_name ? suppliersByName.get(result.product.supplier_name) ?? null : null}
                              quantity={orderActionQuantities[result.product.id] ?? ""}
                              onQuantityChange={(quantity) => setOrderActionQuantities((current) => ({ ...current, [result.product.id]: quantity }))}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {results.length === 0 ? <StatusMessage>계산 결과가 없습니다.</StatusMessage> : null}
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
