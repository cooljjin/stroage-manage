# Mobile Move Peer-Wheel Animation Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** In mobile 재고 작업’s 이동 mode, make the non-operated location wheel visibly scroll to its recalculated quantity whenever a user operates the peer wheel, while preserving the current total-stock invariant and all existing inventory/save/session/history behavior.

**Architecture:** Keep inventory target construction in `mobileInventory.ts` and the page as the authority for draft/confirmed inventory and server persistence. Add an explicit, ephemeral, monotonic peer-wheel visual instruction at the `MobileInventoryControls`/`VerticalQuantityWheel` boundary; it is emitted only by an in-control move-wheel user interaction and consumed only by the opposite wheel. Do not infer animation from a generic controlled `value` prop change, because that prop also changes for loads, keypad commits, server reconciliation, mode resets, and undo/redo.

**Tech Stack:** React 18 + TypeScript, Vite, Tailwind CSS, DOM pointer/wheel/keyboard events, existing `flushSync`/rAF wheel rendering, Capacitor iOS WKWebView.

**Scope / working-tree safety:** This is a plan-only artifact. The inspected branch is `codex/inventory-wheel-smooth`; it already has user-owned modifications in the four requested inventory files and `src/components/QuantityKeypadSheet.tsx`, plus untracked `.hermes/` and `scripts/`. Implementation must layer onto them, must not revert them, and must not modify database/RPC/session schemas. This plan deliberately does not prescribe a commit because the user has requested no commit/push.

---

## Evidence and current flow

### Existing related plan and current worktree context

- `/.hermes/plans/2026-08-21_124214-ios-inventory-wheel-flicker-investigation.md:15-84` documents the controlled parent draft state, rAF wheel projection, delayed 300 ms commit, and iOS flicker investigation. Its facts remain relevant, but its line references predate the current uncommitted worktree.
- The present worktree’s flicker fix is already in `src/components/VerticalQuantityWheel.tsx:118-124`: `applyProjection` calls `setLocalValue(next.value, true)`, whose `flushSync` at `94-104` updates slot text before the imperative track transform. Do not remove, bypass, or reorder this ownership fix while adding peer motion.
- `scripts/mobile-inventory.test.mts:1-106` is the focused script test. It has no package script; it currently tests helper math and source-shape assertions for signed baseline auto mode, not interactive wheel lifecycle or peer animation.

### Exact mobile move data path

1. `src/pages/InventoryOperationPage.tsx:334-365` owns mobile draft quantities, confirmed snapshot/version state, auto baseline, save/session refs, history refs, and keypad target.
2. Initial item synchronization is `InventoryOperationPage.tsx:532-578`: without a mobile session it copies incoming inventory into confirmed snapshot, auto baseline, edit history, and both draft quantities. This is an external synchronization path, not a peer action.
3. The mobile branch is rendered at `InventoryOperationPage.tsx:1610-1642`. It passes drafts and confirmed quantities to controls and resets drafts/baseline on a mode change at `1628-1635`.
4. `src/components/MobileInventoryControls.tsx:72-103` selects target math. In move mode it calls `buildMoveTarget(location, nextValue, confirmedWarehouseQty, confirmedStoreQty)` for both draft and commit callbacks.
5. The two move wheels are rendered independently at `MobileInventoryControls.tsx:172-199`, each controlled by one parent draft prop. Today, when one move wheel changes, `onDraftChange` updates both props; the other wheel’s prop-sync effect numerically resets its `displayValue` without any intentional motion.
6. `src/lib/mobileInventory.ts:96-124` is the invariant boundary: it clamps the operated value against confirmed total and derives the opposite location as `total - adjusted`. It derives move direction from the pair. This function must remain unchanged in meaning: `warehouseQty + storeQty === confirmedWarehouseQty + confirmedStoreQty`.
7. `InventoryOperationPage.tsx:743-759` receives draft/commit targets. Draft changes update both visual draft states and mark `dragging`; commit queues exactly the latest target.
8. `InventoryOperationPage.tsx:625-702` serializes queued RPC writes with expected versions. `applyMobileResult` at `607-623` updates confirmed snapshot, both drafts, item inventory, and edit history after a successful server response.
9. Keypad confirmation is a separate parent path at `InventoryOperationPage.tsx:845-867`; in move mode it directly commits `buildMoveTarget`. The sheet opens/initializes from state at `2011-2025`; `QuantityKeypadSheet.tsx:17-47` validates then invokes `onConfirm`.
10. Undo/redo is a separate parent path at `InventoryOperationPage.tsx:810-843`, using `buildMobileHistoryTarget` (`mobileInventory.ts:180-203`) and `handleMobileCommit`. Conflict reload/reset, visibility/pagehide finalization, unmount, and before-leave session handling are at `667-680`, `711-741`, and `978-1028`.

