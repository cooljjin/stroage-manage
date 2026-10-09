import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { setImmediate } from "node:timers";
import { URL } from "node:url";
import { TextDecoder } from "node:util";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import { parseProductTagUrl, productNfcNdefRecords, productTagUrl } from "../src/lib/productNfc.ts";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

const productId = "8f14e45f-ea4b-4f03-a20b-123456789abc";
const host = "stockly.example";
const productUrl = productTagUrl(productId, host);

async function beginNfcWrite({ confirmOverwrite = () => true, startError, writeError, platform = "android", secondStartError, replayOnRegistration, duringScanStart } = {}) {
  const state = { listener: null, sessionListener: null, active: false, scans: [], timeout: null, sessionRemovals: 0, writes: [], confirmations: 0, messages: [], removals: 0, stops: 0, erases: 0 };
  const CapacitorNfc = {
    addListener: async (name, listener) => {
      if (name === "nfcSessionEnd") {
        state.sessionListener = listener;
        return { remove: async () => { state.sessionRemovals += 1; } };
      }
      state.listener = listener;
      // Capacitor drains events retained while no JS listener was installed.
      replayOnRegistration?.(state.scans.length + 1, listener);
      return { remove: async () => { state.removals += 1; } };
    },
    startScanning: async (options) => {
      state.active = false;
      state.scans.push(options);
      await duringScanStart?.(state.scans.length, state.listener);
      if (state.scans.length === 2 && secondStartError) throw secondStartError;
      if (startError) throw startError;
    },
    stopScanning: async () => { state.stops += 1; state.active = false; },
    write: async (options) => {
      if (!state.active) throw new Error("No active NFC session or tag. Call startScanning and present a tag before writing.");
      state.writes.push(options);
      if (writeError) throw writeError;
    },
    erase: async () => { state.erases += 1; }
  };
  const module = { exports: {} };
  runInNewContext(ts.transpile(await readFile(new URL("../src/lib/nativeAttendanceNfc.ts", import.meta.url), "utf8"), { module: ts.ModuleKind.CommonJS }), {
    module,
    exports: module.exports,
    Error,
    setTimeout: (callback) => { state.timeout = callback; return 1; },
    clearTimeout: () => { state.timeout = null; },
    require: (name) => {
      if (name === "@capacitor/core") return { Capacitor: { isNativePlatform: () => true, getPlatform: () => platform }, registerPlugin: () => ({}) };
      if (name === "@capgo/capacitor-nfc") return { CapacitorNfc };
      if (name === "./productNfc") return { productNfcNdefRecords, urlNdefRecord: (url) => productNfcNdefRecords(url)[0] };
      throw new Error(`Unexpected import: ${name}`);
    }
  });
  const writePromise = module.exports.writeProductUrlToNfc(productUrl, async (message) => {
    state.messages.push(message);
    state.confirmations += 1;
    if (platform === "ios") {
      assert.equal(state.active, false, "Stop the reader before showing confirmation");
      assert.equal(state.removals, 1);
      assert.equal(state.sessionRemovals, 1);
    }
    return confirmOverwrite();
  });
  void writePromise.catch(() => undefined);
  await new Promise((resolve) => setImmediate(resolve));
  return { state, writePromise, present: (event) => { state.active = true; state.listener(event); } };
}

test("populated product tag cancel leaves it untouched and cleans up", async () => {
  const h = await beginNfcWrite({ confirmOverwrite: () => false });
  h.present({ tag: { ndefMessage: [{ tnf: 1, type: [85], id: [], payload: [1] }] } });
  assert.equal(await h.writePromise, false);
  assert.equal(h.state.confirmations, 1);
  assert.equal(h.state.writes.length, 0);
  assert.equal(h.state.erases, 0);
  assert.equal(h.state.removals, 1);
  assert.equal(h.state.stops, 1);
});

test("populated product tag confirmation replaces the full NDEF message once", async () => {
  const h = await beginNfcWrite();
  h.present({ tag: { ndefMessage: [{ tnf: 1, type: [84], id: [], payload: [2] }] } });
  assert.equal(await h.writePromise, true);
  assert.equal(h.state.confirmations, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(h.state.writes)), [{ allowFormat: true, records: productNfcNdefRecords(productUrl) }]);
  assert.equal(h.state.erases, 0);
  assert.equal(h.state.removals, 1);
  assert.equal(h.state.stops, 1);
});

