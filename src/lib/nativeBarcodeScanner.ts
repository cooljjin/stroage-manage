import { Capacitor, registerPlugin } from "@capacitor/core";

type PermissionState = "prompt" | "prompt-with-rationale" | "granted" | "denied" | string;

type BarcodeScannerPermissionStatus = {
  camera: PermissionState;
};

type NativeBarcode = {
  rawValue?: string;
};

type NativeBarcodeScanResponse = {
  barcodes?: NativeBarcode[];
};

type GoogleBarcodeScannerModuleStatus = {
  available: boolean;
};

type NativeBarcodeScannerPlugin = {
  isSupported?: () => Promise<{ supported: boolean }>;
  checkPermissions?: () => Promise<BarcodeScannerPermissionStatus>;
  requestPermissions?: () => Promise<BarcodeScannerPermissionStatus>;
  isGoogleBarcodeScannerModuleAvailable?: () => Promise<GoogleBarcodeScannerModuleStatus>;
  installGoogleBarcodeScannerModule?: () => Promise<void>;
  scan: (options: { formats: string[]; autoZoom: boolean }) => Promise<NativeBarcodeScanResponse>;
};

type FastIosBarcodeScannerPlugin = {
  scan: (options: { formats: string[]; zoomFactor?: number }) => Promise<{ action?: "register"; barcode?: string; rawValue?: string; cancelled?: boolean }>;
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

const fastIosBarcodeScanner = registerPlugin<FastIosBarcodeScannerPlugin>("FastBarcodeScanner");
const barcodeScanner = registerPlugin<NativeBarcodeScannerPlugin>("BarcodeScanner");

function getNativePlatform(): string {
  return Capacitor.getPlatform();
}

export function isNativeBarcodeScannerAvailable() {
  return Capacitor.isNativePlatform();
}

async function scanFastIosBarcode(): Promise<NativeBarcodeScanResult | null> {
  if (getNativePlatform() !== "ios") return null;

  try {
    const result = await fastIosBarcodeScanner.scan({
      formats: PRODUCT_NATIVE_BARCODE_FORMATS,
      zoomFactor: 1.25
    });

    if (result.cancelled) {
      return {
        status: "cancelled",
        message: "스캔이 취소되었습니다.",
        fallbackToWeb: false
      };
    }

    if (result.action === "register") {
      return { status: "register" };
    }

    const barcode = (result.barcode ?? result.rawValue ?? "").trim();
    if (!barcode) {
      return {
        status: "cancelled",
        message: "스캔된 바코드가 없습니다.",
        fallbackToWeb: false
      };
    }

    return { status: "success", barcode };
  } catch {
    return null;
  }
}

export async function scanNativeBarcode(): Promise<NativeBarcodeScanResult> {
  if (!isNativeBarcodeScannerAvailable()) {
    return {
      status: "unavailable",
      message: "네이티브 스캐너를 사용할 수 없어 웹 스캐너로 전환합니다.",
      fallbackToWeb: true
    };
  }

  const fastIosResult = await scanFastIosBarcode();
  if (fastIosResult) return fastIosResult;

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

  if (getNativePlatform() === "android" && barcodeScanner.isGoogleBarcodeScannerModuleAvailable && barcodeScanner.installGoogleBarcodeScannerModule) {
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

  try {
    const result = await barcodeScanner.scan({
      formats: PRODUCT_NATIVE_BARCODE_FORMATS,
      autoZoom: true
    });
    const barcode = result.barcodes?.find((item) => item.rawValue?.trim())?.rawValue?.trim();

    if (!barcode) {
      return {
        status: "cancelled",
        message: "스캔된 바코드가 없습니다.",
        fallbackToWeb: false
      };
    }

    return { status: "success", barcode };
  } catch {
    return {
      status: "error",
      message: "네이티브 스캐너 실행에 실패해 웹 스캐너로 전환합니다.",
      fallbackToWeb: true
    };
  }
}
