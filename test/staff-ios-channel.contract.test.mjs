import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const authServicePath = new globalThis.URL("../src/services/auth/AuthService.ts", import.meta.url);
const nativeConfigPath = new globalThis.URL("../src/lib/nativeAppConfiguration.ts", import.meta.url);
const viewControllerPath = new globalThis.URL("../ios/App/App/AppViewController.swift", import.meta.url);

test("native OAuth callback follows the installed iOS bundle identifier", async () => {
  const [authService, nativeConfig, nativePlugin] = await Promise.all([
    readFile(authServicePath, "utf8"),
    readFile(nativeConfigPath, "utf8"),
    readFile(viewControllerPath, "utf8")
  ]);

  assert.match(nativeConfig, /registerPlugin<NativeAppConfigurationPlugin>\("NativeAppConfiguration"\)/);
  assert.match(nativeConfig, /getNativeAuthCallbackUrl/);
  assert.match(nativePlugin, /registerPluginInstance\(NativeAppConfigurationPlugin\(\)\)/);
  assert.match(nativePlugin, /Bundle\.main\.bundleIdentifier/);
  assert.match(nativePlugin, /:\/\/auth\/callback/);
  assert.match(authService, /getNativeAuthCallbackUrl/);
  assert.match(authService, /await getAuthRedirectUrl\(/);
  assert.match(authService, /com\.jinkim\.storeinventory\.poc/);
});
