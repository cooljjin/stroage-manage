import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import process from "node:process";
import test from "node:test";

// Execute the app's actual SceneDelegate and installed Capacitor proxy with
// UIKit boundary doubles. No device, network, login, or database is involved.
const scene = readFileSync("ios/App/App/SceneDelegate.swift", "utf8").replace(/^import (UIKit|Capacitor)\n/gm, "");
const proxy = readFileSync("node_modules/@capacitor/ios/Capacitor/Capacitor/CAPSceneDelegateProxy.swift", "utf8").replace(/^@objc\(CAPSceneDelegateProxy\)\n/m, "").replace(/\bpublic /g, "");
const stubs = `
import Foundation
let NSUserActivityTypeBrowsingWeb = "web"
class UIResponder {}
protocol UIWindowSceneDelegate {}
protocol UISceneDelegate {}
class UIScene {
    struct ConnectionOptions {
        var urlContexts: Set<UIOpenURLContext> = []
        var userActivities: Set<NSUserActivity> = []
    }
    struct OpenURLOptions {
        var sourceApplication: String? = nil
        var annotation: Any? = nil
        var openInPlace = false
    }
}
class UIWindowScene: UIScene {}
class UISceneSession {}
class NSUserActivity: NSObject {
    var activityType = NSUserActivityTypeBrowsingWeb
    var webpageURL: URL?
}
class UIOpenURLContext: NSObject {
    var url: URL
    var options = UIScene.OpenURLOptions()
    init(_ url: URL) { self.url = url }
}
class UIApplication {
    struct OpenURLOptionsKey: Hashable {
        static let sourceApplication = Self()
        static let annotation = Self()
        static let openInPlace = Self()
    }
}
extension Notification.Name {
    static let capacitorSceneWillConnect = Self("connect")
    static let capacitorViewDidAppear = Self("appear")
    static let capacitorOpenURL = Self("url")
    static let CDVPluginHandleOpenURL = Self("cordova")
    static let capacitorSceneOpenURL = Self("scene-url")
    static let capacitorOpenUniversalLink = Self("universal")
    static let capacitorSceneOpenUniversalLink = Self("scene-universal")
}
class ApplicationDelegateProxy {
    static let shared = ApplicationDelegateProxy()
    var lastURL: URL?
}
class AppViewController {}
class UIWindow {
    var rootViewController: AppViewController?
    init(windowScene: UIWindowScene) {}
    func makeKeyAndVisible() {
        // UIKit is allowed to deliver the initial appearance immediately.
        NotificationCenter.default.post(name: .capacitorViewDidAppear, object: nil)
    }
}
`;

for (const kind of ["product", "attendance", "scheme", "ordinary"]) {
  test(`iOS cold ${kind} launch retains its URL when the first view appears immediately`, () => {
    const dir = mkdtempSync(join(process.env.TMPDIR, "stockly-cold-link-"));
    try {
      const url = kind === "scheme" ? "com.jinkim.stockly.dev://auth/callback?code=fixture" :
        `https://stockly.example/${kind === "product" ? "nfc/dev/product/8f14e45f-ea4b-4f03-a20b-123456789abc" : "attendance/dev/tag/fixture_token"}`;
      const fixture = `
let delegate = SceneDelegate()
let scene = UIWindowScene()
var options = UIScene.ConnectionOptions()
let url = URL(string: "${url}")!
${kind === "scheme" ? "options.urlContexts = [UIOpenURLContext(url)]" : kind === "ordinary" ? "" : "let activity = NSUserActivity(); activity.webpageURL = url; options.userActivities = [activity]"}
var deliveries = 0
let observer = NotificationCenter.default.addObserver(forName: ${kind === "scheme" ? ".capacitorOpenURL" : ".capacitorOpenUniversalLink"}, object: nil, queue: nil) { _ in deliveries += 1 }
delegate.scene(scene, willConnectTo: UISceneSession(), options: options)
print(ApplicationDelegateProxy.shared.lastURL?.absoluteString ?? "none")
print(deliveries)
`;
      const path = join(dir, "main.swift");
      writeFileSync(path, stubs + proxy + scene + fixture);
      const lines = execFileSync("swift", ["-swift-version", "5", path], { encoding: "utf8" }).trim().split("\n");
      assert.equal(lines[0], kind === "ordinary" ? "none" : url, "Cold NFC/auth URL was lost before JS getLaunchUrl could read it");
      assert.equal(lines[1], kind === "ordinary" ? "0" : "1", "Launch must be delivered once");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
