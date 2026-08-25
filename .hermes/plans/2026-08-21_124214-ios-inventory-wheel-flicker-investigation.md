# iOS Inventory Quantity Wheel Flicker — Investigation and Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Identify and fix the remaining iOS WKWebView flicker while dragging the Warehouse (창고) and Store (매장) quantity wheels, without changing inventory semantics, save behavior, or unrelated navigation.

**Architecture:** The mobile Inventory Operation UI has a local, rAF-throttled visual wheel (`VerticalQuantityWheel`), a parent-owned draft state in `InventoryOperationPage`, and a delayed server commit. Investigation must separate compositor paint instability from React/render pressure and from native scroll/gesture interaction before selecting one narrow fix.

**Tech Stack:** React 18 / TypeScript / Vite, Tailwind CSS, Capacitor 8 iOS (`CAPBridgeViewController` / WKWebView), Supabase RPC mobile inventory sessions.

**Scope and constraints:** Plan only. Current branch is `codex/inventory-wheel-smooth` at `a364010`; worktree was clean during inspection. No source edits, commits, builds, Capacitor syncs, or device changes were made. The only artifact made for this plan is this markdown file.

---

## 1. Evidence: Current Data, Render, and Scroll Flow

### 1.1 Route and mobile-mode gate

1. `src/App.tsx:~850-880` renders `InventoryOperationPage` for the `operation` route, passing `productId`, `currentStoreId`, navigation, initial mode, and the before-leave registration callback.
2. `src/hooks/useMobileViewport.ts:3-18` returns true only for `(max-width: 639px)`.
3. `src/pages/InventoryOperationPage.tsx:332-403` computes:
   - `isMobileViewport` through that hook;
   - `mobileTouchEnabled` unless `VITE_MOBILE_INVENTORY_TOUCH_ENABLED === "false"`;
   - `mobileTouchUI = mobileTouchEnabled && isMobileViewport` at line 403.
4. `src/pages/InventoryOperationPage.tsx:1479-1622` chooses the screen:
   - receipt-check-only products take a separate form (`1532-1593`);
   - otherwise, if `mobileTouchUI`, it renders `MobileInventoryControls` (`1594-1621`);
   - desktop controls are the final fallback (`1683+`).

Implication: the reported boxes are not rendered on a wide iPad/Desktop layout, with the touch feature flag disabled, or for receipt-check-only products.

### 1.2 Initial data and parent state ownership

1. `loadProduct` at `InventoryOperationPage.tsx:362-393` queries the product plus `inventory(*)`, normalizes it, and stores the result in `item`. It can create a missing inventory row (not relevant to a normal drag, but important to avoid conflating first-load changes with flicker).
2. Mobile state is declared at `332-360`: independently held draft quantities (`mobileWarehouseQty`, `mobileStoreQty`), confirmed snapshot/version values, save status, edit history, and refs that coordinate queued saves.
3. On an `item` update, the effect at `518-563` copies the server-confirmed item quantities/versions into `mobileConfirmedSnapshot` and the two draft quantity states. It bypasses that reset while a mobile session exists (`520`) and preserves a conflict draft where relevant (`545-561`).
4. `MobileInventoryControls` receives draft quantities as `warehouseQty` and `storeQty`, and confirmed quantities separately (`1596-1605`). Therefore the wheel is controlled by parent draft state in normal steady state, not directly by RPC response.

### 1.3 Wheel → draft target → server commit sequence

1. `src/components/MobileInventoryControls.tsx:68-90` derives the appropriate `MobileInventoryTarget` on every wheel callback:
   - auto/audit: only the touched location changes (`buildAutoTarget` / `buildAuditTarget`);
   - move: both values are recalculated from confirmed total (`buildMoveTarget`).
