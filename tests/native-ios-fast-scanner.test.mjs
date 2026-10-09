import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { URL } from "node:url";
import test from "node:test";

test("iOS barcode scans use the registered fast native scanner", async () => {
  const source = await readFile(new URL("../src/lib/nativeBarcodeScanner.ts", import.meta.url), "utf8");

  assert.match(source, /registerPlugin<FastIosBarcodeScannerPlugin>\("FastBarcodeScanner"\)/);
  assert.match(source, /Capacitor\.getPlatform\(\) !== "ios"/);
  assert.match(source, /fastIosBarcodeScanner\.scan\(\{\s*formats: PRODUCT_NATIVE_BARCODE_FORMATS,/);
});
