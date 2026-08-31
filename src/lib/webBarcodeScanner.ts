import type { Html5Qrcode } from "html5-qrcode";

type Html5QrcodeModule = typeof import("html5-qrcode");

let loadedModule: Html5QrcodeModule | null = null;
let modulePromise: Promise<Html5QrcodeModule> | null = null;

export type WebBarcodeScanner = Html5Qrcode;

function loadWebBarcodeScannerModule() {
  if (loadedModule) return Promise.resolve(loadedModule);
  if (modulePromise) return modulePromise;

  modulePromise = import("html5-qrcode")
    .then((module) => {
      loadedModule = module;
      return module;
    })
    .catch((error: unknown) => {
      modulePromise = null;
      throw error;
    });

  return modulePromise;
}

export async function preloadWebBarcodeScanner() {
  await loadWebBarcodeScannerModule();
}

export function createWebBarcodeScanner(elementId: string): Promise<WebBarcodeScanner> {
  if (loadedModule) return Promise.resolve(buildScanner(loadedModule, elementId));
  return loadWebBarcodeScannerModule().then((module) => buildScanner(module, elementId));
}

export function webBarcodeCameraErrorMessage(error: unknown) {
  const detail = error instanceof Error ? `${error.name} ${error.message}` : String(error ?? "");
  const normalizedDetail = detail.toLocaleLowerCase();

  if (normalizedDetail.includes("notallowed") || normalizedDetail.includes("permission") || normalizedDetail.includes("denied")) {
    return "카메라 권한이 허용되지 않았습니다. 브라우저 설정에서 카메라 권한을 허용해 주세요.";
  }

  if (normalizedDetail.includes("notfound") || normalizedDetail.includes("devicesnotfound") || normalizedDetail.includes("overconstrained")) {
    return "이 기기에서 사용할 수 있는 카메라를 찾지 못했습니다.";
  }

  return "카메라를 시작하지 못했습니다. 다른 앱에서 카메라를 사용 중인지 확인하고 다시 시도해 주세요.";
}

function buildScanner(module: Html5QrcodeModule, elementId: string) {
  const { Html5Qrcode, Html5QrcodeSupportedFormats } = module;

  return new Html5Qrcode(elementId, {
    formatsToSupport: [
      Html5QrcodeSupportedFormats.EAN_13,
      Html5QrcodeSupportedFormats.EAN_8,
      Html5QrcodeSupportedFormats.UPC_A,
      Html5QrcodeSupportedFormats.UPC_E,
      Html5QrcodeSupportedFormats.CODE_128,
      Html5QrcodeSupportedFormats.CODE_39,
      Html5QrcodeSupportedFormats.CODE_93,
      Html5QrcodeSupportedFormats.ITF,
      Html5QrcodeSupportedFormats.CODABAR
    ],
    experimentalFeatures: {
      useBarCodeDetectorIfSupported: true
    },
    verbose: false
  });
}