### Existing wheel lifecycle that the change must preserve

- `VerticalQuantityWheel.tsx:42-52` owns pointer, timer, rAF, snap, pending-prop, and local display refs.
- Pointer movement is thresholded at `197-209`, rAF-coalesced at `126-135`, and uses shared step/offset helpers. Pointer release/cancel and tap/keypad split are at `211-231`; keyboard and desktop mouse wheel behavior are at `233-254`.
- `settle` (`145-165`) rebases through `applyProjection`, optionally animates the track to zero, then schedules the existing delayed commit. Prop reconciliation (`264-274`) intentionally ignores a prop while a pointer or unmatched local pending value exists.
- Slot direction and transform direction are already centralized in `mobileInventory.ts:50-73`, including signed auto’s reversed display. A new peer animation must use those helpers rather than reimplementing direction math.

### Existing semantic regressions to protect

- Signed baseline auto mode is in the current worktree at `MobileInventoryControls.tsx:78-85,109-140`, `InventoryOperationPage.tsx:420-424,845-865,2011-2025`, and `mobileInventory.ts:150-163`. It deliberately uses operation-start baseline rather than a server-confirmed increment.
- Audit targets independently change one location (`mobileInventory.ts:165-178`).
- Mobile log/session/audit/history semantics are recorded in `InventoryOperationPage.tsx:433-466,625-759,810-843`; the server input still carries operation mode, target location, move direction, versions, and session ID (`643-656`).
- The outer full-history restore uses inventory before/after values at `57-218` and `1237-1286`; do not change its source of truth.

---

## Design options, ranked

### 1. Recommended: explicit one-shot `peerAnimation` instruction with a sequence ID

Add a narrow visual-only type, e.g. `PeerWheelAnimation = { sequence: number; fromValue: number; toValue: number }`, to `VerticalQuantityWheel`. `MobileInventoryControls` creates this instruction only when a move wheel produces a user-originated draft value and sends it only to the other wheel. The peer wheel consumes a new sequence exactly once and runs an interruptible destination-rebase scroll.

Why this is recommended:

- It distinguishes causality at the only place that knows “the user changed Warehouse in move mode, therefore Store is the calculated peer,” rather than guessing from a value change.
- It leaves `MobileInventoryTarget`, server payloads, baseline logic, history points, and persisted state untouched.
- It prevents every external prop update from becoming an animation by construction.
- A sequence ID makes repeat values and interrupted animations deterministic; object identity or `value` equality alone is insufficient.

### 2. Pass a generic `updateOrigin` through every page-state setter

Have the page annotate every draft transition (`initial-load`, `pointer`, `keypad`, `server`, `mode`, `history`, `conflict`) and pass that to both wheels.

This is more comprehensive, but is not recommended for the first change: it spreads a presentation-only concern across every save/conflict/history branch, risks missing a branch, and makes a narrow wheel UX change depend on persistence internals. It is suitable only if future requirements need different animations for keypad/history/server transitions.

### 3. Infer a peer update from `mode === "move"`, both values changing, and no active local pointer

This avoids a new callback/prop but is rejected. Server reconciliation, mode reset, history navigation, initial loading, and keypad confirmation can all change both values in move mode. It will animate incorrect transitions and fails the explicit distinction requirement.

### 4. Animate all controlled prop changes in `VerticalQuantityWheel`

Rejected. It necessarily animates initial load, remote refresh/conflict reconciliation, undo/redo, and state restored after navigation. It also creates a feedback loop against the existing `pendingValueRef` protection and could reintroduce the iOS flicker fixed by `flushSync`.

---

## Recommended component and state contract

### `VerticalQuantityWheel.tsx`

