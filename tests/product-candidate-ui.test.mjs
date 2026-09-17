import assert from "node:assert/strict";
import test from "node:test";
import { URL } from "node:url";
import React from "react";
import { createServer } from "vite";

const server = await createServer({ root: new URL("..", import.meta.url).pathname, server: { middlewareMode: true }, define: {
  "import.meta.env.VITE_SUPABASE_URL": JSON.stringify("https://example.supabase.co"),
  "import.meta.env.VITE_SUPABASE_ANON_KEY": JSON.stringify("test-key")
} });
const { ProductEditPage } = await server.ssrLoadModule("/src/pages/ProductEditPage.tsx");
const Services = await server.ssrLoadModule("/src/services/index.ts");
test.after(() => server.close());

const candidate = { canonical_name: "후보 상품", source: "external", brand: "브랜드" };
const product = { id: "existing", store_id: "store-1", name: "기존 상품", barcode: "999", category: "기타", supplier_name: null, storage_type: null, default_location: "창고", unit_name: "개", unit_weight_enabled: false, unit_weight: null, unit_weight_unit: null, processing_required: false, processed_unit_weight: null, processed_unit_weight_unit: null, product_url: null, order_completed: false, confirmed_order_pending: false, urgent_order_requested: false, urgent_order_quantity: null, fresh_order_selected: false, fresh_order_selected_at: null, receipt_check_only: false, status_enabled: false, stock_status: null, minimum_stock: 0, is_important: false, is_active: true, created_at: new Date(0).toISOString() };

function queryResult(data = []) {
  const query = { order: () => query, eq: () => query, single: () => Promise.resolve({ data: data[0] ?? null, error: null }) };
  query.then = (resolve, reject) => Promise.resolve({ data, error: null }).then(resolve, reject);
  return query;
}

function setupHarness({ barcode = " 123 ", barcodeFormat, productId, lookupResult, lookupImpl, edgeResult = { data: { status: "miss" }, error: null }, deferred = false, deferredDataLoad = false } = {}) {
  let resolveLookup;
  let resolveDataLoad;
  const dataLoad = deferredDataLoad ? new Promise((resolve) => { resolveDataLoad = resolve; }) : null;
  const lookup = async (...args) => deferred ? new Promise((resolve) => { resolveLookup = resolve; }) : lookupImpl ? lookupImpl(...args) : lookupResult;
  const harness = { stateIndex: 0, stateValues: [], refIndex: 0, refValues: [], effectIndex: 0, effectInitialized: [], cleanups: [], lookupCalls: 0, lookupArgs: [], mounted: true, postUnmountSetters: 0 };
  const dispatcher = {
    useState(initial) {
      const index = harness.stateIndex++;
      if (!(index in harness.stateValues)) harness.stateValues[index] = typeof initial === "function" ? initial() : initial;
      return [harness.stateValues[index], (value) => { if (!harness.mounted) harness.postUnmountSetters += 1; harness.stateValues[index] = typeof value === "function" ? value(harness.stateValues[index]) : value; }];
    },
    useRef(initial) {
      const index = harness.refIndex++;
      if (!(index in harness.refValues)) harness.refValues[index] = { current: initial };
      return harness.refValues[index];
    },
    useCallback(fn) { return fn; },
    useEffect(effect) {
      const index = harness.effectIndex++;
      if (!harness.effectInitialized[index]) { harness.effectInitialized[index] = true; const cleanup = effect(); if (cleanup) harness.cleanups[index] = cleanup; }
    }
  };
  React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentDispatcher.current = dispatcher;
  Services.ProductLookupService.lookup = async (...args) => { harness.lookupCalls += 1; harness.lookupArgs.push(args); return lookup(...args); };
  Services.EdgeFunctionService.invoke = async () => edgeResult;
  Services.DatabaseService.select = () => {
    if (!dataLoad) return queryResult(productId ? [product] : []);
    const query = { order: () => query, eq: () => query, single: () => dataLoad.then((data) => ({ data: data[0] ?? null, error: null })) };
    query.then = (resolve, reject) => dataLoad.then((data) => ({ data, error: null })).then(resolve, reject);
    return query;
  };
  Services.DatabaseService.rpc = async () => ({ data: [], error: null });
  const navigations = [];
  harness.render = () => { harness.stateIndex = 0; harness.refIndex = 0; harness.effectIndex = 0; harness.tree = ProductEditPage({ productId, barcode, barcodeFormat, navigate: (route) => navigations.push(route), currentStoreId: "store-1" }); return harness.tree; };
  harness.render();
  harness.unmount = () => { harness.mounted = false; harness.cleanups.forEach((cleanup) => cleanup?.()); };
  return { harness, navigations, resolveLookup: (value) => resolveLookup?.(value), resolveDataLoad: (value = []) => resolveDataLoad?.(value) };
}

