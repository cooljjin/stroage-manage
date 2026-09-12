# Mobile Inventory Test Remediation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Restore `mobile-inventory.test.mts` as a trustworthy release check without changing the current viewport-aware user experience.

**Architecture:** Preserve the current runtime policy in `InventoryOperationPage.tsx`: a saved user preference wins; otherwise the default follows `isInventoryTouchViewport`. Test this policy through an exported pure helper, rather than requiring a historical `useState` source-code spelling.

**Tech Stack:** TypeScript, React, Node `assert`, `tsx`.

---

## Analogy and decision

The app is a store’s working rulebook and the test is its inspection checklist. The working rulebook now says, “use the saved preference first; otherwise offer the dial on touch devices and buttons on desktop.” The checklist is still rejecting the store because it expects the old sentence verbatim. Update the checklist; do not make the store operate by an obsolete rule just to satisfy it.

## Scope and guardrails

- Preserve `MOBILE_INPUT_MODE_STORAGE_KEY = "store-inventory-input-mode"` so existing preferences stay intact.
- Do not change inventory quantities, save behavior, UI layout, or routes.
- Do not use source-string assertions to prove input-mode policy.
- Keep current behavior: stored `dial` or `button` overrides the device default.

## Step 1 — Establish the expected behavior in tests (RED)

**Files:**
- Modify: `scripts/mobile-inventory.test.mts:~1-90, ~436-439`

Add executable assertions for the resolver behavior:

| Stored preference | Touch inventory viewport | Expected UI |
| --- | --- | --- |
| `dial` | either | dial |
| `button` | either | buttons |
| absent | true | dial |
| absent | false | buttons |
| invalid | true | dial |

Run:

`npx tsx scripts/mobile-inventory.test.mts`

Expected before implementation: failure because the new resolver is not exported yet. This proves the test can catch a missing policy implementation.

## Step 2 — Extract one testable policy function (GREEN)

**Files:**
- Modify: `src/pages/InventoryOperationPage.tsx:~60-75`

Add an exported pure function such as:

```ts
export function resolveMobileDialMode(storedMode: string | null, defaultDialMode: boolean): boolean {
  return storedMode === "dial" ? true : storedMode === "button" ? false : defaultDialMode;
}
```

Refactor `readStoredMobileDialMode(defaultDialMode)` so it only reads browser storage and forwards its value to the pure resolver. Retain its current error fallback to `defaultDialMode`.

Run:

`npx tsx scripts/mobile-inventory.test.mts`

Expected: resolver behavior assertions pass.

## Step 3 — Remove the obsolete inspection item

**Files:**
- Modify: `scripts/mobile-inventory.test.mts:436-439`

Remove the assertions that require this exact historical source text:

```ts
useState(() => readStoredMobileDialMode())
```

Keep the meaningful integration checks:

- the durable storage key remains unchanged;
- changing input mode persists `dial` or `button`;
- the page initializes with `readStoredMobileDialMode(isInventoryTouchViewport)`;
- the switch’s accessibility state and UI routing remain wired.

Run:

`npx tsx scripts/mobile-inventory.test.mts`

Expected: exit code 0. The checklist now checks the current rulebook, not the old wording.

## Step 4 — Validate that the warning light is trustworthy again

**Files:**
- No production files beyond the helper refactor expected.

Run, in order:

```bash
npx tsx scripts/mobile-inventory.test.mts
node --test test/*.mjs
npm run lint
npm run build
git diff --check
git status --short
```

Acceptance criteria:

- All listed commands exit successfully.
- Existing user changes remain untouched.
- No runtime policy changes occur beyond making the existing policy explicit and testable.
- A future change that breaks saved preference precedence or the mobile/desktop default fails the focused test.

## Risk handling

- **Risk: user preference reset.** Mitigation: retain the exact existing storage key.
- **Risk: test becomes brittle again.** Mitigation: execute the resolver with input/output assertions; avoid hook syntax matching.
- **Risk: accidental UI behavior change.** Mitigation: no changes to the state initializer’s viewport argument or switch persistence route; build and lint after the focused test passes.
