import { Capacitor, registerPlugin } from "@capacitor/core";

type PermissionState = "prompt" | "prompt-with-rationale" | "granted" | "denied" | string;

type BarcodeScannerPermissionStatus = {
  camera: PermissionState;
};

type NativeBarcode = {
  rawValue?: string;
};

type NativeScannerEvent = {
  barcodes?: NativeBarcode[];
  message?: string;
};

type NativeScannerListener = {
  remove: () => Promise<void>;
};

type NativeBarcodeScannerPlugin = {
  isSupported?: () => Promise<{ supported: boolean }>;
  checkPermissions?: () => Promise<BarcodeScannerPermissionStatus>;
  requestPermissions?: () => Promise<BarcodeScannerPermissionStatus>;
  isGoogleBarcodeScannerModuleAvailable?: () => Promise<{ available: boolean }>;
  installGoogleBarcodeScannerModule?: () => Promise<void>;
  startScan: (options?: { formats?: string[] }) => Promise<void>;
  stopScan: () => Promise<void>;
  addListener: (
    eventName: "barcodesScanned" | "scanError",
    listener: (event: NativeScannerEvent) => void
  ) => Promise<NativeScannerListener>;
};

type NativeBarcodeScanResult =
  | { status: "success"; barcode: string }
  | { status: "register" }
  | { status: "unavailable"; message: string; fallbackToWeb: true }
  | { status: "permission-denied"; message: string; fallbackToWeb: false }
  | { status: "module-installing"; message: string; fallbackToWeb: true }
  | { status: "cancelled"; message: string; fallbackToWeb: false }
  | { status: "error"; message: string; fallbackToWeb: true };

const PRODUCT_NATIVE_BARCODE_FORMATS = [
  "EAN_13",
  "EAN_8",
  "UPC_A",
  "UPC_E",
  "CODE_128",
  "CODE_39",
  "CODE_93",
  "ITF",
  "CODABAR"
];

const barcodeScanner = registerPlugin<NativeBarcodeScannerPlugin>("BarcodeScanner");
let activeNativeScanCancel: (() => void) | null = null;
let activeNativeScanCleanup: (() => Promise<void>) | null = null;

export function isNativeBarcodeScannerAvailable() {
  return Capacitor.isNativePlatform();
}

export async function scanNativeBarcode(): Promise<NativeBarcodeScanResult> {
  if (!isNativeBarcodeScannerAvailable()) {
    return {
      status: "unavailable",
      message: "네이티브 스캐너를 사용할 수 없어 웹 스캐너로 전환합니다.",
      fallbackToWeb: true
    };
  }

  const supported = await barcodeScanner.isSupported?.().catch(() => ({ supported: true }));
  if (supported && !supported.supported) {
    return {
      status: "unavailable",
      message: "이 기기에서는 네이티브 스캐너를 지원하지 않아 웹 스캐너로 전환합니다.",
      fallbackToWeb: true
    };
  }

  const permission = await barcodeScanner.checkPermissions?.().catch(() => ({ camera: "prompt" }));
  if (permission?.camera !== "granted") {
    const requested = await barcodeScanner.requestPermissions?.().catch(() => ({ camera: "denied" }));
    if (requested?.camera !== "granted") {
      return {
        status: "permission-denied",
        message: "카메라 권한이 허용되지 않아 스캔을 시작할 수 없습니다.",
        fallbackToWeb: false
      };
    }
  }

  if (Capacitor.getPlatform() === "android" && barcodeScanner.isGoogleBarcodeScannerModuleAvailable && barcodeScanner.installGoogleBarcodeScannerModule) {
    const moduleStatus = await barcodeScanner.isGoogleBarcodeScannerModuleAvailable().catch(() => ({ available: true }));
    if (!moduleStatus.available) {
      await barcodeScanner.installGoogleBarcodeScannerModule().catch(() => undefined);
      return {
        status: "module-installing",
        message: "Android 스캐너 모듈을 설치하는 중입니다. 이번에는 웹 스캐너로 전환합니다.",
        fallbackToWeb: true
      };
    }
  }

  return new Promise((resolve) => {
    let settled = false;
    let cleanupPromise: Promise<void> | null = null;
    const listenerPromises: Array<Promise<NativeScannerListener>> = [];

    const cleanup = () => {
      if (cleanupPromise) return cleanupPromise;
      cleanupPromise = (async () => {
        const listeners = await Promise.all(listenerPromises.map((promise) => promise.catch(() => null)));
        await Promise.all(listeners.filter((listener): listener is NativeScannerListener => listener !== null).map((listener) => listener.remove().catch(() => undefined)));
        await barcodeScanner.stopScan().catch(() => undefined);
        if (activeNativeScanCancel === cancel) activeNativeScanCancel = null;
        if (activeNativeScanCleanup === cleanup) activeNativeScanCleanup = null;
      })();
      return cleanupPromise;
    };

    const finish = (result: NativeBarcodeScanResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
      void cleanup();
    };

    const cancel = () => finish({ status: "cancelled", message: "스캔이 취소되었습니다.", fallbackToWeb: false });
    activeNativeScanCancel = cancel;
    activeNativeScanCleanup = cleanup;

    void (async () => {
      try {
        listenerPromises.push(barcodeScanner.addListener("barcodesScanned", (event) => {
          const barcode = event.barcodes?.find((item) => item.rawValue?.trim())?.rawValue?.trim();
          if (barcode) finish({ status: "success", barcode });
        }));
        listenerPromises.push(barcodeScanner.addListener("scanError", (event) => {
          finish({
            status: "error",
            message: event.message ?? "네이티브 스캐너 실행에 실패해 웹 스캐너로 전환합니다.",
            fallbackToWeb: true
          });
        }));
        await barcodeScanner.startScan({ formats: PRODUCT_NATIVE_BARCODE_FORMATS });
      } catch {
        finish({
          status: "error",
          message: "네이티브 스캐너 실행에 실패해 웹 스캐너로 전환합니다.",
          fallbackToWeb: true
        });
      }
    })();
  });
}

export async function stopNativeBarcode() {
  if (activeNativeScanCancel) {
    activeNativeScanCancel();
    if (activeNativeScanCleanup) await activeNativeScanCleanup();
    return;
  }
  if (activeNativeScanCleanup) {
    await activeNativeScanCleanup();
    return;
  }
  await barcodeScanner.stopScan().catch(() => undefined);
}
