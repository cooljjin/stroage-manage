import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";
import { ScanLine, Search, X } from "lucide-react";
import { PageTitle } from "../components/PageTitle";
import { ProductOrderAction } from "../components/ProductOrderAction";
import { StatusMessage } from "../components/StatusMessage";
import { normalizeInventoryItem } from "../lib/inventory";
import { loadSuppliers } from "../lib/suppliers";
import { supabase } from "../lib/supabase";
import type { AppRoute, InventoryItem, ProductSupplier } from "../types/domain";

type Props = {
  navigate: (route: AppRoute) => void;
};

type FreshReceivingUndoEntry = {
  productId: string;
  freshOrderSelected: boolean;
  freshOrderSelectedAt: string | null;
};

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

export function LowStockPage({ navigate }: Props) {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [suppliers, setSuppliers] = useState<ProductSupplier[]>([]);
  const [orderQuantities, setOrderQuantities] = useState<Record<string, string>>({});
  const [updatingOrderIds, setUpdatingOrderIds] = useState<Set<string>>(new Set());
  const [completingFreshIds, setCompletingFreshIds] = useState<Set<string>>(new Set());
  const [freshReceivingUndoStack, setFreshReceivingUndoStack] = useState<FreshReceivingUndoEntry[]>([]);
  const [undoingFreshReceiving, setUndoingFreshReceiving] = useState(false);
  const [urgentModalOpen, setUrgentModalOpen] = useState(false);
  const [urgentProductId, setUrgentProductId] = useState("");
  const [urgentSearch, setUrgentSearch] = useState("");
  const [urgentDirectInput, setUrgentDirectInput] = useState(false);
  const [urgentDirectName, setUrgentDirectName] = useState("");
  const [urgentQuantity, setUrgentQuantity] = useState("");
  const [savingUrgent, setSavingUrgent] = useState(false);
  const [deletingUrgentIds, setDeletingUrgentIds] = useState<Set<string>>(new Set());
  const [freshModalOpen, setFreshModalOpen] = useState(false);
  const [freshSearch, setFreshSearch] = useState("");
  const [selectedFreshIds, setSelectedFreshIds] = useState<Set<string>>(new Set());
  const [savingFresh, setSavingFresh] = useState(false);
  const [freshScannerActive, setFreshScannerActive] = useState(false);
  const [freshScanMessage, setFreshScanMessage] = useState("");
  const [pendingFreshBarcode, setPendingFreshBarcode] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const freshScannerRef = useRef<Html5Qrcode | null>(null);
  const freshBarcodeHandlingRef = useRef(false);

  useEffect(() => {
    void loadItems();
  }, []);

  useEffect(() => {
    return () => {
      if (freshScannerRef.current?.isScanning) {
        freshScannerRef.current.stop().catch(() => undefined);
      }
    };
  }, []);

  async function loadItems() {
    setLoading(true);
    const [supplierResult, productResult] = await Promise.all([
      loadSuppliers({ activeOnly: true }).catch(() => []),
      supabase.from("products").select("*, inventory(*)").eq("is_active", true).order("name", { ascending: true })
    ]);
    const { data, error: loadError } = productResult;
    setSuppliers(supplierResult);
    if (loadError) {
      setError(loadError.message);
    } else {
      setItems((data ?? []).map((row) => normalizeInventoryItem(row as Parameters<typeof normalizeInventoryItem>[0])));
    }
    setLoading(false);
  }

  const lowStockItems = useMemo(() => {
    return items
      .filter((item) => item.is_low_stock || item.fresh_order_selected || item.urgent_order_requested)
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
      if (item.supplier_name !== "쿠팡 프레시") return false;
      return !keyword || item.name.toLocaleLowerCase("ko").includes(keyword);
    });
  }, [freshSearch, items]);

  const urgentSearchResults = useMemo(() => {
    const keyword = urgentSearch.trim().toLocaleLowerCase("ko");
    if (!keyword) return [];

    return items
      .filter((item) => item.name.toLocaleLowerCase("ko").includes(keyword) || (item.barcode ?? "").toLocaleLowerCase("ko").includes(keyword))
      .slice(0, 8);
  }, [items, urgentSearch]);

  const suppliersByName = useMemo(() => {
    return new Map(suppliers.map((supplier) => [supplier.name, supplier]));
  }, [suppliers]);

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
    setSelectedFreshIds(new Set(items.filter((item) => item.supplier_name === "쿠팡 프레시" && item.fresh_order_selected).map((item) => item.id)));
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
      } else {
        next.add(productId);
      }
      return next;
    });
  }

  async function findProductByFreshBarcode(barcode: string) {
    const barcodeCandidates = getBarcodeCandidates(barcode);
    const { data, error: productError } = await supabase
      .from("products")
      .select("*")
      .in("barcode", barcodeCandidates)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();
    if (productError) return { product: null, errorMessage: productError.message };
    if (data) return { product: data as InventoryItem, errorMessage: "" };

    const { data: barcodeData, error: barcodeError } = await supabase
      .from("product_barcodes")
      .select("product_id")
      .in("barcode", barcodeCandidates)
      .limit(1)
      .maybeSingle();
    if (barcodeError) return { product: null, errorMessage: barcodeError.message };
    if (!barcodeData) return { product: null, errorMessage: "" };

    const { data: aliasProduct, error: aliasError } = await supabase
      .from("products")
      .select("*")
      .eq("id", barcodeData.product_id)
      .eq("is_active", true)
      .maybeSingle();
    if (aliasError) return { product: null, errorMessage: aliasError.message };
    return { product: (aliasProduct as InventoryItem | null) ?? null, errorMessage: "" };
  }

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

    if (product.supplier_name !== "쿠팡 프레시") {
      setFreshScanMessage("쿠팡프레시 제품이 아닙니다.");
      freshBarcodeHandlingRef.current = false;
      return;
    }

    setSelectedFreshIds((current) => new Set(current).add(product.id));
    setFreshSearch(product.name);
    setFreshScanMessage(`${product.name} 품목을 선택했습니다.`);
    freshBarcodeHandlingRef.current = false;
  }, [stopFreshScanner]);

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

    const freshItems = items.filter((item) => item.supplier_name === "쿠팡 프레시");
    const changedItems = freshItems.filter((item) => item.fresh_order_selected !== selectedFreshIds.has(item.id));

    const results = await Promise.all(
      changedItems.map((item) => {
        const selected = selectedFreshIds.has(item.id);
        return supabase
          .from("products")
          .update({
            fresh_order_selected: selected,
            fresh_order_selected_at: selected ? new Date().toISOString() : null
          })
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
          item.supplier_name === "쿠팡 프레시"
            ? {
                ...item,
                fresh_order_selected: selectedFreshIds.has(item.id),
                fresh_order_selected_at: selectedFreshIds.has(item.id) ? item.fresh_order_selected_at ?? new Date().toISOString() : null
              }
            : item
        )
      );
      await closeFreshModal();
    }

    setSavingFresh(false);
  }

  function openUrgentModal() {
    setError("");
    setUrgentProductId("");
    setUrgentSearch("");
    setUrgentDirectInput(false);
    setUrgentDirectName("");
    setUrgentQuantity("");
    setUrgentModalOpen(true);
  }

  async function deleteUrgentOrder(item: InventoryItem) {
    setError("");
    setDeletingUrgentIds((current) => new Set(current).add(item.id));
    setItems((current) => current.map((product) => (product.id === item.id ? { ...product, urgent_order_requested: false, urgent_order_quantity: null } : product)));

    const { error: updateError } = await supabase
      .from("products")
      .update({ urgent_order_requested: false, urgent_order_quantity: null })
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

    const { error: updateError } = await supabase.from("products").update({ order_completed: checked }).eq("id", item.id);
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

    const { error: updateError } = await supabase
      .from("products")
      .update({
        fresh_order_selected: false,
        fresh_order_selected_at: null
      })
      .eq("id", item.id);

    if (updateError) {
      setError(updateError.message);
    } else {
      setFreshReceivingUndoStack((current) => [
        ...current,
        {
          productId: item.id,
          freshOrderSelected: item.fresh_order_selected,
          freshOrderSelectedAt: item.fresh_order_selected_at
        }
      ]);
      setItems((current) =>
        current.map((product) =>
          product.id === item.id
            ? {
                ...product,
                fresh_order_selected: false,
                fresh_order_selected_at: null
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

  async function undoFreshReceiving() {
    const previous = freshReceivingUndoStack[freshReceivingUndoStack.length - 1];
    if (!previous) return;

    setError("");
    setUndoingFreshReceiving(true);

    const { error: updateError } = await supabase
      .from("products")
      .update({
        fresh_order_selected: previous.freshOrderSelected,
        fresh_order_selected_at: previous.freshOrderSelectedAt
      })
      .eq("id", previous.productId);

    if (updateError) {
      setError(updateError.message);
    } else {
      setItems((current) =>
        current.map((product) =>
          product.id === previous.productId
            ? {
                ...product,
                fresh_order_selected: previous.freshOrderSelected,
                fresh_order_selected_at: previous.freshOrderSelectedAt
              }
            : product
        )
      );
      setFreshReceivingUndoStack((current) => current.slice(0, -1));
    }

    setUndoingFreshReceiving(false);
  }

  async function submitUrgentOrder(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const quantity = Number(urgentQuantity);
    const directName = urgentDirectName.trim();

    if (urgentDirectInput && !directName) {
      setError("직접 입력할 품목명을 적어 주세요.");
      return;
    }
    if (!urgentDirectInput && !urgentProductId) {
      setError("긴급발주할 품목을 검색해 선택해 주세요.");
      return;
    }
    if (!Number.isInteger(quantity) || quantity <= 0) {
      setError("발주요청 수량은 1개 이상이어야 합니다.");
      return;
    }

    setSavingUrgent(true);
    setError("");

    if (urgentDirectInput) {
      const { data, error: insertError } = await supabase
        .from("products")
        .insert({
          name: directName,
          barcode: null,
          category: "기타",
          supplier_name: null,
          storage_type: null,
          unit_name: null,
          product_url: null,
          minimum_stock: 0,
          urgent_order_requested: true,
          urgent_order_quantity: quantity
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
          setItems((current) => [...current, normalizeInventoryItem({ ...(data as Parameters<typeof normalizeInventoryItem>[0]), inventory: null })]);
          setUrgentModalOpen(false);
        }
      }
      setSavingUrgent(false);
      return;
    }

    const { error: updateError } = await supabase
      .from("products")
      .update({ urgent_order_requested: true, urgent_order_quantity: quantity })
      .eq("id", urgentProductId);

    if (updateError) {
      setError(updateError.message);
    } else {
      setItems((current) =>
        current.map((product) =>
          product.id === urgentProductId ? { ...product, urgent_order_requested: true, urgent_order_quantity: quantity } : product
        )
      );
      setUrgentModalOpen(false);
    }
    setSavingUrgent(false);
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
              className="touch-button rounded-md bg-emerald-600 px-3 text-sm font-bold text-white"
            >
              프레시상품
            </button>
            <button
              type="button"
              disabled={freshReceivingUndoStack.length === 0 || undoingFreshReceiving}
              onClick={() => void undoFreshReceiving()}
              className="touch-button rounded-md border border-emerald-600 px-3 text-sm font-bold text-emerald-700 disabled:cursor-not-allowed disabled:border-slate-300 disabled:text-slate-400 disabled:opacity-60 dark:text-emerald-200 dark:disabled:border-slate-700 dark:disabled:text-slate-600"
            >
              {undoingFreshReceiving ? "되돌리는 중" : `입고완료 되돌리기 (${freshReceivingUndoStack.length})`}
            </button>
            <button
              type="button"
              onClick={openUrgentModal}
              className="touch-button rounded-md bg-red-600 px-3 text-sm font-bold text-white"
            >
              긴급발주요청
            </button>
            <span className="rounded-full bg-red-100 px-3 py-2 text-sm font-bold text-red-700 dark:bg-red-900 dark:text-red-100">부족재고 ({lowStockItems.length})</span>
          </div>
        }
      />

      {loading ? <StatusMessage>부족 재고를 불러오는 중...</StatusMessage> : null}
      {error ? <StatusMessage type="error">{error}</StatusMessage> : null}

      {!loading && !error ? (
        <>
          <div className="space-y-2 sm:hidden">
            {lowStockItems.map((item) => (
              <div
                key={item.id}
                onClick={() => navigate({ name: "operation", productId: item.id })}
                className={`cursor-pointer rounded-md border p-3 ${
                  item.fresh_order_selected
                    ? "border-emerald-300 bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950"
                    : "border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
                }`}
              >
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <span className="break-words text-base font-bold leading-snug">{item.name}</span>
                  {item.urgent_order_requested ? (
                    <span className="rounded-full bg-red-600 px-2 py-1 text-xs font-bold text-white">긴급 {item.urgent_order_quantity ?? 0}개</span>
                  ) : null}
                  {item.fresh_order_selected ? (
                    <span className="rounded-full bg-emerald-600 px-2 py-1 text-xs font-bold text-white">프레시</span>
                  ) : null}
                </div>
                <div className="grid grid-cols-[1fr_1fr_auto_auto] items-center gap-2 text-sm">
                  <div>
                    <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">총재고</p>
                    <p className="font-bold tabular-nums text-red-700 dark:text-red-200">{item.total_stock}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">최소</p>
                    <p className="tabular-nums">{item.minimum_stock}</p>
                  </div>
                  <div className="flex min-w-[72px] flex-col items-center gap-2" onClick={(event) => event.stopPropagation()}>
                    <label className="flex flex-col items-center gap-1 text-xs font-bold text-slate-600 dark:text-slate-300">
                      발주 완료
                      <input
                        type="checkbox"
                        checked={item.order_completed}
                        disabled={updatingOrderIds.has(item.id)}
                        onChange={(event) => void toggleOrderCompleted(item, event.target.checked)}
                        aria-label={`${item.name} 발주 완료`}
                        className="h-6 w-6 rounded border-slate-300 accent-brand-600 disabled:opacity-45"
                      />
                    </label>
                    {item.fresh_order_selected ? (
                      <button
                        type="button"
                        disabled={completingFreshIds.has(item.id)}
                        onClick={() => void completeFreshReceiving(item)}
                        className="min-h-9 whitespace-nowrap rounded-md bg-emerald-600 px-2 text-xs font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500 dark:disabled:bg-slate-800"
                      >
                        입고 완료
                      </button>
                    ) : null}
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
                  <th className="w-[92px] px-2 py-3 text-center">발주완료</th>
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
                        ? "border-emerald-200 bg-emerald-100 dark:border-emerald-900 dark:bg-emerald-950"
                        : "border-slate-100 dark:border-slate-900"
                    }`}
                  >
                    <td className="px-3 py-3 font-semibold">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="truncate">{item.name}</span>
                        {item.urgent_order_requested ? (
                          <span className="shrink-0 rounded-full bg-red-600 px-2 py-1 text-xs font-bold text-white">긴급 {item.urgent_order_quantity ?? 0}개</span>
                        ) : null}
                        {item.fresh_order_selected ? (
                          <span className="shrink-0 rounded-full bg-emerald-600 px-2 py-1 text-xs font-bold text-white">프레시</span>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-2 py-3 text-right font-bold tabular-nums text-red-700 dark:text-red-200">{item.total_stock}</td>
                    <td className="px-2 py-3 text-right tabular-nums">{item.minimum_stock}</td>
                    <td className="px-2 py-2 text-center" onClick={(event) => event.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={item.order_completed}
                        disabled={updatingOrderIds.has(item.id)}
                        onChange={(event) => void toggleOrderCompleted(item, event.target.checked)}
                        aria-label={`${item.name} 발주 완료`}
                        className="h-6 w-6 rounded border-slate-300 accent-brand-600 disabled:opacity-45"
                      />
                      {item.fresh_order_selected ? (
                        <button
                          type="button"
                          disabled={completingFreshIds.has(item.id)}
                          onClick={() => void completeFreshReceiving(item)}
                          className="mt-2 min-h-9 w-full rounded-md bg-emerald-600 px-2 text-xs font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500 dark:disabled:bg-slate-800"
                        >
                          입고 완료
                        </button>
                      ) : null}
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
                    <h2 className="text-lg font-bold">프레시상품</h2>
                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">쿠팡 프레시 발주처의 상품을 선택합니다.</p>
                  </div>
                  <button
                    type="button"
                    disabled={savingFresh}
                    onClick={() => void saveFreshProducts()}
                    className="touch-button shrink-0 rounded-md bg-emerald-600 px-4 text-sm font-bold text-white disabled:opacity-50"
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
                      className={`touch-button icon-button ${freshScannerActive ? "border-emerald-600 bg-emerald-600 text-white dark:bg-emerald-600 dark:text-white" : ""}`}
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
                  <p className="mt-2 text-right text-xs font-bold text-emerald-700 dark:text-emerald-300">
                    {selectedFreshIds.size}개 선택
                  </p>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto p-3">
                  <div className="space-y-2">
                    {freshProducts.map((item) => {
                      const selected = selectedFreshIds.has(item.id);

                      return (
                        <label
                          key={item.id}
                          className={`flex min-h-14 cursor-pointer items-center gap-3 rounded-md border px-3 py-2 ${
                            selected
                              ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950"
                              : "border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={() => toggleFreshProduct(item.id)}
                            className="h-6 w-6 shrink-0 rounded border-slate-300 accent-emerald-600"
                          />
                          <span className="min-w-0 flex-1 break-words font-bold">{item.name}</span>
                        </label>
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
                    className="touch-button rounded-md bg-emerald-600 px-4 font-bold text-white"
                  >
                    예
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {urgentModalOpen ? (
            <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/55 px-4">
              <form onSubmit={submitUrgentOrder} className="w-full max-w-md rounded-lg bg-white p-4 shadow-xl dark:bg-slate-900">
                <div className="mb-4">
                  <h2 className="text-lg font-bold">긴급발주요청</h2>
                  <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">품목과 요청 수량을 입력합니다.</p>
                </div>

                <div className="mb-3">
                  <span className="mb-1 block text-sm font-bold">품목</span>
                  <div className="mb-2 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setUrgentDirectInput(false)}
                      className={`touch-button rounded-md px-3 text-sm font-bold ${!urgentDirectInput ? "bg-red-600 text-white" : "border border-slate-300 dark:border-slate-700"}`}
                    >
                      검색
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setUrgentDirectInput(true);
                        setUrgentProductId("");
                      }}
                      className={`touch-button rounded-md px-3 text-sm font-bold ${urgentDirectInput ? "bg-red-600 text-white" : "border border-slate-300 dark:border-slate-700"}`}
                    >
                      직접입력
                    </button>
                  </div>

                  {urgentDirectInput ? (
                    <input
                      className="field"
                      value={urgentDirectName}
                      onChange={(event) => setUrgentDirectName(event.target.value)}
                      placeholder="품목명 직접 입력"
                      autoFocus
                    />
                  ) : (
                    <>
                      <label className="relative block">
                        <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
                        <input
                          className="field pl-10 pr-10"
                          value={urgentSearch}
                          onChange={(event) => {
                            setUrgentSearch(event.target.value);
                            setUrgentProductId("");
                          }}
                          placeholder="상품명 또는 바코드 검색"
                          autoFocus
                        />
                        {urgentSearch ? (
                          <button
                            type="button"
                            onClick={() => {
                              setUrgentSearch("");
                              setUrgentProductId("");
                            }}
                            className="absolute right-1 top-1/2 inline-flex h-10 w-10 -translate-y-1/2 items-center justify-center text-slate-500"
                            aria-label="검색어 지우기"
                          >
                            <X size={19} />
                          </button>
                        ) : null}
                      </label>

                      <div className="mt-2 max-h-48 space-y-2 overflow-y-auto">
                        {urgentSearchResults.map((item) => {
                          const selected = urgentProductId === item.id;

                          return (
                            <button
                              key={item.id}
                              type="button"
                              onClick={() => {
                                setUrgentProductId(item.id);
                                setUrgentSearch(item.name);
                              }}
                              className={`w-full rounded-md border p-2 text-left text-sm ${
                                selected
                                  ? "border-red-500 bg-red-50 dark:bg-red-950"
                                  : "border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900"
                              }`}
                            >
                              <span className="block font-bold">{item.name}</span>
                              <span className="text-xs text-slate-500 dark:text-slate-400">{item.barcode ?? "바코드 없음"}</span>
                            </button>
                          );
                        })}
                        {urgentSearch.trim() && urgentSearchResults.length === 0 ? (
                          <StatusMessage>검색 결과가 없습니다. 직접입력을 사용해 주세요.</StatusMessage>
                        ) : null}
                      </div>
                    </>
                  )}
                </div>

                <label className="mb-4 block">
                  <span className="mb-1 block text-sm font-bold">발주요청 수량</span>
                  <input
                    className="field"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={urgentQuantity}
                    onChange={(event) => setUrgentQuantity(event.target.value.replace(/\D/g, ""))}
                    placeholder="예: 10"
                  />
                </label>

                <div className="grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => setUrgentModalOpen(false)} className="touch-button rounded-md border border-slate-300 px-4 font-bold dark:border-slate-700">
                    취소
                  </button>
                  <button type="submit" disabled={savingUrgent} className="touch-button rounded-md bg-red-600 px-4 font-bold text-white disabled:opacity-50">
                    {savingUrgent ? "저장 중" : "요청 저장"}
                  </button>
                </div>
              </form>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
