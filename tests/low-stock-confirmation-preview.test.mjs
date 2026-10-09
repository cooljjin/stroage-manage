import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import test from "node:test";

const source = readFileSync(new URL("../src/pages/LowStockPage.tsx", import.meta.url), "utf8");

test("confirmation preview lists the same checked items used for submission", () => {
  const dialog = source.slice(source.indexOf("{confirmationModalOpen ? ("), source.indexOf("{confirmedModalOpen ? ("));
  assert.match(source, /const confirmCheckedItems = useMemo\(\(\) => lowStockItems\.filter\(\(item\) => item\.order_completed\)/);
  assert.match(source, /const rows = confirmCheckedItems\.map\(\(item\) => \(\{/);
  assert.match(dialog, /aria-label="컨펌 체크한 품목"/);
  assert.match(dialog, /confirmCheckedItems\.map\(\(item\) => \([\s\S]*?<li key=\{item\.id\} className="break-words">\{item\.name\}<\/li>/);
  assert.ok(dialog.indexOf("컨펌 체크한 품목") < dialog.indexOf(">메모<"));
  assert.match(dialog, /max-h-\[85dvh\][^"]*overflow-y-auto/);
});