2. Each wheel is rendered at `MobileInventoryControls.tsx:113-141`, respectively Warehouse (`114-127`) and Store (`128-141`). They use the same component and configuration except label/location/callback/value.
3. `InventoryOperationPage.tsx:727-734` handles `onDraftChange`: saves the target in a ref, calls `setMobileWarehouseQty` and `setMobileStoreQty`, and marks save state `dragging`.
4. `VerticalQuantityWheel.tsx:92-98` updates its own `displayValue` ref/state and calls `onDraftChange` whenever the projected integer quantity changes. Thus one applied wheel projection can schedule both a wheel-local React render and a page-level React render.
5. On release, `VerticalQuantityWheel.tsx:136-156` settles the visual offset, then starts a `MOBILE_SETTLE_DELAY_MS` (300 ms) commit timer. The parent commit handler (`InventoryOperationPage.tsx:736-743`) queues one latest target.
6. `flushMobileTargets` (`609-686`) sends the queued target through `applyMobileInventoryChange`; the helper calls `apply_mobile_inventory_change_v2` at `src/lib/mobileInventorySession.ts:33-49`.
7. A successful RPC result enters `applyMobileResult` (`592-607`), which updates confirmed snapshot, draft quantities, `item.inventory`, and edit history. The parent rerenders again after the server response.

Evidence-based consequence: network/RPC activity does not happen per pointer-move; it happens after release plus 300 ms. Network rendering can explain a post-release visual jump, but cannot by itself explain continuous flicker during a held drag.

### 1.4 Exact pointer, render, and visual-transform path

1. Pointer down (`VerticalQuantityWheel.tsx:162-186`): clears pending settle/rAF/snap motion, sets `transition: none`, resets transform to zero, records pointer ID/start Y/start value, and calls `setPointerCapture`.
2. Pointer move (`188-200`): after the 8px threshold, prevents default, calculates a projected `value` and residual `offset`, then coalesces updates into one `requestAnimationFrame`.
3. Projection (`100-110`) uses `MOBILE_DRAG_STEP_PX = 32` (`src/lib/mobileInventory.ts:3`) and boundary compression (max 12px). Value changes are integer steps; residual sub-step movement is a translated track.
4. rAF application (`117-126`) calls `applyProjection` (`112-115`), which:
   - updates wheel-local `displayValue` and invokes the parent draft callback; and
   - imperatively writes `transform: translate3d(0, offsetpx, 0)` on the inner track.
5. Render (`263-277`) places five quantity slots in an absolute track (`269-271`) inside an overflowing, paint-contained, masked element (`267-273`). The central selection has a separate border overlay.
6. The prop synchronization effect (`246-256`) deliberately ignores parent `value` updates while a pointer exists. This normally prevents parent renders from snapping the visual display backward during a drag. After release, it clears `pendingValueRef` only when the parent has caught up.
7. Release/cancel (`202-222`) applies the final snap projection. `settle` first forces `transition: none`, applies the final value/offset, forces layout via `void track.offsetHeight`, then on the next rAF adds a 180ms transform transition and writes zero offset (`136-154`).

### 1.5 CSS and native configuration facts

1. The wheel itself has `touch-none`, `select-none`, `overflow-hidden`, `transition-colors`, and `active:bg-*` in `VerticalQuantityWheel.tsx:264`. `touch-none` maps to `touch-action: none` in the generated CSS.
2. The global press-scale transform is only attached to `.touch-button`, `.primary-button`, and `.secondary-button` in `src/styles.css:38-59`. The wheel does **not** carry `touch-button`; this rules out that global active-scale rule as the direct cause for this component.
3. The track container uses both standard `maskImage` and `WebkitMaskImage`, plus `contain: "paint"` (`VerticalQuantityWheel.tsx:268`). The moving child uses `translate3d` (`84-86`, `269`). This exact combination is a plausible iOS compositor seam, not proof of a bug.
4. No wheel-specific CSS exists in `src/styles.css`; the mobile inventory CSS only adjusts generic page/button/field sizing (`197-217`).
5. `src/App.tsx:373-422` runs a rAF scroll-restoration loop only after navigation with a pending saved scroll position. It calls `window.scrollTo` repeatedly until reachability/timeout and stops on `touchmove`. It is a possible confounder when entering/restoring the operation route, but it has no normal per-drag trigger.
6. Native setup is standard Capacitor: `ios/App/App/AppViewController.swift:4-10` only registers the barcode plugin; `capacitor.config.json:1-5` has no remote `server.url`; `Info.plist:48-60` supports portrait and landscape. Nothing inspected directly customizes WKWebView scrolling.
7. The iOS bundle is generated/ignored (`ios/.gitignore:4`), but its embedded `index-DxlUiLql.js` contains the current wheel implementation, including `WebkitMaskImage`, the forced-layout/snap code, and the cubic-bezier transition. Its timestamp is 2026-08-21 12:16 KST, later than HEAD’s 08:10 KST commit. This is evidence that this local iOS project has received the current source bundle; it does not establish what exact TestFlight/device build the reporter used.

