import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import test from "node:test";

const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const topMenu = readFileSync(new URL("../src/components/TopMenu.tsx", import.meta.url), "utf8");

test("Stockly logo menu anchors to the left and the menu button remains right-anchored", () => {
  assert.match(app, /const \[logoMenuOpen, setLogoMenuOpen\] = useState\(false\);/);
  assert.match(app, /<TopMenu\s+open=\{logoMenuOpen\}\s+align="left"/);
  assert.match(app, /<TopMenu\s+open=\{menuOpen\}\s+role=\{profileRole\}/);
  assert.match(topMenu, /align\?: "left" \| "right"/);
  assert.match(topMenu, /align === "left" \? "left-0" : "right-0"/);
});
