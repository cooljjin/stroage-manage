# Real Dial Auto-Rebase Animation Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** When an auto-mode user taps either current-stock box, animate each affected signed adjustment wheel from its currently displayed delta through every intermediate signed integer to `0`, using real moving slot content—not a destination-text swap with a CSS slide—while preserving all current inventory behavior.

**Architecture:** Keep `InventoryOperationPage.tsx` as the authoritative owner of auto baseline, draft quantity, confirmed snapshot, save queue, session, log/conflict, and history state. Keep `value={delta}` controlled on `VerticalQuantityWheel`, but replace the authoritative-rebase visual implementation with a dedicated, visual-only rebase reel that owns a temporary sequence of signed slot values from the old delta to zero. The reel must never call `onDraftChange` or `onCommit`; once complete (or cancelled) it returns to the ordinary five-slot controlled reel centered at authoritative `0`.

**Tech Stack:** React 18 + TypeScript, Vite, DOM `requestAnimationFrame`/CSS transforms (or WAAPI only if it fits the existing cleanup model), `flushSync`, Capacitor iOS WKWebView.

**Speed requirement:** Touch must start the reel motion on the next animation frame with no deliberate waiting, and the dial must return to `0` quickly rather than spending 180ms on every logical row. Use one continuous timeline with an initial per-row duration target of roughly 35–50ms (device validation decides the final value), so ordinary adjustments such as `±1` through `±5` finish promptly while still showing real intermediate rows. There must be no chained stop/start pauses; large deltas remain interruptible and their duration policy must be decided explicitly rather than silently skipping the physical travel.

**Scope / working-tree safety:** Plan only. The inspected branch is `codex/inventory-wheel-smooth`. It has user-owned modifications in `src/components/MobileInventoryControls.tsx`, `src/components/QuantityKeypadSheet.tsx`, `src/components/VerticalQuantityWheel.tsx`, `src/lib/mobileInventory.ts`, `src/pages/InventoryOperationPage.tsx`, plus untracked `.hermes/` and `scripts/`. Layer implementation on that working tree; do not revert unrelated changes, alter persistence contracts, commit, or push. The only intended implementation files are called out below.

---

## Current evidence: why the rebase is a visual slide, not a true dial motion

### Authoritative rebase data path

1. Tapping either current-stock button in `src/components/MobileInventoryControls.tsx:152-162` calls the one parent callback, `onRebaseAutoBaseline`.
2. `src/pages/InventoryOperationPage.tsx:428-432` replaces **both** auto baselines with the currently rendered warehouse/store draft quantities and increments `mobileAutoRebaseSequence`.
3. The parent continues passing the same draft quantities plus the new baseline into `MobileInventoryControls` (`InventoryOperationPage.tsx:1620-1653`). Its auto wheels calculate `delta = currentQty - baselineQty` at `MobileInventoryControls.tsx:142-179`; therefore each rebased delta becomes `0`.
4. Each signed auto wheel receives that `0` as `value` and the new `authoritativeRebaseSequence` (`MobileInventoryControls.tsx:163-179`). The page does not issue a draft or save target, which is correct and must remain true.

### Exact current DOM/animation behavior

- `VerticalQuantityWheel` always renders only five static slots, `SLOT_OFFSETS = [-2, -1, 0, 1, 2]`, at `src/components/VerticalQuantityWheel.tsx:6,404-416`.
- On an authoritative sequence, its effect captures `previousDisplayValue`, clears pending/user/peer motion, then immediately calls `setDisplayValueLocal(value, true)` at lines 293-310. `value` is already `0`, so React synchronously replaces the five slot labels with `[-2, -1, 0, +1, +2]` in signed/reversed order.
- Only after destination labels are flushed does it derive one pixel displacement, `(value - previousDisplayValue) * MOBILE_DRAG_STEP_PX`, set a single `translate3d`, and transition that transform back to zero (`VerticalQuantityWheel.tsx:319-334`). `MOBILE_DRAG_STEP_PX` is 32 at `src/lib/mobileInventory.ts:3`.
- For example, rebasing `+5` produces the destination labels around zero first, puts that destination track at `-160px` after `getVerticalWheelTrackOffset(..., true)`, then moves the same five zero-centered labels to `0px` over 180ms. It neither renders `+4`, `+3`, `+2`, `+1` as consecutively centered slots nor has row content corresponding to the 160px travel. Larger distances just move the same destination labels farther.
- The existing source-shape regression in `scripts/mobile-inventory.test.mts:208-226` explicitly describes and locks this behavior as “synchronously swaps in controlled slot text” followed by one transform. That assertion must be replaced because it encodes the behavior being changed.

