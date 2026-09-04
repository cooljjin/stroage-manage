import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import test from "node:test";

const recipeImportPage = readFileSync(new URL("../src/pages/RecipeImportPage.tsx", import.meta.url), "utf8");
const masterApprovalsPage = readFileSync(new URL("../admin-console/src/pages/MasterRecipeApprovalsPage.tsx", import.meta.url), "utf8");
const visibleBillingCopy = /예상 비용|실제 비용|승인 금액|최대 비용|추가 비용|비용 승인|비용을|비용이|\$0\.50|\$5\.00|\(USD/;

test("recipe import screens do not show charges or currency units", () => {
  assert.doesNotMatch(recipeImportPage, visibleBillingCopy);
  assert.doesNotMatch(masterApprovalsPage, visibleBillingCopy);
  assert.match(recipeImportPage, /관리자 확인/);
  assert.match(masterApprovalsPage, /관리자 확인/);
});
