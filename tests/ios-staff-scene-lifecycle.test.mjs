import assert from "node:assert/strict"
import test from "node:test"
import { readFile } from "node:fs/promises"

const app = new URL("../ios/App/App/", import.meta.url)

test("staff live-reload build keeps its UIKit scene lifecycle", async () => {
  const [plist, delegate, project] = await Promise.all([
    readFile(new URL("Info-Staff.plist", app), "utf8"),
    readFile(new URL("SceneDelegate.swift", app), "utf8"),
    readFile(new URL("../App.xcodeproj/project.pbxproj", app), "utf8")
  ])

  assert.match(plist, /<key>UIApplicationSceneManifest<\/key>/)
  assert.match(plist, /<string>\$\(PRODUCT_MODULE_NAME\)\.SceneDelegate<\/string>/)
  assert.match(delegate, /class SceneDelegate: UIResponder, UIWindowSceneDelegate/)
  assert.match(delegate, /window\?\.rootViewController = AppViewController\(\)/)
  const sourcePhases = project.match(/files = \([\s\S]*?\n\t\t\};/g) || []
  assert.equal(sourcePhases.filter(phase => phase.includes("SceneDelegate.swift in Sources")).length, 2)
})