**Conclusion:** the current rebase has direction-aware CSS motion, but not dial semantics. It swaps to the final reel before motion starts and translates a destination reel once. It cannot visibly pass intermediate signed values, and the five-slot content cannot truthfully cover an arbitrary rebase distance.

---

## Constraints that must not regress

- Signed auto semantics remain baseline-relative: `buildAutoAdjustmentTarget` in `src/lib/mobileInventory.ts:150-163` uses the operation-start/rebased baseline, accepts negative values, clamps final quantities at zero, and does not alter the other location.
- Signed display stays positive-above / negative-below via `reverseDisplayOrder` and the centralized `getVerticalWheelSlotValue` / `getVerticalWheelTrackOffset` helpers (`mobileInventory.ts:50-63`). Do not duplicate or invert their math in a new rebase path.
- Normal pointer, desktop mouse-wheel, keyboard-arrow, tap-to-keypad, long press, delayed 300ms commit, and drag snap behavior in `VerticalQuantityWheel.tsx:141-291` remain unchanged.
- Existing peer move animation remains an explicit visual-only `peerAnimation` sequence (`VerticalQuantityWheel.tsx:340-379`, `MobileInventoryControls.tsx:84-126`) and must not be conflated with auto rebase. Move/audit wheels still receive no `authoritativeRebaseSequence`.
- The controlled-reset fix remains: an authoritative rebase clears `pendingValueRef`, pointer state, drag frame, existing rebase/peer motion, transition state, and stale transform before accepting the new controlled value. This prevents a pre-rebase pending draft from blocking reconciliation.
- The iOS center-flicker protection remains: React-owned labels must be synchronously flushed with `setDisplayValueLocal(..., true)` / `flushSync` before an imperative transform can expose them in the center band. Never set a transform first and let an async render catch up later.
- `InventoryOperationPage.tsx` persistence boundaries remain unchanged: `handleMobileDraft` (751-758), `handleMobileCommit` (760-767), queued authoritative apply/conflict recovery (615-717), keypad confirmation (853-875), mode reset (1638-1645), history (818-851), session finalization, logs, and full history restore must not gain animation metadata or altered target math.

---

## Ranked design options

### 1. Recommended: temporary virtualized authoritative-rebase reel, driven by an explicit visual timeline

Add rebase-only presentation state inside `VerticalQuantityWheel`, for example:

```ts
type AuthoritativeRebaseMotion = {
  sequence: number
  fromValue: number
  toValue: 0
  direction: -1 | 1
  stepCount: number
  startedAt: number
}
```

Render a rebase track instead of the normal five-slot track only while this state is active. The track logically contains every integer in the inclusive path `fromValue, fromValue - sign(fromValue), ..., 0`; with `reverseDisplayOrder`, slot ordering and physical transform direction continue to come from the existing helpers. Animate a continuous row-height transform while maintaining a small, sliding DOM window around the current row index. Rebase its window before the center crosses an edge, using `flushSync` before resetting its modulo transform, so the visual result is continuous and no stale label flashes.

Why recommended:

- It is the only option below that scales without putting millions of DOM rows into WebKit while preserving the requirement that the logical sequence contains every signed intermediate value.
- It is isolated from business state: `value` remains final/controlled `0`; the temporary reel is a paint projection, cannot emit draft/commit callbacks, and disappears after cleanup.
- It gives exact lifecycle control for interruptions, reduced motion, transition end, and iOS paint ordering.
- It can share the existing `MOBILE_DRAG_STEP_PX`, direction helpers, `trackRef`, rAF/timer cleanup, and five-slot reel after it finishes.

### 2. Good first implementation only if rebases are guaranteed small: temporary extended DOM track

On rebase, construct every path row in an array and render it in a dedicated temporary track, initially centered on `fromValue`; transition it by `stepCount * MOBILE_DRAG_STEP_PX` until `0` centers; then remove it and restore the normal reel.