### 1.6 Relevant history and test coverage

1. `85df145` introduced the mobile inventory UI and the original simple single-number wheel. Its wheel directly called parent draft state on pointer moves; it did not have slots, mask, paint containment, rAF transform, local display state, or snap animation.
2. `b3b6043` added long-press inventory checks and disabled controls while save/check is pending; it did not introduce the reel animation.
3. HEAD commit `a364010` (“Improve quantity wheel dragging and update iOS signing”) changed `VerticalQuantityWheel.tsx` and `mobileInventory.ts`:
   - 20px to 32px drag step;
   - local display state and rAF projection;
   - five-slot masked reel, `translate3d`, paint containment, boundary rubber-band, and 180ms snap;
   - iOS Xcode changes were signing/build-number only, not rendering code.
4. There is no JS unit/component/E2E test harness in `package.json` (no test script/framework). The only related test found is `supabase/tests/060_mobile_inventory_sessions_contract.sql:1-71`, a non-mutating database catalog/privilege contract; it cannot test pointer rendering, paint, or iOS behavior.

## 2. Ranked, Falsifiable Hypotheses

These are hypotheses, not root-cause claims. Test them in order and record a short video + trace for every result.

### H1 — iOS compositor instability from masked/paint-contained transformed text (highest priority)

**Why it fits:** The symptom is iOS-specific and both boxes share the exact transformed `translate3d` child inside an `overflow:hidden` element with `contain: paint` and `-webkit-mask-image`. Those features were added together in `a364010`; the old single-value wheel had none.

**Prediction:** On the same iPhone and gesture, flicker disappears or materially decreases if only the mask/paint-containment layer is removed/bypassed while preserving pointer math, parent callbacks, and transform motion. The performance trace should show visual artifacts without matching React state discontinuities.

**Falsifier:** Flicker remains indistinguishable with an unmasked, non-contained clipping implementation that uses the same values/transforms; or instrumented transform/value sequences show discontinuities coincident with flashes.

### H2 — rAF updates create React rendering/paint pressure while the track is composited (second)

**Why it fits:** Every applied step calls `setDisplayValue` and invokes parent callbacks which set two page-level states and save status. The full operation page, control panel, both wheels, summary/status UI, and their formatted labels re-render during a drag. The track is also mutated outside React in the same frame.

**Prediction:** A profile shows long frames, more than one React commit per relevant rAF, or a correlation between frame drops/visible flicker and value-boundary crossings. A probe that holds displayed slots in refs/imperative text during drag or defers parent state to a smaller cadence improves the issue without changing the mask.

**Falsifier:** Frame durations and React commits remain low/stable at flicker moments, while changing render cadence alone has no effect.

### H2.5 — step-boundary rebase exposes the previous text at the center (new evidence; highest-priority probe)

