import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BrowserMultiFormatOneDReader } from "@zxing/browser";
import type { IScannerControls } from "@zxing/browser";
import { BarcodeFormat, DecodeHintType } from "@zxing/library";
import { Camera, Search, ScanLine, ZoomIn } from "lucide-react";
import { PageTitle } from "../components/PageTitle";
import { StatusMessage } from "../components/StatusMessage";
import { supabase } from "../lib/supabase";
import type { AppRoute, Product } from "../types/domain";

type Props = {
  navigate: (route: AppRoute) => void;
};

const PRODUCT_LIVE_BARCODE_FORMATS = [
  BarcodeFormat.EAN_13,
  BarcodeFormat.EAN_8,
  BarcodeFormat.UPC_A,
  BarcodeFormat.UPC_E,
  BarcodeFormat.CODE_128,
  BarcodeFormat.CODE_39,
  BarcodeFormat.CODE_93,
  BarcodeFormat.ITF,
  BarcodeFormat.CODABAR
];
const SCAN_ATTEMPT_DELAY_MS = 80;

type ExtendedMediaTrackCapabilities = MediaTrackCapabilities & {
  focusMode?: string[];
  zoom?: { min: number; max: number; step: number };
};

type ExtendedMediaTrackSettings = MediaTrackSettings & {
  zoom?: number;
};

type ExtendedMediaTrackConstraintSet = MediaTrackConstraintSet & {
  focusMode?: string;
  zoom?: number;
};

function getBarcodeCandidates(barcode: string): string[] {
  const normalized = barcode.trim();
  const candidates = new Set([normalized]);

  if (/^\d{12}$/.test(normalized)) candidates.add(`0${normalized}`);
  if (/^0\d{12}$/.test(normalized)) candidates.add(normalized.slice(1));

  return [...candidates];
}

function createBarcodeHints() {
  const hints = new Map<DecodeHintType, unknown>();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, PRODUCT_LIVE_BARCODE_FORMATS);
  hints.set(DecodeHintType.TRY_HARDER, true);
  return hints;
}

async function findProductByBarcode(barcode: string): Promise<{ product: Product | null; errorMessage: string }> {
  const barcodeCandidates = getBarcodeCandidates(barcode);
  const { data, error } = await supabase.from("products").select("*").in("barcode", barcodeCandidates).eq("is_active", true).limit(1).maybeSingle();
  if (error) return { product: null, errorMessage: error.message };
  if (data) return { product: data as Product, errorMessage: "" };

  const { data: barcodeData, error: barcodeError } = await supabase.from("product_barcodes").select("product_id").in("barcode", barcodeCandidates).limit(1).maybeSingle();
  if (barcodeError) return { product: null, errorMessage: barcodeError.message };
  if (!barcodeData) return { product: null, errorMessage: "" };

  const { data: aliasProduct, error: aliasError } = await supabase.from("products").select("*").eq("id", barcodeData.product_id).eq("is_active", true).maybeSingle();
  if (aliasError) return { product: null, errorMessage: aliasError.message };
  return { product: (aliasProduct as Product | null) ?? null, errorMessage: "" };
}