function walk(node, visit, found = []) {
  if (node === null || node === undefined) return found;
  if (typeof node === "string") { visit(node, found); return found; }
  if (typeof node !== "object") return found;
  visit(node, found);
  if (typeof node.type === "function") {
    walk(node.type(node.props), visit, found);
    return found;
  }
  const children = Array.isArray(node.props?.children) ? node.props.children : [node.props?.children];
  children.forEach((child) => walk(child, visit, found));
  return found;
}
function text(node) { if (typeof node === "string") return node; return walk(node, (item, found) => { if (typeof item === "string") found.push(item); }).join(""); }
function buttons(tree) { return walk(tree, (node, found) => { if (node.type === "button") found.push(node); }); }
function inputs(tree) { return walk(tree, (node, found) => { if (node.type === "input") found.push(node); }); }
function selects(tree) { return walk(tree, (node, found) => { if (node.type === "select") found.push(node); }); }
async function settle() { for (let index = 0; index < 6; index += 1) await new Promise((resolve) => globalThis.queueMicrotask(resolve)); }

// The production component is rendered with only React/service boundaries replaced; lookup state and handlers remain production code.
test("ProductEditPage registration flow accepts a candidate and preserves a user-edited name", async () => {
  const { harness } = setupHarness({ lookupResult: { status: "hit", input: "123", gtin: "123", candidate } });
  await settle();
  harness.render();
  assert.equal(harness.lookupCalls, 1);
  assert.match(text(harness.tree), /후보 상품/);
  const nameInput = inputs(harness.tree).find((input) => input.props.value === "");
  nameInput.props.onChange({ target: { value: "사용자 상품" } });
  harness.render();
  const accept = buttons(harness.tree).find((button) => text(button).includes("맞아요"));
  accept.props.onClick();
  harness.render();
  assert.equal(inputs(harness.tree).find((input) => input.props.className === "field").props.value, "사용자 상품");
  assert.match(text(harness.tree), /정보가 자동기입 되었습니다\. 나머지 정보를 입력해 주세요\./);

  const second = setupHarness({ lookupResult: { status: "hit", input: "123", gtin: "123", candidate } });
  await settle();
  second.harness.render();
  buttons(second.harness.tree).find((button) => text(button).includes("맞아요")).props.onClick();
  second.harness.render();
  assert.equal(inputs(second.harness.tree).find((input) => input.props.value === "후보 상품").props.value, "후보 상품");
});

test("shared catalog candidate fills only reusable product registration fields", async () => {
  const { applyProductCandidateToDraft } = await server.ssrLoadModule("/src/pages/ProductEditPage.tsx");
  const draft = applyProductCandidateToDraft({
    ...candidate,
    category: "음료",
    storage_type: "냉장",
    supplier_name: "공용 발주처",
    product_url: "https://orders.example.invalid/item/123"
  }, false);

  assert.deepEqual(draft, {
    name: "후보 상품",
    category: "음료",
    storageTypes: ["냉장"],
    supplierName: "공용 발주처",
    productUrl: "https://orders.example.invalid/item/123"
  });
  assert.equal("store_id" in draft, false);
  assert.equal("source_store_id" in draft, false);
});

test("shared catalog candidate auto-fills registration defaults after a scan", async () => {
  const sharedCandidate = {
    ...candidate,
    source: "catalog",
    category: "음료",
    storage_type: "냉장",
    supplier_name: "공용 발주처",
    product_url: "https://orders.example.invalid/item/123"
  };
  const { harness } = setupHarness({ lookupResult: { status: "hit", input: "123", gtin: "123", candidate: sharedCandidate } });
  await settle();
  harness.render();

  assert.ok(inputs(harness.tree).some((input) => input.props.value === "후보 상품"));
  assert.ok(inputs(harness.tree).some((input) => input.props.value === "https://orders.example.invalid/item/123"));
  assert.match(text(harness.tree), /공용 카탈로그 정보를 자동 입력했습니다/);
});