1. Add a presentation-only optional prop, named consistently with the codebase, such as:

```ts
type PeerWheelAnimation = {
  sequence: number
  fromValue: number
  toValue: number
}

peerAnimation?: PeerWheelAnimation | null
```

2. Keep `value` as the authoritative controlled numeric value. `peerAnimation` is only permission to animate that one already-authoritative change; it must never calculate or emit an inventory target.
3. Track the last consumed sequence in a ref. On a new sequence:
   - ignore it if disabled, if `fromValue === toValue`, or if a user owns this wheel via an active pointer;
   - cancel any existing peer/snap rAF and timeout cleanly;
   - immediately rebase slot text to `toValue` with the same synchronous visual ordering used by `applyProjection`;
   - place the track one slot away from centre in the direction implied by `toValue - fromValue`, then rAF-transition it to zero using the existing `MOBILE_SNAP_DURATION_MS` and reduced-motion check;
   - clear only peer-motion-specific state on completion.
4. Use a destination-rebase, one-slot visual scroll for arbitrarily large changes. The five-slot reel cannot truthfully animate every intermediate integer for a large drag without a larger/virtualized track. One directional slot travel visibly communicates that the peer dial changed and lands on the exact final number without a fabricated long scroll.
5. Add a distinct peer-animation ref/timer or generalize the current snap cleanup carefully. All rAF/timeouts must be cleared on unmount alongside the existing cleanup at `256-262`.

### `MobileInventoryControls.tsx`

1. Extend wheel-origin callbacks just enough to distinguish a wheel-originated draft from other calls. Prefer an additive optional callback payload rather than moving target math:

```ts
type WheelInputKind = "pointer" | "wheel" | "keyboard"
// VerticalQuantityWheel calls onDraftChange(value, inputKind)
```

A keyboard arrow on an operated move wheel can be treated as a user-owned dial change and animate the peer; a tap only opens keypad and emits no draft. The explicit keypad confirmation remains parent-owned and emits no peer instruction.

2. Keep the current `handleLocationDraft` target calculation intact. When—and only when—`mode === "move"` and the callback came from a wheel user input:
   - calculate the existing `buildMoveTarget` first;
   - construct a new sequence and set an ephemeral peer instruction for the opposite location with its current draft `fromValue` and target’s opposite `toValue`;
   - invoke existing `onDraftChange(target)` unchanged.
3. Pass the instruction only to the non-originating `VerticalQuantityWheel`; pass `null` to the operated wheel. Clear/replace the instruction after consumption or leave its last value inert because the sequence gate guarantees one-shot behavior. Prefer a small local ref/state sequence scoped to controls—not parent inventory state.
4. On rendering auto/audit controls (`164-201`), supply no peer instruction. The signed auto wheel’s `reverseDisplayOrder` and baseline behavior must remain as is.

### `InventoryOperationPage.tsx` and `mobileInventory.ts`

- No inventory math or persisted type changes should be needed. Do not add a visual origin to `MobileInventoryTarget`, edit history, RPC arguments, session storage, or inventory logs.
- Keep `buildMoveTarget` the sole source of destination amounts and direction.
- Do not have `handleMobileDraft`, `handleMobileCommit`, `applyMobileResult`, `resetMobileDraft`, or `handleMobileHistoryNavigation` synthesize peer animation. Their ordinary prop updates must be immediate/reconciled, not animated.
- If a code-level test seam is useful, keep a small pure helper in `mobileInventory.ts` limited to visual direction normalization; otherwise avoid expanding that domain helper for UI state.

---

## Animation lifecycle and interruption rules

### Allowed trigger

Emit one peer animation only after all are true:

1. controls are currently in `move` mode;
2. the origin is a move wheel’s pointer drag, desktop wheel event, or keyboard arrow event;
3. `buildMoveTarget` returns a real opposite-location change; and
4. the update is the direct user draft transition, not a parent prop reconciliation.

The operated wheel continues its existing local drag/rebase/snap behavior. The non-operated wheel is the only wheel that performs peer animation.

### Explicit non-triggers

Do not animate peer motion for:

