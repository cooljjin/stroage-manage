import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const storyboardPath = new globalThis.URL("../ios/App/App/Base.lproj/Main.storyboard", import.meta.url);

test("iOS bridge controller resolves from the active target module", async () => {
  const storyboard = await readFile(storyboardPath, "utf8");

  assert.match(
    storyboard,
    /customClass="AppViewController" customModuleProvider="target"/,
    "the storyboard must resolve AppViewController from each target's Swift module"
  );
  assert.doesNotMatch(storyboard, /customModule="App"/);
});