Advantages: easiest to reason about, naturally produces actual intermediate rows, one composited transform, and few timing boundaries.

Why second: a signed adjustment allows values up to roughly 99,999,999.9999 in the parser and can have large integer deltas. A fully materialized DOM list is unsafe for memory/layout and large `translate3d` distances can stress WKWebView. It is acceptable only with a deliberately documented small practical maximum—not one that silently skips values.

### 3. Hybrid: extended DOM track for a safe threshold, virtualized reel beyond it

Use option 2 for, for example, <= 80 logical rows, and option 1 above that. Both branches must use the same no-callback, sequence, interruption, reduced-motion, and cleanup contract. This may reduce implementation complexity in the common case, but it doubles visual paths and test surface.

Recommendation: do not start here unless profiling shows virtualization is materially worse for common 1–20 step rebases. A single virtual-window implementation is preferable for correctness consistency.

### 4. Repeated `setDisplayValueLocal` / one-row snaps for each value

Rejected. Chaining 180ms CSS snaps would be slow and visibly stop/start between rows; shortening them becomes jerky, creates many React/transition races, and is vulnerable to the exact iOS center flicker this work must preserve.

### 5. Keep destination text and animate one long transform

Rejected. This is the current implementation and fails the requested dial semantics.

### 6. Mutate the authoritative controlled `value` through intermediate values

Rejected. It would emit draft/commit behavior or require suppressing it through the page’s save/session/history paths; it risks persistence updates, pending-value reconciliation regressions, and conflicts with the authoritative baseline reset.

---

## Recommended state, DOM, and animation lifecycle

### Inputs and derived values

On a newly observed `authoritativeRebaseSequence` in `VerticalQuantityWheel`:

1. Capture `fromValue = displayValueRef.current` **before** changing local labels. This is the currently adjusted signed delta, not a recomputation from the new baseline.
2. Read controlled `value` as `toValue`; current auto rebase requires `toValue === 0`. Defensively support a different authoritative target only if existing callers may later use it, but do not change today’s API/semantics.
3. Derive `rawDelta = toValue - fromValue`, `direction = Math.sign(rawDelta)`, and `stepCount = Math.abs(rawDelta)`.
4. Define a discrete-row requirement: the current wheel controls and slot helper operate in one quantity unit per 32px row. If fractional signed drafts are actually supported by drag/keypad, document and resolve the mismatch before coding: either animate decimal increments using a defined precision or animate only an integer-valued dial path. Do not silently round a user’s `0.5` delta to claim every intermediate value was shown.

### Prepare and cancel prior ownership

For every new authoritative sequence, in this exact order:

1. Mark it consumed with `lastAuthoritativeRebaseSequenceRef` so React rerenders cannot replay it.
2. Clear `pendingValueRef`, pointer capture/state, long-press timer, pending drag rAF, settle timer, current peer motion, previous rebase rAF/timer, transition, and transform. Use a single idempotent `cancelAuthoritativeRebaseMotion({ resetTrack: true })` helper; it must invalidate the prior sequence/token before cancellation callbacks can finish it.
3. Do not call `onDraftChange` or `onCommit` during any preparation/cancellation branch.
4. If `fromValue === toValue`, no track exists, or `prefers-reduced-motion: reduce` matches, synchronously set normal `displayValue` to `toValue` with `setDisplayValueLocal(toValue, true)`, reset transform, finish styles, and return. This is the only non-motion rebase path.

### Start the real reel without iOS flicker