- initial product load and `item` synchronization (`InventoryOperationPage.tsx:532-578`);
- opening/cancelling keypad, or keypad Apply (`845-867`, `2011-2025`), even in move mode;
- server success/reconciliation (`607-623`) and queue/error/conflict recovery (`625-702`);
- mode changes and draft/baseline reset (`1628-1635`);
- history undo/redo (`810-843`) or full log restore (`1237-1286`);
- visibility/pagehide/app-state finalization (`978-1028`);
- auto/audit wheel changes, including signed auto baseline adjustments;
- equal/clamped values and disabled controls.

### Ordering and concurrency

1. Arm the peer instruction in the same React batch as the existing draft target update. Its `toValue` must be copied from that exact `buildMoveTarget` result; never recompute from a potentially stale prop.
2. In the peer wheel, consume the instruction once. Rebase React-owned slot text before setting a nonzero transform, preserving the `flushSync` ordering that prevents stale centre-slot flicker.
3. If a new peer instruction arrives before the previous animation ends, cancel the prior rAF/timer, consume the higher sequence, and animate from the current authoritative peer display toward the newest target. Never queue an animation backlog.
4. If the user pointer-downs the peer wheel while its peer animation is running, cancel peer motion immediately, reset its transform to zero, preserve the current final displayed value, and let pointer ownership take over. User input wins.
5. If the parent sends an ordinary external `value` while no peer instruction is current, use the existing reconciliation path with no animation. If it arrives while a peer animation is active, cancel visual peer motion and reconcile to authoritative value; external server/conflict truth wins.
6. Respect `prefers-reduced-motion`: synchronously show the destination, consume the sequence, and do not rAF/transition. Keep ARIA `aria-valuenow`/label correct at the final value.
7. Do not schedule or alter commits from peer animation. There remains one commit schedule owned by the operated wheel’s `settle`/keyboard path and existing parent queue.

---

## TDD and regression seams

The repository has no frontend test runner in `package.json`; preserve the existing focused script style unless the implementer explicitly agrees to add minimal tooling. Run only non-mutating checks during implementation planning/testing; `npm run build` writes `dist`, so it belongs only in an execution phase where generated output mutation is permitted.

### Add first, then implement (vertical TDD slices)

1. Extend `scripts/mobile-inventory.test.mts` with pure move invariants before UI changes:
   - Warehouse operation: `buildMoveTarget("창고", 7, 10, 3)` yields Warehouse 7 / Store 6, total 13, correct move direction.
   - Store operation: mirror it and assert same total.
   - clamp at 0 and total; verify an unchanged/clamped target has no peer-motion eligibility.
   - baseline auto and audit assertions already present must stay unchanged.
2. Add a small source-level/protocol assertion only if it is robust: move wheels receive a dedicated peer-animation prop and auto wheels do not. Do not make tests dependent on Tailwind classes, JSX whitespace, or private variable names.
3. If a minimal React event test harness is introduced with team approval, add lifecycle cases using fake rAF/timers:
   - a move pointer/keyboard input on Warehouse emits exactly one Store instruction and Store visually traverses then settles at its final value;
   - the source wheel gets no peer instruction;
   - a second rapid source change supersedes—not queues—the first peer animation;
   - pointer-down on the animated peer cancels animation and starts a normal drag;
   - reduced motion and unmount leave no rAF/timers.
4. Add negative cases as first-class regressions:
   - initial controlled `value` mount/update does not animate;
   - keypad move confirmation changes numbers without peer animation;
   - server success/error/conflict prop change does not animate;
   - mode switch and reset do not animate;
   - undo/redo/history state navigation does not animate.
5. For each test: write it red, run the focused command and observe the expected missing behavior, implement the minimal change, rerun it green, then run the existing focused script. Do not write all tests first and then a broad implementation.

### Suggested execution commands (do not run as part of this plan)

```bash
npx tsx scripts/mobile-inventory.test.mts
npm run lint
npm run build
```

If `tsx` is not installed or is not the project’s established invocation, first inspect the lockfile/package tooling and record the non-mutating command actually used; do not silently install a package just to run this script. `npm run build` and `npm run ios:prepare` mutate generated artifacts, so run them only with execution authorization.

---

## Manual Chrome and iOS validation

Use an isolated product whose name contains `테스트`, never an operating product. Record initial Warehouse/Store/total, final displayed drafts, final server values, save count/status, and whether any unintended animation occurred.

