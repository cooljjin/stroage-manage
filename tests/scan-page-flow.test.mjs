import test from "node:test";
import assert from "node:assert/strict";

const loaderEnabled = globalThis.process.execArgv.some((argument) => argument.includes("scan-page-loader.mjs"));
const loaderSkipReason = "run with --experimental-loader ./tests/scan-page-loader.mjs to execute production ScanPage";

function makeStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key)
  };
}

function setupHarness({ native = false, pending = null, web = false } = {}) {
  const storage = makeStorage();
  if (pending) storage.setItem("store-inventory-pending-scan", JSON.stringify(pending));
  const timers = [];
  const navigations = [];
  const harness = {
    cleanups: [],
    handleBarcode: null,
    startScanner: null,
    startWebScanner: null,
    rpcCalls: [],
    rpcBoundaryCalls: [],
    rpcResults: [],
    rpcDeferred: [],
    native: { available: native, result: { status: "cancelled", message: "취소", fallbackToWeb: false }, results: [], calls: 0, stopCalls: 0 },
    stateIndex: 0,
    stateValues: [],
    stateInitialized: [],
    refIndex: 0,
    refValues: [],
    effectIndex: 0,
    effectInitialized: [],
    webScanner: {
      isScanning: false,
      start: async (_camera, _config, onSuccess) => { harness.webSuccess = onSuccess; onSuccess("web-raw", { result: { format: { formatName: "EAN_8" } } }); },
      stop: async () => undefined,
      applyVideoConstraints: async () => undefined,
      getRunningTrackCameraCapabilities: () => ({ zoomFeature: () => ({ isSupported: () => false }) }),
      scanFileV2: async () => harness.imageResult ?? ({ decodedText: "image-raw", result: { format: { formatName: "UPC_E" } } })
    }
  };
  globalThis.__scanHarness = harness;
  globalThis.localStorage = storage;
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: native || web ? { mediaDevices: {} } : {} });
  globalThis.document = { body: { classList: { add() {}, remove() {} } } };
  globalThis.window = {
    localStorage: storage,
    setTimeout: (fn) => { timers.push(fn); return timers.length; },
    clearTimeout: () => {}
  };
  const navigate = (route) => navigations.push(route);
  return { harness, storage, timers, navigations, navigate };
}

async function renderScanPage(harness, navigate, storeId = "store-a") {
  const { ScanPage } = await import("../src/pages/ScanPage.tsx");
  harness.render = () => {
    harness.stateIndex = 0;
    harness.refIndex = 0;
    harness.effectIndex = 0;
    ScanPage({ navigate, currentStoreId: storeId });
  };
  harness.render();
  await new Promise((resolve) => globalThis.queueMicrotask(resolve));
  assert.ok(harness.handleBarcode, "production ScanPage handleBarcode was not captured");
  return ScanPage;
}

test("production ScanPage resolves raw-first candidates and routes registered variants to operation", { skip: loaderEnabled ? false : loaderSkipReason }, async () => {
  const { harness, navigations, navigate } = setupHarness();
  await renderScanPage(harness, navigate);

  for (const product of [
    { id: "registered", receipt_check_only: false },
    { id: "alias", barcode_alias: true },
    { id: "receipt", receipt_check_only: true }
  ]) {
    harness.rpcResults = [{ data: [], error: null }, { data: [product], error: null }];
    await harness.handleBarcode("0012345678901", "auto", "UPC_E");
    assert.deepEqual(harness.rpcCalls.at(-1), { storeId: "store-a", candidates: ["012345678901"] });
    assert.deepEqual(harness.rpcCalls.slice(-2).map(({ candidates }) => candidates[0]), ["0012345678901", "012345678901"]);
    assert.deepEqual(navigations.pop(), { name: "operation", productId: product.id, initialInventoryMode: "auto" });
    harness.handleBarcode = null;
    harness.refValues = [];
    harness.effectInitialized = [];
    await renderScanPage(harness, navigate);
  }
});