1. Build rebase presentation state with the path anchored at `fromValue`, including a virtual window that contains at least two rows above/below the center plus one guard row on each side (minimum seven rows; use a named constant rather than relying on normal `SLOT_OFFSETS`).
2. `flushSync` the rebase state so the DOM has a center row whose text is `formatValue(fromValue)` before writing the transform. This is the rebase equivalent of the existing `setDisplayValueLocal(..., true)` ordering and is mandatory for iOS.
3. Set the temporary track at the source center using `transition: none`, `will-change: transform`, and a source-to-destination transform sign calculated via `getVerticalWheelTrackOffset`. In reversed signed display, a decreasing delta must move the reel in the physical direction that places the next signed row correctly; use the helper, never an ad hoc negation.
4. Trigger animation on the next rAF after forcing layout (`void track.offsetHeight`). Use a named per-row duration (`REBASE_MS_PER_STEP`, proposed initial value 45–60ms after device validation) so the physical travel remains `stepCount * 32px` and every logical row crosses the center in order. Use the same easing family as the wheel snap only if it does not bunch row crossings at the beginning/end; linear or a near-linear ease is preferable when the requirement is visibly sequential values.
5. During animation, drive the virtual index from elapsed progress in rAF. Whenever the displayed window is about to exhaust its guard rows, synchronously replace the window with the next contiguous values and compensate the track’s base offset in the same frame. The center value must monotonically follow `fromValue → ... → 0`; no destination labels may appear before their turn.
6. Set `aria-valuenow` and the aria label to the current visual rebase center (not premature zero) while the temporary reel is active. At completion it becomes controlled `toValue`. Confirm this with an accessibility decision if announcements would be excessively noisy; visual requirements do not require `aria-live` announcements for every row.

### Large deltas: explicit policy, not a hidden shortcut

- Do not cap the logical path or jump directly to zero; that would contradict the requirement.
- Use virtualization so DOM memory is bounded regardless of `stepCount`.
- Duration is intentionally proportional to step count for readable sequential values. Initial proposal: 50ms per row with no normal hard cap; a 20-step rebase is about one second, and a 100-step rebase is about five seconds. The user may interrupt it at any time. This is more honest than a capped animation that skips/blur-jumps unseen rows.
- Before implementation, product must decide whether very large deltas should take their full proportional time, use an explicit user-visible “fast spin” mode that still crosses all logical rows but cannot guarantee human readability, or impose a product-level maximum adjustment. Do not silently apply a duration cap.
- Profile at 60Hz and 120Hz. At a rate faster than a display refresh interval, every integer cannot be visibly painted; therefore “visibly pass through every intermediate number” has a physical upper bound. Preserve the semantic row sequence regardless, and record the practical approved `REBASE_MS_PER_STEP` after iOS testing.

### Finish and return to controlled normal wheel

1. Only the current sequence/token may finish. Ignore rAF, CSS `transitionend`, or timeout events belonging to cancelled sequences.
2. At the final row, synchronously render ordinary normal-wheel slots for authoritative `toValue` through `setDisplayValueLocal(toValue, true)` (and clear rebase presentation state in the same flush).
3. Reset transform to zero, remove transition/`will-change`, clear rebase refs/timers, and leave `pendingValueRef` null.
4. Use `transitionend` filtered to `event.target === track` and `propertyName === "transform"` as the primary completion signal. Retain a duration+buffer timeout fallback for WKWebView/background cases; both call an idempotent `completeAuthoritativeRebase(sequence)`.
5. The existing ordinary controlled-value reconciliation effect must see a display value equal to controlled `value` after completion and do nothing.

### Interruption/precedence table

| Event | Required outcome |
|---|---|
| New auto-box tap/newer authoritative sequence | Cancel and clean the old rebase atomically; take the then-current visual center as the new `fromValue`; start the newest path to authoritative `0`; never queue animations. |
| Pointer down/drag on that wheel | User wins: cancel rebase, flush the current center into normal slots, zero the track, then initialize pointer `startValue` from that center. Existing pointer/mouse/keyboard behavior continues. |
| Mouse wheel or keyboard arrow during rebase | Treat as direct user ownership: cancel rebase first, then perform the normal input operation from the current visual center. Ensure it produces only its normal draft/commit path. |
| Tap/Enter to keypad during rebase | Cancel/reconcile to the current visual center before opening keypad; keypad must initialize from the value users saw. No rebase callback is emitted. |
| Peer move animation | Auto wheel and move wheels are disjoint today. Nevertheless, central cancellation must invalidate peer and rebase timers safely so a future caller cannot have two tracks fighting. |
| Ordinary external controlled `value` update (server success, conflict reload, mode reset, history, initial item sync) | External authority wins: cancel visual rebase, render that external value synchronously, and do not animate unless it carries a new explicit authoritative rebase sequence. |
| `disabled` becomes true/unmount | Cancel rAF/timers/listeners, reset styles, do not emit callbacks, and do not leave a composited transform. |
| Reduced Motion | Consume sequence and immediately show controlled `0`; no temporary track/rAF/transition. |