### Chrome desktop/mobile emulation

1. In move mode, drag Warehouse up/down by one step, multi-step, and to 0/total. Warehouse follows the finger; Store visibly scrolls once per recalculated peer target and ends at `total - Warehouse`.
2. Repeat operating Store. Confirm reverse transfer direction and invariant.
3. Test rapid drags: no queued/replayed peer animation, no stale destination, no flicker at a 32 px boundary.
4. Use mouse wheel and keyboard arrows if supported: source moves normally, peer follows visibly; tap/Enter opens keypad instead of animating.
5. Confirm move keypad Apply updates both numeric values but does not animate the opposite wheel.
6. Switch auto → move → audit and back; verify signed auto baseline labels/deltas, audit independent quantities, and no visual carry-over animation.
7. Exercise undo/redo and outer history restore with test data; verify immediate reconciliation/no peer animation and expected move log/session behavior.
8. Simulate delayed/offline/error/conflict where the current environment supports it. Verify peer visual motion is local only, server reconciliation never replays it, and queue/latest-target semantics remain unchanged.

### Physical iOS Capacitor/WKWebView

1. Validate a native bundle built from the implementation source (not an old installed/TestFlight bundle). Capacitor uses local `dist` per `README.md:172-189`; do not hand-edit generated assets.
2. Repeat every Chrome move interaction in portrait and landscape, light/dark, including 20+ step rapid drags and the 0/total boundary.
3. Specifically inspect the current flicker regression: each wheel’s own drag and its peer animation must not flash a stale number in the centre band. Capture a 60/120 fps screen recording if anything is visible.
4. Start a drag on the peer while it is animating; it must immediately become user-controlled, not fight the pointer or scroll the page.
5. Toggle iOS Reduce Motion; the destination should update without transition and remain accessible as a spinbutton.
6. Background/foreground or navigate away/back during a pending save. Verify finalization still writes only the intended target/session and returning/restored values do not animate.

---

## Risks and open questions

1. **What counts as “turns one dial”?** This plan treats pointer drag, mouse wheel, and keyboard arrow as wheel operation, and excludes keypad by explicit requirement. Confirm whether keyboard arrow should be excluded on touch-only deployments; it is safe to include because it is an actual dial interaction.
2. **Large numeric transfer visual semantics.** A five-slot reel cannot animate every integer for a 50-unit change. The recommended one-slot destination-rebase scroll is honest about direction and destination without a slow/fake traversal. If product wants every intermediate number, that is a separate virtualization/duration design decision.
3. **Current user changes are uncommitted.** The existing signed-auto and flicker work is part of the required preservation surface. Rebase the implementation on the actual worktree and do not assume HEAD alone reflects the relevant behavior.
4. **`flushSync` and iOS composition sensitivity.** Reusing the rebase order is essential. Replacing it with asynchronous state update plus an imperative transform can reintroduce the documented centre-band flicker.
5. **Visual props must not leak into persistence.** Persisting an origin/instruction in `MobileInventoryTarget` would pollute session/log/history semantics and potentially make undo/redo behavior depend on transient UI state.
6. **No current component harness.** Script-level testing can prove target math and protocol seams but not rendered interpolation. Add a React harness only if its setup cost is accepted; physical iOS remains required for WKWebView paint confidence.

---

## Bite-sized implementation tasks

### Task 1: Lock current semantics with red helper regressions

**Objective:** Make move total preservation and no-op/clamp cases explicit before adding presentation state.

**Files:**
- Modify: `scripts/mobile-inventory.test.mts:3-106`
- Verify only: `src/lib/mobileInventory.ts:96-124,150-203`

**Steps:**
1. Add a failing `buildMoveTarget` Warehouse case that asserts both destination values, total equality, target location, and move direction.
2. Run the focused script; confirm the assertion fails only because the new expectation/test seam is absent or incorrect.
3. Add the mirror Store and 0/total clamp assertions; no production helper change should be necessary if current semantics are correct.
4. Rerun the focused script and preserve all signed-auto assertions.

### Task 2: Define the explicit peer-animation protocol

**Objective:** Add a typed, one-shot visual instruction without changing inventory targets or server payloads.

