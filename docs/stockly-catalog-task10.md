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

## Correction round 2 — coverage only

- Added a real mocked native-plugin boundary check for the selected barcode's `rawValue` and `format` pairing.
- Added a retained wiring check for camera, image, native, pending replay, register-route metadata, and duplicate/lifecycle guards.
- Existing helper tests still cover web camera/image mapping, legacy pending entries, malformed metadata, TTL/store scope, and UPC_E versus EAN_8.

Evidence:

- `node --test tests/barcode-scan-metadata.test.mjs` — 7 passed, 1 skipped; native boundary test requires Node's module-mocking flag.
- `node --experimental-loader /tmp/stockly-ts-extension-loader.mjs --experimental-test-module-mocks --test tests/barcode-scan-metadata.test.mjs` — 8 passed, 0 failed.
- `node --test test/*.test.mjs tests/*.test.mjs` — 38 passed, 1 failed, 1 skipped; the sole failure is the pre-existing vertical wheel `snapFractionalValueOnStep` contract.
- `npm run build` — passed, exit 0.
- `npm run lint` — passed, exit 0.
- `git diff --check` — passed, exit 0.

Model/provider: gpt-5.6-luna / openai-codex. No production files were changed in this correction. Native/web camera, image, physical barcode, and test-store UI checks remain unrun.
