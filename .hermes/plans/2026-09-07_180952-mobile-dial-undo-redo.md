# Mobile Dial Undo/Redo Repair Implementation Plan

> **확인 필요:** 아래 초안 중 Undo/Redo 비활성화 계획은 현재 로컬 코드·`test/mobile-inventory-explicit-save.contract.test.mjs`의 저장 전 히스토리 탐색 계약과 다르다. 원문은 당시 제안으로 보존하며 재구현 전 승인 요구를 확인한다.

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Make the inventory-operation dial mode’s Undo/Redo controls honest and usable when there is an unsaved quantity draft, without reintroducing automatic persistence.

**Architecture:** Dial edits remain local until the existing full-width **저장** action flushes and finalizes them. The page owns the edit-history and draft refs. The control component only receives two booleans which determine whether Undo/Redo are available. Do not add a new backend RPC, session type, or history structure.

**Tech Stack:** React 18, TypeScript, existing `node:test` source-contract tests.

---

## Confirmed cause

Relevant flow in `src/pages/InventoryOperationPage.tsx`:

1. A dial interaction calls `handleMobileDraft()` while dragging, then `handleMobileCommit()` when released.
2. `handleMobileCommit()` sets both `mobileDraftTargetRef.current` and `mobileQueuedTargetRef.current`; this is deliberately an **unsaved** local draft.
3. The existing `handleMobileHistoryNavigation()` begins with:

```ts
if (mobileSaveInFlightRef.current || mobileQueuedTargetRef.current || mobileDraftTargetRef.current) return;
```

4. Therefore, after any unsaved dial adjustment, Undo and Redo silently do nothing.
5. `MobileInventoryControls` does not receive a `hasUnsavedDraft` prop. Its buttons are still enabled as long as history bounds permit and `saveState` is not dragging/pending/error. The UI promises an action that the handler refuses.
6. After a saved history navigation, the handler intentionally calls `handleMobileCommit()`, which changes the displayed quantities but leaves persistence to the existing **저장** button. Keep this behavior: the product requirement is explicit save only.

## Chosen solution

**Disable both Undo and Redo while an unsaved quantity draft exists.**

This is the smallest safe repair because:

- It matches the existing handler’s guard instead of bypassing it.
- It preserves explicit save semantics; Undo/Redo do not secretly write inventory.
- It does not reinterpret Undo as “discard the current draft,” which could surprise a worker who expects undo history rather than cancel.
- It fixes the false affordance: unavailable actions look unavailable.

The status text already says “수량을 조정하는 중...” during dragging. After release it returns to idle; add no new complex state machine. The buttons are disabled based on the actual refs/state passed from the page.

**Deliberately not included:** a separate “초안 취소” control. Add it only if users explicitly ask to discard an unsaved dial adjustment without saving; it has different semantics from history undo.

---

## Task 1: Add a red-capable contract test for the availability rule

**Objective:** Ensure the page calculates that history navigation is unavailable whenever there is a local, unpersisted draft.

**Files:**
- Modify: `test/mobile-inventory-explicit-save.contract.test.mjs`
- Modify later: `src/pages/InventoryOperationPage.tsx`

**Step 1: Add the failing assertions**

Append a second test. It must inspect the `MobileInventoryControls` call site rather than only the child component. Require an explicit boolean that combines both refs:

```js
test("mobile history controls are unavailable while a dial draft is unsaved", () => {
  assert.match(
    inventoryOperationPage,
    /const mobileHistoryNavigationDisabled = Boolean\(mobileSaveInFlightRef\.current \|\| mobileQueuedTargetRef\.current \|\| mobileDraftTargetRef\.current\);/,
  );
  assert.match(
    inventoryOperationPage,
    /historyNavigationDisabled=\{mobileHistoryNavigationDisabled\}/,
  );
});
```

The exact identifier may differ only if it remains a single explicit page-level boolean derived from all three existing guards. Do not duplicate this condition in multiple JSX props.

**Step 2: Run it red**

Run:

```bash
node --test test/mobile-inventory-explicit-save.contract.test.mjs
```

Expected before implementation: the new assertion fails because no such availability prop exists.

---

## Task 2: Pass the actual navigation availability from the page

**Objective:** Make the parent expose the same condition that `handleMobileHistoryNavigation()` already enforces.

**Files:**
- Modify: `src/pages/InventoryOperationPage.tsx`

**Step 1: Add one derived boolean immediately before the main `return`**

Use the same existing guard terms and no new React state:

```ts
const mobileHistoryNavigationDisabled = Boolean(
  mobileSaveInFlightRef.current || mobileQueuedTargetRef.current || mobileDraftTargetRef.current
);
```

Why this belongs in the page: the refs are the source of truth and only the page owns them. Do not expose those refs to `MobileInventoryControls`.

**Step 2: Pass it to `MobileInventoryControls`**

At the only call site near the existing `canUndo` / `canRedo` props, add:

```tsx
historyNavigationDisabled={mobileHistoryNavigationDisabled}
```

Keep the existing history bounds unchanged:

```tsx
canUndo={mobileEditHistoryIndex > 0}
canRedo={mobileEditHistoryIndex >= 0 && mobileEditHistoryIndex < mobileEditHistory.length - 1}
```

**Step 3: Do not change these functions**

