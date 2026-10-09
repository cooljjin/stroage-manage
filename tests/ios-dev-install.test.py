import copy
import importlib.util
import json
from pathlib import Path
import plistlib
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]


class DevInstallTest(unittest.TestCase):
    def test_build_only_requires_device_and_uses_generic_ios_destination(self):
        path = ROOT / "scripts/install-ios-dev.py"
        spec = importlib.util.spec_from_file_location("installer", path)
        assert spec is not None and spec.loader is not None
        installer = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(installer)

        with self.assertRaises(SystemExit):
            installer.parse_args(["--build-only"])
        build_only = installer.parse_args(["--build-only", "--device", "offline-device"])
        regular = installer.parse_args(["--device", "online-device"])
        self.assertEqual(installer.build_destination(build_only), "generic/platform=iOS")
        self.assertEqual(installer.build_destination(regular), "id=online-device")

    def test_build_number_includes_settings_and_all_prior_artifact_suffixes(self):
        path = ROOT / "scripts/install-ios-dev.py"
        spec = importlib.util.spec_from_file_location("installer", path)
        assert spec is not None and spec.loader is not None
        installer = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(installer)

        build = installer.next_build_number(
            "110", None,
            ["developer-1.0.0-117", "developer-1.0.1-121.zip", "notes.txt"],
        )
        self.assertEqual(build, "122")

    def test_nfc_plugin_check_accepts_matching_debug_dylib(self):
        path = ROOT / "scripts/install-ios-dev.py"
        spec = importlib.util.spec_from_file_location("installer", path)
        assert spec is not None and spec.loader is not None
        installer = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(installer)

        with tempfile.TemporaryDirectory() as temporary:
            app = Path(temporary) / "Stockly Dev.app"
            app.mkdir()
            executable = app / "Stockly Dev"
            debug_dylib = app / "Stockly Dev.debug.dylib"
            executable.touch()
            debug_dylib.touch()
            (app / "Info.plist").write_bytes(plistlib.dumps({"CFBundleExecutable": executable.name}))

            def strings(command, binary):
                return b"NativeNfcConfirmationPlugin" if command == "strings" and binary == str(debug_dylib) else b"launcher stub"

            with patch.object(installer, "run", side_effect=strings):
                evidence = installer.verify_nfc_plugin(app)

        self.assertEqual(evidence, {
            "native_nfc_plugin_registered": True,
            "native_nfc_plugin_in_code_image": True,
            "native_nfc_code_image": "Stockly Dev.debug.dylib",
        })

    def test_offsite_manifest_records_artifact_hashes_and_verification(self):
        path = ROOT / "scripts/install-ios-dev.py"
        spec = importlib.util.spec_from_file_location("installer", path)
        assert spec is not None and spec.loader is not None
        installer = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(installer)

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            app = root / "Stockly Dev.app"
            app.mkdir()
            (app / "executable").write_bytes(b"signed-app")
            archive = root / "Stockly-Dev.zip"
            archive.write_bytes(b"signed-archive")
            manifest = root / "install-manifest.json"
            evidence = {"strict_codesign": True, "nfc_tag_entitlement": True}
            provenance = {"git_commit": "abc123", "worktree_dirty": True}

            result = installer.write_install_manifest(
                manifest, app, archive, "1.2.3", "122", "offline-device", evidence, provenance
            )

            self.assertEqual(json.loads(manifest.read_text()), result)
            self.assertEqual(result["application"], {
                "bundle_id": installer.BUNDLE, "version": "1.2.3", "build": "122"
            })
            self.assertEqual(result["target"]["device_udid"], "offline-device")
            self.assertEqual(result["verification"], evidence)
            self.assertEqual(len(result["artifact"]["archive_sha256"]), 64)
            self.assertEqual(len(result["artifact"]["app_tree_sha256"]), 64)

    def test_signed_install_contract_rejects_missing_settings(self):
        path = ROOT / "scripts/install-ios-dev.py"
        self.assertTrue(path.exists(), "missing fail-closed Dev installer")
        spec = importlib.util.spec_from_file_location("installer", path)
        assert spec is not None and spec.loader is not None
        installer = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(installer)
        info = {"CFBundleIdentifier": installer.BUNDLE, "CFBundleVersion": "117",
                "StocklyDevServerURL": installer.SERVER}
        signed = {"application-identifier": installer.APP_ID,
                  "com.apple.developer.associated-domains": [installer.DOMAIN],
                  "com.apple.developer.nfc.readersession.formats": ["TAG"], "get-task-allow": True}
        profile = {"Entitlements": copy.deepcopy(signed), "ProvisionedDevices": ["test-device"]}
        installer.verify_contract(info, signed, profile, "test-device", "117")
        for section, key, value in [
            ("info", "CFBundleIdentifier", "com.jinkim.storeinventory.poc"),
            ("info", "CFBundleVersion", "116"),
            ("info", "StocklyDevServerURL", "https://wrong.invalid"),
            ("signed", "com.apple.developer.associated-domains", ["applinks:stroage-manage.vercel.app"]),
            ("signed", "com.apple.developer.nfc.readersession.formats", []),
            ("signed", "get-task-allow", False),
            ("profile", "ProvisionedDevices", []),
            ("profile_ent", "get-task-allow", False),
            ("profile_ent", "application-identifier", "wrong-app"),
        ]:
            with self.subTest(section=section, key=key):
                i, s, p = copy.deepcopy((info, signed, profile))
                target = {"info": i, "signed": s, "profile": p, "profile_ent": p["Entitlements"]}[section]
                target[key] = value
                with self.assertRaises(ValueError):
                    installer.verify_contract(i, s, p, "test-device", "117")


if __name__ == "__main__":
    unittest.main()
