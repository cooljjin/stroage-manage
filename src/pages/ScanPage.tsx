import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";
import { Search, ScanLine } from "lucide-react";
import { PageTitle } from "../components/PageTitle";
import { StatusMessage } from "../components/StatusMessage";
import { supabase } from "../lib/supabase";
import type { AppRoute, Product } from "../types/domain";

type Props = {
  navigate: (route: AppRoute) => void;
};

const SCANNER_ID = "barcode-scanner";
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

export function ScanPage({ navigate }: Props) {
  const [scannerActive, setScannerActive] = useState(false);
  const [message, setMessage] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [results, setResults] = useState<Product[]>([]);
  const [loadingSearch, setLoadingSearch] = useState(false);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const barcodeHandlingRef = useRef(false);
  const autoStartAttemptedRef = useRef(false);

  const canScan = useMemo(() => "mediaDevices" in navigator, []);

  useEffect(() => {
    return () => {
      if (scannerRef.current?.isScanning) {
        scannerRef.current.stop().catch(() => undefined);
      }
    };
  }, []);

  const handleBarcode = useCallback(async (barcode: string) => {
    if (barcodeHandlingRef.current) return;
    barcodeHandlingRef.current = true;
    setMessage(`스캔됨: ${barcode}`);
    if (scannerRef.current?.isScanning) {
      await scannerRef.current.stop().catch(() => undefined);
    }
    setScannerActive(false);

    const { data, error } = await supabase.from("products").select("*").eq("barcode", barcode).eq("is_active", true).maybeSingle();
    if (error) {
      setMessage(error.message);
      barcodeHandlingRef.current = false;
      return;
    }

    if (data) {
      navigate({ name: "operation", productId: data.id });
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

    if (scannerRef.current?.isScanning) return;

    const scanner = new Html5Qrcode(SCANNER_ID, {
      formatsToSupport: PRODUCT_BARCODE_FORMATS,
      experimentalFeatures: {
        useBarCodeDetectorIfSupported: true
      },
      verbose: false
    });
    scannerRef.current = scanner;
    barcodeHandlingRef.current = false;
    setScannerActive(true);

    try {
      await scanner.start(
        { facingMode: "environment" },
        {
          fps: 15,
          disableFlip: true,
          videoConstraints: {
            facingMode: "environment",
            width: { ideal: 1280 },
            height: { ideal: 720 }
          }
        },
        (decodedText) => void handleBarcode(decodedText),
        () => undefined
      );
    } catch (error) {
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
    if (scannerRef.current?.isScanning) await scannerRef.current.stop();
    barcodeHandlingRef.current = false;
    setScannerActive(false);
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
      setResults((data ?? []) as Product[]);
    }
    setLoadingSearch(false);
  }

  return (
    <section>
      <PageTitle title="바코드 스캔" description="상품을 스캔하거나 이름으로 검색합니다." />

      <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="panel p-4">
          <div id={SCANNER_ID} className="min-h-[320px] overflow-hidden rounded-md bg-slate-900" />
          <div className="mt-4 grid grid-cols-2 gap-3">
            <button type="button" onClick={startScanner} disabled={scannerActive} className="primary-button inline-flex items-center justify-center gap-2">
              <ScanLine size={20} />
              바코드 스캔
            </button>
            <button type="button" onClick={stopScanner} disabled={!scannerActive} className="secondary-button">
              중지
            </button>
          </div>
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