export function ScanPage({ navigate }: Props) {
  const [scannerActive, setScannerActive] = useState(false);
  const [message, setMessage] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [results, setResults] = useState<Product[]>([]);
  const [loadingSearch, setLoadingSearch] = useState(false);
  const [zoomRange, setZoomRange] = useState<{ min: number; max: number; step: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const liveReaderRef = useRef<BrowserMultiFormatOneDReader | null>(null);
  const liveControlsRef = useRef<IScannerControls | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const barcodeHandlingRef = useRef(false);
  const autoStartAttemptedRef = useRef(false);

  const canScan = useMemo(() => "mediaDevices" in navigator, []);

  useEffect(() => {
    const videoElement = videoRef.current;
    return () => {
      liveControlsRef.current?.stop();
      liveControlsRef.current = null;
      liveReaderRef.current = null;
      const stream = videoElement?.srcObject;
      if (stream instanceof MediaStream) stream.getTracks().forEach((track) => track.stop());
    };
  }, []);

  const handleBarcode = useCallback(async (barcode: string) => {
    if (barcodeHandlingRef.current) return;
    barcodeHandlingRef.current = true;
    setMessage(`스캔됨: ${barcode}`);
    liveControlsRef.current?.stop();
    liveControlsRef.current = null;
    liveReaderRef.current = null;
    setScannerActive(false);
    setZoomRange(null);

    const { product, errorMessage } = await findProductByBarcode(barcode);
    if (errorMessage) {
      setMessage(errorMessage);
      barcodeHandlingRef.current = false;
      return;
    }

    if (product) {
      navigate({ name: "operation", productId: product.id });
    } else {
      navigate({ name: "register", barcode });
    }
  }, [navigate]);

  const startScanner = useCallback(async () => {
    setMessage("");
    if (!canScan) {
      setMessage("이 기기에서는 카메라를 사용할 수 없습니다.");
      return;
    }

    if (liveControlsRef.current || !videoRef.current) return;

    const reader = new BrowserMultiFormatOneDReader(createBarcodeHints(), {
      delayBetweenScanAttempts: SCAN_ATTEMPT_DELAY_MS,
      delayBetweenScanSuccess: 0,
      tryPlayVideoTimeout: 10000
    });
    liveReaderRef.current = reader;
    barcodeHandlingRef.current = false;
    setZoomRange(null);
    setZoom(1);
    setScannerActive(true);

    try {
      const controls = await reader.decodeFromConstraints(
        {
          audio: false,
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1280, max: 1920 },
            height: { ideal: 720, max: 1440 },
            frameRate: { ideal: 30, min: 15 }
          }
        },
        videoRef.current,
        (result) => {
          if (result) void handleBarcode(result.getText());
        }
      );
      liveControlsRef.current = controls;
      if (barcodeHandlingRef.current) {
        controls.stop();
        liveControlsRef.current = null;
        liveReaderRef.current = null;
        return;
      }

      const stream = videoRef.current.srcObject;
      const track = stream instanceof MediaStream ? stream.getVideoTracks()[0] : undefined;
      if (track) {
        const capabilities = track.getCapabilities() as ExtendedMediaTrackCapabilities;
        const settings = track.getSettings() as ExtendedMediaTrackSettings;
        if (capabilities.focusMode?.includes("continuous")) {
          await track.applyConstraints({
            advanced: [{ focusMode: "continuous" } as ExtendedMediaTrackConstraintSet]
          }).catch(() => undefined);
        }
        if (capabilities.zoom) {
          setZoomRange(capabilities.zoom);
          setZoom(settings.zoom ?? capabilities.zoom.min);
        }
      }
    } catch (error) {
      liveControlsRef.current?.stop();
      liveControlsRef.current = null;
      liveReaderRef.current = null;
      const stream = videoRef.current?.srcObject;
      if (stream instanceof MediaStream) stream.getTracks().forEach((track) => track.stop());
      setScannerActive(false);
      setMessage(error instanceof Error ? error.message : "카메라 실행에 실패했습니다.");
    }
  }, [canScan, handleBarcode]);

  useEffect(() => {
    if (autoStartAttemptedRef.current) return;
    autoStartAttemptedRef.current = true;
    const timer = window.setTimeout(() => {
      void startScanner();
    }, 250);

    return () => window.clearTimeout(timer);
  }, [startScanner]);

  async function stopScanner() {
    liveControlsRef.current?.stop();
    liveControlsRef.current = null;
    liveReaderRef.current = null;
    barcodeHandlingRef.current = false;
    setScannerActive(false);
    setZoomRange(null);
  }

  async function changeZoom(nextZoom: number) {
    const stream = videoRef.current?.srcObject;
    const track = stream instanceof MediaStream ? stream.getVideoTracks()[0] : undefined;
    if (!track) return;

    setZoom(nextZoom);
    await track.applyConstraints({
      advanced: [{ zoom: nextZoom } as ExtendedMediaTrackConstraintSet]
    }).catch(() => {
      setMessage("이 기기에서는 확대 배율을 변경할 수 없습니다.");
    });
  }

  async function scanImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setMessage("사진에서 바코드를 찾는 중...");
    liveControlsRef.current?.stop();
    liveControlsRef.current = null;
    liveReaderRef.current = null;
    setScannerActive(false);
    setZoomRange(null);

    const imageReader = new BrowserMultiFormatOneDReader(createBarcodeHints());
    const imageUrl = URL.createObjectURL(file);

    try {
      const result = await imageReader.decodeFromImageUrl(imageUrl);
      await handleBarcode(result.getText());
    } catch {
      setMessage("사진에서 바코드를 찾지 못했습니다. 바코드가 화면을 크게 차지하도록 다시 촬영해 주세요.");
    } finally {
      URL.revokeObjectURL(imageUrl);
    }
  }

  async function handleSearch(event: FormEvent) {
    event.preventDefault();
    const keyword = searchTerm.trim();
    if (!keyword) return;

    setLoadingSearch(true);
    const { data, error } = await supabase
      .from("products")
      .select("*")
      .or(`name.ilike.%${keyword}%,barcode.ilike.%${keyword}%`)
      .eq("is_active", true)
      .order("name", { ascending: true })
      .limit(20);

    if (error) {
      setMessage(error.message);
      setResults([]);
    } else {
      const productsById = new Map<string, Product>();
      ((data ?? []) as Product[]).forEach((product) => productsById.set(product.id, product));

      const { data: barcodeRows, error: barcodeError } = await supabase.from("product_barcodes").select("product_id").ilike("barcode", `%${keyword}%`).limit(20);
      if (barcodeError) {
        setMessage(barcodeError.message);
      } else {
        const missingProductIds = [...new Set((barcodeRows ?? []).map((row) => row.product_id).filter((id) => !productsById.has(id)))];
        if (missingProductIds.length > 0) {
          const { data: aliasProducts, error: aliasProductsError } = await supabase.from("products").select("*").in("id", missingProductIds).eq("is_active", true);
          if (aliasProductsError) {
            setMessage(aliasProductsError.message);
          } else {
            ((aliasProducts ?? []) as Product[]).forEach((product) => productsById.set(product.id, product));
          }
        }
      }

      setResults([...productsById.values()].sort((left, right) => left.name.localeCompare(right.name, "ko")).slice(0, 20));
    }
    setLoadingSearch(false);
  }

  return (
    <section>
      <PageTitle title="바코드 스캔" description="상품을 스캔하거나 이름으로 검색합니다." />

      <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="panel p-4">
          <div className="relative overflow-hidden rounded-md bg-slate-900">
            <video
              ref={videoRef}
              className="h-[min(58dvh,520px)] min-h-[320px] w-full object-cover"
              playsInline
              muted
              autoPlay
            />
            {scannerActive ? (
              <>
                <div className="pointer-events-none absolute inset-2 rounded-lg border-2 border-white/70 shadow-[0_0_0_999px_rgba(15,23,42,0.08)]" />
                <div className="pointer-events-none absolute inset-x-3 bottom-3 rounded-md bg-slate-950/70 px-3 py-2 text-center text-xs font-semibold text-white backdrop-blur">
                  화면 어디든 바코드가 보이게 하고, 가까우면 20~30cm 떨어뜨려 주세요.
                </div>
              </>
            ) : null}
          </div>

          {scannerActive && zoomRange ? (
            <label className="mt-3 flex items-center gap-3 rounded-md bg-slate-100 px-3 py-2 dark:bg-slate-900">
              <ZoomIn className="shrink-0 text-slate-500" size={18} />
              <input
                type="range"
                min={zoomRange.min}
                max={zoomRange.max}
                step={zoomRange.step}
                value={zoom}
                onChange={(event) => void changeZoom(Number(event.target.value))}
                className="min-w-0 flex-1 accent-teal-700"
                aria-label="카메라 확대"
              />
              <span className="w-10 text-right text-xs font-bold">{zoom.toFixed(1)}x</span>
            </label>
          ) : null}

          <div className="mt-4 grid grid-cols-2 gap-3">
            <button type="button" onClick={startScanner} disabled={scannerActive} className="primary-button inline-flex items-center justify-center gap-2">
              <ScanLine size={20} />
              바코드 스캔
            </button>
            <button type="button" onClick={stopScanner} disabled={!scannerActive} className="secondary-button">
              중지
            </button>
          </div>
          <input
            ref={imageInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={(event) => void scanImage(event)}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => imageInputRef.current?.click()}
            className="secondary-button mt-3 inline-flex w-full items-center justify-center gap-2"
          >
            <Camera size={19} />
            사진으로 바코드 인식
          </button>
          {message ? <div className="mt-3"><StatusMessage type={message.includes("실패") ? "error" : "info"}>{message}</StatusMessage></div> : null}
        </div>

        <div className="panel p-4">
          <form onSubmit={handleSearch} className="flex gap-2">
            <input className="field" value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="상품명 또는 바코드" />
            <button type="submit" className="primary-button inline-flex min-w-[56px] items-center justify-center" aria-label="상품 검색">
              <Search size={22} />
            </button>
          </form>

          <div className="mt-4 space-y-2">
            {loadingSearch ? <StatusMessage>검색 중...</StatusMessage> : null}
            {!loadingSearch && results.length === 0 && searchTerm ? <StatusMessage>검색 결과가 없습니다.</StatusMessage> : null}
            {results.map((product) => (
              <button
                key={product.id}
                type="button"
                onClick={() => navigate({ name: "operation", productId: product.id })}
                className="w-full rounded-md border border-slate-200 bg-white p-3 text-left dark:border-slate-800 dark:bg-slate-900"
              >
                <span className="block font-semibold">{product.name}</span>
                <span className="text-sm text-slate-500 dark:text-slate-400">{product.barcode ?? "바코드 없음"}</span>
              </button>
            ))}
            <button type="button" onClick={() => navigate({ name: "register", barcode: searchTerm.trim() })} className="secondary-button w-full">
              새 상품 등록
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
