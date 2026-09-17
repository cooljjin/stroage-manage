import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const scriptPath = join(dirname(fileURLToPath(import.meta.url)), "../scripts/ios-testflight-api-key.sh");
const script = await readFile(scriptPath, "utf8");
const deploymentDoc = await readFile(join(dirname(scriptPath), "../docs/testflight-api-key-deployment.md"), "utf8");

test("iOS TestFlight script is pinned to the development channel", () => {
  assert.match(script, /workspace=.*ios\/App\/App\.xcworkspace/);
  assert.match(script, /scheme="App"/);
  assert.match(script, /expected_bundle_id="com\.jinkim\.stockly"/);
  assert.match(script, /staff_bundle_id="com\.jinkim\.storeinventory\.poc"/);
  assert.match(script, /expected_team_id="RQMBNM7XVV"/);
  assert.match(script, /expected_build="\$\{STOCKLY_IOS_EXPECTED_BUILD:-81\}"/);
  assert.match(script, /assert_build_setting "PRODUCT_BUNDLE_IDENTIFIER" "\$expected_bundle_id"/);
  assert.match(script, /assert_build_setting "CURRENT_PROJECT_VERSION" "\$expected_build"/);
});

test("TestFlight web assets use the validated staging preparation path", () => {
  assert.match(script, /npm run ios:prepare:staging/);
  assert.doesNotMatch(script, /npm run build\b/);
  assert.doesNotMatch(script, /npx cap sync ios/);
});

test("deployment documentation matches Xcode build 81 and safe staging preparation", () => {
  assert.match(deploymentDoc, /Build: `81`/);
  assert.match(deploymentDoc, /npm run ios:prepare:staging/);
  assert.doesNotMatch(deploymentDoc, /`npm run build`/);
  assert.doesNotMatch(deploymentDoc, /`npx cap sync ios`/);
});

test("upload is opt-in and uses App Store Connect API key authentication", () => {
  assert.match(script, /upload=false/);
  assert.match(script, /--upload\)/);
  assert.match(script, /ASC_API_KEY_PATH/);
  assert.match(script, /ASC_API_KEY_ID/);
  assert.match(script, /ASC_API_ISSUER_ID/);
  assert.match(script, /xcrun altool/);
  assert.match(script, /--api-key "\$ASC_API_KEY_ID"/);
  assert.match(script, /--api-issuer "\$ASC_API_ISSUER_ID"/);
  assert.doesNotMatch(script, /set -x/);
});

test("archive/export validates bundle metadata and code signing", () => {
  assert.match(script, /xcodebuild[\s\S]*-archivePath "\$archive_path"[\s\S]*archive/);
  assert.match(script, /xcodebuild[\s\S]*-exportArchive/);
  assert.match(script, /codesign --verify --deep --strict/);
  assert.match(script, /CFBundleIdentifier/);
  assert.match(script, /CFBundleShortVersionString/);
  assert.match(script, /CFBundleVersion/);
  assert.match(script, /TeamIdentifier=\$expected_team_id/);
});