---

## File-by-file implementation plan

### Task 1: Replace the false-positive rebase regression with red behavioral/protocol assertions

**Objective:** Stop testing the rejected destination-swap implementation and establish the real-dial contract before production code changes.

**Files:**
- Modify: `scripts/mobile-inventory.test.mts:156-264`
- Verify only: `src/lib/mobileInventory.ts:3,50-63,150-163`

**Steps:**
1. Preserve existing pure assertions for signed slot ordering, transform direction, baseline adjustment, move total invariant, peer protocol, and rebase callback wiring.
2. Replace the current assertion at `scripts/mobile-inventory.test.mts:216-224` that expects `setDisplayValueLocal(value, true)` before a delta-sized single track offset.
3. Add a failing source/protocol assertion for a named authoritative rebase motion state/path that captures `fromValue`, uses a distinct temporary rebase reel/window, and has no `onDraftChange`/`onCommit` inside its lifecycle.
4. Add source assertions that completion is sequence/token-gated and restores normal controlled slots at `toValue`, and that `reverseDisplayOrder` flows through the same transform helper.
5. Keep source-shape checks narrow enough to tolerate formatting/refactors; prefer named helper/type contracts over a large regex tied to JSX whitespace.
6. Run the established focused script in execution phase: `npx tsx scripts/mobile-inventory.test.mts`. It should fail because the real-reel protocol does not exist yet.

### Task 2: Extract and test pure rebase-path math only if needed

**Objective:** Make direction, inclusive rows, and bounded window math deterministic without leaking animation state into inventory targets.

**Files:**
- Prefer create: `src/lib/verticalWheelRebase.ts`
- Modify: `scripts/mobile-inventory.test.mts`
- Alternative only if the team rejects a new file: add narrowly UI-specific exports to `src/lib/mobileInventory.ts` without changing `MobileInventoryTarget`.

**Steps:**
1. Write red unit assertions for `+3 → 0` producing `+3, +2, +1, 0`, `-3 → 0` producing `-3, -2, -1, 0`, and a window shift preserving contiguous order with no duplicate/skip.
2. Add sign/direction assertions for `reverseDisplayOrder=false/true`; prove the physical track offset is obtained through `getVerticalWheelTrackOffset`.
3. Define explicit fractional behavior in tests before implementation. If wheel drag is integer-only but keypad accepts decimals, include `+2.5 → 0` behavior in the test/decision rather than leaving it accidental.
4. Implement the smallest pure path/window helpers to turn tests green. Do not modify `buildAutoAdjustmentTarget`, move target math, session types, or persistence input.

### Task 3: Add a single-owner authoritative-rebase lifecycle to the wheel

**Objective:** Introduce cancel/complete/state cleanup primitives before replacing the visual rendering.

**Files:**
- Modify: `src/components/VerticalQuantityWheel.tsx:52-114,293-402`
- Test: `scripts/mobile-inventory.test.mts`

**Steps:**
1. Add red assertions for named refs/state: authoritative sequence/token, rebase rAF, completion fallback timer, and visual center value; do not reuse peer refs ambiguously.
2. Implement `cancelAuthoritativeRebaseMotion`, `completeAuthoritativeRebase`, and an idempotent transition cleanup helper. Each must clear its own rAF/timer and correctly reset `transition`, `willChange`, and transform.
3. Preserve the existing ordering in a new-rebase start: clear `pendingValueRef`, pointer/long press/drag state, peer motion, and normal snap state before accepting controlled state.
4. Update pointer-down, keyboard, and wheel handlers to cancel a running authoritative reel before using `displayValueRef.current` as their source. Preserve their current direct-input callback kinds and commit cadence.
5. Update unmount cleanup to cancel every new rAF/timer and remove any transition-end listener if one is added.
6. Do not change `MobileInventoryControls.tsx`, page persistence code, or `mobileInventory.ts` in this task.

### Task 4: Render the temporary real-dial reel and complete one positive rebase TDD slice

**Objective:** Make `+N → 0` visibly center `+N-1`, `+N-2`, …, `0` while moving smoothly by 32px rows.