test("changing the barcode clears defaults auto-applied for the previous catalog product", async () => {
  const sharedCandidate = { ...candidate, source: "catalog", category: "음료", storage_type: "냉장", supplier_name: "공용 발주처", product_url: "https://orders.example.invalid/shared" };
  const flow = setupHarness({ lookupResult: { status: "hit", input: "123", gtin: "123", candidate: sharedCandidate } });
  await settle(); flow.harness.render();
  const barcodeInput = inputs(flow.harness.tree).find((input) => input.props.value === " 123 ");
  barcodeInput.props.onChange({ target: { value: "456" } });
  flow.harness.render();

  assert.ok(inputs(flow.harness.tree).some((input) => input.props.required && input.props.value === ""));
  assert.ok(inputs(flow.harness.tree).some((input) => input.props.type === "url" && input.props.value === ""));
  assert.equal(selects(flow.harness.tree)[0].props.value, "기타");
  assert.equal(selects(flow.harness.tree)[1].props.value, "");
  assert.doesNotMatch(buttons(flow.harness.tree).find((button) => text(button) === "냉장").props.className, /bg-brand-600/);
});

test("shared catalog defaults do not overwrite fields edited while lookup is pending", async () => {
  const sharedCandidate = { ...candidate, source: "catalog", category: "음료", storage_type: "냉장", supplier_name: "공용 발주처", product_url: "https://orders.example.invalid/shared" };
  const flow = setupHarness({ barcode: "", deferred: true });
  await settle(); flow.harness.render();
  const barcodeInput = inputs(flow.harness.tree).find((input) => input.props.value === "" && !input.props.required);
  barcodeInput.props.onChange({ target: { value: "123" } });
  flow.harness.render();
  buttons(flow.harness.tree).find((button) => button.props.className === "secondary-button mt-2 w-full").props.onClick();
  await settle(); flow.harness.render();

  inputs(flow.harness.tree).find((input) => input.props.required).props.onChange({ target: { value: "직접 입력 이름" } });
  selects(flow.harness.tree)[0].props.onChange({ target: { value: "기타" } });
  buttons(flow.harness.tree).find((button) => text(button) === "상온").props.onClick();
  selects(flow.harness.tree)[1].props.onChange({ target: { value: "직접 발주처" } });
  inputs(flow.harness.tree).find((input) => input.props.type === "url").props.onChange({ target: { value: "https://manual.example.invalid/item" } });
  flow.resolveLookup({ status: "hit", input: "123", gtin: "123", candidate: sharedCandidate });
  await settle(); flow.harness.render();

  assert.ok(inputs(flow.harness.tree).some((input) => input.props.value === "직접 입력 이름"));
  assert.ok(inputs(flow.harness.tree).some((input) => input.props.value === "https://manual.example.invalid/item"));
  assert.equal(selects(flow.harness.tree)[0].props.value, "기타");
  assert.equal(selects(flow.harness.tree)[1].props.value, "직접 발주처");
  assert.match(buttons(flow.harness.tree).find((button) => text(button) === "상온").props.className, /bg-brand-600/);
});

test("late option loading preserves already applied shared catalog defaults", async () => {
  const sharedCandidate = { ...candidate, source: "catalog", category: "음료", storage_type: "냉장", supplier_name: "공용 발주처", product_url: "https://orders.example.invalid/shared" };
  const flow = setupHarness({ lookupResult: { status: "hit", input: "123", gtin: "123", candidate: sharedCandidate }, deferredDataLoad: true });
  await settle(); flow.harness.render();
  flow.resolveDataLoad([]);
  await settle(); flow.harness.render();

  assert.ok(inputs(flow.harness.tree).some((input) => input.props.value === "후보 상품"));
  assert.equal(selects(flow.harness.tree)[0].props.value, "음료");
  assert.equal(selects(flow.harness.tree)[1].props.value, "공용 발주처");
});

test("ProductEditPage exposes real miss/error fallback outcomes and registration-only guard", async () => {
  const miss = setupHarness({ lookupResult: { status: "miss", input: "123", gtin: "123" } });
  await settle(); miss.harness.render();
  assert.match(text(miss.harness.tree), /일치하는 상품이 없습니다/);
  const unavailable = setupHarness({ lookupResult: { status: "unavailable", input: "123", error: { message: "offline" } } });
  await settle(); unavailable.harness.render();
  assert.match(text(unavailable.harness.tree), /offline/);
  const edit = setupHarness({ productId: "existing", barcode: "999", lookupResult: { status: "hit", input: "999", gtin: "999", candidate } });
  await settle(); edit.harness.render();
  assert.equal(edit.harness.lookupCalls, 0);
  assert.match(text(edit.harness.tree), /기존 상품/);
});