- `handleMobileHistoryNavigation()` — retain its guard as a second safety barrier against races/stale render state.
- `handleMobileCommit()` — retain queued drafts and explicit save behavior.
- `saveMobileDraft()` / `flushMobileTargets()` — do not auto-save on undo/redo.
- `recordMobileEditResult()` — its history-index update is the correct persistence-time operation.

---

## Task 3: Make the controls visually and functionally match the guard

**Objective:** Prevent an unavailable Undo/Redo control from being clickable.

**Files:**
- Modify: `src/components/MobileInventoryControls.tsx`

**Step 1: Extend `Props` once**

Near `canUndo` / `canRedo`, add:

```ts
historyNavigationDisabled: boolean;
```

Add it to the component parameter destructuring next to those props.

**Step 2: Include it in both button disable conditions**

Use the prop in both existing conditions:

```tsx
disabled={disabled || historyNavigationDisabled || !canUndo || saveState === "dragging" || saveState === "pending" || saveState === "error"}
```

```tsx
disabled={disabled || historyNavigationDisabled || !canRedo || saveState === "dragging" || saveState === "pending" || saveState === "error"}
```

Do not rename the icons or labels. Do not add a tooltip claiming the reason unless the user requests copy changes; native disabled styling provides the correct immediate feedback with the existing shared button classes.

**Step 3: Run the focused test green**

Run:

```bash
node --test test/mobile-inventory-explicit-save.contract.test.mjs
```

Expected: all tests pass.

---

## Task 4: Protect the actual handler guard and explicit-save contract

**Objective:** Ensure a future edit cannot make Undo/Redo write immediately or remove the race-safe handler guard.

**Files:**
- Modify: `test/mobile-inventory-explicit-save.contract.test.mjs`

**Step 1: Assert that the handler still has its safety guard**

Use the existing `functionBody()` helper:

```js
const historyNavigation = functionBody("handleMobileHistoryNavigation", "handleMobileKeypadConfirm");
assert.match(
  historyNavigation,
  /if \(mobileSaveInFlightRef\.current \|\| mobileQueuedTargetRef\.current \|\| mobileDraftTargetRef\.current\) return;/,
);
```

**Step 2: Assert history navigation remains draft-only**

```js
assert.match(historyNavigation, /handleMobileCommit\(target, targetIndex\);/);
assert.doesNotMatch(historyNavigation, /flushMobileTargets|saveMobileDraft|applyMobileInventoryChange/);
```

This is important: undo/redo can update the local dial display after a saved history selection, but only **저장** may mutate inventory.

**Step 3: Run all focused dial protocol checks**

Run:

```bash
node --test test/mobile-inventory-explicit-save.contract.test.mjs test/inventory-input-mode-default.contract.test.mjs
npx tsx scripts/mobile-inventory.test.mts
```

Expected: all pass.

---

## Task 5: Build, lint, and manual test on the isolated test store

**Objective:** Verify type correctness and the real tap sequence.

**Files:** no source changes expected.

**Step 1: Static verification**

Run:

```bash
git diff --check
npm run build
npm run lint
```

Expected: all exit 0. The Vite chunk-size warning is non-blocking if it is the existing warning; report it but do not address it in this change.

**Step 2: Manual mobile acceptance test**

Use only the dedicated **테스트 매장** and a product whose name includes `테스트`.

1. Enter **재고 작업** and enable **다이얼 방식**.
2. Confirm there are at least two saved history points (perform and save a small reversible change first if needed).
3. Confirm Undo is enabled at the newest saved point and Redo is disabled.
4. Move either dial but do **not** save. Confirm both Undo and Redo become disabled; tapping cannot silently appear to do nothing.
5. Tap **저장**. Confirm the new quantity persists.
6. Tap Undo. Confirm the dial shows the preceding saved quantity and the status denotes a modification point; confirm the real inventory is not yet changed on the server.
7. Tap **저장**. Confirm server inventory changes to that preceding point.
8. Tap Redo. Confirm the next point appears locally; tap **저장** and confirm it persists.
9. Verify the browser/device’s network is never mutated merely by pressing Undo or Redo; only the full-width **저장** action sends the inventory mutation.

**Step 3: Review only intended files**

Run:

```bash
git diff -- src/pages/InventoryOperationPage.tsx src/components/MobileInventoryControls.tsx test/mobile-inventory-explicit-save.contract.test.mjs
git status --short
```

Do not stage, reset, or modify unrelated existing changes, including `docs/stockly-design-guidelines.md`, `src/pages/HomePage.tsx`, and the pre-existing `.hermes/plans/` files.

---

## Acceptance criteria

- After a dial is changed but before **저장**, Undo and Redo are visibly disabled.
- Their event handlers retain the existing refs-based guard for race safety.
- After a saved point is selected with Undo/Redo, the screen updates locally, and a subsequent **저장** is still required to persist it.
- No automatic flush/finalize is added on dial release, Undo, Redo, navigation, lifecycle, or mode switch.
- Focused tests, build, lint, and the manual isolated-store flow pass.

## Risks and boundaries

- This intentionally does **not** make Undo cancel an unsaved dial draft. That is a distinct UI command and must be requested explicitly.
- A disabled button alone is not a concurrency control; retain the handler guard.
- Do not alter backend session, RPC, or inventory-log schema. This is an existing client-state/UI availability mismatch.