**Files:**
- Modify: `src/components/VerticalQuantityWheel.tsx:404-416` and authoritative rebase effect at `293-338`
- Modify if Task 2 created it: `src/lib/verticalWheelRebase.ts`
- Test: `scripts/mobile-inventory.test.mts`; optionally a minimal component harness only with approval

**Steps:**
1. Write a red lifecycle test/harness that starts at positive signed `+3`, advances controlled animation time, and asserts the center labels occur in order `+3`, `+2`, `+1`, `0`, ending at transform zero and no callbacks. If no React harness exists, add testable pure frame/window output and maintain a narrowly named source assertion; record that source tests alone cannot prove paint interpolation.
2. Add rebase-only render state and switch the DOM from normal `SLOT_OFFSETS` to the temporary track only while that state is active.
3. `flushSync` source row rendering before first transform write. Start with `transition: none`, force layout, then schedule the animation in rAF.
4. Use the existing row height constant `MOBILE_DRAG_STEP_PX` (32) for all track shifts. Do not hard-code Tailwind `h-8` separately without a comment/test tying it to the constant.
5. Implement virtual window shifting before edge exhaustion, flush updated row text, compensate base transform in the same rAF, and continue with no visual jump.
6. Complete on filtered `transitionend` plus fallback timeout, flush ordinary `value=0` slots, and clean all visual state.
7. Run the focused script green before proceeding.

### Task 5: Complete signed/reversed, fractional, reduced-motion, and large-delta behavior

**Objective:** Apply the same real-reel semantics to negative signed deltas without compromising accessibility or performance.

**Files:**
- Modify: `src/components/VerticalQuantityWheel.tsx`
- Modify: `scripts/mobile-inventory.test.mts`
- Modify if needed: `src/lib/verticalWheelRebase.ts`

**Steps:**
1. Red test `-3 → 0`: assert center order `-3, -2, -1, 0`, correct reversed positive-above/negative-below layout, and transform direction through `getVerticalWheelTrackOffset(..., true)`.
2. Green it without adding special-case direction math outside the existing helpers.
3. Red test reduced-motion: it consumes the sequence, has final `0`, creates no rAF/transition/fallback timer, and emits no callback; green it.
4. Red test a large `stepCount` through the pure window helper: bounded DOM window size, contiguous logical row ranges, no skipped/duplicated rows, and no materialized full path array. Green it.
5. Implement the approved fractional policy and test it explicitly. If unresolved, block production release rather than silently truncating signed user values.
6. Confirm `aria-valuenow` follows visual center during the reel or document/approve alternative accessibility semantics; final zero must be authoritative at completion.

### Task 6: Protect interruption and non-trigger paths

**Objective:** Prove real rebase motion is narrowly authorized and cannot interfere with saved inventory state or other visual motions.

**Files:**
- Modify: `src/components/VerticalQuantityWheel.tsx`
- Modify: `scripts/mobile-inventory.test.mts`
- Verify only: `src/components/MobileInventoryControls.tsx`, `src/pages/InventoryOperationPage.tsx`, `src/lib/mobileInventory.ts`

**Steps:**
1. Red/green: a second higher rebase sequence supersedes the first; its source is the current visual center, it does not queue, and only its completion can clear state.
2. Red/green: pointer-down, mouse wheel, keyboard arrow, and keypad tap interrupt correctly; normal behaviors then start from the visible value and own only their usual draft/commit routes.
3. Red/green: external controlled update with no new rebase sequence cancels the reel and reconciles immediately; test initial item sync, successful save, conflict reload/reset, mode change, undo/redo, and history restore as non-animated pathways.
4. Red/green: peer move animation and authoritative rebase cannot leave competing transforms/timers. Preserve the existing peer sequence behavior and ensure auto wheels still never receive `peerAnimation`.
5. Assert neither the rebase component state nor any rebase metadata crosses `MobileInventoryControls` into `MobileInventoryTarget`, `handleMobileDraft`, `handleMobileCommit`, `applyMobileResult`, RPC apply input, session, edit history, or logs.

### Task 7: Verify parent wiring remains deliberately minimal

**Objective:** Ensure only the existing rebase sequence authorizes a real reel and all business semantics remain untouched.