**Why it fits:** The new report says the previous number flashes exactly when a number reaches the center band. During a live drag, `applyProjection()` calls `setLocalValue(next.value)` (React state, which updates the five slot texts) and immediately calls `setTrackOffset(-next.offset)` (imperative DOM mutation). At an exact 32px boundary, the projection changes from `{value: old, offset: ~32}` to `{value: old + 1, offset: 0}`. If the transform reset is painted before React commits the new slot text, the old slot set is momentarily centered, so the previous number appears in the selection band. This is a falsifiable ordering hypothesis and explains the exact old-number symptom without involving the server.

**Prediction:** With the finger still down, the flash repeats at each full drag step (approximately every `MOBILE_DRAG_STEP_PX`), and a diagnostic trace shows `next.value !== previous displayValue` together with `Math.abs(next.offset) < 1` immediately before the flash. A probe that atomically coordinates slot text rebase and transform reset removes the flash without changing pointer math or save behavior.

**Falsifier:** The flash occurs only on pointer-up, never at live step boundaries, or the trace shows the DOM slot text has already committed before the transform reaches zero.

**Smallest probe:** Temporarily hold the visual rebase/transform pair together at a step boundary (for diagnosis, use a `useLayoutEffect`/synchronous visual commit or keep the old slot basis until the transform reaches zero), while recording the old/new center text. Do not change React keys or database timing in this probe.

### H3 — release/snap ordering causes a one-frame transform/slot mismatch (third)

**Why it fits:** `settle` writes transition none, changes local state and transform, synchronously reads layout, then in the next frame enables transition and resets transform. Parent state updates are asynchronous. This can produce a flash especially at pointer up/cancel or at a value threshold.

**Prediction:** Flicker is confined to lift-off/snap, and a trace shows it after the final `applyProjection` / before or during the next rAF transition. Disabling only snap (immediate reset to zero) removes the artifact while held-drag behavior remains stable.

**Falsifier:** Flicker is equally present throughout a held drag, before pointer-up, with snap disabled.

### H4 — parent-controlled prop reconciliation or an external item update overwrites the local reel (fourth)

**Why it fits:** The page’s `item` effect can overwrite draft quantities whenever item changes and there is no session, while successful saves update item and the draft. The wheel has special `pendingValueRef` reconciliation. An unexpected item reload, conflict handling, or update sequence could create real value jumps that look like flicker.

**Prediction:** Instrumentation finds `value` prop changes that do not equal the wheel’s pending/local value, or `item`/snapshot effects while pointer is active. The visual flash aligns with a logged parent value reset, not just a compositor frame.

**Falsifier:** During a held drag, parent values always match the local proposed value and no `item` effect/RPC response occurs at flash time.

### H5 — page scroll restoration or native gesture arbitration competes with the wheel (lowest priority)

**Why it fits:** The app has an rAF `window.scrollTo` restoration loop and the wheel relies on `touch-action: none` plus pointer capture. WKWebView gesture behavior can differ from desktop Safari. However, no normal in-page drag starts the restoration loop, so current code evidence ranks this lower.

**Prediction:** The issue only occurs immediately after route/scroll restoration or includes nonzero/changing `scrollY`/`visualViewport` values; it disappears after waiting for route stabilization or when page scrolling is held constant.

**Falsifier:** Flicker reproduces on a settled operation page with no scroll/viewport changes, and restoration instrumentation is inactive.

## 3. Tight Reproduction and Instrumentation Loop

### Reproduction baseline

Use a dedicated non-production “테스트” product only (repository guidance permits it) with known whole-number Warehouse and Store quantities, e.g. 50/50. Do not use a receipt-check-only product.

For each run:

1. Install a fresh Capacitor build made from the candidate source using the normal release/dev process; record app build number, git SHA, device model, iOS version, orientation, and whether it is Debug/TestFlight.
2. Open Inventory Operation only after the page is fully loaded and no “saving” state is visible.
3. Test Warehouse and Store separately in auto mode. Drag 5–8 steps slowly, then rapidly across 20+ steps; hold a sub-step position; release; repeat at zero and (in move mode) the maximum boundary.
4. Capture a 60fps or 120fps screen recording and a Safari Web Inspector timeline for each reproducible failure. Define failure as any transient blank/duplicated/misaligned digit, track jump, or page movement visible in the recording—not merely a delayed save status.
5. Repeat five times per condition. Report both `flicker runs / total runs` and whether the occurrence is held-drag, threshold-only, boundary-only, or release-only.

