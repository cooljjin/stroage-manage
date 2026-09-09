import test from "node:test";
import assert from "node:assert/strict";
import { mock } from "node:test";
import { readFile } from "node:fs/promises";
import { URL } from "node:url";
import { normalizeBarcodeFormat, barcodeScanMetadata, consumePendingScanEntry, getWebBarcodeScanResult } from "../src/lib/barcodeScanMetadata.ts";

test("preserves known native and web scanner formats", () => {
  assert.equal(normalizeBarcodeFormat("UPC_E"), "UPC_E");
  assert.equal(normalizeBarcodeFormat("EAN_8"), "EAN_8");
  assert.equal(normalizeBarcodeFormat("UPC-E"), "UPC_E");
});

test("keeps non-GTIN and unknown formats distinct from EAN-8", () => {
  assert.equal(normalizeBarcodeFormat("CODE_128"), "CODE_128");
  assert.equal(normalizeBarcodeFormat("future-format"), "UNKNOWN");
  assert.equal(normalizeBarcodeFormat(undefined), undefined);
  assert.notEqual(normalizeBarcodeFormat("UPC_E"), "EAN_8");
});

test("metadata accepts legacy and malformed route values safely", () => {
  assert.deepEqual(barcodeScanMetadata(undefined), {});
  assert.deepEqual(barcodeScanMetadata({ barcodeFormat: "UPC_E" }), { barcodeFormat: "UPC_E" });
  assert.deepEqual(barcodeScanMetadata({ barcodeFormat: "EAN_8" }), { barcodeFormat: "EAN_8" });
  assert.deepEqual(barcodeScanMetadata({ barcodeFormat: "EAN8" }), { barcodeFormat: "UNKNOWN" });
  assert.deepEqual(barcodeScanMetadata({ barcodeFormat: 8 }), {});
});

test("web camera and image results retain the decoder format", () => {
  assert.deepEqual(getWebBarcodeScanResult("01234567", { result: { format: { formatName: "EAN_8" } } }), {
    barcode: "01234567",
    barcodeFormat: "EAN_8"
  });
  assert.deepEqual(getWebBarcodeScanResult("01234567", { result: { format: { formatName: "UPC_E" } } }), {
    barcode: "01234567",
    barcodeFormat: "UPC_E"
  });
  assert.deepEqual(getWebBarcodeScanResult("01234567"), { barcode: "01234567" });
});

test("pending metadata roundtrip keeps legacy entries and rejects malformed formats", () => {
  const legacy = JSON.parse(JSON.stringify({ barcode: "01234567", storeId: "test", savedAt: 1 }));
  const current = JSON.parse(JSON.stringify({ ...legacy, barcodeFormat: "UPC_E" }));
  const malformed = JSON.parse(JSON.stringify({ ...legacy, barcodeFormat: "EAN8" }));
  assert.deepEqual(barcodeScanMetadata(legacy), {});
  assert.deepEqual(barcodeScanMetadata(current), { barcodeFormat: "UPC_E" });
  assert.deepEqual(barcodeScanMetadata(malformed), { barcodeFormat: "UNKNOWN" });
});

test("pending consumption normalizes untrusted metadata and enforces store and TTL", () => {
  const now = 1_000_000;
  const base = { barcode: "01234567", storeId: "test", savedAt: now };
  assert.deepEqual(consumePendingScanEntry(JSON.stringify({ ...base, barcodeFormat: 8 }), "test", now), {
    ...base,
    initialInventoryMode: "auto"
  });
  assert.deepEqual(consumePendingScanEntry(JSON.stringify({ ...base, barcodeFormat: {} }), "test", now), {
    ...base,
    initialInventoryMode: "auto"
  });
  assert.equal(consumePendingScanEntry(JSON.stringify({ ...base, barcodeFormat: "EAN8" }), "test", now).barcodeFormat, "UNKNOWN");
  assert.equal(consumePendingScanEntry(JSON.stringify({ ...base, barcodeFormat: "UPC_E" }), "test", now).barcodeFormat, "UPC_E");
  assert.equal(consumePendingScanEntry(JSON.stringify({ ...base, barcodeFormat: "EAN_8" }), "test", now).barcodeFormat, "EAN_8");
  assert.equal(consumePendingScanEntry(JSON.stringify({ ...base, savedAt: now - 5 * 60 * 1000 - 1 }), "test", now), null);
  assert.equal(consumePendingScanEntry(JSON.stringify(base), "other", now), null);
});

test("native scanner preserves the format from the selected barcode", async (t) => {
  if (typeof mock.module !== "function") {
    t.skip("run with --experimental-test-module-mocks for the native boundary check");
    return;
  }

  const listeners = new Map();
  const plugin = {
    isSupported: async () => ({ supported: true }),
    checkPermissions: async () => ({ camera: "granted" }),
    addListener: async (name, listener) => {
      listeners.set(name, listener);
      return { remove: async () => undefined };
    },
    startScan: async () => listeners.get("barcodesScanned")({
      barcodes: [
        { rawValue: "", format: "EAN_8" },
        { rawValue: "01234567", format: "UPC_E" }
      ]
    }),
    stopScan: async () => undefined
  };

  mock.module("@capacitor/core", {
    exports: {
      Capacitor: { isNativePlatform: () => true, getPlatform: () => "ios" },
      registerPlugin: () => plugin
    }
  });
  const { scanNativeBarcode } = await import(`../src/lib/nativeBarcodeScanner.ts?native-test=${Date.now()}`);
  assert.deepEqual(await scanNativeBarcode(), {
    status: "success",
    barcode: "01234567",
    barcodeFormat: "UPC_E"
  });
});

test("scan page keeps native, web, image, pending and route format boundaries wired", async () => {
  const source = await readFile(new URL("../src/pages/ScanPage.tsx", import.meta.url), "utf8");
  assert.match(source, /getWebBarcodeScanResult\(decodedText, result\)/);
  assert.match(source, /getWebBarcodeScanResult\(result\.decodedText, result\)/);
  assert.match(source, /handleBarcode\(result\.barcode, scanModeRef\.current === "audit" \? "audit" : "auto", result\.barcodeFormat\)/);
  assert.match(source, /handleBarcode\(pendingScan\.barcode, pendingScan\.initialInventoryMode, pendingScan\.barcodeFormat\)/);
  assert.match(source, /navigate\(\{ name: "register", barcode, barcodeFormat \}\)/);
  assert.match(source, /barcodeHandlingRef\.current/);
  assert.match(source, /completedNavigationRef\.current/);
  assert.match(source, /scanAttemptRef\.current/);
  assert.match(source, /PENDING_SCAN_STORAGE_KEY/);
});
