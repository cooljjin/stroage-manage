import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = dirname(testDirectory);
const outputDirectory = "/tmp/stockly-gtin-test";
mkdirSync(outputDirectory, { recursive: true });
execFileSync(join(repositoryRoot, "node_modules/.bin/tsc"), [
  join(repositoryRoot, "src/lib/gtin.ts"),
  "--target", "ES2020",
  "--module", "ES2020",
  "--moduleResolution", "Bundler",
  "--outDir", outputDirectory,
  "--declaration", "false",
  "--skipLibCheck"
], { cwd: repositoryRoot, stdio: "inherit" });
const { validateGtin } = await import(`${outputDirectory}/gtin.js?${Date.now()}`);

test("normalizes equivalent UPC-A/EAN-13/GTIN-14 inputs without changing originals", () => {
  const cases = [
    ["036000291452", "UPC_A", "00036000291452"],
    ["0036000291452", "EAN13", "00036000291452"],
    ["00036000291452", "GTIN14", "00036000291452"]
  ];
  for (const [value, format, gtin14] of cases) {
    assert.deepEqual(validateGtin(value, format), { status: "valid", original: value, format, gtin14 });
  }
});

test("validates EAN-8 only when the format is explicit", () => {
  assert.deepEqual(validateGtin("96385074", "EAN8"), {
    status: "valid",
    original: "96385074",
    format: "EAN8",
    gtin14: "00000096385074"
  });
  assert.equal(validateGtin("96385074").status, "ambiguous");
});

test("keeps UPC-E and format-less eight digits ambiguous", () => {
  assert.equal(validateGtin("04210005", "UPC_E").status, "ambiguous");
  assert.equal(validateGtin("04210005").status, "ambiguous");
});

test("rejects bad checksums for every explicit supported format", () => {
  for (const [value, format] of [
    ["96385075", "EAN8"],
    ["036000291453", "UPC_A"],
    ["4006381333932", "EAN13"],
    ["10012345678903", "GTIN14"]
  ]) {
    const result = validateGtin(value, format);
    assert.equal(result.status, "invalid");
    assert.equal(result.original, value);
    assert.equal("gtin14" in result, false);
  }
});

test("retains nonzero GTIN-14 packaging indicators", () => {
  const result = validateGtin("10036000291459", "GTIN14");
  assert.equal(result.status, "valid");
  assert.equal(result.gtin14, "10036000291459");
  assert.notEqual(result.gtin14, "00036000291452");
});

test("rejects malformed input without repair or a lookup key", () => {
  for (const value of [
    " 036000291452", "03600029145-2", "abc036000291452", "１２３４５６７８",
    "٠٣٦٠٠٠٢٩١٤٥٢", "", "   ", "---", "8801234567890", "1234567", "123456789012345"
  ]) {
    const result = validateGtin(value);
    assert.equal(result.status, "invalid");
    assert.equal(result.original, value);
    assert.equal("gtin14" in result, false);
  }
  for (const result of [validateGtin("96385074"), validateGtin("04210005", "UPC_E")]) {
    assert.equal(result.status, "ambiguous");
    assert.equal("gtin14" in result, false);
  }
});
