"""Development-signed Stockly Dev only; never exports or uploads an IPA."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import plistlib
import re
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
BUNDLE = "com.jinkim.stockly.dev"
APP_ID = "RQMBNM7XVV." + BUNDLE
DOMAIN = "applinks:stroage-manage.vercel.app?mode=developer"
SERVER = "https://macmini-1.tailc45cff.ts.net:8443"
BASE = Path.home() / "Stockly-Dev-Distributions"


def run(*args):
    return subprocess.check_output(args, cwd=ROOT, stderr=subprocess.PIPE)


def verify_contract(info, signed, profile, device, build):
    checks = {
        "Dev Bundle ID": info.get("CFBundleIdentifier") == BUNDLE,
        "build number": info.get("CFBundleVersion") == build,
        "Dev server": info.get("StocklyDevServerURL") == SERVER,
        "signed App ID": signed.get("application-identifier") == APP_ID,
        "developer Universal Links": signed.get("com.apple.developer.associated-domains") == [DOMAIN],
        "NFC TAG": signed.get("com.apple.developer.nfc.readersession.formats") == ["TAG"],
        "development signature": signed.get("get-task-allow") is True,
        "profile App ID": profile.get("Entitlements", {}).get("application-identifier") == APP_ID,
        "development profile": profile.get("Entitlements", {}).get("get-task-allow") is True,
        "target iPhone profile": device in profile.get("ProvisionedDevices", []),
    }
    for label, valid in checks.items():
        if not valid:
            raise ValueError(f"Installation blocked: {label}")
    return {label: True for label in checks}


def verify_app(app, device, build):
    run("codesign", "--verify", "--deep", "--strict", str(app))
    info = plistlib.loads((app / "Info.plist").read_bytes())
    signed = plistlib.loads(run("codesign", "-d", "--entitlements", ":-", str(app)))
    profile = plistlib.loads(run("security", "cms", "-D", "-i", str(app / "embedded.mobileprovision")))
    return {"strict_codesign": True, **verify_contract(info, signed, profile, device, build)}


def coredevice(out, *args):
    target = out / "device.json"
    run("xcrun", "devicectl", *args, "--json-output", str(target))
    return json.loads(target.read_text())["result"]


def installed(out, device):
    apps = coredevice(out, "device", "info", "apps", "--device", device)["apps"]
    return next((a for a in apps if a.get("bundleIdentifier") == BUNDLE), None)


def tree_hash(path):
    return {str(p.relative_to(path)): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in path.rglob("*") if p.is_file() and p.name not in ("cordova.js", "cordova_plugins.js")}


def tree_digest(path):
    data = json.dumps(tree_hash(path), sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(data).hexdigest()


def file_sha256(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def next_build_number(current, installed_app, artifacts):
    values = [int(current), int((installed_app or {}).get("bundleVersion", "0"))]
    for artifact in artifacts:
        match = re.search(r"-(\d+)(?:\.[A-Za-z]+)?$", Path(artifact).name)
        if match:
            values.append(int(match.group(1)))
    return str(max(values) + 1)


def build_destination(args):
    return "generic/platform=iOS" if args.build_only else f"id={args.device}"


def write_install_manifest(path, app, archive, version, build, device, evidence, provenance):
    path = Path(path)
    app = Path(app)
    archive = Path(archive)
    manifest = {
        "schema_version": 1,
        "application": {"bundle_id": BUNDLE, "version": version, "build": build},
        "target": {"device_udid": device},
        "artifact": {
            "app_path": str(app.resolve()),
            "archive_path": str(archive.resolve()),
            "manifest_path": str(path.resolve()),
            "app_tree_sha256": tree_digest(app),
            "archive_sha256": file_sha256(archive),
        },
        "provenance": provenance,
        "verification": evidence,
    }
    path.write_text(json.dumps(manifest, indent=2) + "\n")
    return manifest


def verify_nfc_plugin(app):
    controller = ROOT / "ios/App/App/AppViewController.swift"
    if "registerPluginInstance(NativeNfcConfirmationPlugin())" not in controller.read_text():
        raise ValueError("Native NFC confirmation plugin is not registered")
    info = plistlib.loads((app / "Info.plist").read_bytes())
    executable = app / info["CFBundleExecutable"]
    if not executable.is_file():
        raise ValueError("Native app executable is missing")
    code_images = (executable, app / f"{executable.name}.debug.dylib")
    for code_image in code_images:
        if code_image.is_file() and b"NativeNfcConfirmationPlugin" in run("strings", str(code_image)):
            return {
                "native_nfc_plugin_registered": True,
                "native_nfc_plugin_in_code_image": True,
                "native_nfc_code_image": code_image.name,
            }
    raise ValueError("Native NFC confirmation plugin is missing from app executable and debug dylib")


def source_provenance():
    inputs = [
        "ios/App/App.xcodeproj/project.pbxproj",
        "ios/App/App/AppViewController.swift",
        "ios/App/App/AppDev.entitlements",
        "ios/App/App/Info-Dev.plist",
        "package-lock.json",
        "package.json",
        "public/apple-app-site-association",
        "src/lib/nativeAttendanceNfc.ts",
        "src/lib/productNfc.ts",
        "vite.config.ts",
    ]
    return {
        "git_commit": run("git", "rev-parse", "HEAD").decode().strip(),
        "worktree_dirty": bool(run("git", "status", "--porcelain", "--untracked-files=all").strip()),
        "installer_sha256": file_sha256(Path(__file__)),
        "input_sha256": {name: file_sha256(ROOT / name) for name in inputs if (ROOT / name).is_file()},
    }


def install(args):
    BASE.mkdir(exist_ok=True)
    # ponytail: one local install lock; separate only if independent devices need concurrency.
    with (BASE / "developer-install.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        with tempfile.TemporaryDirectory(prefix="stockly-install-") as temporary:
            scratch = Path(temporary)
            if args.build_only:
                device = args.device
                if not device:
                    raise ValueError("--build-only requires --device <UDID>")
                before = None
            else:
                devices = coredevice(scratch, "list", "devices")["devices"]
                phones = [d["properties"]["hardware"]["udid"] for d in devices
                          if d["properties"]["hardware"].get("reality") == "physical"
                          and d["properties"]["hardware"].get("deviceType") == "iPhone"
                          and d["properties"]["connection"].get("pairingState") == "paired"]
                device = args.device or (phones[0] if len(phones) == 1 else None)
                if not device or device not in phones:
                    raise ValueError("Select one paired physical iPhone with --device <UDID>")
                before = installed(scratch, device)
            settings = json.loads(run("xcodebuild", "-workspace", "ios/App/App.xcworkspace", "-scheme", "App",
                                      "-configuration", "Debug", "-sdk", "iphoneos", "-showBuildSettings", "-json"))
            settings = next(s["buildSettings"] for s in settings if s["target"] == "App")
            if settings["PRODUCT_BUNDLE_IDENTIFIER"] != BUNDLE or settings["DEVELOPMENT_TEAM"] != "RQMBNM7XVV":
                raise ValueError("Unexpected Xcode Dev identity")
            prior = [p.name for p in BASE.glob("developer-*")]
            build = next_build_number(settings["CURRENT_PROJECT_VERSION"], before, prior)
            out = BASE / f"developer-{settings['MARKETING_VERSION']}-{build}"
            out.mkdir(mode=0o700)
            shared = ROOT / "ios/App/App/AppDev.entitlements"
            original = shared.read_bytes()
            entitlement = plistlib.loads(original)
            entitlement["com.apple.developer.associated-domains"] = [DOMAIN]
            override = out / "AppDevDeveloper.entitlements"
            override.write_bytes(plistlib.dumps(entitlement))
            # Check staging separation without exposing any environment values.
            env_check = """import {loadEnv} from 'vite';
