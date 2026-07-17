import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";
import { CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, ClipboardList, ScanLine, Search, X } from "lucide-react";
import { PageTitle } from "../components/PageTitle";
import { ProductOrderAction } from "../components/ProductOrderAction";
import { InventoryTableSkeleton, LowStockCardSkeleton } from "../components/Skeleton";
import { StatusMessage } from "../components/StatusMessage";
import { formatInventoryQuantity, normalizeInventoryItem } from "../lib/inventory";
import { recordReceiptCheckOnly, recordReceiptCompletion } from "../lib/receiptCheck";
import { loadSuppliers } from "../lib/suppliers";
import * as Services from "../services";
import type { AppRoute, InventoryItem, ProductSupplier, ProfileRole } from "../types/domain";
import type { Database } from "../types/supabase";

type Props = {
  navigate: (route: AppRoute) => void;
  currentStoreId: string;
  currentRole: ProfileRole;
};

type FreshReceivingUndoEntry = {
  productId: string;
  freshOrderSelected: boolean;
  freshOrderSelectedAt: string | null;
  urgentOrderRequested: boolean;
  urgentOrderQuantity: number | null;
  orderCompleted: boolean;
  receiptLogId: string | null;
};

type ConfirmedOrderItem = Database["public"]["Tables"]["confirmed_order_items"]["Row"];

const FRESH_SCANNER_ID = "fresh-product-scanner";
const PRODUCT_BARCODE_FORMATS = [
  Html5QrcodeSupportedFormats.EAN_13,
  Html5QrcodeSupportedFormats.EAN_8,
  Html5QrcodeSupportedFormats.UPC_A,
  Html5QrcodeSupportedFormats.UPC_E,
  Html5QrcodeSupportedFormats.CODE_128,
  Html5QrcodeSupportedFormats.CODE_39,
  Html5QrcodeSupportedFormats.CODE_93,
  Html5QrcodeSupportedFormats.ITF,
  Html5QrcodeSupportedFormats.CODABAR
];
const DEFAULT_CAMERA_ZOOM = 2.5;

type FocusMediaTrackConstraints = MediaTrackConstraints & {
  advanced?: Array<MediaTrackConstraintSet & { focusMode?: string }>;
};

function getBarcodeCandidates(barcode: string): string[] {
  const normalized = barcode.trim();
  const candidates = new Set([normalized]);

  if (/^\d{12}$/.test(normalized)) candidates.add(`0${normalized}`);
  if (/^0\d{12}$/.test(normalized)) candidates.add(normalized.slice(1));

  return [...candidates];
}