test("explicitly empty NDEF tag writes directly without prompting", async () => {
  const h = await beginNfcWrite({ confirmOverwrite: () => false });
  h.present({ tag: { ndefMessage: [] } });
  assert.equal(await h.writePromise, true);
  assert.equal(h.state.confirmations, 0);
  assert.equal(h.state.writes.length, 1);
});

test("duplicate NFC events cannot start concurrent confirmation or writes", async () => {
  let resolveConfirmation;
  const confirmation = new Promise((resolve) => { resolveConfirmation = resolve; });
  const h = await beginNfcWrite({ confirmOverwrite: () => confirmation });
  const event = { tag: { ndefMessage: [{ tnf: 1, type: [84], id: [], payload: [3] }] } };
  h.present(event);
  h.present(event);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.state.confirmations, 1);
  assert.equal(h.state.writes.length, 0);
  resolveConfirmation(true);
  assert.equal(await h.writePromise, true);
  assert.equal(h.state.writes.length, 1);
});

test("missing NDEF data fails closed, and scan/write failures clean up", async () => {
  const unknown = await beginNfcWrite();
  unknown.present({ tag: {} });
  await assert.rejects(unknown.writePromise, /NDEF/);
  assert.equal(unknown.state.writes.length, 0);
  assert.equal(unknown.state.removals, 1);
  assert.equal(unknown.state.stops, 1);

  const startError = new Error("scan failed");
  const failedScan = await beginNfcWrite({ startError });
  await assert.rejects(failedScan.writePromise, /scan failed/);
  assert.equal(failedScan.state.removals, 1);
  assert.equal(failedScan.state.stops, 1);

  const failedWrite = await beginNfcWrite({ writeError: new Error("write failed") });
  failedWrite.present({ tag: { ndefMessage: [] } });
  await assert.rejects(failedWrite.writePromise, /write failed/);
  assert.equal(failedWrite.state.removals, 1);
  assert.equal(failedWrite.state.stops, 1);
});

for (const ndefMessage of [undefined, null]) {
  test(`iOS writable tag with ${ndefMessage} NDEF registers only after explicit confirmation`, async () => {
    const h = await beginNfcWrite({ platform: "ios" });
    const tag = { type: "tag", tag: { id: [4, 1], isWritable: true, maxSize: 144, ndefMessage } };
    h.present(tag);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(h.state.writes.length, 0);
    assert.equal(h.state.scans.length, 2);
    h.present(tag);
    assert.equal(await h.writePromise, true);
    assert.equal(h.state.confirmations, 1);
    assert.match(h.state.messages[0], /기존 정보를 읽지 못/);
    assert.match(h.state.messages[0], /삭제/);
    assert.equal(h.state.writes.length, 1);
    assert.equal(h.state.erases, 0);
    assert.equal(h.state.removals, 2);
    assert.equal(h.state.stops, 2);
  });
}

test("iOS unknown NDEF cancellation preserves the tag", async () => {
  const h = await beginNfcWrite({ platform: "ios", confirmOverwrite: () => false });
  h.present({ type: "tag", tag: { id: [4, 1], isWritable: true, maxSize: 144 } });
  assert.equal(await h.writePromise, false);
  assert.equal(h.state.writes.length, 0);
  assert.equal(h.state.erases, 0);
  assert.equal(h.state.removals, 1);
  assert.equal(h.state.stops, 2);
});

test("unknown NDEF without iOS write capability still fails closed", async () => {
  for (const [platform, tag] of [
    ["android", { isWritable: true, maxSize: 144 }],
    ["ios", { isWritable: false, maxSize: 144 }],
    ["ios", { isWritable: true, maxSize: 0 }],
    ["ios", { isWritable: true }],
    ["ios", {}]
  ]) {
    const h = await beginNfcWrite({ platform });
    h.present({ type: "tag", tag });
    await assert.rejects(h.writePromise, /NDEF/);
    assert.equal(h.state.confirmations, 0);
    assert.equal(h.state.writes.length, 0);
  }
});

