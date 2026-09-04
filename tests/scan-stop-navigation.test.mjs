import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { URL } from "node:url";
import test from "node:test";

test("native scan stop returns to the home screen instead of hiding the scan UI", async () => {
  const source = await readFile(new URL("../src/pages/ScanPage.tsx", import.meta.url), "utf8");

  assert.match(
    source,
    /async function cancelNativeScanner\(\) \{\s*await stopScanner\(\);\s*navigate\(\{ name: "home" \}\);\s*\}/
  );
  assert.match(source, /onClick=\{\(\) => void cancelNativeScanner\(\)\}/);
});

test("native scan mode controls use compact labels", async () => {
  const source = await readFile(new URL("../src/pages/ScanPage.tsx", import.meta.url), "utf8");
  const nativeOverlay = source.match(/\{nativeScanActive \? \([\s\S]*?\) : null\}/)?.[0] ?? "";

  assert.match(nativeOverlay, />\s*입고\s*<\/button>/);
  assert.match(nativeOverlay, />\s*실사\s*<\/button>/);
  assert.doesNotMatch(nativeOverlay, />\s*(입고모드|실사모드)\s*<\/button>/);
});