function todayDateValue(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function shiftDateValue(dateValue: string, dayOffset: number): string {
  const date = new Date(`${dateValue}T00:00:00`);
  date.setDate(date.getDate() + dayOffset);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function LowStockPage({ navigate, currentStoreId, currentRole }: Props) {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [suppliers, setSuppliers] = useState<ProductSupplier[]>([]);
  const [orderQuantities, setOrderQuantities] = useState<Record<string, string>>({});
  const [updatingOrderIds, setUpdatingOrderIds] = useState<Set<string>>(new Set());
  const [completingFreshIds, setCompletingFreshIds] = useState<Set<string>>(new Set());
  const [freshReceivingUndoStack, setFreshReceivingUndoStack] = useState<FreshReceivingUndoEntry[]>([]);
  const [undoingFreshReceiving, setUndoingFreshReceiving] = useState(false);
  const [deletingUrgentIds, setDeletingUrgentIds] = useState<Set<string>>(new Set());
  const [freshModalOpen, setFreshModalOpen] = useState(false);
  const [freshSearch, setFreshSearch] = useState("");
  const [selectedFreshIds, setSelectedFreshIds] = useState<Set<string>>(new Set());
  const [selectedUrgentIds, setSelectedUrgentIds] = useState<Set<string>>(new Set());
  const [expandedFreshCategory, setExpandedFreshCategory] = useState<string | null>(null);
  const [savingFresh, setSavingFresh] = useState(false);
  const [freshScannerActive, setFreshScannerActive] = useState(false);
  const [freshScanMessage, setFreshScanMessage] = useState("");
  const [pendingFreshBarcode, setPendingFreshBarcode] = useState("");
  const [confirmedItems, setConfirmedItems] = useState<ConfirmedOrderItem[]>([]);
  const [confirmedModalOpen, setConfirmedModalOpen] = useState(false);
  const [confirmedOrderDate, setConfirmedOrderDate] = useState(() => todayDateValue());
  const [confirmedCalendarOpen, setConfirmedCalendarOpen] = useState(false);
  const [loadingConfirmed, setLoadingConfirmed] = useState(false);
  const [savingConfirmation, setSavingConfirmation] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const freshScannerRef = useRef<Html5Qrcode | null>(null);
  const freshBarcodeHandlingRef = useRef(false);

  useEffect(() => {
    return () => {
      if (freshScannerRef.current?.isScanning) {
        freshScannerRef.current.stop().catch(() => undefined);
      }
    };
  }, []);

  const loadItems = useCallback(async () => {
    setLoading(true);
    const [supplierResult, productResult] = await Promise.all([
      loadSuppliers({ activeOnly: true }).catch(() => []),
      Services.DatabaseService.select("products", "*, inventory(*)").eq("store_id", currentStoreId).eq("is_active", true).order("name", { ascending: true })
    ]);
    const { data, error: loadError } = productResult;
    setSuppliers(supplierResult);
    if (loadError) {
      setError(loadError.message);
    } else {
      setItems(((data ?? []) as Parameters<typeof normalizeInventoryItem>[0][]).map((row) => normalizeInventoryItem(row)));
    }
    setLoading(false);
  }, [currentStoreId]);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  const lowStockItems = useMemo(() => {
    return items
      .filter((item) => item.fresh_order_selected || item.urgent_order_requested || (!item.receipt_check_only && item.is_low_stock))
      .sort((a, b) => {
        if (a.urgent_order_requested !== b.urgent_order_requested) {
          return a.urgent_order_requested ? -1 : 1;
        }
        if (a.fresh_order_selected !== b.fresh_order_selected) {
          return a.fresh_order_selected ? -1 : 1;
        }
        return a.name.localeCompare(b.name, "ko");
      });
  }, [items]);

  const freshProducts = useMemo(() => {
    const keyword = freshSearch.trim().toLocaleLowerCase("ko");
    return items.filter((item) => {
      return !keyword || item.name.toLocaleLowerCase("ko").includes(keyword);
    });
  }, [freshSearch, items]);

  const freshSearchActive = freshSearch.trim().length > 0;

  const freshProductsByCategory = useMemo(() => {
    const groups = new Map<string, InventoryItem[]>();
    freshProducts.forEach((item) => {
      const category = item.category || "기타";
      groups.set(category, [...(groups.get(category) ?? []), item]);
    });

    return [...groups.entries()]
      .map(([category, products]) => ({
        category,
        products: products.sort((a, b) => a.name.localeCompare(b.name, "ko")),
        selectedCount: products.filter((item) => selectedFreshIds.has(item.id)).length,
        urgentCount: products.filter((item) => selectedUrgentIds.has(item.id)).length
      }))
      .sort((a, b) => a.category.localeCompare(b.category, "ko"));
  }, [freshProducts, selectedFreshIds, selectedUrgentIds]);

  const suppliersByName = useMemo(() => {
    return new Map(suppliers.map((supplier) => [supplier.name, supplier]));
  }, [suppliers]);

  const itemsById = useMemo(() => {
    return new Map(items.map((item) => [item.id, item]));
  }, [items]);

  const todayOrderDate = todayDateValue();
  const canConfirmOrderItems = currentRole !== "staff";
  const confirmCheckedItems = useMemo(() => lowStockItems.filter((item) => item.order_completed), [lowStockItems]);

  const stopFreshScanner = useCallback(async () => {
    if (freshScannerRef.current?.isScanning) {
      await freshScannerRef.current.stop().catch(() => undefined);
    }
    freshBarcodeHandlingRef.current = false;
    setFreshScannerActive(false);
  }, []);

  function openFreshModal() {
    setError("");
    setFreshScanMessage("");
    setPendingFreshBarcode("");
    setFreshSearch("");
    setExpandedFreshCategory(null);
    setSelectedFreshIds(
      new Set(
        items
          .filter((item) => item.fresh_order_selected)
          .map((item) => item.id)
      )
    );
    setSelectedUrgentIds(
      new Set(
        items
          .filter((item) => item.urgent_order_requested)
          .map((item) => item.id)
      )
    );
    setFreshModalOpen(true);
  }

  async function closeFreshModal() {
    await stopFreshScanner();
    setFreshModalOpen(false);
    setFreshScanMessage("");
    setPendingFreshBarcode("");
  }

  function toggleFreshProduct(productId: string) {
    setSelectedFreshIds((current) => {
      const next = new Set(current);
      if (next.has(productId)) {
        next.delete(productId);
        setSelectedUrgentIds((urgentCurrent) => {
          const urgentNext = new Set(urgentCurrent);
          urgentNext.delete(productId);
          return urgentNext;
        });
      } else {
        next.add(productId);
      }
      return next;
    });
  }

  function toggleUrgentProduct(productId: string) {
    setSelectedUrgentIds((current) => {
      const next = new Set(current);
      if (next.has(productId)) {
        next.delete(productId);
      } else {
        next.add(productId);
        setSelectedFreshIds((freshCurrent) => new Set(freshCurrent).add(productId));
      }
      return next;
    });
  }

  const findProductByFreshBarcode = useCallback(async (barcode: string) => {
    const barcodeCandidates = getBarcodeCandidates(barcode);
    const { data, error: productError } = await Services.DatabaseService.select("products", "*")
      .eq("store_id", currentStoreId)
      .in("barcode", barcodeCandidates)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();
    if (productError) return { product: null, errorMessage: productError.message };
    if (data) return { product: data as InventoryItem, errorMessage: "" };

    const { data: barcodeData, error: barcodeError } = await Services.DatabaseService.select("product_barcodes", "product_id")
      .eq("store_id", currentStoreId)
      .in("barcode", barcodeCandidates)
      .limit(1)
      .maybeSingle();
    if (barcodeError) return { product: null, errorMessage: barcodeError.message };
    if (!barcodeData) return { product: null, errorMessage: "" };

    const { data: aliasProduct, error: aliasError } = await Services.DatabaseService.select("products", "*")
      .eq("store_id", currentStoreId)
      .eq("id", barcodeData.product_id)
      .eq("is_active", true)
      .maybeSingle();
    if (aliasError) return { product: null, errorMessage: aliasError.message };
    return { product: (aliasProduct as InventoryItem | null) ?? null, errorMessage: "" };
  }, [currentStoreId]);

  const handleFreshBarcode = useCallback(async (barcode: string) => {
    if (freshBarcodeHandlingRef.current) return;
    freshBarcodeHandlingRef.current = true;
    setFreshScanMessage(`스캔됨: ${barcode}`);
    await stopFreshScanner();

    const { product, errorMessage } = await findProductByFreshBarcode(barcode);
    if (errorMessage) {
      setFreshScanMessage(errorMessage);
      freshBarcodeHandlingRef.current = false;
      return;
    }

    if (!product) {
      setPendingFreshBarcode(barcode);
      setFreshScanMessage("");
      freshBarcodeHandlingRef.current = false;
      return;
    }

    setSelectedFreshIds((current) => new Set(current).add(product.id));
    setFreshSearch(product.name);
    setExpandedFreshCategory(product.category || "기타");
    setFreshScanMessage(`${product.name} 품목을 선택했습니다.`);
    freshBarcodeHandlingRef.current = false;
  }, [findProductByFreshBarcode, stopFreshScanner]);

  const startFreshScanner = useCallback(async () => {
    setFreshScanMessage("");
    setPendingFreshBarcode("");

    if (!("mediaDevices" in navigator)) {
      setFreshScanMessage("이 기기에서는 카메라를 사용할 수 없습니다.");
      return;
    }
    if (freshScannerRef.current?.isScanning) return;

    const scanner = new Html5Qrcode(FRESH_SCANNER_ID, {
      formatsToSupport: PRODUCT_BARCODE_FORMATS,
      experimentalFeatures: {
        useBarCodeDetectorIfSupported: true
      },
      verbose: false
    });
    freshScannerRef.current = scanner;
    freshBarcodeHandlingRef.current = false;
    setFreshScannerActive(true);
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));

    try {
      await scanner.start(
        { facingMode: { ideal: "environment" } },
        {
          fps: 12,
          qrbox: (viewfinderWidth, viewfinderHeight) => ({
            width: Math.floor(Math.min(viewfinderWidth * 0.92, 520)),
            height: Math.floor(Math.min(viewfinderHeight * 0.32, 150))
          }),
          aspectRatio: 4 / 3,
          disableFlip: true,
          videoConstraints: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1920 },
            height: { ideal: 1440 }
          }
        },
        (decodedText) => void handleFreshBarcode(decodedText),
        () => undefined
      );

      const focusConstraints: FocusMediaTrackConstraints = {
        advanced: [{ focusMode: "continuous" }]
      };
      await scanner.applyVideoConstraints(focusConstraints).catch(() => undefined);

      const zoomFeature = scanner.getRunningTrackCameraCapabilities().zoomFeature();
      if (zoomFeature.isSupported()) {
        const initialZoom = Math.min(zoomFeature.max(), Math.max(zoomFeature.min(), DEFAULT_CAMERA_ZOOM));
        await zoomFeature.apply(initialZoom).catch(() => undefined);
      }
    } catch (scanError) {
      setFreshScannerActive(false);
      setFreshScanMessage(scanError instanceof Error ? scanError.message : "카메라 실행에 실패했습니다.");
    }
  }, [handleFreshBarcode]);

  async function goToRegisterFreshBarcode() {
    const barcode = pendingFreshBarcode;
    if (!barcode) return;
    await closeFreshModal();
    navigate({ name: "register", barcode });
  }

  async function saveFreshProducts() {
    setSavingFresh(true);
    setError("");

    const changedItems = items.filter((item) => {
      const selected = selectedFreshIds.has(item.id);
      return item.fresh_order_selected !== selected || item.urgent_order_requested !== selectedUrgentIds.has(item.id) || (selected && !item.order_completed);
    });

    const results = await Promise.all(
      changedItems.map((item) => {
        const selected = selectedFreshIds.has(item.id);
        const urgent = selectedUrgentIds.has(item.id);
        return Services.DatabaseService.update("products", {
            fresh_order_selected: selected,
            fresh_order_selected_at: selected ? new Date().toISOString() : null,
            urgent_order_requested: urgent,
            urgent_order_quantity: urgent ? item.urgent_order_quantity : null,
            order_completed: selected ? true : item.order_completed
          })
          .eq("store_id", currentStoreId)
          .eq("id", item.id);
      })
    );
    const saveError = results.find((result) => result.error)?.error;

    if (saveError) {
      setError(saveError.message);
      await loadItems();
    } else {
      setItems((current) =>
        current.map((item) =>
          ({
            ...item,
            fresh_order_selected: selectedFreshIds.has(item.id),
            fresh_order_selected_at: selectedFreshIds.has(item.id) ? item.fresh_order_selected_at ?? new Date().toISOString() : null,
            urgent_order_requested: selectedUrgentIds.has(item.id),
            urgent_order_quantity: selectedUrgentIds.has(item.id) ? item.urgent_order_quantity : null,
            order_completed: selectedFreshIds.has(item.id) ? true : item.order_completed
          })
        )
      );
      await closeFreshModal();
    }

    setSavingFresh(false);
  }

  async function loadConfirmedItems(orderDate = confirmedOrderDate) {
    setLoadingConfirmed(true);
    setError("");
    const { data, error: loadError } = await Services.DatabaseService.select("confirmed_order_items", "*")
      .eq("store_id", currentStoreId)
      .eq("order_date", orderDate)
      .order("urgent_order_requested", { ascending: false })
      .order("product_name", { ascending: true });

    if (loadError) {
      setError(loadError.message);
    } else {
      setConfirmedItems((data ?? []) as ConfirmedOrderItem[]);
    }
    setLoadingConfirmed(false);
  }

  async function openConfirmedModal() {
    const orderDate = todayDateValue();
    setConfirmedOrderDate(orderDate);
    setConfirmedCalendarOpen(false);
    setConfirmedModalOpen(true);
    await loadConfirmedItems(orderDate);
  }

  async function changeConfirmedOrderDate(orderDate: string) {
    setConfirmedOrderDate(orderDate);
    await loadConfirmedItems(orderDate);
  }

  async function moveConfirmedOrderDate(dayOffset: number) {
    const nextDate = shiftDateValue(confirmedOrderDate, dayOffset);
    setConfirmedCalendarOpen(false);
    await changeConfirmedOrderDate(nextDate);
  }

  async function confirmTodayOrderItems() {
    if (!canConfirmOrderItems) {
      setError("관리자만 발주 품목을 확정할 수 있습니다.");
      return;
    }
    if (confirmCheckedItems.length === 0) {
      setError("확정할 품목을 먼저 컨펌 체크하세요.");
      return;
    }

    const ok = window.confirm(`컨펌 체크한 ${confirmCheckedItems.length}개 품목을 오늘 발주 품목으로 확정할까요?\n기존 당일 확정 목록은 선택한 품목으로 교체됩니다.`);
    if (!ok) return;

    setSavingConfirmation(true);
    setError("");
    setMessage("");

    const { error: deleteError } = await Services.DatabaseService.delete("confirmed_order_items")
      .eq("store_id", currentStoreId)
      .eq("order_date", todayOrderDate);

    if (deleteError) {
      setError(deleteError.message);
      setSavingConfirmation(false);
      return;
    }

    const confirmedAt = new Date().toISOString();
    const rows = confirmCheckedItems.map((item) => ({
      store_id: currentStoreId,
      order_date: todayOrderDate,
      product_id: item.id,
      product_name: item.name,
      category: item.category || "기타",
      supplier_name: item.supplier_name,
      total_stock: item.receipt_check_only ? null : item.total_stock,
      minimum_stock: item.receipt_check_only ? null : item.minimum_stock,
      is_low_stock: !item.receipt_check_only && item.is_low_stock,
      fresh_order_selected: item.fresh_order_selected,
      urgent_order_requested: item.urgent_order_requested,
      urgent_order_quantity: item.urgent_order_quantity,
      order_completed: item.order_completed,
      confirmed_at: confirmedAt
    }));

    const { error: insertError } = await Services.DatabaseService.insert("confirmed_order_items", rows);
    if (insertError) {
      setError(insertError.message);
    } else {
      setConfirmedItems(rows.map((row, index) => ({
        id: `${row.product_id}-${index}`,
        confirmed_by: null,
        created_at: confirmedAt,
        ...row
      })));
      setMessage(`오늘 발주 품목 ${rows.length}개를 확정했습니다.`);
    }
    setSavingConfirmation(false);
  }

  async function deleteUrgentOrder(item: InventoryItem) {
    setError("");
    setDeletingUrgentIds((current) => new Set(current).add(item.id));
    setItems((current) => current.map((product) => (product.id === item.id ? { ...product, urgent_order_requested: false, urgent_order_quantity: null } : product)));

    const { error: updateError } = await Services.DatabaseService.update("products", { urgent_order_requested: false, urgent_order_quantity: null })
      .eq("store_id", currentStoreId)
      .eq("id", item.id);

    if (updateError) {
      setItems((current) => current.map((product) => (product.id === item.id ? item : product)));
      setError(updateError.message);
    }

    setDeletingUrgentIds((current) => {
      const next = new Set(current);
      next.delete(item.id);
      return next;
    });
  }

  async function toggleOrderCompleted(item: InventoryItem, checked: boolean) {
    setError("");
    setUpdatingOrderIds((current) => new Set(current).add(item.id));
    setItems((current) => current.map((product) => (product.id === item.id ? { ...product, order_completed: checked } : product)));

    const { error: updateError } = await Services.DatabaseService.update("products", { order_completed: checked }).eq("store_id", currentStoreId).eq("id", item.id);
    if (updateError) {
      setItems((current) => current.map((product) => (product.id === item.id ? { ...product, order_completed: item.order_completed } : product)));
      setError(updateError.message);
    }

    setUpdatingOrderIds((current) => {
      const next = new Set(current);
      next.delete(item.id);
      return next;
    });
  }

  async function completeFreshReceiving(item: InventoryItem) {
    setError("");
    setCompletingFreshIds((current) => new Set(current).add(item.id));

    const receiptResult = item.receipt_check_only
      ? await recordReceiptCheckOnly(item.id, currentStoreId)
      : await recordReceiptCompletion(item.id, currentStoreId);

    if (receiptResult.errorMessage) {
      setError(receiptResult.errorMessage);
    } else {
      setFreshReceivingUndoStack((current) => [
        ...current,
        {
          productId: item.id,
          freshOrderSelected: item.fresh_order_selected,
          freshOrderSelectedAt: item.fresh_order_selected_at,
          urgentOrderRequested: item.urgent_order_requested,
          urgentOrderQuantity: item.urgent_order_quantity,
          orderCompleted: item.order_completed,
          receiptLogId: receiptResult.logId
        }
      ]);
      setItems((current) =>
        current.map((product) =>
          product.id === item.id
            ? {
                ...product,
                fresh_order_selected: false,
                fresh_order_selected_at: null,
                urgent_order_requested: false,
                urgent_order_quantity: null,
                order_completed: false
              }
            : product
        )
      );
    }

    setCompletingFreshIds((current) => {
      const next = new Set(current);
      next.delete(item.id);
      return next;
    });
  }

  function handleReceiptComplete(item: InventoryItem) {
    if (item.fresh_order_selected || item.receipt_check_only || item.order_completed) {
      void completeFreshReceiving(item);
      return;
    }
    navigate({ name: "operation", productId: item.id });
  }

  async function undoFreshReceiving() {
    const previous = freshReceivingUndoStack[freshReceivingUndoStack.length - 1];
    if (!previous) return;

    setError("");
    setUndoingFreshReceiving(true);

    const { data: userData } = await Services.AuthService.getUser();
    if (!userData.user) {
      setError("로그인이 필요합니다.");
      setUndoingFreshReceiving(false);
      return;
    }

    const { error: updateError } = await Services.DatabaseService.update("products", {
        fresh_order_selected: previous.freshOrderSelected,
        fresh_order_selected_at: previous.freshOrderSelectedAt,
        urgent_order_requested: previous.urgentOrderRequested,
        urgent_order_quantity: previous.urgentOrderQuantity,
        order_completed: previous.orderCompleted
      })
      .eq("store_id", currentStoreId)
      .eq("id", previous.productId);

    if (updateError) {
      setError(updateError.message);
      setUndoingFreshReceiving(false);
      return;
    }

    if (previous.receiptLogId) {
      const { error: logUndoError } = await Services.DatabaseService.update("inventory_logs", {
          reverted_at: new Date().toISOString(),
          reverted_by: userData.user.id
        })
        .eq("store_id", currentStoreId)
        .eq("id", previous.receiptLogId);

      if (logUndoError) {
        setError(logUndoError.message);
        setUndoingFreshReceiving(false);
        return;
      }
    }

    setItems((current) =>
      current.map((product) =>
        product.id === previous.productId
          ? {
              ...product,
              fresh_order_selected: previous.freshOrderSelected,
              fresh_order_selected_at: previous.freshOrderSelectedAt,
              urgent_order_requested: previous.urgentOrderRequested,
              urgent_order_quantity: previous.urgentOrderQuantity,
              order_completed: previous.orderCompleted
            }
          : product
      )
    );
    setFreshReceivingUndoStack((current) => current.slice(0, -1));

    setUndoingFreshReceiving(false);
  }

  return (
    <section>
      <PageTitle
        title="부족 재고"
        description="총재고가 최소재고 이하인 품목입니다."
        action={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={openFreshModal}
              className="touch-button rounded-md bg-brand-600 px-3 text-sm font-bold text-white"
            >
              발주품목 추가
            </button>
            {canConfirmOrderItems ? (
              <button
                type="button"
                disabled={savingConfirmation || loading || confirmCheckedItems.length === 0}
                onClick={() => void confirmTodayOrderItems()}
                className="touch-button inline-flex items-center gap-1 rounded-md bg-brand-600 px-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500 dark:disabled:bg-slate-800"
              >
                <CheckCircle2 size={18} />
                {savingConfirmation ? "확정 중" : "컨펌하기"}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => void openConfirmedModal()}
              className="touch-button inline-flex items-center gap-1 rounded-md border border-brand-600 px-3 text-sm font-bold text-brand-700 dark:text-brand-100"
            >
              <ClipboardList size={18} />
              확정품목 확인하기
            </button>
            <button
              type="button"
              disabled={freshReceivingUndoStack.length === 0 || undoingFreshReceiving}
              onClick={() => void undoFreshReceiving()}
              className="touch-button rounded-md border border-brand-600 px-3 text-sm font-bold text-brand-700 disabled:cursor-not-allowed disabled:border-slate-300 disabled:text-slate-400 disabled:opacity-60 dark:text-brand-100 dark:disabled:border-slate-700 dark:disabled:text-slate-600"
            >
              {undoingFreshReceiving ? "되돌리는 중" : `입고완료 되돌리기 (${freshReceivingUndoStack.length})`}
            </button>
          </div>
        }
      />

      {loading ? (
        <div role="status" aria-live="polite" aria-label="부족 재고를 불러오는 중">
          <span className="sr-only">부족 재고를 불러오는 중...</span>
          <div className="sm:hidden">
            <LowStockCardSkeleton />
          </div>
          <div className="hidden sm:block">
            <InventoryTableSkeleton rows={6} />
          </div>
        </div>
      ) : null}
      {error ? <StatusMessage type="error">{error}</StatusMessage> : null}
      {message ? <div className="mt-2"><StatusMessage type="success">{message}</StatusMessage></div> : null}

      {!loading && !error ? (
        <>
          <div className="space-y-2 sm:hidden">
            {lowStockItems.map((item) => (
              <div
                key={item.id}
                onClick={() => navigate({ name: "operation", productId: item.id })}
                className={`cursor-pointer rounded-md border p-3 ${
                  item.fresh_order_selected
                    ? "border-brand-200 bg-brand-50 dark:border-brand-800 dark:bg-brand-950"
                    : "border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
                }`}
              >
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <span className="break-words text-base font-bold leading-snug">{item.name}</span>
                  {item.urgent_order_requested ? (
                    <span className="rounded-full bg-red-600 px-2 py-1 text-xs font-bold text-white">
                      {item.urgent_order_quantity ? `긴급 ${item.urgent_order_quantity}개` : "긴급"}
                    </span>
                  ) : null}
                  {item.fresh_order_selected ? (
                    <span className="rounded-full bg-brand-600 px-2 py-1 text-xs font-bold text-white">추가</span>
                  ) : null}
                </div>
                <div className="grid grid-cols-[1fr_1fr_auto_auto] items-center gap-2 text-sm">
                  <div>
                    <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">총재고</p>
                    <p className="font-bold tabular-nums text-red-700 dark:text-red-200">
                      {item.receipt_check_only ? "-" : formatInventoryQuantity(item.total_stock)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">최소</p>
                    <p className="tabular-nums">{item.receipt_check_only ? "-" : item.minimum_stock}</p>
                  </div>
                  <div className="flex min-w-[154px] flex-wrap items-end justify-end gap-2" onClick={(event) => event.stopPropagation()}>
                    <label className="flex flex-col items-center gap-1 text-xs font-bold text-slate-600 dark:text-slate-300">
                      컨펌
                      <input
                        type="checkbox"
                        checked={item.order_completed}
                        disabled={updatingOrderIds.has(item.id)}
                        onChange={(event) => void toggleOrderCompleted(item, event.target.checked)}
                        aria-label={`${item.name} 컨펌`}
                        className="h-6 w-6 rounded border-slate-300 accent-brand-600 disabled:opacity-45"
                      />
                    </label>
                    <button
                      type="button"
                      disabled={completingFreshIds.has(item.id)}
                      onClick={() => handleReceiptComplete(item)}
                      className="min-h-9 whitespace-nowrap rounded-md bg-brand-600 px-3 text-xs font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500 dark:disabled:bg-slate-800"
                    >
                      입고 완료
                    </button>
                    {item.urgent_order_requested ? (
                      <button
                        type="button"
                        disabled={deletingUrgentIds.has(item.id)}
                        onClick={() => void deleteUrgentOrder(item)}
                        className="min-h-9 whitespace-nowrap rounded-md border border-red-200 px-2 text-xs font-bold text-red-700 disabled:cursor-not-allowed disabled:opacity-45 dark:border-red-900 dark:text-red-200"
                      >
                        삭제
                      </button>
                    ) : null}
                  </div>
                  <ProductOrderAction
                    item={item}
                    supplier={item.supplier_name ? suppliersByName.get(item.supplier_name) ?? null : null}
                    quantity={orderQuantities[item.id] ?? ""}
                    onQuantityChange={(quantity) => setOrderQuantities((current) => ({ ...current, [item.id]: quantity }))}
                  />
                </div>
              </div>
            ))}
          </div>

          <div className="panel hidden overflow-visible sm:block">
            <table className="w-full table-fixed text-left text-sm">
              <thead className="sticky top-[73px] z-20 bg-slate-100 text-xs text-slate-600 shadow-sm dark:bg-slate-900 dark:text-slate-300">
                <tr>
                  <th className="px-3 py-3">상품명</th>
                  <th className="w-16 px-2 py-3 text-right">총재고</th>
                  <th className="w-16 px-2 py-3 text-right">최소</th>
                  <th className="w-[92px] px-2 py-3 text-center">컨펌</th>
                  <th className="w-[96px] px-2 py-3 text-center">입고완료</th>
                  <th className="w-[122px] px-2 py-3 text-center">발주</th>
                </tr>
              </thead>
              <tbody>
                {lowStockItems.map((item) => (
                  <tr
                    key={item.id}
                    onClick={() => navigate({ name: "operation", productId: item.id })}
                    className={`cursor-pointer border-t ${
                      item.fresh_order_selected
                        ? "border-brand-200 bg-brand-50 dark:border-brand-800 dark:bg-brand-950"
                        : "border-slate-100 dark:border-slate-900"
                    }`}
                  >
                    <td className="px-3 py-3 font-semibold">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="truncate">{item.name}</span>
                        {item.urgent_order_requested ? (
                          <span className="shrink-0 rounded-full bg-red-600 px-2 py-1 text-xs font-bold text-white">
                            {item.urgent_order_quantity ? `긴급 ${item.urgent_order_quantity}개` : "긴급"}
                          </span>
                        ) : null}
                        {item.fresh_order_selected ? (
                          <span className="shrink-0 rounded-full bg-brand-600 px-2 py-1 text-xs font-bold text-white">추가</span>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-2 py-3 text-right font-bold tabular-nums text-red-700 dark:text-red-200">
                      {item.receipt_check_only ? "-" : formatInventoryQuantity(item.total_stock)}
                    </td>
                    <td className="px-2 py-3 text-right tabular-nums">{item.receipt_check_only ? "-" : item.minimum_stock}</td>
                    <td className="px-2 py-2 text-center" onClick={(event) => event.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={item.order_completed}
                        disabled={updatingOrderIds.has(item.id)}
                        onChange={(event) => void toggleOrderCompleted(item, event.target.checked)}
                        aria-label={`${item.name} 컨펌`}
                        className="h-6 w-6 rounded border-slate-300 accent-brand-600 disabled:opacity-45"
                      />
                      {item.urgent_order_requested ? (
                        <button
                          type="button"
                          disabled={deletingUrgentIds.has(item.id)}
                          onClick={() => void deleteUrgentOrder(item)}
                          className="mt-2 min-h-9 w-full rounded-md border border-red-200 px-2 text-xs font-bold text-red-700 disabled:cursor-not-allowed disabled:opacity-45 dark:border-red-900 dark:text-red-200"
                        >
                          삭제
                        </button>
                      ) : null}
                    </td>
                    <td className="px-2 py-2 text-center" onClick={(event) => event.stopPropagation()}>
                      <button
                        type="button"
                        disabled={completingFreshIds.has(item.id)}
                        onClick={() => handleReceiptComplete(item)}
                        className="min-h-9 w-full rounded-md bg-brand-600 px-2 text-xs font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500 dark:disabled:bg-slate-800"
                      >
                        입고 완료
                      </button>
                    </td>
                    <td className="px-2 py-2 text-center">
                      <ProductOrderAction
                        item={item}
                        supplier={item.supplier_name ? suppliersByName.get(item.supplier_name) ?? null : null}
                        quantity={orderQuantities[item.id] ?? ""}
                        onQuantityChange={(quantity) => setOrderQuantities((current) => ({ ...current, [item.id]: quantity }))}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {lowStockItems.length === 0 ? <StatusMessage type="success">부족 재고가 없습니다.</StatusMessage> : null}

          {freshModalOpen ? (
            <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/55 px-4 py-6">
              <div className="flex max-h-[85dvh] w-full max-w-lg flex-col overflow-hidden rounded-lg bg-white shadow-xl dark:bg-slate-900">
                <div className="flex items-start justify-between gap-3 border-b border-slate-200 p-4 dark:border-slate-800">
                  <div>
                    <h2 className="text-lg font-bold">발주품목 추가</h2>
                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">부족 재고 화면에 표시할 품목을 선택합니다.</p>
                  </div>
                  <button
                    type="button"
                    disabled={savingFresh}
                    onClick={() => void saveFreshProducts()}
                    className="touch-button shrink-0 rounded-md bg-brand-600 px-4 text-sm font-bold text-white disabled:opacity-50"
                  >
                    {savingFresh ? "저장 중" : "저장"}
                  </button>
                </div>

                <div className="border-b border-slate-200 p-4 dark:border-slate-800">
                  <div className="grid grid-cols-[1fr_auto] gap-2">
                    <label className="relative block min-w-0">
                      <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
                      <input
                        className="field pl-10 pr-10"
                        value={freshSearch}
                        onChange={(event) => setFreshSearch(event.target.value)}
                        placeholder="품목 검색"
                        autoFocus
                      />
                      {freshSearch ? (
                        <button
                          type="button"
                          onClick={() => setFreshSearch("")}
                          className="absolute right-1 top-1/2 inline-flex h-10 w-10 -translate-y-1/2 items-center justify-center text-slate-500"
                          aria-label="검색어 지우기"
                        >
                          <X size={19} />
                        </button>
                      ) : null}
                    </label>
                    <button
                      type="button"
                      onClick={() => (freshScannerActive ? void stopFreshScanner() : void startFreshScanner())}
                      className={`touch-button icon-button ${freshScannerActive ? "border-brand-600 bg-brand-600 text-white dark:bg-brand-600 dark:text-white" : ""}`}
                      aria-label={freshScannerActive ? "바코드 스캔 중지" : "바코드 스캔"}
                      title={freshScannerActive ? "스캔 중지" : "바코드 스캔"}
                    >
                      {freshScannerActive ? <X size={20} /> : <ScanLine size={20} />}
                    </button>
                  </div>
                  <div className={`mt-3 overflow-hidden rounded-md bg-slate-900 ${freshScannerActive ? "block" : "hidden"}`}>
                    <div id={FRESH_SCANNER_ID} className="min-h-[240px]" />
                  </div>
                  {freshScannerActive ? (
                    <p className="mt-2 rounded-md bg-slate-100 px-3 py-2 text-xs font-bold text-slate-600 dark:bg-slate-950 dark:text-slate-300">
                      바코드 전체가 화면 안에 들어오도록 맞춰 주세요.
                    </p>
                  ) : null}
                  {freshScanMessage ? (
                    <div className="mt-2">
                      <StatusMessage type={freshScanMessage.includes("아닙니다") || freshScanMessage.includes("실패") ? "error" : "info"}>{freshScanMessage}</StatusMessage>
                    </div>
                  ) : null}
                  <p className="mt-2 text-right text-xs font-bold text-brand-700 dark:text-brand-100">
                    {selectedFreshIds.size}개 선택
                  </p>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto p-3">
                  <div className="space-y-2">
                    {freshSearchActive ? (
                      freshProducts.map((item) => {
                        const selected = selectedFreshIds.has(item.id);
                        const urgent = selectedUrgentIds.has(item.id);

                        return (
                          <div
                            key={item.id}
                            className={`flex min-h-14 cursor-pointer items-center gap-3 rounded-md border px-3 py-2 ${
                              selected
                                ? "border-brand-500 bg-brand-50 dark:bg-brand-950"
                                : "border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900"
                            }`}
                          >
                            <label className="grid h-8 w-8 shrink-0 place-items-center" aria-label={`${item.name} 발주품목 선택`}>
                              <input
                                type="checkbox"
                                checked={selected}
                                onChange={() => toggleFreshProduct(item.id)}
                                className="h-6 w-6 rounded border-slate-300 accent-brand-600"
                              />
                            </label>
                            <span className="min-w-0 flex-1 break-words font-bold">{item.name}</span>
                            <label className="flex shrink-0 flex-col items-center gap-1 text-xs font-bold text-red-700 dark:text-red-200">
                              긴급
                              <input
                                type="checkbox"
                                checked={urgent}
                                onChange={() => toggleUrgentProduct(item.id)}
                                className="h-6 w-6 rounded border-slate-300 accent-red-600"
                              />
                            </label>
                          </div>
                        );
                      })
                    ) : freshProductsByCategory.map(({ category, products, selectedCount, urgentCount }) => {
                      const expanded = expandedFreshCategory === category;

                      return (
                        <div key={category} className="overflow-hidden rounded-md border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
                          <button
                            type="button"
                            onClick={() => setExpandedFreshCategory(expanded ? null : category)}
                            className="flex min-h-14 w-full items-center justify-between gap-3 px-3 py-2 text-left"
                          >
                            <span className="min-w-0 flex-1 break-words font-bold">{category}</span>
                            <span className="shrink-0 rounded-full bg-slate-100 px-2 py-1 text-xs font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                              {selectedCount}/{products.length}{urgentCount > 0 ? ` 긴급 ${urgentCount}` : ""}
                            </span>
                          </button>

                          {expanded ? (
                            <div className="border-t border-slate-200 p-2 dark:border-slate-700">
                              <div className="space-y-2">
                                {products.map((item) => {
                                  const selected = selectedFreshIds.has(item.id);
                                  const urgent = selectedUrgentIds.has(item.id);

                                  return (
                                    <div
                                      key={item.id}
                                      className={`flex min-h-14 cursor-pointer items-center gap-3 rounded-md border px-3 py-2 ${
                                        selected
                                          ? "border-brand-500 bg-brand-50 dark:bg-brand-950"
                                          : "border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900"
                                      }`}
                                    >
                                      <label className="grid h-8 w-8 shrink-0 place-items-center" aria-label={`${item.name} 발주품목 선택`}>
                                        <input
                                          type="checkbox"
                                          checked={selected}
                                          onChange={() => toggleFreshProduct(item.id)}
                                          className="h-6 w-6 rounded border-slate-300 accent-brand-600"
                                        />
                                      </label>
                                      <span className="min-w-0 flex-1 break-words font-bold">{item.name}</span>
                                      <label className="flex shrink-0 flex-col items-center gap-1 text-xs font-bold text-red-700 dark:text-red-200">
                                        긴급
                                        <input
                                          type="checkbox"
                                          checked={urgent}
                                          onChange={() => toggleUrgentProduct(item.id)}
                                          className="h-6 w-6 rounded border-slate-300 accent-red-600"
                                        />
                                      </label>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          ) : null}
                        </div>
                      );
                    })}

                    {freshProducts.length === 0 ? <StatusMessage>검색 결과가 없습니다.</StatusMessage> : null}
                  </div>
                </div>

                <div className="border-t border-slate-200 p-3 dark:border-slate-800">
                  <button
                    type="button"
                    onClick={() => void closeFreshModal()}
                    disabled={savingFresh}
                    className="touch-button w-full rounded-md border border-slate-300 px-4 font-bold dark:border-slate-700"
                  >
                    닫기
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {confirmedModalOpen ? (
            <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/55 px-4 py-6">
              <div className="flex max-h-[85dvh] w-full max-w-lg flex-col overflow-hidden rounded-lg bg-white shadow-xl dark:bg-slate-900">
                <div className="flex items-start justify-between gap-3 border-b border-slate-200 p-4 dark:border-slate-800">
                  <div className="min-w-0">
                    <h2 className="text-lg font-bold">확정품목 확인하기</h2>
                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{confirmedOrderDate} 확정 발주 품목</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setConfirmedModalOpen(false)}
                    className="icon-button touch-button shrink-0"
                    aria-label="확정품목 닫기"
                    title="닫기"
                  >
                    <X size={20} />
                  </button>
                </div>

                <div className="border-b border-slate-200 p-3 dark:border-slate-800">
                  <div className="grid grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void moveConfirmedOrderDate(-1)}
                      disabled={loadingConfirmed}
                      className="icon-button touch-button"
                      aria-label="전날 확정품목 보기"
                      title="전날"
                    >
                      <ChevronLeft size={20} />
                    </button>
                    <div className="min-w-0 rounded-md bg-slate-100 px-3 py-2 text-center text-sm font-bold tabular-nums text-slate-700 dark:bg-slate-950 dark:text-slate-100">
                      {confirmedOrderDate}
                    </div>
                    <button
                      type="button"
                      onClick={() => void moveConfirmedOrderDate(1)}
                      disabled={loadingConfirmed}
                      className="icon-button touch-button"
                      aria-label="다음날 확정품목 보기"
                      title="다음날"
                    >
                      <ChevronRight size={20} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmedCalendarOpen((value) => !value)}
                      className="icon-button touch-button text-brand-700 dark:text-brand-100"
                      aria-label="날짜 선택"
                      title="날짜 선택"
                    >
                      <CalendarDays size={19} />
                    </button>
                  </div>
                  {confirmedCalendarOpen ? (
                    <input
                      type="date"
                      value={confirmedOrderDate}
                      onChange={(event) => void changeConfirmedOrderDate(event.target.value)}
                      className="field mt-2 w-full"
                      aria-label="확정품목 조회 날짜"
                    />
                  ) : null}
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto p-3">
                  {loadingConfirmed ? <StatusMessage>확정 품목을 불러오는 중...</StatusMessage> : null}
                  {!loadingConfirmed && confirmedItems.length === 0 ? <StatusMessage>선택한 날짜에 확정된 품목이 없습니다.</StatusMessage> : null}
                  {!loadingConfirmed && confirmedItems.length > 0 ? (
                    <div className="space-y-2">
                      {confirmedItems.map((item) => {
                        const product = itemsById.get(item.product_id);

                        return (
                          <div key={item.id} className="rounded-md border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-950">
                            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="min-w-0 flex-1 break-words font-bold">{item.product_name}</span>
                                  {item.urgent_order_requested ? (
                                    <span className="rounded-full bg-red-600 px-2 py-1 text-xs font-bold text-white">
                                      {item.urgent_order_quantity ? `긴급 ${item.urgent_order_quantity}개` : "긴급"}
                                    </span>
                                  ) : null}
                                  {item.fresh_order_selected ? (
                                    <span className="rounded-full bg-brand-600 px-2 py-1 text-xs font-bold text-white">추가</span>
                                  ) : null}
                                  {item.is_low_stock ? (
                                    <span className="rounded-full bg-amber-500 px-2 py-1 text-xs font-bold text-white">부족</span>
                                  ) : null}
                                </div>
                                <div className="mt-2 grid grid-cols-2 gap-2 text-xs font-semibold text-slate-500 dark:text-slate-400">
                                  <span>카테고리: {item.category}</span>
                                  <span>발주처: {item.supplier_name || "미지정"}</span>
                                  <span>총재고: {item.total_stock === null ? "-" : formatInventoryQuantity(item.total_stock)}</span>
                                  <span>최소: {item.minimum_stock ?? "-"}</span>
                                </div>
                              </div>
                              {product ? (
                                <ProductOrderAction
                                  item={product}
                                  supplier={item.supplier_name ? suppliersByName.get(item.supplier_name) ?? null : null}
                                  quantity={orderQuantities[item.product_id] ?? ""}
                                  onQuantityChange={(quantity) => setOrderQuantities((current) => ({ ...current, [item.product_id]: quantity }))}
                                />
                              ) : null}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </div>

                <div className="border-t border-slate-200 p-3 dark:border-slate-800">
                  <button
                    type="button"
                    onClick={() => setConfirmedModalOpen(false)}
                    className="touch-button w-full rounded-md border border-slate-300 px-4 font-bold dark:border-slate-700"
                  >
                    닫기
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {pendingFreshBarcode ? (
            <div className="fixed inset-0 z-[60] grid place-items-center bg-slate-950/60 px-4">
              <div className="w-full max-w-sm rounded-lg bg-white p-4 shadow-xl dark:bg-slate-900">
                <h2 className="text-lg font-extrabold">신규 등록하시겠습니까?</h2>
                <p className="mt-2 text-sm font-semibold text-slate-500 dark:text-slate-400">등록되지 않은 바코드입니다.</p>
                <p className="mt-2 rounded-md bg-slate-100 px-3 py-2 text-sm font-bold tabular-nums dark:bg-slate-950">{pendingFreshBarcode}</p>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setPendingFreshBarcode("")}
                    className="touch-button rounded-md border border-slate-300 px-4 font-bold dark:border-slate-700"
                  >
                    아니요
                  </button>
                  <button
                    type="button"
                    onClick={() => void goToRegisterFreshBarcode()}
                    className="touch-button rounded-md bg-brand-600 px-4 font-bold text-white"
                  >
                    예
                  </button>
                </div>
              </div>
            </div>
          ) : null}

        </>
      ) : null}
    </section>
  );
}
