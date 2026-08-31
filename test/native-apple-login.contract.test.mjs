import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const authServicePath = new globalThis.URL("../src/services/auth/AuthService.ts", import.meta.url);
const nativeApplePath = new globalThis.URL("../src/lib/nativeAppleSignIn.ts", import.meta.url);
const viewControllerPath = new globalThis.URL("../ios/App/App/AppViewController.swift", import.meta.url);

test("iOS Apple login uses native AuthenticationServices and exchanges its identity token with Supabase", async () => {
  const [authService, nativeApple, nativePlugin] = await Promise.all([
    readFile(authServicePath, "utf8"),
    readFile(nativeApplePath, "utf8"),
    readFile(viewControllerPath, "utf8")
  ]);

  assert.match(authService, /loginWithApple\(\)\s*\{[\s\S]*signInWithNativeApple\(\)/);
  assert.match(authService, /supabase\.auth\.signInWithIdToken\(\{[\s\S]*provider:\s*"apple"/);
  assert.match(authService, /await supabase\.auth\.updateUser\(/);
  assert.doesNotMatch(authService, /if \(error\) return \{ data: result\.data, error \}/, "profile metadata storage must not turn an established Apple session into a failed login");
  assert.doesNotMatch(
    authService,
    /loginWithApple\(\)\s*\{\s*return signInWithOAuthProvider\("apple"\);\s*\}/,
    "native iOS Apple login must not use the browser OAuth helper"
  );
  assert.match(nativeApple, /registerPlugin<NativeAppleSignInPlugin>\("NativeAppleSignIn"\)/);
  assert.match(nativeApple, /crypto\.randomUUID\(\)/);
  assert.match(nativeApple, /crypto\.subtle\.digest\("SHA-256"/);
  assert.match(nativeApple, /authorize\(\{ nonce: hashedNonce \}\)/);
  assert.match(authService, /const existingMetadata = result\.data\.user\.user_metadata \?\? \{\}/);
  assert.match(authService, /if \(!existingMetadata\.full_name && fullName\)/);
  assert.match(authService, /async closeNativeAuthBrowser\(\) \{[\s\S]*await Browser\.close\(\)/);
  assert.match(nativePlugin, /DispatchQueue\.main\.async/);
  assert.match(nativePlugin, /ASAuthorizationAppleIDProvider/);
  assert.match(nativePlugin, /request\.nonce/);
  assert.match(nativePlugin, /didCompleteWithAuthorization authorization: ASAuthorization\)/);
  assert.match(nativePlugin, /registerPluginInstance\(NativeAppleSignInPlugin\(\)\)/);
});
