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
  /className="rounded-xl min-h-\[68px\][^"]*sm:min-h-\[72px\]/,
  "auto current-stock cards use the same fixed height as move compact current-stock dials"
);
assert.match(
  autoRender,
  /<button[\s\S]*?onClick=\{onRebaseAutoBaseline\}[\s\S]*?disabled=\{disabled \|\| rebaseDisabled\}[\s\S]*?aria-label=\{`\$\{location\} 현재 재고 \$\{formatInventoryQuantity\(currentQty\)\}, 조정 기준으로 재설정`\}/,
  "each auto current-stock box is an accessible rebase button that shares the controls' pending/save disabled state"
);
assert.match(
  autoRender,
  /showDragHint=\{false\}/,
  "auto adjustment wheels hide the drag instruction text and center their labels"
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

assert.match(
  controlsSource,
  /function getMoveDelta\(location: Location, quantity: number\): number[\s\S]*?function getMoveAbsoluteValue\(location: Location, delta: number\): number/,
  "move mode converts between confirmed absolute quantities and signed dial deltas"
);
assert.match(controlsSource, /function renderMoveLocation\(location: Location\)/, "move mode renders location cards with adjustment wheels");
const moveRenderStart = controlsSource.indexOf("function renderMoveLocation");
const moveRenderEnd = controlsSource.indexOf("\n  return (", moveRenderStart);
const moveRender = controlsSource.slice(moveRenderStart, moveRenderEnd);
assert.match(moveRender, /label=\{`\$\{location\} 현재 재고`\}/, "move mode current stock cards contain absolute quantity dials");
assert.match(moveRender, /value=\{currentQty\}[\s\S]*?formatValue=\{formatInventoryQuantity\}/, "move current stock dials show and edit absolute quantities");
assert.match(moveRender, /label=\{`\$\{location\} 현재 재고`\}[\s\S]*?compact/, "move current stock dials use the compact layout variant");
assert.match(moveRender, /onDraftChange=\{\(value, inputKind\) => handleLocationDraft\(location, value, inputKind, "absolute"\)\}/, "current stock dial edits use absolute move quantities");
assert.match(moveRender, /showDragHint=\{false\}/, "move adjustment wheels hide the drag instruction text");
assert.match(moveRender, /label=\{`\$\{location\} 조정`\}/, "move mode labels its signed adjustment wheels");
assert.match(moveRender, /invertDrag[\s\S]*?reverseDisplayOrder/, "move signed wheels use the same direction and display order as auto");
assert.match(moveRender, /min=\{-[^}]+\}[\s\S]*?max=\{[^}]+\}/, "move signed wheels use baseline-aware transfer bounds");
assert.match(
  controlsSource,
  /fromValue = getMoveDelta\(peerLocation, [^;]+\);[\s\S]*?toValue = getMoveDelta\(peerLocation, [^;]+\);/,
  "move peer animation uses signed deltas on both sides"
);

