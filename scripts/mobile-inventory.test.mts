import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildAutoAdjustmentTarget,
  buildMoveTarget,
  MOBILE_DRAG_STEP_PX,
  getVerticalDragStepCount,
  getVerticalWheelStep,
  getVerticalWheelSlotValue,
  getVerticalWheelTrackOffset,
  parseSignedMobileQuantity
} from "../src/lib/mobileInventory.ts";

assert.deepEqual(
  buildAutoAdjustmentTarget("창고", 3, 5, 7),
  {
    mode: "auto",
    targetLocation: "창고",
    moveDirection: null,
    warehouseQty: 8,
    storeQty: 7
  },
  "positive warehouse adjustments add to the operation-start baseline"
);

assert.deepEqual(
  buildAutoAdjustmentTarget("매장", -10, 5, 7),
  {
    mode: "auto",
    targetLocation: "매장",
    moveDirection: null,
    warehouseQty: 5,
    storeQty: 0
  },
  "negative adjustments clamp the baseline-relative target at zero without changing the other location"
);

assert.equal(
  buildAutoAdjustmentTarget("창고", 3, 5, 7).warehouseQty,
  8,
  "the same net delta remains relative to the opening baseline after confirmed stock changes"
);

assert.equal(parseSignedMobileQuantity("+2.5"), 2.5, "signed keypad input accepts an explicit positive sign");
assert.equal(parseSignedMobileQuantity("-2,5"), -2.5, "signed keypad input accepts comma decimals");
assert.equal(parseSignedMobileQuantity("-"), null, "a sign alone is not a quantity");

assert.equal(
  getVerticalWheelStep(-1),
  1,
  "scrolling up maps to the same positive step as an upward drag"
);
assert.equal(
  getVerticalWheelStep(1),
  -1,
  "scrolling down maps to the same negative step as a downward drag"
);
assert.equal(getVerticalWheelStep(0), 0, "zero wheel movement does not change the dial");

assert.deepEqual(
  [-1, 0, 1].map((offset) => getVerticalWheelSlotValue(0, offset, -3, undefined, true)),
  [1, 0, -1],
  "reversed signed wheel display puts positive values above zero and negative values below"
);

assert.equal(
  getVerticalWheelTrackOffset(MOBILE_DRAG_STEP_PX, false),
  -MOBILE_DRAG_STEP_PX,
  "normal wheel tracking translates upward to bring the lower positive slot into the center"
);
assert.equal(
  getVerticalWheelTrackOffset(MOBILE_DRAG_STEP_PX, true),
  MOBILE_DRAG_STEP_PX,
  "reversed signed wheel tracking translates downward to bring the upper positive slot into the center"
);

const controlsSource = readFileSync(new URL("../src/components/MobileInventoryControls.tsx", import.meta.url), "utf8");
const autoRenderStart = controlsSource.indexOf("function renderAutoLocation");
const autoRenderEnd = controlsSource.indexOf("\n  return (", autoRenderStart);
const autoRender = controlsSource.slice(autoRenderStart, autoRenderEnd);
assert.match(
  controlsSource,
  /onRebaseAutoBaseline: \(\) => void;/,
  "mobile controls expose a narrow callback for rebasing auto adjustments without submitting an inventory target"
);
assert.match(
  autoRender,
  /const currentQty = isWarehouse \? warehouseQty : storeQty;/,
  "the signed auto upper stock box reads the latest warehouse/store draft target"
);
assert.match(
  autoRender,
  /<button[\s\S]*?onClick=\{onRebaseAutoBaseline\}[\s\S]*?disabled=\{disabled \|\| rebaseDisabled\}[\s\S]*?aria-label=\{`\$\{location\} 현재 재고 \$\{formatInventoryQuantity\(currentQty\)\}, 조정 기준으로 재설정`\}/,
  "each auto current-stock box is an accessible rebase button that shares the controls' pending/save disabled state"
);
assert.match(
  autoRender,
  /ariaLabel=\{`\$\{location\} 조정값 \$\{formatSignedQuantity\(delta\)\}, 현재 재고 \$\{formatInventoryQuantity\(currentQty\)\}`\}/,
  "the signed auto wheel aria label reports the latest draft current stock"
);
assert.match(
  autoRender,
  /<VerticalQuantityWheel[\s\S]*?\binvertDrag\b/,
  "the signed auto wheel inverts drag direction without changing absolute wheels"
);
assert.equal(
  getVerticalDragStepCount(100, 132, true) * -1,
  1,
  "an inverted downward drag produces the positive signed adjustment"
);
assert.equal(
  getVerticalDragStepCount(100, 68, true) * -1,
  -1,
  "an inverted upward drag produces the negative signed adjustment"
);

