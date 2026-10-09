import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const ios = 'ios/App/App/';

test('every iOS app target launches an AppViewController scene', () => {
  for (const name of ['Info-Dev.plist', 'Info.plist', 'Info-Staff.plist']) {
    const plist = JSON.parse(execFileSync('plutil', ['-convert', 'json', '-o', '-', ios + name]));
    const scenes = plist.UIApplicationSceneManifest?.UISceneConfigurations?.UIWindowSceneSessionRoleApplication;
    assert.equal(scenes?.[0]?.UISceneDelegateClassName, '$(PRODUCT_MODULE_NAME).SceneDelegate', name);
  }
  const delegate = readFileSync(ios + 'SceneDelegate.swift', 'utf8');
  assert.match(delegate, /AppViewController/);
  assert.match(delegate, /SceneDelegateProxy\.shared\.scene/);
  const project = readFileSync('ios/App/App.xcodeproj/project.pbxproj', 'utf8');
  assert.equal((project.match(/SceneDelegate\.swift in Sources \*\//g) || []).length, 4);
});
