import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { URL } from "node:url";
import { setImmediate } from "node:timers";
import test from "node:test";
import ts from "typescript";
import { parseProductTagUrl } from "../src/lib/productNfc.ts";
import { consumePendingAttendanceToken, parseAttendanceTagUrl, pendingAttendanceRequestId, savePendingAttendanceToken } from "../src/lib/attendancePayroll.ts";

const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const helpers = app.slice(app.indexOf("function attendanceTokenFromUrl"), app.indexOf("function initialAttendanceToken"));
const listenerStart = app.indexOf("  useEffect(() => {\n    if (!Capacitor.isNativePlatform()) return;");
const listenerEffect = app.slice(listenerStart, app.indexOf("  }, []);", listenerStart) + "  }, []);".length);
const punchStart = app.indexOf("  useEffect(() => {\n    if (!profile || (!attendanceToken && !attendanceTestTag)) return;");
const punchEffect = app.slice(punchStart, app.indexOf("  }, [attendanceRetry, attendanceToken, attendanceTestTag, profile]);", punchStart) + "  }, [attendanceRetry, attendanceToken, attendanceTestTag, profile]);".length);
assert.ok(listenerStart >= 0 && punchStart >= 0, "Native link/punch effects must exist");

function execute(source, context) {
  runInNewContext(ts.transpile(source, { target: ts.ScriptTarget.ES2022 }), context);
}

async function linkHarness(launchUrl, channel = "development") {
  const values = new Map();
  const state = { product: null, token: null, punch: null, requests: [], removed: false };
  const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
  const context = {
    URL, window: { location: { host: "dev.example", href: "https://dev.example/" }, history: { replaceState() {} } },
    ATTENDANCE_LINK_HOST: "stockly.example", PRODUCT_TAG_CHANNEL: channel,
    PENDING_PRODUCT_URL_STORAGE_KEY: "stockly-pending-product-url",
    parseProductTagUrl, parseAttendanceTagUrl, savePendingAttendanceToken,
    sessionStorage: storage, Capacitor: { isNativePlatform: () => true },
    CapacitorApp: {
      getLaunchUrl: async () => launchUrl ? { url: launchUrl } : undefined,
      addListener: async (name, callback) => { assert.equal(name, "appUrlOpen"); state.open = callback; return { remove: async () => { state.removed = true; } }; }
    },
    useEffect: (effect) => { state.cleanup = effect(); },
    setPendingProductRoute: (route) => { state.product = JSON.parse(JSON.stringify(route)); },
    setAttendanceToken: (token) => { state.token = token; },
    setAttendanceError() {}, setAttendanceMessage() {},
    Services: { AuthService: { isNativeAuthCallbackUrl: () => false } }
  };
  execute(helpers + listenerEffect, context);
  await new Promise((resolve) => setImmediate(resolve));
  return { state, context, storage };
}

function processPunch(harness, profile) {
  const { context, state } = harness;
  Object.assign(context, {
    profile, attendanceToken: state.token, attendanceTestTag: null, attendanceRetry: 0,
    pendingAttendanceRequestId, consumePendingAttendanceToken,
    setAttendanceBusy() {}, setAttendancePunch: (punch) => { state.punch = punch; },
    Services: { ...context.Services, DatabaseService: { rpc: async (name, payload) => {
      state.requests.push({ name, payload });
      return { data: { id: "fixture-punch-event", tagged_at: "2026-10-03T00:00:00Z" }, error: null };
    } } }
  });
  execute(helpers + punchEffect, context);
}