### Minimum temporary diagnostic probe (first implementation task, removed before merge)

Add an explicitly development-only wheel diagnostic interface (not production logging) behind a query flag or Vite development guard. At pointer down/move rAF/release/snap completion, record a bounded ring buffer containing:

- pointer event sequence, `pointerId`, `clientY`, `startY`, projected value/offset, and whether it was dragged/cancelled;
- rAF timestamp and interval, `performance.now()`, and the actual `track.style.transform`;
- wheel local display value, incoming `value` prop, pending value, parent save state, and a monotonically increasing parent render counter;
- `window.scrollY`, `visualViewport?.offsetTop`, `visualViewport?.height`, and `document.visibilityState`;
- a `PerformanceObserver` long-task count/duration if supported.

Expose a copy-to-console/clipboard action only in development. Do not log product IDs, store IDs, user IDs, or inventory history.

### Controlled discriminating probes

Run one change per candidate build; retain the same gesture script and environment:

1. **H1 probe:** remove only `maskImage`, `WebkitMaskImage`, and `contain: paint`, leaving overflow clip, slot geometry, transform, and callbacks unchanged.
2. **H2 probe:** preserve visual behavior but prevent page-level state updates on every projection (e.g., draft callback only on value-change at a bounded cadence or move the visual draft state to the controls subtree). Compare commit/frame count and video.
3. **H3 probe:** bypass the snap transition only; immediately reset the offset after final projection.
4. **H4 probe:** use the diagnostic ring buffer to assert no unsolicited input-prop/item/snapshot reset occurs from pointer-down until commit begins.
5. **H5 probe:** mark the App restoration effect active/inactive and capture `scrollY`/viewport values; reproduce only after the flag is inactive before considering a scroll-lock or routing change.

Decision rule: implement only the smallest change supported by a positive probe. If no probe changes the result, stop and collect an iOS GPU/compositing trace before attempting a fourth visual redesign.

## 4. Step-by-Step Fix Plan

### Task 1: Establish a red-capable iOS evidence loop

**Objective:** Turn “flickers” into a classified, repeatable observation before changing behavior.

**Files:**
- Modify temporarily: `src/components/VerticalQuantityWheel.tsx:40-256`
- Possibly modify temporarily: `src/pages/InventoryOperationPage.tsx:518-743`
- Do not modify: database schema/RPCs, inventory semantics, iOS signing, unrelated global navigation.

**Steps:**
1. Add the bounded development-only diagnostic probe described above.
2. Produce baseline recordings/traces for both Warehouse and Store, auto/move/audit modes, slow/fast/release/boundary gestures.
3. Verify source SHA/build number in the installed iOS app before interpreting results. Capacitor uses local `dist` (`README.md:172-189`), so source-only results do not prove device behavior.
4. Classify the flicker timing and rank hypotheses again from captured evidence.
5. Remove diagnostics after the deciding probe and before final validation.

### Task 2: Test and, if confirmed, eliminate the compositor-risk layer (expected first fix path)

**Objective:** Replace the risky rendering composition only if H1 is confirmed.

**Likely files:**
- Modify: `src/components/VerticalQuantityWheel.tsx:84-154, 263-277`
- Possibly add narrowly scoped styles: `src/styles.css` (do not change global button rules)
- Keep unchanged: `src/lib/mobileInventory.ts:3-50`, `MobileInventoryControls.tsx:74-141`, save/RPC helpers.