test("production ScanPage routes unknown scans to register with format and preserves valid legacy pending replay", { skip: loaderEnabled ? false : loaderSkipReason }, async () => {
  const pending = { barcode: "legacy-123", storeId: "store-a", savedAt: Date.now() };
  const { harness, timers, navigations, navigate } = setupHarness({ pending });
  harness.rpcResults = [{ data: [], error: null }];
  await renderScanPage(harness, navigate);
  timers.splice(0).forEach((timer) => timer());
  await new Promise((resolve) => globalThis.queueMicrotask(() => globalThis.queueMicrotask(resolve)));
  assert.deepEqual(harness.rpcCalls[0], { storeId: "store-a", candidates: ["legacy-123"] });
  assert.deepEqual(navigations.pop(), { name: "register", barcode: "legacy-123", barcodeFormat: undefined });

  const second = setupHarness();
  await renderScanPage(second.harness, second.navigate);
  second.harness.rpcResults = [{ data: [], error: null }];
  await second.harness.handleBarcode("987654321098", "audit", "EAN_8");
  assert.deepEqual(second.navigations[0], { name: "register", barcode: "987654321098", barcodeFormat: "EAN_8" });
});

test("production ScanPage native cancellation, fallback, and duplicate guard use the real scanner callbacks", { skip: loaderEnabled ? false : loaderSkipReason }, async () => {
  const { harness, navigations, navigate } = setupHarness({ native: true });
  await renderScanPage(harness, navigate);
  assert.ok(harness.startScanner, "production ScanPage startScanner was not captured");

  harness.native.result = { status: "cancelled", message: "취소", fallbackToWeb: false };
  await harness.startScanner();
  assert.deepEqual(navigations.pop(), { name: "home" });

  harness.native.result = { status: "error", message: "native failed", fallbackToWeb: true };
  await harness.startScanner();
  await new Promise((resolve) => globalThis.queueMicrotask(resolve));
  assert.deepEqual(harness.rpcCalls.at(-1), { storeId: "store-a", candidates: ["web-raw"] });
  assert.equal(navigations.at(-1).name, "register");

  const callsBefore = harness.rpcCalls.length;
  await harness.handleBarcode("duplicate", "auto");
  await harness.handleBarcode("duplicate-again", "auto");
  assert.equal(harness.rpcCalls.length, callsBefore, "duplicate guard allowed a second production navigation");
});

test("production ScanPage preserves native success, camera events, and image metadata", { skip: loaderEnabled ? false : loaderSkipReason }, async () => {
  const native = setupHarness({ native: true });
  native.harness.native.result = { status: "success", barcode: "native-raw", barcodeFormat: "UPC_E" };
  await renderScanPage(native.harness, native.navigate);
  await native.harness.startScanner();
  assert.deepEqual(native.navigations.at(-1), { name: "register", barcode: "native-raw", barcodeFormat: "UPC_E" });

  const register = setupHarness({ native: true });
  await renderScanPage(register.harness, register.navigate);
  register.harness.native.result = { status: "register", barcode: "ignored-by-production" };
  await register.harness.startScanner();
  assert.deepEqual(register.navigations, [{ name: "register", barcode: "" }]);
  assert.equal(register.harness.rpcBoundaryCalls.length, 0, "native register status must not resolve a barcode");

  const camera = setupHarness({ web: true });
  await renderScanPage(camera.harness, camera.navigate);
  await camera.harness.startScanner();
  await new Promise((resolve) => globalThis.queueMicrotask(resolve));
  assert.deepEqual(camera.navigations.at(-1), { name: "register", barcode: "web-raw", barcodeFormat: "EAN_8" });

  const image = setupHarness({ web: true });
  image.harness.imageResult = { decodedText: "image-raw", result: { format: { formatName: "UPC_E" } } };
  await renderScanPage(image.harness, image.navigate);
  await image.harness.imageChange({ target: { files: [{}], value: "" } });
  await new Promise((resolve) => globalThis.queueMicrotask(() => globalThis.queueMicrotask(() => globalThis.queueMicrotask(resolve))));
  assert.equal(image.harness.rpcCalls.length, 1);
  assert.deepEqual(image.harness.rpcCalls[0], { storeId: "store-a", candidates: ["image-raw"] });

  image.harness.rpcResults = [{ data: [], error: null }];
  await new Promise((resolve) => globalThis.queueMicrotask(() => globalThis.queueMicrotask(() => globalThis.queueMicrotask(resolve))));
  assert.deepEqual(image.navigations.at(-1), { name: "register", barcode: "image-raw", barcodeFormat: "UPC_E" });
});

