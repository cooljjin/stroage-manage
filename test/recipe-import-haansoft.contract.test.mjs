import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import test from "node:test";

const recipeImport = readFileSync(new URL("../src/lib/recipeImport.ts", import.meta.url), "utf8");

test("Haansoft workbook preflight avoids HTML parsing and explains unreadable sheets", () => {
  assert.match(recipeImport, /cellHTML:\s*false/);
  assert.match(recipeImport, /if \(workbook\.SheetNames\.length === 0\) \{[\s\S]*읽을 수 있는 시트가 없습니다\./);
  assert.match(recipeImport, /if \(!sheet\) \{[\s\S]*일부 시트를 읽지 못했습니다\./);
});