**Steps:**
1. Make a focused non-mask probe and verify it changes the observed failure rate.
2. Choose the smallest stable visual structure:
   - retain one overflow clip and the center selection border;
   - remove `maskImage`/`WebkitMaskImage` and `contain: paint` if the probe proves them causal;
   - use explicit opacity/colour treatment or a static central value rather than a masked GPU layer if fading is needed;
   - retain identical 32px rows, preview values, min/max behavior, pointer capture, and accessibility spinbutton attributes.
3. Ensure a track transform is written in one predictable ownership model; avoid concurrent React DOM replacement and imperative transform writes for the same visual decision.
4. Confirm no pointer-up snap flash, no stale slot text, and no layout jump at 0/max.

**Alternative decision path:** If H2, not H1, wins, do not remove the visual design blindly. Split visual drag state from page-level draft state so the page does not rerender for every rAF; retain a final/controlled parent update that preserves current autosave semantics. If H3 wins, alter only snap scheduling. If H4/H5 wins, fix the demonstrated upstream reset/scroll source rather than wheel styling.

### Task 3: Protect state synchronization and save semantics

**Objective:** Ensure the visual fix cannot introduce quantity rollback, duplicate commits, or an altered server mutation cadence.

**Likely files:**
- Modify only if evidence requires it: `src/components/VerticalQuantityWheel.tsx:92-156, 246-256`
- Verify/no functional change expected: `src/components/MobileInventoryControls.tsx:74-90, 113-141`
- Verify/no functional change expected: `src/pages/InventoryOperationPage.tsx:609-743`
- Verify/no functional change expected: `src/lib/mobileInventory.ts:41-50` and `src/lib/mobileInventorySession.ts:33-63`

**Steps:**
1. Assert local displayed value never regresses while pointer capture is active.
2. Assert release produces exactly one delayed target commit per settled gesture, with the final snapped value.
3. Assert a pending server response cannot overwrite a newer drag draft; preserve current queue/latest-target semantics.
4. Exercise save error/conflict behavior and page leave/visibility finalization without changing the existing RPC/version contract.

### Task 4: Add automated regression coverage at the seams

**Objective:** Add tests for deterministic math/state behavior and, if feasible, component event sequencing. Do not claim pixel-level iOS rendering is unit-testable.

**Likely new files (choose the project’s adopted test runner during implementation):**
- Create: `src/lib/mobileInventory.test.ts`
- Create: `src/components/VerticalQuantityWheel.test.tsx`
- Potentially add test tooling/config only after verifying the smallest compatible setup; do not add an E2E framework just for this bug unless the team explicitly accepts it.

**Tests:**
1. `getVerticalDragStepCount` at exact, below, and above 32px boundaries; release rounding both directions.
2. Projection/value clamp at min zero and move-mode max; verify residual boundary offset cannot alter quantity beyond limits.
3. Pointer sequence: down → sub-threshold move → tap opens keypad; down → drag → rAF projection → pointer up commits only final value after delay.
4. Pointer cancel: commits the latest already-projected value once, never opens keypad, and clears timers/rAF on unmount.
5. Prop reconciliation: local pending draft is not overwritten by an older prop; matching parent prop clears pending state; an external confirmed update reconciles when no active drag exists.
6. If H2 is confirmed, add an assertion that parent draft callback count is bounded as designed while final value stays correct.

### Task 5: Build, native-copy, and validate the real iOS artifact

**Objective:** Verify the exact bundle that runs inside the Capacitor app, not only a desktop browser.

**Files/artifacts:**
- Generated only through standard commands: `dist/` and ignored `ios/App/App/public/`.
- Do not hand-edit generated assets.

**Steps:**
1. Run the new focused tests, then project checks (`npm run build`, `npm run lint`) after implementation.
2. Use the documented `npm run ios:prepare` flow to rebuild and copy the web bundle before opening/running iOS; this mutates generated outputs and must occur only during execution, not investigation.
3. In the installed app, verify the wheel code/version through the in-app build identifier/remote inspector, then execute the validation matrix below.
4. Record remaining device-only observations separately from browser/unit test results.

## 5. Regression Tests and iOS Validation Matrix

### Automated