test("Android NDEF-formattable blank tag keeps direct registration", async () => {
  const h = await beginNfcWrite();
  h.present({ type: "ndef-formatable", tag: {} });
  assert.equal(await h.writePromise, true);
  assert.equal(h.state.confirmations, 0);
  assert.equal(h.state.writes.length, 1);
});

const occupiedIosTag = { type: "ndef", tag: { id: [4, 1, 2, 3], isWritable: true, maxSize: 144, ndefMessage: [{ tnf: 1, type: [85], id: [], payload: [1] }] } };

async function rescanIosTag(options) {
  const h = await beginNfcWrite({ platform: "ios", ...options });
  h.present(occupiedIosTag);
  await new Promise((resolve) => setImmediate(resolve));
  return h;
}

test("iOS overwrite waits for a fresh detection after confirmation and writes once", async () => {
  const h = await rescanIosTag();
  assert.equal(h.state.confirmations, 1);
  assert.equal(h.state.scans.length, 2);
  assert.equal(h.state.writes.length, 0);
  assert.match(h.state.scans[1].alertMessage, /같은 NFC 태그를 다시/);
  h.present(occupiedIosTag);
  h.present(occupiedIosTag);
  assert.equal(await h.writePromise, true);
  assert.equal(h.state.writes.length, 1);
  assert.equal(h.state.erases, 0);
  assert.equal(h.state.removals, 2);
  assert.equal(h.state.sessionRemovals, 2);
  assert.equal(h.state.timeout, null);
});

test("iOS overwrite refuses a different tag on the second scan", async () => {
  const h = await rescanIosTag();
  h.present({ ...occupiedIosTag, tag: { ...occupiedIosTag.tag, id: [9, 2] } });
  await assert.rejects(h.writePromise, /다른 태그/);
  assert.equal(h.state.writes.length, 0);
  assert.equal(h.state.erases, 0);
});

test("iOS overwrite refuses missing identity and read-only second tags", async () => {
  const noId = await beginNfcWrite({ platform: "ios" });
  noId.present({ ...occupiedIosTag, tag: { ...occupiedIosTag.tag, id: undefined } });
  await assert.rejects(noId.writePromise, /식별자/);
  assert.equal(noId.state.confirmations, 0);
  const readOnly = await rescanIosTag();
  readOnly.present({ ...occupiedIosTag, tag: { ...occupiedIosTag.tag, isWritable: false } });
  await assert.rejects(readOnly.writePromise, /읽기 전용/);
  assert.equal(readOnly.state.writes.length, 0);
});

test("cancelled or timed-out second scan releases the waiting operation", async () => {
  for (const reason of ["userCancelled", "sessionTimeout"]) {
    const h = await rescanIosTag();
    h.state.sessionListener({ reason });
    if (reason === "userCancelled") assert.equal(await h.writePromise, false);
    else await assert.rejects(h.writePromise, /읽기 시간이/);
    assert.equal(h.state.writes.length, 0);
    assert.equal(h.state.removals, 2);
    assert.equal(h.state.timeout, null);
  }
  const h = await rescanIosTag();
  h.state.timeout();
  await assert.rejects(h.writePromise, /인식하지 못/);
  assert.equal(h.state.writes.length, 0);
});

test("rescan start failure preserves the tag and cleans up", async () => {
  const h = await rescanIosTag({ secondStartError: new Error("second scan failed") });
  await assert.rejects(h.writePromise, /second scan failed/);
  assert.equal(h.state.writes.length, 0);
  assert.equal(h.state.erases, 0);
  assert.equal(h.state.removals, 2);
});

test("late events from the first iOS scan cannot write after confirmation", async () => {
  const h = await beginNfcWrite({ platform: "ios" });
  const firstListener = h.state.listener;
  const firstSessionEnd = h.state.sessionListener;
  h.present(occupiedIosTag);
  await new Promise((resolve) => setImmediate(resolve));
  firstListener(occupiedIosTag);
  firstSessionEnd({ reason: "userCancelled" });
  assert.equal(h.state.writes.length, 0);
  h.present(occupiedIosTag);
  assert.equal(await h.writePromise, true);
  assert.equal(h.state.writes.length, 1);
});