const s=loadEnv('staging',process.cwd(),'VITE_'), p=loadEnv('production',process.cwd(),'VITE_');
for(const k of ['VITE_SUPABASE_URL','VITE_SUPABASE_ANON_KEY'])
if(!s[k]||!p[k]||s[k]===p[k])throw Error('Separate staging values required');
"""
            run("node", "--input-type=module", "-e", env_check)
            run("curl", "--fail", "--silent", "--show-error", "--max-time", "15", SERVER + "/@vite/client")
            with (out / "build.log").open("wb") as log:
                for command in [
                    ["npm", "run", "build", "--", "--mode", "staging"],
                    ["npx", "cap", "copy", "ios"],
                    ["xcodebuild", "-workspace", "ios/App/App.xcworkspace", "-scheme", "App", "-configuration", "Debug",
                     "-sdk", "iphoneos", "-destination", build_destination(args), "-derivedDataPath", str(out / "DerivedData"),
                     f"CURRENT_PROJECT_VERSION={build}", f"CODE_SIGN_ENTITLEMENTS={override}", "-allowProvisioningUpdates", "build"],
                ]:
                    print(f"Running {command[0]} (log: {out / 'build.log'})", flush=True)
                    subprocess.run(command, cwd=ROOT, stdout=log, stderr=log, check=True)
            app = out / "DerivedData/Build/Products/Debug-iphoneos/Stockly Dev.app"
            evidence = verify_app(app, device, build)
            if shared.read_bytes() != original:
                raise ValueError("Shared distribution entitlement changed")
            evidence["shared_release_entitlements_unchanged"] = True
            if tree_hash(ROOT / "dist") != tree_hash(app / "public"):
                raise ValueError("Native web bundle differs from current staging build")
            evidence["staging_web_assets_match_dist"] = True
            run("node", "--input-type=module", "-e", env_check + """