test("production ScanPage replays pending metadata and checks both raw-first candidate directions", { skip: loaderEnabled ? false : loaderSkipReason }, async () => {
  const first = setupHarness({ pending: { barcode: "012345678901", barcodeFormat: "UPC_E", storeId: "store-a", savedAt: Date.now() } });
  await renderScanPage(first.harness, first.navigate);
  first.timers.splice(0).forEach((timer) => timer());
  await new Promise((resolve) => globalThis.queueMicrotask(() => globalThis.queueMicrotask(() => globalThis.queueMicrotask(() => globalThis.queueMicrotask(resolve)))));
  assert.deepEqual(first.harness.rpcCalls.slice(0, 2).map(({ candidates }) => candidates[0]), ["012345678901", "0012345678901"]);
  assert.deepEqual(first.navigations.at(-1), { name: "register", barcode: "012345678901", barcodeFormat: "UPC_E" });

  const second = setupHarness();
  await renderScanPage(second.harness, second.navigate);
  await second.harness.handleBarcode("0123456789012", "auto", "EAN_13");
  assert.deepEqual(second.harness.rpcCalls.slice(-2).map(({ candidates }) => candidates[0]), ["0123456789012", "123456789012"]);
});

test("production ScanPage rejects deferred duplicates, stale attempts, late results, and cleans up on unmount", { skip: loaderEnabled ? false : loaderSkipReason }, async () => {
  const deferred = setupHarness();
  let resolveFirst;
  deferred.harness.rpcDeferred.push(new Promise((resolve) => { resolveFirst = resolve; }));
  await renderScanPage(deferred.harness, deferred.navigate);
  const first = deferred.harness.handleBarcode("first");
  const second = deferred.harness.handleBarcode("second");
  resolveFirst({ data: [], error: null });
  await Promise.all([first, second]);
  assert.equal(deferred.harness.rpcCalls.length, 1);
  assert.equal(deferred.navigations.length, 1);

  const stale = setupHarness({ native: true });
  let resolveStale;
  stale.harness.native.results.push(new Promise((resolve) => { resolveStale = resolve; }));
  await renderScanPage(stale.harness, stale.navigate);
  const staleScan = stale.harness.startScanner();
  await new Promise((resolve) => globalThis.queueMicrotask(resolve));
  assert.equal(stale.harness.native.calls, 1);
  stale.harness.native.result = { status: "cancelled", message: "취소", fallbackToWeb: false };
  await stale.harness.startScanner();
  resolveStale({ status: "success", barcode: "stale", barcodeFormat: "UPC_E" });
  await staleScan;
  assert.deepEqual(stale.navigations, [{ name: "home" }]);

  const unmounted = setupHarness({ native: true });
  let resolveUnmounted;
  unmounted.harness.native.results.push(new Promise((resolve) => { resolveUnmounted = resolve; }));
  await renderScanPage(unmounted.harness, unmounted.navigate);
  const unmountedScan = unmounted.harness.startScanner();
  await new Promise((resolve) => globalThis.queueMicrotask(resolve));
  assert.equal(unmounted.harness.native.calls, 1);
  assert.ok(unmounted.harness.cleanups.length > 0);
  unmounted.harness.cleanups.forEach((cleanup) => cleanup());
  resolveUnmounted({ status: "success", barcode: "late", barcodeFormat: "EAN_8" });
  await unmountedScan;
  assert.equal(unmounted.navigations.length, 0);
  assert.ok(unmounted.harness.native.stopCalls > 0);
});

test("production ScanPage uses rendered manual input and registration button", { skip: loaderEnabled ? false : loaderSkipReason }, async () => {
  const manual = setupHarness();
  manual.harness.searchTermInitial = "initial-manual";
  await renderScanPage(manual.harness, manual.navigate);
  assert.ok(manual.harness.searchInput);
  assert.ok(manual.harness.registerButton);
  manual.harness.searchInput.onChange({ target: { value: " entered-manual " } });
  assert.equal(manual.harness.stateValues[2], " entered-manual ");
  manual.harness.render();
  manual.harness.registerButton.onClick();
  assert.deepEqual(manual.navigations.at(-1), { name: "register", barcode: "entered-manual" });
});