const productId = "8f14e45f-ea4b-4f03-a20b-123456789abc";
for (const kind of ["cold", "warm"]) {
  test(`${kind} native Dev product link queues the exact inventory audit route`, async () => {
    const url = `https://stockly.example/nfc/dev/product/${productId}`;
    const h = await linkHarness(kind === "cold" ? url : null);
    if (kind === "warm") h.state.open({ url });
    assert.deepEqual(h.state.product, { name: "operation", productId, initialInventoryMode: "audit" });
    assert.equal(h.state.token, null);
    const nextProductId = "9f14e45f-ea4b-4f03-a20b-123456789abc";
    h.state.open({ url: `https://stockly.example/nfc/dev/product/${nextProductId}` });
    assert.deepEqual(h.state.product, { name: "operation", productId: nextProductId, initialInventoryMode: "audit" }, "A later physical product tag must replace the prior launch route");
    h.state.cleanup();
    assert.equal(h.state.removed, true);
  });

  test(`${kind} native Dev attendance link survives login and opens a punch without finalizing it`, async () => {
    const url = "https://stockly.example/attendance/dev/tag/fixture_token";
    const h = await linkHarness(kind === "cold" ? url : null);
    if (kind === "warm") h.state.open({ url });
    assert.equal(h.state.token, "fixture_token");
    const requestId = pendingAttendanceRequestId(h.storage);
    // iOS can deliver a cold URL through both launch lookup and the open event.
    h.state.open({ url });
    assert.equal(pendingAttendanceRequestId(h.storage), requestId);
    processPunch(h, null);
    assert.equal(h.state.requests.length, 0);
    processPunch(h, { store_id: "fixture-store" });
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(h.state.requests.map(({ name }) => name), ["begin_attendance_punch"]);
    assert.equal(h.state.requests[0].payload.raw_token, "fixture_token");
    assert.equal(h.state.requests[0].payload.request_id, requestId);
    assert.equal(h.state.punch.id, "fixture-punch-event");
    assert.equal(h.state.token, null);
    h.state.open({ url });
    assert.notEqual(pendingAttendanceRequestId(h.storage), requestId, "A subsequent physical tap must get a new request ID");
  });
}

for (const kind of ["cold", "warm"]) {
  test(`${kind} attendance URL is not replayed by getLaunchUrl after a WebView reload`, async () => {
    const url = "https://stockly.example/attendance/dev/tag/fixture_token";
    const h = await linkHarness(kind === "cold" ? url : null);
    if (kind === "warm") h.state.open({ url });
    processPunch(h, { store_id: "fixture-store" });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(h.state.token, null);
    h.context.CapacitorApp.getLaunchUrl = async () => ({ url });
    execute(helpers + listenerEffect, h.context);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(h.state.token, null, "Reload must not start another attendance punch from the stale native URL");
    h.state.open({ url });
    assert.equal(h.state.token, "fixture_token", "A new physical tap must still work after reload");
  });
}

test("warm product navigation survives a WebView reload before login/profile restoration", async () => {
  const url = `https://stockly.example/nfc/dev/product/${productId}`;
  const h = await linkHarness(null);
  h.state.open({ url });
  h.state.cleanup();
  // A WebView reload discards React state, but retains sessionStorage/native URL.
  h.state.product = null;
  h.context.CapacitorApp.getLaunchUrl = async () => ({ url });
  const initializer = app.match(/const \[pendingProductRoute, setPendingProductRoute\] = useState<AppRoute \| null>\((.*)\);/)[1];
  execute(helpers + `setPendingProductRoute((${initializer})());`, h.context);
  execute(helpers + listenerEffect, h.context);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(h.state.product, { name: "operation", productId, initialInventoryMode: "audit" });

  const start = app.indexOf("  useEffect(() => {\n    if (!pendingProductRoute || !session || !profile) return;");
  const effect = app.slice(start, app.indexOf("  }, [pendingProductRoute, profile, route, session]);", start) + "  }, [pendingProductRoute, profile, route, session]);".length);
  const navigations = [];
  Object.assign(h.context, {
    pendingProductRoute: h.state.product, session: null, profile: null,
    routeKey: JSON.stringify, route: { name: "home" },
    navigateRef: { current: (route) => navigations.push(JSON.parse(JSON.stringify(route))) }
  });
  execute(effect, h.context);
  assert.equal(navigations.length, 0, "Wait for login/profile before navigating");
  h.context.session = {};
  h.context.profile = { store_id: "fixture-store" };
  execute(effect, h.context);
  assert.deepEqual(navigations, [{ name: "operation", productId, initialInventoryMode: "audit" }]);
  assert.equal(h.storage.getItem("stockly-pending-product-url"), url, "Keep the link until the route actually commits");
  h.context.route = navigations[0];
  execute(effect, h.context);
  execute(helpers + `setPendingProductRoute((${initializer})());`, h.context);
  assert.equal(h.state.product, null, "Completed navigation must not replay after another reload");
});

test("production app ignores Dev product and attendance links", async () => {
  const h = await linkHarness(`https://stockly.example/nfc/dev/product/${productId}`, "production");
  h.state.open({ url: "https://stockly.example/attendance/dev/tag/fixture_token" });
  assert.equal(h.state.product, null);
  assert.equal(h.state.token, null);
});