**Files:**
- Verify only: `src/components/MobileInventoryControls.tsx:142-179`
- Verify only: `src/pages/InventoryOperationPage.tsx:416-432,540-602,615-767,818-875,1618-1653,2022-2036`
- Verify only: `src/lib/mobileInventory.ts:96-203`

**Steps:**
1. Confirm both auto current-stock buttons still invoke the same `onRebaseAutoBaseline` and remain disabled only under the existing `rebaseDisabled` conditions.
2. Confirm `handleMobileAutoBaselineRebase` still changes only baseline and monotonic sequence, never draft target or save queue.
3. Confirm auto’s `invertDrag`, `reverseDisplayOrder`, signed ARIA label, and baseline-relative keypad path remain unchanged.
4. Confirm move peer animation remains a separate explicit sequence from direct pointer/wheel/keyboard drafts; keep no peer instruction on auto wheels.
5. Confirm page-level save/session/log/conflict/history/restore behavior is unchanged in code and no visual state is persisted.

### Task 8: Run authorized checks and manual validation

**Objective:** Verify source behavior, browser rendering, and physical iOS WKWebView paint behavior.

**Files/artifacts:**
- Generated only with execution authorization: `dist/` and iOS copied assets from `npm run ios:prepare`

**Steps:**
1. Run `npx tsx scripts/mobile-inventory.test.mts` after each TDD slice.
2. When mutation is authorized, run `npm run lint` and `npm run build`. Note that build writes `dist/`; do not run it in a plan-only task.
3. Use only a product whose name contains `테스트` for manual save/restore validation; record starting and final quantities, save state, and logs.
4. Run the Chrome and physical-iOS matrices below. Report failures and unverified device conditions separately.

---

## TDD/regression seams

The current focused test is a Node assertion script, not an interactive component test. It can strongly protect helper math and explicit source contracts, but it cannot prove that browser/WKWebView paints every intermediate row. Use it for pure path/window state and add a minimal React fake-rAF harness only if existing tooling supports it without a broad test-framework migration.

Required vertical slices:

1. Positive path helper: write failing `+3 → 0` ordered rows/window test; implement only that helper.
2. Positive wheel lifecycle: write failing test for visual source state → transition → completion, no callbacks; implement only that flow.
3. Negative/reverse path: write failing `-3 → 0` test; implement with centralized helpers.
4. Reduced motion and cleanup: write red no-rAF/no-timer/unmount test; implement the bypass/cleanup.
5. New-sequence and user interruption: red supersede/input-ownership tests; implement cancellation.
6. External value/non-trigger regression: red immediate-reconciliation tests; preserve no-animation behavior.
7. Large-delta virtual-window tests: ensure bounded nodes and no skipped logical rows.

Required regression assertions:

- `pendingValueRef` is cleared before authoritative render and cannot suppress zero reconciliation.
- Rebase path contains no `onDraftChange` or `onCommit` call.
- Existing peer move instructions retain their current sequence-gated visual-only behavior.
- Both signed auto wheels receive authoritative rebase sequence; move/audit wheels do not.
- Rebase controls remain disabled through `dragging`/`pending` without disabling normal wheels.
- `buildAutoAdjustmentTarget`, `buildMoveTarget`, audit target, move total invariant, save/session/history/log type contracts do not change.
- Exact track row height is `MOBILE_DRAG_STEP_PX = 32`, matching rendered `h-8`/`leading-8` rows.

---

## Manual validation matrix

### Chrome desktop and mobile emulation

