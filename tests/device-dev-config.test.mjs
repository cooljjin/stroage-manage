import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const project = readFileSync("ios/App/App.xcodeproj/project.pbxproj", "utf8");
const native = readFileSync("ios/App/App/AppViewController.swift", "utf8");
const auth = readFileSync("src/services/auth/AuthService.ts", "utf8");
const settings = (name) => {
  const block = project.match(new RegExp(`504EC31[78].*? /\\* ${name} \\*/ = \\{[\\s\\S]*?\\n\\t\\t\\};`));
  assert.ok(block, `${name} configuration missing`);
  return block[0];
};
const plist = (path) => readFileSync(path, "utf8");

test("Debug Dev and Release/Staff remain isolated", () => {
  assert.match(settings("Debug"), /PRODUCT_BUNDLE_IDENTIFIER = com\.jinkim\.stockly\.dev;/);
  assert.match(settings("Debug"), /INFOPLIST_FILE = "App\/Info-Dev\.plist";/);
  assert.match(settings("Debug"), /CODE_SIGN_ENTITLEMENTS = App\/AppDev\.entitlements;/);
  assert.match(plist("ios/App/App/AppDev.entitlements"), /<string>TAG<\/string>/);
  assert.match(settings("Release"), /PRODUCT_BUNDLE_IDENTIFIER = com\.jinkim\.stockly;/);
  assert.match(settings("Release"), /INFOPLIST_FILE = App\/Info\.plist;/);
  assert.doesNotMatch(readFileSync("capacitor.config.json", "utf8"), /"server"|"cleartext"|stockly\.dev/);
  assert.doesNotMatch(readFileSync("ios/App/App/Info.plist", "utf8"), /StocklyDevServerURL/);
  assert.doesNotMatch(readFileSync("ios/App/App/Info-Staff.plist", "utf8"), /StocklyDevServerURL/);
  assert.match(plist("ios/App/App/Info-Dev.plist"), /<key>CFBundleURLSchemes<\/key><array><string>com\.jinkim\.stockly\.dev<\/string><\/array>/);
  assert.match(plist("ios/App/App/Info-Dev.plist"), /<key>StocklyDevServerURL<\/key><string>https:\/\/[^/]+\.ts\.net:8443<\/string>/);
  assert.match(native, /#if DEBUG[\s\S]*bundleIdentifier == "com\.jinkim\.stockly\.dev"[\s\S]*descriptor\.serverURL = url[\s\S]*#endif/);
  assert.match(auth, /"com\.jinkim\.stockly\.dev:"/);
});
