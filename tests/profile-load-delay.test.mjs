import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { URL } from "node:url";

const appPath = new URL("../src/App.tsx", import.meta.url);
const profilesPath = new URL("../src/lib/profiles.ts", import.meta.url);

test("profile lookup errors keep the user out of the store connection fallback", async () => {
  const [app, profiles] = await Promise.all([
    readFile(appPath, "utf8"),
    readFile(profilesPath, "utf8")
  ]);

  assert.match(profiles, /return \{ profile: null, errorMessage: error\.message \};/);
  assert.match(app, /const \[profileLoadError, setProfileLoadError\] = useState\(""\);/);
  assert.match(app, /if \(profileLoadError\) \{[\s\S]*?인터넷 연결이 지연되고 있습니다\.[\s\S]*?다시 시도/);
  assert.ok(
    app.indexOf("if (profileLoadError)") < app.indexOf("if (!profile || !profile.store_id || profile.store_id === \"null\")"),
    "the connection fallback must only render after a confirmed missing profile"
  );
});