- Quantity math: drag-step/trailing half-step rounding, min/max clamping, inverted drag if later used.
- Wheel pointer lifecycle: tap, threshold, drag, release, cancel, long press, unmount timer cleanup.
- Parent seam: final target contains the correct Warehouse/Store pair for auto, audit, and move.
- Existing database contract: keep `supabase/tests/060_mobile_inventory_sessions_contract.sql` passing in its normal local-Supabase environment; it validates schema/RPC privileges only and is not a UI test.
- Static quality: TypeScript build and ESLint after code changes.

### Manual iOS matrix

| Dimension | Required cases | Expected result |
|---|---|---|
| Device/OS | at least one supported real iPhone; ideally newest iOS + oldest supported iOS (deployment target is 15.5) | no flicker or page jump |
| Distribution | Xcode Debug and release/TestFlight-equivalent bundle | same wheel behavior; source hash/build verified |
| Location | Warehouse and Store | same stable rendering |
| Mode | auto, audit, move | quantity semantics remain correct |
| Gesture | slow, rapid, long 20+ step, sub-step hold, release, cancellation/interruption | stable digits/track; final value matches drag |
| Bounds | zero and move total maximum | bounded rubber-band/feedback without blank/duplicate digits |
| Display | portrait and landscape (both supported in `Info.plist:48-60`), light and dark | no clipping/flicker/layout overflow |
| Save | normal network, delayed/offline/error, conflict if test environment supports it | one final save; no rollback/duplicate; clear existing error behavior |
| Navigation | immediately after route restoration, normal settled page, navigate away/back, app background/foreground | no scroll fight; pending session finalization preserved |
| Accessibility | Reduce Motion on/off, VoiceOver focus/tap/keypad path | immediate/no-animation behavior when reduced; spinbutton remains usable |

For each matrix cell, separately report visual result, final local number, final server number, save count, and whether the page’s scroll position changed.

## 6. Risks and Open Questions

1. **Exact symptom not yet captured.** “Flicker” might mean blank text, duplicate slots, a snap/jump, active-state flash, or page scroll. The classification changes the root-cause ranking; do not implement from the word alone.
2. **Device/build identity is unverified.** Local ignored iOS public assets include HEAD’s wheel code, but the report may come from a prior installed/TestFlight bundle. Validate app build number/SHA before interpreting a device result.
3. **iOS simulator is insufficient evidence.** The likely H1 path concerns WKWebView GPU composition and must be tested on physical hardware; simulator/desktop Safari may not reproduce it.
4. **Changing render cadence can alter inventory UX.** Any H2 fix must retain immediate local feedback and the existing one-final-target, 300ms delayed commit behavior. Do not debounce away a real final operation or alter conflict/version handling.
5. **Mask removal is a visual trade-off.** An unmasked reel may lose the fade cue; prefer a simpler static/opacity treatment over keeping an unstable compositor effect. Accessibility and readability take priority.
6. **Forced layout is deliberate but risky.** `void track.offsetHeight` may be needed to start the current snap transition; remove/replace it only after proving it causes the flash or after redesigning the snap mechanism.
7. **No existing frontend test harness.** Adding one is useful but has setup/maintenance cost. Keep it minimal and targeted; automated tests cannot prove a GPU paint bug.
8. **No evidence currently ties iOS signing to flicker.** `a364010` changed signing identity/build number alongside the wheel code, but inspected Xcode changes do not affect WebView rendering. Treat signing as unrelated unless device/version investigation shows otherwise.

## Completion Criteria

The fix is ready only when: (a) a recorded iOS reproduction has a confirmed or strongly isolated cause, (b) the chosen narrow fix lowers the observed flicker rate to zero across the required repeated runs, (c) quantity/server-save semantics and accessibility remain intact, (d) generated Capacitor assets come from the tested source, and (e) focused tests plus build/lint pass. If the evidence does not identify a cause, report the traces and failed falsification attempts rather than shipping a speculative visual change.
