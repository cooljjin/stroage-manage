import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { URL } from "node:url";

const storyboardPath = new URL("../ios/App/App/Base.lproj/Main.storyboard", import.meta.url);

test("iOS bridge storyboard resolves AppViewController through its active target", async () => {
  const storyboard = await readFile(storyboardPath, "utf8");

  assert.match(
    storyboard,
    /customClass="AppViewController"\s+customModuleProvider="target"/,
    "the storyboard must not hard-code the original App module, because a separately named iOS target cannot load it",
  );
  assert.doesNotMatch(storyboard, /customModule="App"/);
});