| Scenario | Expected result |
|---|---|
| Auto, warehouse delta `+1`, then tap either current-stock box | Wheel begins at `+1`, visibly rolls through `0`; current stock unchanged; no save/request/status change. |
| Auto, warehouse `+5` | Center advances `+5,+4,+3,+2,+1,0` in order; no destination `0` slots appear early; ends centered at zero. |
| Auto, store `-5` | Center advances `-5,-4,-3,-2,-1,0`; positive values remain above and negative below throughout. |
| Both locations have nonzero deltas, tap either box | Both wheels independently roll from their own current signed deltas to zero, with no stale labels/cross-talk. |
| Positive/negative fractional signed delta | Confirm the approved fractional policy: no rounded/skipped claim and correct final zero. |
| Large delta | DOM remains bounded; no skipped/duplicated center sequence; duration follows approved policy; user can interrupt. |
| Pointer drag during reel | Rebase stops immediately; drag begins from visible center; existing delayed commit/save behavior is unchanged. |
| Mouse wheel / ArrowUp / ArrowDown during reel | Rebase yields to direct input; correct source value, draft and commit behavior; no duplicate callback. |
| Tap/Enter during reel | Rebase stops and keypad opens at visible quantity; keypad confirmation retains existing behavior. |
| Reduced Motion | Immediate final zero, no transition/flicker/callback. |
| Auto → move → audit → auto | No rebase animation leaks across modes; auto signed baseline works; move peer animation remains its own behavior. |
| Move direct drag/wheel/key | Peer still animates only the opposite move wheel; auto rebase mechanism is absent. |
| Save success, error/conflict reload, history undo/redo/restore, initial load | Controlled values reconcile immediately; none becomes an authoritative rebase animation. |

### Physical iOS Capacitor / WKWebView

1. Validate a newly built/copied native bundle, not a stale installed/TestFlight bundle. Per `README.md:172-189`, Capacitor uses local `dist`; do not hand-edit generated assets.
2. Repeat every Chrome scenario on a physical device in portrait and landscape; test both 60Hz and ProMotion hardware if available.
3. Record `+1`, `+5`, `-5`, and a rapid rebase at 60/120fps. Inspect the center band frame-by-frame for the known failure: a stale old/destination number flashing before its correct row. Any flash blocks release.
4. Test an interrupted reel by dragging the same wheel and by switching/applying external state while animation is active. Confirm no scroll fight, stuck transform, or stale timer callback.
5. Enable iOS Reduce Motion; confirm instant final state and spinbutton accessibility remains accurate.
6. Background/foreground and leave/re-enter during pending save/rebase. Confirm only intended inventory target/session finalizes; restored values do not replay a visual rebase without a new sequence.
7. Test large-delta performance: no blank mask region, dropped labels, runaway DOM growth, memory warning, or non-responsive touch.

---

## Open questions and tradeoffs to resolve before implementation

1. **Fractional adjustment path:** `parseSignedMobileQuantity` supports up to four decimals, while the current reel row concept is one value/32px. What exact intermediate increments must a `+2.5 → 0` rebase show? Choose a product precision (e.g., 0.1 / 0.01 / entered decimal precision) and derive duration/row count accordingly; do not silently truncate.
2. **Large-delta duration:** Literal readable visibility of every integer requires duration proportional to steps; a fixed duration cannot make 10,000 rows individually visible at normal refresh rates. The recommended default is no hidden cap plus interruptibility. Product must approve the per-row time and whether exceptional large values need an explicit fast-spin UX or input constraint.
3. **One transform vs rAF virtualization:** A small extended DOM track is simpler and naturally smooth, but virtualized re-centering protects WKWebView memory/layout for arbitrary values. Start with the virtual approach unless profiling demonstrates a safe practical range with strict product limits.
4. **Accessibility announcement frequency:** Visual `aria-valuenow` can track the center while `aria-live` stays off to avoid dozens of announcements. Confirm this is acceptable to accessibility review; final zero must always be accurate.
5. **Dual-wheel synchronization:** One rebase sequence currently reaches both signed auto wheels. They may have different step counts/durations and finish separately. This is truthful to each dial; confirm whether the product instead expects a shared finish time (which would make one dial’s rows too fast/slow).
6. **Existing worktree is not HEAD-only:** Current peer animation, signed auto, and iOS flicker code are uncommitted user work. Re-inspect the actual worktree immediately before execution and preserve it rather than applying an old plan against pristine HEAD.

---

## Completion criteria

The implementation is complete only when tapping an auto current-stock box causes each nonzero signed adjustment dial to start at its currently adjusted visible value, move smoothly by 32px logical rows, visibly center every approved intermediate signed value in order, and end at `0`; no code merely swaps destination text then slides it. Positive-above/negative-below display, reduced motion, direct input behavior, pending controlled reconciliation, iOS flicker protection, peer move animation, baseline delta, save/session/log/conflict/history/restore semantics must remain intact. Focused regressions, authorized lint/build, Chrome validation, and physical iOS validation must pass or be reported as unverified.