test("ProductEditPage manual lookup starts from an empty barcode and unmount suppresses its deferred response", async () => {
  const manual = setupHarness({ barcode: "", deferred: true });
  await settle();
  manual.harness.render();
  const barcodeInput = inputs(manual.harness.tree).find((input) => input.props.value === "" && !input.props.required);
  barcodeInput.props.onChange({ target: { value: " 123 " } });
  manual.harness.render();
  const lookupButton = buttons(manual.harness.tree).find((button) => text(button).includes("상품 정보 조회"));
  assert.equal(lookupButton.props.disabled, false);
  lookupButton.props.onClick();
  await settle();
  manual.harness.render();
  manual.harness.unmount();
  manual.resolveLookup({ status: "hit", input: " 123 ", gtin: "123", candidate });
  await settle();
  assert.equal(manual.harness.postUnmountSetters, 0);
});

test("ProductEditPage cancel independently invalidates a deferred manual lookup", async () => {
  const cancelled = setupHarness({ barcode: "", deferred: true });
  await settle();
  cancelled.harness.render();
  const barcodeInput = inputs(cancelled.harness.tree).find((input) => input.props.value === "" && !input.props.required);
  barcodeInput.props.onChange({ target: { value: "123" } });
  cancelled.harness.render();
  buttons(cancelled.harness.tree).find((button) => button.props.className === "secondary-button mt-2 w-full").props.onClick();
  await settle();
  cancelled.harness.render();
  buttons(cancelled.harness.tree).find((button) => text(button) === "취소" && button.props.className?.includes("px-3")).props.onClick();
  cancelled.resolveLookup({ status: "hit", input: "123", gtin: "123", candidate });
  await settle();
  cancelled.harness.render();
  assert.doesNotMatch(text(cancelled.harness.tree), /후보 상품/);
  assert.equal(cancelled.harness.stateValues.some((value) => value?.canonical_name === candidate.canonical_name), false);
  assert.deepEqual(cancelled.navigations, [{ name: "scan" }]);
});

test("ProductEditPage fallback statuses keep manual Save enabled through the component", async () => {
  const cases = [
    ["invalid", { status: "invalid", input: "123" }],
    ["ambiguous", { status: "ambiguous", input: "123" }],
    ["rate_limited", { status: "rate_limited", input: "123" }],
    ["Edge error", { status: "miss", input: "123", gtin: "00000000000123" }]
  ];
  for (const [label, lookupResult] of cases) {
    const options = label === "Edge error" ? { lookupResult, edgeResult: { data: null, error: { message: "service offline" } } } : { lookupResult };
    const flow = setupHarness(options);
    await settle();
    flow.harness.render();
    assert.match(text(flow.harness.tree), label === "Edge error" ? /service offline/ : /직접 입력/);
    const nameInput = inputs(flow.harness.tree).find((input) => input.props.className === "field" && input.props.value === "" && input.props.required);
    nameInput.props.onChange({ target: { value: `수동 ${label}` } });
    flow.harness.render();
    const save = buttons(flow.harness.tree).find((button) => button.props.type === "submit");
    assert.equal(save.props.disabled, false, label);
  }
});

test("ProductEditPage preserves user edits made before a deferred candidate response", async () => {
  const flow = setupHarness({ barcode: "", deferred: true });
  await settle();
  flow.harness.render();
  const barcodeInput = inputs(flow.harness.tree).find((input) => input.props.value === "" && !input.props.required);
  barcodeInput.props.onChange({ target: { value: "123" } });
  flow.harness.render();
  buttons(flow.harness.tree).find((button) => button.props.className === "secondary-button mt-2 w-full").props.onClick();
  await settle();
  flow.harness.render();
  const nameInput = inputs(flow.harness.tree).find((input) => input.props.className === "field" && input.props.value === "" && input.props.required);
  nameInput.props.onChange({ target: { value: "사용자 입력" } });
  flow.resolveLookup({ status: "hit", input: "123", gtin: "123", candidate });
  await settle();
  flow.harness.render();
  assert.equal(inputs(flow.harness.tree).find((input) => input.props.className === "field").props.value, "사용자 입력");
});