test("cancelled product NFC write does not report success in inventory operation", async () => {
  const operation = await readFile(new URL("../src/pages/InventoryOperationPage.tsx", import.meta.url), "utf8");
  const start = operation.indexOf("  async function writeCurrentProductNfcTag() {");
  const end = operation.indexOf("\n  async function openMemoHistory()", start);
  assert.ok(start >= 0 && end > start);
  const uiState = { nfcWriting: false, error: "", success: undefined };
  const context = {
    item: { id: productId }, nfcWriting: false, NFC_LINK_HOST: host, PRODUCT_TAG_CHANNEL: "production",
    productTagUrl, writeProductUrlToNfc: async () => false,
    setNfcWriting(value) { uiState.nfcWriting = value; }, setError(value) { uiState.error = value; },
    setSuccess(value) { uiState.success = value; }
  };
  runInNewContext(ts.transpile(operation.slice(start, end), { target: ts.ScriptTarget.ES2022 }), context);
  await context.writeCurrentProductNfcTag();
  assert.equal(uiState.success, "");
  assert.equal(uiState.error, "");
  assert.equal(uiState.nfcWriting, false);
});

test("product NFC URLs accept only the configured HTTPS route and a UUID", () => {
  const url = productTagUrl(productId, host);
  assert.equal(url, `https://${host}/nfc/product/${productId}`);
  assert.equal(parseProductTagUrl(url, host), productId);
  assert.equal(parseProductTagUrl(`http://${host}/nfc/product/${productId}`, host), null);
  assert.equal(parseProductTagUrl(`https://evil.example/nfc/product/${productId}`, host), null);
  assert.equal(parseProductTagUrl(`https://${host}/inventory/${productId}`, host), null);
  assert.equal(parseProductTagUrl(`https://${host}/nfc/product/not-a-uuid`, host), null);
  assert.throws(() => productTagUrl("not-a-uuid", host), /품목/);
});

test("Dev product tags use a Dev-only path and cannot route the production app", () => {
  const url = productTagUrl(productId, host, "development");
  assert.equal(url, `https://${host}/nfc/dev/product/${productId}`);
  assert.equal(parseProductTagUrl(url, host, "development"), productId);
  assert.equal(parseProductTagUrl(url, host), null);
  // Previously written product tags remain readable in Dev when explicitly delivered to it.
  assert.equal(parseProductTagUrl(productTagUrl(productId, host), host, "development"), productId);
  const [uri] = productNfcNdefRecords(url);
  assert.equal(new TextDecoder().decode(new Uint8Array(uri.payload.slice(1))), `${host}/nfc/dev/product/${productId}`);
});

test("product NFC tag keeps an iOS URI first and adds the Stockly Android application record", () => {
  const [uri, androidApp] = productNfcNdefRecords(productTagUrl(productId, host));
  assert.equal(uri.tnf, 0x01);
  assert.deepEqual(uri.type, [0x55]);
  assert.equal(uri.payload[0], 0x04);
  assert.equal(new TextDecoder().decode(new Uint8Array(uri.payload.slice(1))), `stockly.example/nfc/product/${productId}`);
  assert.equal(androidApp.tnf, 0x04);
  assert.equal(new TextDecoder().decode(new Uint8Array(androidApp.type)), "android.com:pkg");
  assert.equal(new TextDecoder().decode(new Uint8Array(androidApp.payload)), "com.jinkim.stockly");
});

test("Dev NFC association targets only the Dev route and the signed Dev capability", async () => {
  const association = JSON.parse(await source("public/apple-app-site-association"));
  const dev = association.applinks.details.find((detail) => detail.appIDs.includes("RQMBNM7XVV.com.jinkim.stockly.dev"));
  assert.ok(dev, "Dev app is missing from AASA");
  assert.deepEqual(dev.appIDs, ["RQMBNM7XVV.com.jinkim.stockly.dev"]);
  assert.deepEqual(dev.components.map((component) => component["/"]), ["/nfc/dev/product/*", "/attendance/dev/tag/*", "/nfc/product/*", "/attendance/tag/*"]);
  assert.equal(association.applinks.details.at(-1), dev, "Legacy production links keep precedence when both apps are installed");
  const production = association.applinks.details.filter((detail) => detail !== dev);
  assert.ok(production.every((detail) => detail.components.every((component) => component["/"] !== "/nfc/dev/product/*")));
  assert.match(await source("ios/App/App/AppDev.entitlements"), /com.apple.developer.associated-domains[\s\S]*applinks:stroage-manage\.vercel\.app/);
  const operation = await source("src/pages/InventoryOperationPage.tsx");
  const app = await source("src/App.tsx");
  assert.match(operation, /import.meta.env.MODE === "staging" \? "development" : "production"/);
  assert.match(operation, /productTagUrl\(item.id, NFC_LINK_HOST, PRODUCT_TAG_CHANNEL\)/);
  assert.match(app, /import.meta.env.MODE === "staging" \? "development" : "production"/);
  assert.match(app, /parseProductTagUrl\(url, ATTENDANCE_LINK_HOST, PRODUCT_TAG_CHANNEL\)/);
});

