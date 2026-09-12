# Stockly Catalog Task 10 — Scanner format preservation

## Implementation

- Native ML Kit scan results retain the selected barcode `format` alongside `rawValue`.
- Web camera and image results map html5-qrcode's `formatName` into the same optional metadata.
- `UPC_E`, `EAN_8`, other supported symbologies, and `UNKNOWN` remain distinct; no format is inferred from barcode length.
- Pending scan storage carries `barcodeFormat`; legacy entries without metadata remain valid, and malformed metadata is dropped or normalized before replay.
- Unregistered navigation carries `barcodeFormat` on `AppRoute`; the existing raw barcode resolver still runs first and registered navigation is unchanged.
- Native/web fallback, cancellation, duplicate-navigation refs, scan attempts, TTL, and store scope were not changed.

## Changed paths

- `src/lib/nativeBarcodeScanner.ts`
- `src/lib/webBarcodeScanner.ts`
- `src/lib/barcodeScanMetadata.ts`
- `src/pages/ScanPage.tsx`
- `src/types/domain.ts`
- `tests/barcode-scan-metadata.test.mjs`

## Evidence

Model/provider: gpt-5.6-luna / openai-codex.

Historical RED before implementation:

- `node --test tests/barcode-scan-metadata.test.mjs` — failed because `src/lib/barcodeScanMetadata.ts` did not exist.

Focused GREEN:

- `node --test tests/barcode-scan-metadata.test.mjs` — 6 passed, 0 failed.
- Covers native/web known formats, non-GTIN and unknown formats, UPC-E versus EAN-8, legacy/malformed metadata, camera/image result mapping, pending metadata roundtrip, and the production pending-entry consumer's format normalization, TTL, and store scope.

Correction GREEN:

- `node --test tests/barcode-scan-metadata.test.mjs` — 6 passed, 0 failed after moving pending-entry consumption through the tested normalization path.

Common verification after implementation:

- `npm run build` — passed, exit 0.
- `npm run lint` — passed, exit 0.
- `git diff --check` — passed, exit 0.
- `node --test test/*.test.mjs tests/*.test.mjs` — 37 passed, 1 failed, exit 1 (38 total). The only failure is the pre-existing `tests/vertical-quantity-wheel-fractional-slots.test.mjs` contract expecting `/snapFractionalValueOnStep = true/`; no scanner test failed.

## Not run

Native camera, web camera, image scan on a device, and manual test-store UI checks were not run. This task contract forbids remote DB access and no approved device session was used. ProductEdit lookup/props integration remains Task 11.

No SQL, dependency, database, external provider, deployment, commit, push, or merge changes were made. Existing dirty and untracked user files were preserved.

## Extra S10 recovery — test-only

- The retained flow tests execute production `ScanPage`, including the native `status: "register"` branch, and assert its exact single `{ name: "register", barcode: "" }` route without a resolver/RPC call.
- The harness preserves `useState`/`useRef` values across an explicit rerender; the manual test changes `initial-manual` to `entered-manual` and asserts the entered value drives registration.
- `resolvedProducts.ts` is loaded from production; only the `DatabaseService.rpc` boundary is stubbed, so candidate RPC order is retained behavioral evidence.
- Deferred tests enter a live native scan before invalidation/unmount, then release late results and assert no stale navigation plus native cleanup.

Evidence:

- `node --experimental-loader ./tests/scan-page-loader.mjs --test ./tests/scan-page-flow.test.mjs` — 7 passed, 0 failed; includes native `status: "register"` no-RPC and state-preserving manual rerender evidence.
- `node --experimental-loader ./tests/scan-page-loader.mjs --experimental-test-module-mocks --test ./tests/barcode-scan-metadata.test.mjs` — 8 passed, 0 failed.
- `node --test ./test/*.test.mjs ./tests/*.test.mjs` — 66 passed, 1 failed, 8 skipped, 75 total, exit 1. The sole failure is the pre-existing vertical-wheel `snapFractionalValueOnStep` contract; no retained scanner flow failed.
- Historical protected `npm run build` failure — earlier validation recorded `TS5033`/`EPERM` while writing `node_modules/.tmp/tsconfig.app.tsbuildinfo`; that is a shared-cache permission failure, not an application regression. A current rerun of `npm run build` passed, exit 0.
- Safe isolated-cache type checks — `npx tsc -p tsconfig.app.json --tsBuildInfoFile /tmp/stockly-parallel-s10.app.tsbuildinfo --noEmit && npx tsc -p tsconfig.node.json --tsBuildInfoFile /tmp/stockly-parallel-s10.node.tsbuildinfo --noEmit` passed. The current Vite production bundle is covered by the passing `npm run build`; `vite --configLoader runner` was not counted because the terminal guard classified that invocation as a long-lived process.
- `npm run lint` — passed, exit 0.
- `git diff --check` — passed, exit 0.

Model/provider: gpt-5.6-luna / openai-codex. No production files were changed. Physical native/web/image camera, physical UPC-E/EAN-8, and test-store UI checks remain unrun.