test("ProductEditPage normalizes barcode identity when it changes before deferred resolution", async () => {
  const flow = setupHarness({ barcode: "", barcodeFormat: "EAN_13", deferred: true });
  await settle();
  flow.harness.render();
  const barcodeInput = inputs(flow.harness.tree).find((input) => input.props.value === "" && !input.props.required);
  barcodeInput.props.onChange({ target: { value: " 123 " } });
  flow.harness.render();
  buttons(flow.harness.tree).find((button) => button.props.className === "secondary-button mt-2 w-full").props.onClick();
  await settle();
  flow.harness.render();
  flow.resolveLookup({ status: "hit", input: " 123 ", gtin: "123", candidate });
  await settle();
  flow.harness.render();
  assert.match(text(flow.harness.tree), /후보 상품/);
});

test("ProductEditPage rejects stale deferred results on barcode change", async () => {
  const changed = setupHarness({ deferred: true });
  await settle();
  changed.harness.render();
  const barcodeInput = inputs(changed.harness.tree).find((input) => input.props.value === " 123 ");
  barcodeInput.props.onChange({ target: { value: "456" } });
  changed.harness.render();
  changed.resolveLookup({ status: "hit", input: "123", gtin: "123", candidate });
  await settle(); changed.harness.render();
  assert.doesNotMatch(text(changed.harness.tree), /후보 상품/);
});

test("ProductEditPage forwards trimmed identity and candidate acceptance through the production boundary", async () => {
  let received;
  const setup = setupHarness({ barcodeFormat: "EAN_13", lookupImpl: async (...args) => { received = args; return { status: "hit", input: args[0], gtin: "123", candidate }; } });
  setup.harness.render();
  await settle();
  assert.equal(received[0], " 123 ");
  assert.equal(received[1], "EAN13");
  setup.harness.render();
  assert.equal(typeof buttons(setup.harness.tree).find((button) => text(button).includes("직접 입력")).props.onClick, "function");
});

test("manual barcode edits clear stale scan symbology before a new lookup", async () => {
  const flow = setupHarness({ barcode: "R011824490001", barcodeFormat: "CODE_128", lookupResult: { status: "miss", input: "R011824490001", externalLookupEligible: false } });
  await settle(); flow.harness.render();
  assert.equal(flow.harness.lookupArgs[0][1], "CODE_128");

  const barcodeInput = inputs(flow.harness.tree).find((input) => input.props.value === "R011824490001");
  barcodeInput.props.onChange({ target: { value: "MANUAL-EDIT" } });
  flow.harness.render();
  buttons(flow.harness.tree).find((button) => button.props.className === "secondary-button mt-2 w-full").props.onClick();
  await settle();
  assert.equal(flow.harness.lookupArgs.at(-1)[1], undefined);
});

test("orchestration helper retains manual fallback and stale guards", async () => {
  const { executeProductLookup, normalizeProductLookupIdentity, shouldLookupProductCandidate } = await server.ssrLoadModule("/src/pages/ProductEditPage.tsx");
  assert.equal(shouldLookupProductCandidate(true, " 123 "), true);
  assert.equal(shouldLookupProductCandidate(false, "123"), false);
  const identity = normalizeProductLookupIdentity(" 123 ", "EAN_13");
  const result = await executeProductLookup(" 123 ", "EAN_13", "store-1", (value) => value === identity, { lookup: async () => ({ status: "miss", input: "123", gtin: "123" }), invoke: async () => ({ data: { status: "rate_limited" }, error: null }) });
  assert.equal(result.status, "error");
});

test("non-GTIN catalog misses never invoke the external provider", async () => {
  const { executeProductLookup, normalizeProductLookupIdentity } = await server.ssrLoadModule("/src/pages/ProductEditPage.tsx");
  let edgeCalls = 0;
  const identity = normalizeProductLookupIdentity("R011824490001", "CODE_128");
  const result = await executeProductLookup("R011824490001", "CODE_128", "store-1", (value) => value === identity, {
    lookup: async () => ({ status: "miss", input: "R011824490001", externalLookupEligible: false }),
    invoke: async () => { edgeCalls += 1; return { data: { status: "miss" }, error: null }; }
  });
  assert.equal(result.status, "miss");
  assert.equal(edgeCalls, 0);
});