const {readFileSync}=await import('node:fs');
const h=readFileSync('dist/index.html','utf8');
const e=h.match(/<script[^>]+src="([^"?]+\\.js)/)?.[1];
if(!e)throw Error('Missing bundle entry');
const b=readFileSync('dist/'+e.replace(/^\\//,''),'utf8');
if(!b.includes(s.VITE_SUPABASE_URL)||!b.includes(s.VITE_SUPABASE_ANON_KEY)||b.includes(p.VITE_SUPABASE_URL))
throw Error('Staging bundle isolation failed');
""")
            evidence["staging_bundle_isolated"] = True
            evidence["development_server_reachable"] = True
            if args.build_only:
                evidence.update(verify_nfc_plugin(app))
                archive = out / f"Stockly-Dev-{settings['MARKETING_VERSION']}-{build}.zip"
                run("ditto", "-c", "-k", "--sequesterRsrc", "--keepParent", str(app), str(archive))
                manifest = out / "install-manifest.json"
                write_install_manifest(
                    manifest, app, archive, settings["MARKETING_VERSION"], build, device, evidence,
                    source_provenance(),
                )
                print(f"Built and verified Stockly Dev {settings['MARKETING_VERSION']} ({build}); no device installation performed.")
                print(f"App: {app}\nTransfer archive: {archive}\nInstall manifest: {manifest}")
                return
            current = installed(scratch, device)
            if int((current or {}).get("bundleVersion", "0")) >= int(build):
                raise ValueError("Another install advanced the build; retry, no downgrade allowed")
            run("xcrun", "devicectl", "device", "install", "app", "--device", device, str(app))
            after = installed(scratch, device)
            if not after or after.get("bundleVersion") != build:
                raise ValueError("Installed build readback failed")
            run("xcrun", "devicectl", "device", "process", "launch", "--terminate-existing", "--activate", "--device", device, BUNDLE)
            processes = coredevice(scratch, "device", "info", "processes", "--device", device)["runningProcesses"]
            if not any("Stockly%20Dev.app/Stockly%20Dev" in p.get("executable", "") for p in processes):
                raise ValueError("App launch process not found")
            print(f"Installed and launched Stockly Dev {after['version']} ({build}); developer NFC entitlement verified.")


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--device", help="Paired physical iPhone UDID; auto-selects when exactly one is paired")
    parser.add_argument("--build-only", action="store_true", help="Build a signed transferable app without querying or installing a device")
    parser.add_argument("--verify-only", type=Path, help="Validate an existing signed .app without building or installing")
    args = parser.parse_args(argv)
    if args.build_only and not args.device:
        parser.error("--build-only requires --device <UDID>")
    if args.build_only and args.verify_only:
        parser.error("--build-only cannot be combined with --verify-only")
    return args


if __name__ == "__main__":
    args = parse_args()
    try:
        if args.verify_only:
            if not args.device:
                parser.error("--verify-only requires --device")
            info = plistlib.loads((args.verify_only / "Info.plist").read_bytes())
            verify_app(args.verify_only, args.device, info["CFBundleVersion"])
            print("Signed Dev installation contract verified; no installation performed.")
        else:
            install(args)
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        print(f"Stopped: {error}")
        raise SystemExit(1)
