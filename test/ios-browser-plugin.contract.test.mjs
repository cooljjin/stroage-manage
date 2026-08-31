import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL, fileURLToPath } from "node:url";
import test from "node:test";

const podfile = readFileSync(fileURLToPath(new URL("../ios/App/Podfile", import.meta.url)), "utf8");
const podfileLock = readFileSync(fileURLToPath(new URL("../ios/App/Podfile.lock", import.meta.url)), "utf8");

test("iOS OAuth Browser plugin is declared and resolved in CocoaPods", () => {
  assert.match(podfile, /pod 'CapacitorBrowser', :path => '\.\.\/\.\.\/node_modules\/@capacitor\/browser'/);
  assert.match(podfileLock, /^ {2}- CapacitorBrowser \(/m);
  assert.match(podfileLock, /^ {2}- "CapacitorBrowser \(from `\.\.\/\.\.\/node_modules\/@capacitor\/browser`\)"/m);
});
