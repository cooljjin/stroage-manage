import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { URL } from "node:url";
import test from "node:test";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("native and web scanners accept QR codes", async () => {
  const [nativeScanner, webScanner] = await Promise.all([
    source("src/lib/nativeBarcodeScanner.ts"),
    source("src/lib/webBarcodeScanner.ts")
  ]);
  const nativeFormats = nativeScanner.match(/const PRODUCT_NATIVE_BARCODE_FORMATS = \[([\s\S]*?)\];/)?.[1] ?? "";
  const webFormats = webScanner.match(/formatsToSupport: \[([\s\S]*?)\]/)?.[1] ?? "";

  assert.match(nativeFormats, /"QR_CODE"/);
  assert.match(webFormats, /Html5QrcodeSupportedFormats\.QR_CODE/);
});

test("web camera scan areas fit square QR codes and forward decoded payloads", async () => {
  const [scanPage, lowStockPage] = await Promise.all([
    source("src/pages/ScanPage.tsx"),
    source("src/pages/LowStockPage.tsx")
  ]);
  const qrCapableFrame = /height: Math\.floor\(Math\.min\(viewfinderHeight \* 0\.7, viewfinderWidth \* 0\.92, 360\)\)/;

  assert.match(scanPage, qrCapableFrame);
  assert.match(lowStockPage, qrCapableFrame);
  assert.match(scanPage, /\(decodedText\) => void handleBarcode\(decodedText\)/);
  assert.match(scanPage, /await handleBarcode\(result\.barcode/);
  assert.match(scanPage, /navigate\(\{ name: "register", barcode \}\)/);
});
