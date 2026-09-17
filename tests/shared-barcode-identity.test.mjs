import assert from "node:assert/strict";
import test from "node:test";
import { normalizeSharedBarcodeIdentity } from "../src/lib/sharedBarcode.ts";

test("GTIN symbologies share one GTIN-14 catalog identity", () => {
  assert.deepEqual(normalizeSharedBarcodeIdentity("8809084013546", "EAN_13"), {
    format: "GTIN",
    value: "08809084013546",
    key: "GTIN:08809084013546",
    externalLookupEligible: true
  });
});

test("CODE_128 preserves a case-sensitive printable payload", () => {
  assert.deepEqual(normalizeSharedBarcodeIdentity(" R011824490001 ", "CODE_128"), {
    format: "CODE_128",
    value: " R011824490001 ",
    key: "CODE_128: R011824490001 ",
    externalLookupEligible: false
  });
  assert.notEqual(
    normalizeSharedBarcodeIdentity("Abc", "CODE_128")?.key,
    normalizeSharedBarcodeIdentity("ABC", "CODE_128")?.key
  );
});

test("CODE_39 and CODE_93 preserve decoder payloads in separate format namespaces", () => {
  assert.equal(normalizeSharedBarcodeIdentity("ab-12", "CODE_39")?.key, "CODE_39:ab-12");
  assert.equal(normalizeSharedBarcodeIdentity("ab-12", "CODE_93")?.key, "CODE_93:ab-12");
});

test("ITF validates digits while CODABAR accepts decoder-stripped guards", () => {
  assert.equal(normalizeSharedBarcodeIdentity("001122", "ITF")?.key, "ITF:001122");
  assert.equal(normalizeSharedBarcodeIdentity("a1234b", "CODABAR")?.key, "CODABAR:a1234b");
  assert.equal(normalizeSharedBarcodeIdentity("1234", "CODABAR")?.key, "CODABAR:1234");
  assert.equal(normalizeSharedBarcodeIdentity("12345", "ITF"), null);
});

test("unknown, QR-like, control-character, and oversized payloads are not shared", () => {
  assert.equal(normalizeSharedBarcodeIdentity("https://example.com", "UNKNOWN"), null);
  assert.equal(normalizeSharedBarcodeIdentity("ABC\n123", "CODE_128"), null);
  assert.equal(normalizeSharedBarcodeIdentity("A".repeat(129), "CODE_128"), null);
  assert.deepEqual(normalizeSharedBarcodeIdentity(" CODE-PAD", "CODE_128")?.value, " CODE-PAD");
  assert.deepEqual(normalizeSharedBarcodeIdentity("CODE-PAD ", "CODE_128")?.value, "CODE-PAD ");
});