const warehouseMove = buildMoveTarget("창고", 7, 10, 3);
assert.deepEqual(
  warehouseMove,
  {
    mode: "move",
    targetLocation: "창고",
    moveDirection: "warehouse-to-store",
    warehouseQty: 7,
    storeQty: 6
  },
  "a warehouse move uses the confirmed total to derive the store peer"
);
assert.equal(warehouseMove.warehouseQty + warehouseMove.storeQty, 13, "warehouse moves preserve the confirmed total");

const storeMove = buildMoveTarget("매장", 7, 10, 3);
assert.deepEqual(
  storeMove,
  {
    mode: "move",
    targetLocation: "창고",
    moveDirection: "warehouse-to-store",
    warehouseQty: 6,
    storeQty: 7
  },
  "a store move mirrors the warehouse move without recalculating from drafts"
);
assert.equal(storeMove.warehouseQty + storeMove.storeQty, 13, "store moves preserve the confirmed total");

assert.deepEqual(
  buildMoveTarget("창고", -1, 10, 3),
  { mode: "move", targetLocation: "창고", moveDirection: "warehouse-to-store", warehouseQty: 0, storeQty: 13 },
  "move targets clamp at zero while preserving the total"
);
assert.deepEqual(
  buildMoveTarget("매장", 99, 10, 3),
  { mode: "move", targetLocation: "창고", moveDirection: "warehouse-to-store", warehouseQty: 0, storeQty: 13 },
  "move targets clamp at the confirmed total while preserving the total"
);

const wheelSource = readFileSync(new URL("../src/components/VerticalQuantityWheel.tsx", import.meta.url), "utf8");
assert.match(
  wheelSource,
  /export type PeerWheelAnimation = \{\s*sequence: number;\s*fromValue: number;\s*toValue: number;\s*\};/,
  "the wheel exposes a typed, sequence-gated visual-only peer instruction"
);
assert.match(
  wheelSource,
  /onDraftChange: \(value: number, inputKind\?: WheelInputKind\) => void;/,
  "wheel drafts identify direct pointer, mouse-wheel, and keyboard input without changing commits"
);
assert.match(
  controlsSource,
  /onDraftChange=\{\(value, inputKind\) => handleLocationDraft\("창고", value, inputKind\)\}/,
  "the move warehouse wheel forwards its direct input source to the move target boundary"
);
assert.match(
  controlsSource,
  /onDraftChange=\{\(value, inputKind\) => handleLocationDraft\("매장", value, inputKind\)\}/,
  "the move store wheel forwards its direct input source to the move target boundary"
);
assert.match(
  controlsSource,
  /peerAnimation=\{warehousePeerAnimation\}/,
  "the warehouse wheel can receive only an explicit peer visual instruction"
);
assert.match(
  controlsSource,
  /peerAnimation=\{storePeerAnimation\}/,
  "the store wheel can receive only an explicit peer visual instruction"
);
assert.doesNotMatch(autoRender, /peerAnimation=/, "signed auto wheels never receive peer animation instructions");
assert.match(
  autoRender,
  /<VerticalQuantityWheel[\s\S]*?authoritativeRebaseSequence=\{autoRebaseSequence\}/,
  "each signed auto wheel receives the authoritative rebase sequence"
);
const nonAutoRenderStart = controlsSource.indexOf("        ) : (", controlsSource.indexOf('mode === "auto" ?'));
const nonAutoRenderEnd = controlsSource.indexOf("        )}", nonAutoRenderStart);
const nonAutoRender = controlsSource.slice(nonAutoRenderStart, nonAutoRenderEnd);
assert.doesNotMatch(nonAutoRender, /authoritativeRebaseSequence=/, "move and audit wheels never receive the auto rebase sequence");
assert.match(
  autoRender,
  /disabled=\{disabled \|\| rebaseDisabled\}/,
  "auto current-stock rebase buttons stay disabled through dragging and pending saves without disabling the wheels"
);