test("product tags deep-link into the audit workflow from cold and warm app links", async () => {
  const [app, operation, association, android, mainActivity, entitlements, info] = await Promise.all([
    source("src/App.tsx"),
    source("src/pages/InventoryOperationPage.tsx"),
    source("public/apple-app-site-association"),
    source("android/app/src/main/AndroidManifest.xml"),
    source("android/app/src/main/java/com/jinkim/storeinventory/poc/MainActivity.java"),
    source("ios/App/App/AppNfcRelease.entitlements"),
    source("ios/App/App/Info.plist")
  ]);
  assert.match(app, /parseProductTagUrl/);
  assert.match(app, /getLaunchUrl\(\)/);
  assert.match(app, /addListener\("appUrlOpen"/);
  assert.match(app, /initialInventoryMode:\s*"audit"/);
  assert.match(app, /function initialRoute\(\): AppRoute \{[\s\S]*?productRouteFromUrl/);
  assert.match(operation, /writeProductUrlToNfc/);
  assert.match(operation, /aria-label="품목 NFC 태그 기록"/);
  assert.match(association, /\/nfc\/product\/\*/);
  assert.match(entitlements, /applinks:stroage-manage\.vercel\.app/);
  assert.match(android, /android:pathPrefix="\/nfc\/product\/"/);
  assert.match(android, /android:name="android\.permission\.NFC"/);
  assert.match(mainActivity, /ACTION_NDEF_DISCOVERED[\s\S]*?Intent\.ACTION_VIEW/);
  assert.match(info, /NFCReaderUsageDescription[\s\S]*?품목 재고 확인/);
});


test("retained first-scan event cannot write before the second NFC session starts", async () => {
  const h = await rescanIosTag({
    replayOnRegistration(scan, listener) {
      if (scan === 2) listener(occupiedIosTag);
    }
  });
  assert.equal(h.state.scans.length, 2);
  assert.equal(h.state.writes.length, 0);
  assert.equal(h.state.stops, 1, "Retained event must not fail/stop the fresh scan");
  h.present(occupiedIosTag);
  assert.equal(await h.writePromise, true);
  assert.equal(h.state.writes.length, 1);
});

test("events during NFC startup are ignored until session activation completes", async () => {
  let activate;
  const activation = new Promise((resolve) => { activate = resolve; });
  const h = await beginNfcWrite({
    platform: "ios",
    duringScanStart(scan, listener) {
      listener(occupiedIosTag);
      return activation;
    }
  });
  assert.equal(h.state.confirmations, 0);
  assert.equal(h.state.writes.length, 0);
  assert.equal(h.state.stops, 0);
  activate();
  await new Promise((resolve) => setImmediate(resolve));
  h.present({ type: "ndef", tag: { ...occupiedIosTag.tag, ndefMessage: [] } });
  assert.equal(await h.writePromise, true);
  assert.equal(h.state.writes.length, 1);
});

test("retained event on initial listener registration cannot trigger confirmation", async () => {
  const h = await beginNfcWrite({
    platform: "ios",
    replayOnRegistration(_scan, listener) { listener(occupiedIosTag); }
  });
  assert.equal(h.state.confirmations, 0);
  assert.equal(h.state.writes.length, 0);
  h.present({ type: "ndef", tag: { ...occupiedIosTag.tag, ndefMessage: [] } });
  assert.equal(await h.writePromise, true);
});
