# Mobile Inventory Input-Mode Test Contract Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Replace the brittle source-text assertion that fails on the current viewport-aware dial default with behavior-oriented coverage for saved and default mobile inventory input modes.

**Architecture:** Keep `InventoryOperationPage.tsx`’s existing policy: a stored user preference wins; otherwise the default follows `isInventoryTouchViewport`. Move the policy into a small exported pure helper so the test can execute it rather than inspecting a particular `useState` spelling.

**Tech Stack:** TypeScript, React, Node `assert`, `tsx`.

---

## Current facts

- Failing command: `npx tsx scripts/mobile-inventory.test.mts`
- Failure: `scripts/mobile-inventory.test.mts:436` requires the obsolete exact text `readStoredMobileDialMode()`.
- Current implementation: `src/pages/InventoryOperationPage.tsx:362` calls `readStoredMobileDialMode(isInventoryTouchViewport)`.
- Current intended policy:
  - persisted `dial` → dial UI;
  - persisted `button` → button UI;
  - no persisted preference → dial on an inventory touch viewport, buttons otherwise.

## Non-goals

- Do not change the user’s stored `store-inventory-input-mode` preference key.
- Do not change dial/button UI layout or inventory save behavior.
- Do not modify production logic merely to preserve an obsolete regular-expression assertion.

## Task 1: Extract the policy into a testable pure helper

**Objective:** Make input-mode resolution executable outside React and browser storage.

**Files:**
- Modify: `src/pages/InventoryOperationPage.tsx:~60-75`
- Test: `scripts/mobile-inventory.test.mts`

**Step 1 — Write failing tests**

Add direct assertions for a helper such as:

```ts
assert.equal(resolveMobileDialMode("dial", false), true);
assert.equal(resolveMobileDialMode("button", true), false);
assert.equal(resolveMobileDialMode(null, true), true);
assert.equal(resolveMobileDialMode(null, false), false);
assert.equal(resolveMobileDialMode("invalid", true), true);
```

The helper should receive a nullable stored mode and the viewport default. The test must import and execute it; do not inspect its source text.

**Step 2 — Verify RED**

Run:

`npx tsx scripts/mobile-inventory.test.mts`

Expected: failure because `resolveMobileDialMode` is not exported/available yet.

**Step 3 — Implement the minimum helper**

Near `MOBILE_INPUT_MODE_STORAGE_KEY`, add an exported pure helper:

```ts
export function resolveMobileDialMode(storedMode: string | null, defaultDialMode: boolean): boolean {
  return storedMode === "dial" ? true : storedMode === "button" ? false : defaultDialMode;
}
```

Refactor `readStoredMobileDialMode(defaultDialMode)` to read `localStorage` and delegate to this helper. Preserve the existing `try/catch` fallback to `defaultDialMode`.

**Step 4 — Verify GREEN**

Run:

`npx tsx scripts/mobile-inventory.test.mts`

Expected: all assertions pass.

## Task 2: Replace stale source-shape assertions

**Objective:** Remove tests that dictate an old `useState` call form while keeping essential integration checks.

**Files:**
- Modify: `scripts/mobile-inventory.test.mts:436-439`

**Step 1 — Remove only obsolete assertions**

Delete assertions requiring either of these literal source forms:

```ts
readStoredMobileDialMode()
useState(() => readStoredMobileDialMode())
```

**Step 2 — Keep implementation-independent integration coverage**

Retain assertions that the durable key is used and switching persists a user selection. If source wiring must be checked, assert the semantic call shape accepts the viewport default, not exact whitespace or an empty argument list:

```ts
/readStoredMobileDialMode\(isInventoryTouchViewport\)/
```

The pure-helper tests in Task 1 are the authority for default behavior.

**Step 3 — Verify GREEN**

Run:

`npx tsx scripts/mobile-inventory.test.mts`

Expected: exit code 0.

## Task 3: Regression validation

**Objective:** Verify the repaired test signal and the project’s regular quality gates.

**Files:**
- No additional files expected.

**Step 1 — Run the focused contract test**

`npx tsx scripts/mobile-inventory.test.mts`

Expected: exit code 0.

**Step 2 — Run existing test suite**

```bash
node --test test/*.mjs
```

Expected: all tests pass.

**Step 3 — Run static and build validation**

```bash
npm run lint
npm run build
git diff --check
git status --short
```

Expected: lint/build/diff checks pass. Review `git status` without touching pre-existing user changes.

## Risks and acceptance criteria

**Risk:** A source-regex test can still become brittle if it asserts React hook syntax. Limit source checks to necessary wiring and test policy through execution.

**Risk:** Changing the storage key would reset existing user choice. Keep `store-inventory-input-mode` unchanged.

**Done when:**
- The focused script exits successfully.
- A saved dial/button setting always overrides viewport defaults.
- An absent or invalid setting defaults to dial only for touch inventory viewports.
- Lint, regular tests, build, and whitespace validation pass.
