import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { URL } from "node:url";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("../src/pages/ScanPage.tsx", import.meta.url), "utf8")
  .replaceAll("import.meta.env", '({VITE_MOBILE_INVENTORY_TOUCH_ENABLED: "true"})');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX }
}).outputText;

// Execute the real component effects; replace only rendering, camera and browser APIs.
async function scanStarts(native, replay, unmount = false) {
  const effects = [];
  const timers = new Map();
  let timerId = 0;
  let starts = 0;
  const storage = { getItem: () => null, setItem() {}, removeItem() {} };
  const hooks = {
    useState: value => [typeof value === "function" ? value() : value, () => {}],
    useRef: value => ({ current: value }),
    useMemo: callback => callback(),
    useCallback: callback => callback,
    useEffect: callback => effects.push(callback),
    useLayoutEffect: () => {}
  };
  const sandbox = {
    exports: {},
    navigator: { mediaDevices: {} },
    localStorage: storage,
    document: { body: { classList: { add() {}, remove() {} } } },
    window: {
      localStorage: storage,
      setTimeout: callback => { timers.set(++timerId, callback); return timerId; },
      clearTimeout: id => timers.delete(id)
    },
    require(name) {
      if (name === "react") return hooks;
      if (name === "react/jsx-runtime") return { jsx: () => null, jsxs: () => null };
      if (name.endsWith("useMobileViewport")) return { useMobileViewport: () => true };
      if (name.endsWith("mobileInventory")) return { normalizeMobileScanMode: () => "auto" };
      if (name.endsWith("nativeBarcodeScanner")) return {
        isNativeBarcodeScannerAvailable: () => native,
        scanNativeBarcode: () => { starts++; return new Promise(() => {}); },
        stopNativeBarcode: async () => {}
      };
      if (name.endsWith("webBarcodeScanner")) return {
        preloadWebBarcodeScanner: async () => {},
        createWebBarcodeScanner: async () => ({
          start: async () => { starts++; },
          applyVideoConstraints: async () => {},
          getRunningTrackCameraCapabilities: () => ({ zoomFeature: () => ({ isSupported: () => false }) })
        })
      };
      return {};
    }
  };
  vm.runInNewContext(compiled, sandbox);
  sandbox.exports.ScanPage({ navigate() {}, currentStoreId: "isolated-no-db", scanLaunchId: 1 });
  let cleanups = effects.map(callback => callback());
  if (replay) {
    cleanups.forEach(cleanup => cleanup?.());
    cleanups = effects.map(callback => callback());
  }
  if (unmount) cleanups.forEach(cleanup => cleanup?.());
  for (const [id, callback] of [...timers]) { timers.delete(id); callback(); }
  for (let i = 0; i < 10; i++) await Promise.resolve();
  return starts;
}

for (const native of [true, false]) {
  const scanner = native ? "native" : "web";
  test(`${scanner} scanner starts exactly once after development effect replay`, async () => {
    assert.equal(await scanStarts(native, false), 1, "ordinary mount");
    assert.equal(await scanStarts(native, true), 1, "StrictMode setup/cleanup/setup");
  });
  test(`${scanner} scanner does not start after unmount`, async () => {
    assert.equal(await scanStarts(native, true, true), 0);
  });
}
