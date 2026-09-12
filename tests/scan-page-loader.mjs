import { transform } from "esbuild";
import { access, readFile } from "node:fs/promises";
import { URL, fileURLToPath, pathToFileURL } from "node:url";

const barcodeMetadataUrl = pathToFileURL(new URL("../src/lib/barcodeScanMetadata.ts", import.meta.url).pathname).href;

const stubs = {
  "react": `export const useState = (initial) => { const harness = globalThis.__scanHarness; const index = harness.stateIndex++; if (!harness.stateInitialized[index]) { harness.stateValues[index] = index === 2 && harness.searchTermInitial !== undefined ? harness.searchTermInitial : (typeof initial === "function" ? initial() : initial); harness.stateInitialized[index] = true; } return [harness.stateValues[index], (next) => { harness.stateValues[index] = typeof next === "function" ? next(harness.stateValues[index]) : next; }]; }; export const useRef = (value) => { const harness = globalThis.__scanHarness; const index = harness.refIndex++; if (!harness.refValues[index]) harness.refValues[index] = { current: value }; return harness.refValues[index]; }; export const useMemo = (fn) => fn(); export const useCallback = (fn) => { if (fn.toString().includes("savePendingScanBarcode")) globalThis.__scanHarness.handleBarcode = fn; if (fn.toString().includes("const scanAttempt = scanAttemptRef.current + 1")) globalThis.__scanHarness.startScanner = fn; if (fn.toString().includes("webScannerLoadingAttemptRef.current = scanAttempt")) globalThis.__scanHarness.startWebScanner = fn; return fn; }; export const useEffect = (fn) => { const harness = globalThis.__scanHarness; const index = harness.effectIndex++; if (harness.effectInitialized[index]) return; harness.effectInitialized[index] = true; const cleanup = fn(); if (cleanup) harness.cleanups.push(cleanup); }; export const useLayoutEffect = useEffect;`,
  "../services": `export const DatabaseService = { rpc: async (name, args) => { const harness = globalThis.__scanHarness; const result = harness.rpcDeferred.shift() ?? harness.rpcResults.shift() ?? { data: [], error: null }; harness.rpcBoundaryCalls.push({ name, args }); if (name === "resolve_product_by_barcode") harness.rpcCalls.push({ storeId: args.target_store_id, candidates: [args.target_barcode] }); return result; } };`,
  "react/jsx-runtime": `const record = (type, props) => { const harness = globalThis.__scanHarness; if (props?.accept === "image/*") harness.imageChange = props.onChange; if (props?.placeholder === "상품명 또는 바코드") harness.searchInput = props; if (type === "button" && props?.children === "새 상품 등록") harness.registerButton = props; return ({ type, props }); }; export const Fragment = Symbol("Fragment"); export const jsx = record; export const jsxs = record;`,
  "lucide-react": `export const Camera = "Camera"; export const Search = "Search"; export const ScanLine = "ScanLine"; export const ZoomIn = "ZoomIn";`,
  "../components/PageTitle": `export const PageTitle = () => null;`,
  "../components/StatusMessage": `export const StatusMessage = () => null;`,
  "../hooks/useMobileViewport": `export const useMobileViewport = () => false;`,
  "../lib/mobileInventory": `export const normalizeMobileScanMode = (value) => value === "audit" ? "audit" : "auto";`,
  "../lib/nativeBarcodeScanner": `export const isNativeBarcodeScannerAvailable = () => globalThis.__scanHarness.native.available; export const scanNativeBarcode = () => { globalThis.__scanHarness.native.calls += 1; return Promise.resolve(globalThis.__scanHarness.native.results.shift() ?? globalThis.__scanHarness.native.result); }; export const stopNativeBarcode = () => { globalThis.__scanHarness.native.stopCalls += 1; return Promise.resolve(); };`,
  "../lib/webBarcodeScanner": `import { getWebBarcodeScanResult } from "${barcodeMetadataUrl}"; export { getWebBarcodeScanResult }; export const preloadWebBarcodeScanner = async () => undefined; export const createWebBarcodeScanner = async () => globalThis.__scanHarness.webScanner; export const webBarcodeCameraErrorMessage = () => "camera error";`
};

export async function resolve(specifier, context, nextResolve) {
  if (stubs[specifier]) return { url: `data:text/javascript,${encodeURIComponent(stubs[specifier])}`, shortCircuit: true };
  if (context.parentURL?.includes("/src/") && specifier.startsWith(".")) {
    for (const extension of [".ts", ".tsx"]) {
      const candidate = new URL(`${specifier}${extension}`, context.parentURL);
      try {
        await access(fileURLToPath(candidate));
        return { url: candidate.href, shortCircuit: true };
      } catch {
        // Try the next TypeScript extension.
      }
    }
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url.startsWith("data:text/javascript,")) return { format: "module", source: decodeURIComponent(url.slice("data:text/javascript,".length)), shortCircuit: true };
  if (url.includes("/src/") && (url.endsWith(".ts") || url.endsWith(".tsx"))) {
    const source = await readFile(fileURLToPath(url), "utf8");
    const result = await transform(source, { loader: url.endsWith(".tsx") ? "tsx" : "ts", format: "esm", jsx: "automatic", define: { "import.meta.env.VITE_MOBILE_INVENTORY_TOUCH_ENABLED": "undefined" }, sourcemap: false });
    return { format: "module", source: result.code, shortCircuit: true };
  }
  return nextLoad(url, context);
}

export const scanPageUrl = pathToFileURL(new URL("../src/pages/ScanPage.tsx", import.meta.url).pathname).href;
