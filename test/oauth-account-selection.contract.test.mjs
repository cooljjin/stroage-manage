import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const authServicePath = new globalThis.URL("../src/services/auth/AuthService.ts", import.meta.url);

test("iOS Kakao login requires reauthentication while account linking keeps account selection", async () => {
  const authService = await readFile(authServicePath, "utf8");

  assert.match(
    authService,
    /function getOAuthQueryParams\(provider: Provider\) \{[\s\S]*provider === "google" \|\| provider === "kakao"[\s\S]*prompt: "select_account"/
  );
  assert.match(
    authService,
    /function getOAuthLoginQueryParams\(provider: Provider\) \{[\s\S]*provider === "kakao" && Capacitor\.getPlatform\(\) === "ios"[\s\S]*prompt: "login"[\s\S]*getOAuthQueryParams\(provider\)/
  );
  assert.match(
    authService,
    /signInWithOAuthProvider[\s\S]*queryParams: getOAuthLoginQueryParams\(provider\)/
  );
  assert.match(
    authService,
    /function getOAuthOptions\(provider: Provider\) \{[\s\S]*queryParams: getOAuthQueryParams\(provider\)/
  );
});