**Files:**
- Modify: `src/components/VerticalQuantityWheel.tsx:9-35`
- Modify: `src/components/MobileInventoryControls.tsx:17-40,72-103,172-199`
- Do not modify: `src/lib/mobileInventory.ts:10-25`, mobile session RPC input.

**Steps:**
1. Write a focused source/protocol regression proving move-only peer instruction wiring and no auto/audit wiring.
2. Observe it fail.
3. Add the optional typed `peerAnimation` prop and optional input-kind callback extension, retaining backwards-compatible call sites until all are updated.
4. In controls, create a monotonic local sequence and opposite-location peer instruction only from a user wheel draft in move mode, using the already calculated `buildMoveTarget` result.
5. Run TypeScript/lint only when execution authorization permits; fix type errors without broad refactors.

### Task 3: Implement destination-rebase peer scrolling in the wheel

**Objective:** Make the non-operated wheel visibly settle to an explicitly authorized peer destination while retaining the flicker fix.

**Files:**
- Modify: `src/components/VerticalQuantityWheel.tsx:42-165,197-274`

**Steps:**
1. Write a red lifecycle test (or narrowly inspectable test seam if no harness is approved) for one new sequence: display destination slot text, animate from a one-row directional offset, then settle at zero.
2. Add dedicated peer-motion cancellation/cleanup, sequence consumption, reduced-motion bypass, and destination-rebase helper.
3. Use the existing `setLocalValue(..., true)`/`flushSync` ordering before transform writes; use existing offset/direction helpers.
4. Ensure peer motion does not call `onDraftChange` or `onCommit`.
5. Verify unmount cancels every new rAF/timer and existing pointer/tap/long-press behavior remains intact.

### Task 4: Add interruption and negative-path tests

**Objective:** Prove explicit instructions animate and ordinary controlled updates do not.

**Files:**
- Modify: `scripts/mobile-inventory.test.mts`
- Optionally create only with approval: a minimal component lifecycle test file/configuration.

**Steps:**
1. Red test: a second peer sequence supersedes the first without a backlog.
2. Green: cancel/rebase the old peer animation before consuming the new sequence.
3. Red test: pointer-down on peer interrupts peer animation; green it with user-input-wins cleanup.
4. Add no-animation cases for initial load, keypad Apply, server result/conflict, mode reset, undo/redo/history target, disabled state, and equal values.
5. Re-run the focused script after each vertical slice.

### Task 5: Integrate without changing page persistence behavior

**Objective:** Confirm the page needs no source annotations and retains all saves/history semantics.

**Files:**
- Verify only: `src/pages/InventoryOperationPage.tsx:532-578,607-759,810-867,978-1028,1610-1642,2011-2025`
- Verify only: `src/lib/mobileInventorySession.ts:1-63`

**Steps:**
1. Confirm the peer prop is generated and consumed entirely below the page boundary.
2. Confirm keypad, mode, history, and server paths supply only normal values—not peer instructions.
3. Confirm `MobileInventoryTarget`, apply input, edit point, and log/session contracts are byte-for-byte conceptually unchanged.
4. Run the existing focused script and then authorized non-mutating checks; record any pre-existing lint failures separately.

### Task 6: Validate browser and physical iOS behavior

**Objective:** Verify the artifact and behavior users actually see.

**Files/artifacts:**
- Generated during authorized execution only: `dist/`, then Capacitor iOS public assets through `npm run ios:prepare`.

**Steps:**
1. Complete the Chrome matrix above using a `테스트` product.
2. Run `npm run lint` and `npm run build`; report generated-output mutation explicitly.
3. Build/copy with the documented iOS process only after source checks pass.
4. Complete the physical iOS matrix, including flicker recording, reduced motion, interruption, and app lifecycle/session finalization.
5. Report final server pairs, total invariant, logs/history status, and any unverified device condition honestly.

---

## Completion criteria

The change is complete only when a direct user move-wheel interaction causes exactly the opposite wheel to visibly scroll to the existing `buildMoveTarget` destination; every listed non-trigger remains immediate/non-animated; `warehouse + store` always equals the confirmed move total; signed auto, audit, flicker ordering, save/session/log/conflict/finalization, and undo/redo/history behavior are unchanged; focused tests plus authorized lint/build pass; and physical iOS validation shows no stale-centre flash or input/scroll fight.