assert.deepEqual(
  buildMoveTarget("창고", 10 + 1, 10, 3),
  { mode: "move", targetLocation: "매장", moveDirection: "store-to-warehouse", warehouseQty: 11, storeQty: 2 },
  "a positive warehouse signed delta becomes one unit from store to warehouse"
);
assert.deepEqual(
  buildMoveTarget("매장", 3 + 1, 10, 3),
  { mode: "move", targetLocation: "창고", moveDirection: "warehouse-to-store", warehouseQty: 9, storeQty: 4 },
  "a positive store signed delta becomes one unit from warehouse to store"
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

assert.doesNotMatch(controlsSource, /총재고 .* 안에서 자유롭게 조정|창고에서 매장으로 이동|매장에서 창고로 이동/, "move mode hides the direction helper text");

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
  /peerAnimation=\{peerAnimationForLocation\}/,
  "the move adjustment wheel receives the signed peer visual instruction"
);
assert.match(
  moveRender,
  /const peerAnimationForLocation = isWarehouse \? warehousePeerAnimation : storePeerAnimation;/,
  "the opposite move wheel is selected by location"
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
  /compact \? "min-h-\[68px\] px-3 py-2 sm:min-h-\[72px\]"/,
  "compact current-stock dials match the auto current-stock card height"
);
assert.match(
  wheelSource,
  /\{compact \? <ChevronUp[\s\S]*\{compact \? <ChevronDown/,
  "compact move current-stock dials show arrows above and below the number"
);
assert.ok(
  wheelSource.includes('className={`flex w-full items-center gap-1 ${compact || !showDragHint ? "justify-center" : "justify-between"}`}'),
  "compact move current-stock dial headers center their text without changing full wheel headers"
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
  /<button className="touch-button shrink-0 border-0 bg-transparent[^"]*" type="button" onClick=\{onBack\} aria-label="뒤로가기"/,
  "the inventory operation back button keeps only the arrow without an icon box"
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
assert.match(nativeScannerSource, /scan: \(options: \{ formats: string\[\]; autoZoom: boolean \}\) => Promise<NativeBarcodeScanResponse>;/, "native scanner uses the ready-to-use native scan API");
assert.match(nativeScannerSource, /fastIosBarcodeScanner/, "iOS uses the native fast scanner before fallback");
assert.doesNotMatch(nativeScannerSource, /startScan|barcodesScanned/, "the React WebView scanner is not the native default path");
assert.match(scanSource, /const \[showFallbackUi, setShowFallbackUi\] = useState\(!nativeScannerAvailable\);/, "the React barcode screen starts hidden on native platforms");
assert.doesNotMatch(scanSource, /nativeScanActive|barcode-scanner-modal|barcode-scanner-active/, "native scanning does not render the React scanner screen as its camera UI");
assert.match(scanSource, /if \(nativeScannerAvailable\) \{[\s\S]*?const result = await scanNativeBarcode\(\);/, "native scanning is attempted before the web screen");
assert.match(scanSource, /type ScanMode = "audit" \| "auto";/, "scan mode is represented as a mutually exclusive audit or receipt mode");
assert.match(scanSource, /role="switch"[\s\S]*aria-label="실사모드"/, "fallback scan screen exposes the audit mode switch");
assert.match(scanSource, /role="switch"[\s\S]*aria-label="입고모드"/, "fallback scan screen exposes the receipt mode switch");
assert.match(scanSource, /const launchDelay = nativeScannerAvailable \? 0 : 250;/, "native scanning starts without the web-screen delay");
assert.match(scanSource, /if \(nativeScannerAvailable\) \{[\s\S]*?setShowFallbackUi\(false\);[\s\S]*?const result = await scanNativeBarcode\(\);/, "every native launch hides a previously visible fallback screen before opening the scanner");
assert.match(scanSource, /native-scanner-pending/, "native launch hides the surrounding React chrome while the native scanner is opening");
assert.match(scanSource, /className=\{showFallbackUi \? undefined : "native-scanner-fallback-hidden"\}/, "the React scanner DOM stays mounted but is not visible until web fallback is selected");
assert.match(scanSource, /setShowFallbackUi\(true\);[\s\S]*?new Html5Qrcode\(SCANNER_ID/, "the web scanner is created after the fallback DOM is kept mounted");
assert.doesNotMatch(scanSource, /native-scanner-launch-screen/, "the native path does not render a separate React launch screen");

const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
assert.match(appSource, /permittedRoute\.name === "product-edit" \? \([\s\S]*?border-0 bg-transparent[\s\S]*?<ArrowLeft size=\{18\} \/>/, "the product edit back action uses an icon-only button without a box");

const operationHeaderStart = pageSource.indexOf("inventory-operation-header");
const productSummaryStart = pageSource.indexOf("inventory-product-summary", operationHeaderStart);
const productSummaryEnd = pageSource.indexOf("\n\n      {item.receipt_check_only", productSummaryStart);
const productSummarySource = pageSource.slice(productSummaryStart, productSummaryEnd);
assert.match(pageSource, /<h1 className="min-w-0 flex-1 truncate text-\[23px\] font-extrabold tracking-normal sm:text-\[27px\]">\{item\.name\}<\/h1>/, "the inventory operation header shows the item name in a larger bold style");
assert.doesNotMatch(productSummarySource, /<p[^>]*>\{item\.name\}<\/p>/, "the item name is not duplicated below the header");

console.log("mobile inventory and native scan protocol tests passed");