assert.match(
  wheelSource,
  /authoritativeRebaseSequence\?: number;/,
  "the wheel exposes an optional authoritative rebase sequence"
);
assert.match(
  wheelSource,
  /const AUTOMATIC_SPRING_STIFFNESS = 0\.1[2-8];/,
  "automatic wheel motion uses the requested light spring stiffness range"
);
assert.match(
  wheelSource,
  /const AUTOMATIC_SPRING_DAMPING = 0\.7[2-9];/,
  "automatic wheel motion uses firm damping without a rubber-band bounce"
);
assert.match(
  wheelSource,
  /const AUTOMATIC_SPRING_MAX_OVERSHOOT_ROWS = 0\.2;/,
  "automatic wheel adds a modestly stronger but still bounded rebound"
);
assert.match(
  wheelSource,
  /type AutomaticSpringMotion = \{[\s\S]*?targetValue: number;[\s\S]*?position: number;[\s\S]*?velocity: number;/,
  "automatic motion keeps position and velocity separate from the controlled value"
);
const rebaseEffectStart = wheelSource.indexOf("if (authoritativeRebaseSequence === undefined");
const rebaseEffectEnd = wheelSource.indexOf("\n\n  useEffect(() => {\n    if (!peerAnimation", rebaseEffectStart);
const rebaseEffect = wheelSource.slice(rebaseEffectStart, rebaseEffectEnd);
assert.match(
  rebaseEffect,
  /const targetValue = value;[\s\S]*?startAutomaticMotion\(targetValue, authoritativeRebaseSequence\);/,
  "a rebase keeps the controlled target logical while delegating only visual movement"
);
assert.match(
  wheelSource,
  /function frame\(now: number\) \{[\s\S]*?activeMotion\.velocity = \([\s\S]*?activeMotion\.targetValue - activeMotion\.position[\s\S]*?Math\.pow\(AUTOMATIC_SPRING_DAMPING, frameScale\);[\s\S]*?automaticFrameRef\.current = window\.requestAnimationFrame\(frame\);/,
  "one requestAnimationFrame loop integrates spring position and velocity"
);
assert.match(
  wheelSource,
  /function updateAutomaticVisual\(motion: AutomaticSpringMotion\)[\s\S]*?setTrackOffset\(getVerticalWheelTrackOffset\(\(motion\.position - baseValue\) \* MOBILE_DRAG_STEP_PX, reverseDisplayOrder\)\);/,
  "fractional spring progress updates only the composited direction-aware transform"
);
assert.match(
  wheelSource,
  /const completedRows = Math\.floor\(Math\.max\(0, travelledRows \+ 0\.0000001\)\);[\s\S]*?setDisplayValueLocal\(baseValue, true\);/,
  "crossed rows synchronously rebase the five labels without rendering every frame"
);
assert.doesNotMatch(
  wheelSource.slice(wheelSource.indexOf("function startAutomaticMotion"), wheelSource.indexOf("\n  function projection")),
  /onDraftChange|onCommit/,
  "automatic visual motion never creates a draft or commit"
);
assert.match(
  wheelSource,
  /automaticTimerRef\.current = window\.setTimeout\(\(\) => finishAutomaticMotion\(motion\.id\), AUTOMATIC_SPRING_MAX_DURATION_MS\);/,
  "a bounded fallback completes a stalled automatic animation"
);
assert.doesNotMatch(rebaseEffect, /onDraftChange|onCommit/, "the authoritative rebase never creates a draft or commit");
assert.ok(rebaseEffectStart < wheelSource.indexOf("if (pointerRef.current) return;"), "the authoritative rebase effect runs before normal value reconciliation");

const pageSource = readFileSync(new URL("../src/pages/InventoryOperationPage.tsx", import.meta.url), "utf8");
const rebaseHandlerStart = pageSource.indexOf("function handleMobileAutoBaselineRebase");
const rebaseHandlerEnd = pageSource.indexOf("\n  }", rebaseHandlerStart) + "\n  }".length;
const rebaseHandler = pageSource.slice(rebaseHandlerStart, rebaseHandlerEnd);
assert.match(
  rebaseHandler,
  /resetMobileAutoBaseline\(\{ warehouseQty: mobileWarehouseQty, storeQty: mobileStoreQty \}\);/,
  "rebasing takes both auto baselines from the currently rendered warehouse and store draft quantities"
);
assert.doesNotMatch(
  rebaseHandler,
  /mobileDraftTargetRef/,
  "rebasing does not replace the displayed draft state with a queued draft target"
);
assert.match(
  rebaseHandler,
  /mobileAutoRebaseSequenceRef\.current \+= 1;[\s\S]*?setMobileAutoRebaseSequence\(mobileAutoRebaseSequenceRef\.current\);/,
  "each rendered auto baseline rebase advances the monotonic authoritative sequence"
);
assert.match(
  pageSource,
  /rebaseDisabled=\{mobileInventoryCheckSaving \|\| mobileSaveState === "dragging" \|\| mobileSaveState === "pending"\}/,
  "only rebase controls are disabled during the dragging-to-pending gap"
);
assert.match(
  pageSource,
  /autoRebaseSequence=\{mobileAutoRebaseSequence\}/,
  "the page forwards the monotonic sequence to mobile controls"
);
assert.match(
  pageSource,
  /<MobileInventoryControls[\s\S]*?onRebaseAutoBaseline=\{handleMobileAutoBaselineRebase\}/,
  "the inventory operation page wires the auto rebase callback into mobile controls"
);
assert.match(
  pageSource,
  /onClick=\{\(\) => navigate\(\{ name: "inventory" \}, \{ resetToRoot: true \}\)\}[\s\S]*?aria-label="재고현황으로 이동"/,
  "the inventory operation list button returns to the inventory overview root"
);
assert.match(pageSource, /const \[memoOpen, setMemoOpen\] = useState\(true\);/, "the memo panel is open by default");
assert.match(pageSource, /onClick=\{\(\) => setMemoOpen\(\(open\) => !open\)\}/, "the memo header has a toggle button");
assert.match(pageSource, /aria-expanded=\{memoOpen\}/, "the memo toggle exposes its expanded state");
assert.match(pageSource, /aria-controls="inventory-memo-content"/, "the memo toggle points to the collapsible content");
assert.match(pageSource, /id="inventory-memo-content"[\s\S]*?hidden=\{!memoOpen\}/, "memo content is hidden when collapsed");

const scanSource = readFileSync(new URL("../src/pages/ScanPage.tsx", import.meta.url), "utf8");
const nativeScannerSource = readFileSync(new URL("../src/lib/nativeBarcodeScanner.ts", import.meta.url), "utf8");
assert.match(nativeScannerSource, /startScan: \(options\?: \{ formats\?: string\[\] \}\) => Promise<void>;/, "native scanner exposes the WebView-backed startScan API");
assert.match(nativeScannerSource, /stopScan: \(\) => Promise<void>;/, "native scanner can stop the custom camera session");
assert.match(nativeScannerSource, /addListener:[\s\S]*eventName: "barcodesScanned"/, "native scanner receives barcode events while the custom UI is visible");
assert.match(scanSource, /const \[nativeScanActive, setNativeScanActive\] = useState\(false\);/, "the scan page tracks the native camera overlay state");
assert.match(scanSource, /const autoStartKey = nativeScannerAvailable \? \(scanLaunchId \?\? "native-initial"\) : "web-initial";/, "native scanning keeps its automatic launch path");
assert.match(scanSource, /document\.body\.classList\.add\("barcode-scanner-active"\)/, "native scanning makes the WebView camera background transparent");
assert.match(scanSource, /className="barcode-scanner-modal"/, "native scanning renders a WebView overlay above the camera");
assert.match(scanSource, /aria-label="네이티브 실사모드"/, "native scanning exposes the audit checkbox on the overlay");

console.log("mobile inventory and native scan protocol tests passed");
