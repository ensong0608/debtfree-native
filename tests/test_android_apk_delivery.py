import tempfile
import unittest
import zipfile
from pathlib import Path
import subprocess
import sys

from scripts.android_apk_delivery import validate_bundle_entries, validate_manifest


VALID_MANIFEST = '''<manifest xmlns:android="http://schemas.android.com/apk/res/android">
  <application android:debuggable="false">
    <activity android:name=".MainActivity">
      <intent-filter>
        <action android:name="android.intent.action.MAIN" />
        <category android:name="android.intent.category.LAUNCHER" />
      </intent-filter>
    </activity>
  </application>
</manifest>'''


class AndroidApkDeliveryTests(unittest.TestCase):
    def test_accepts_bundle_and_non_debuggable_normal_launcher(self):
        validate_bundle_entries(["assets/index.android.bundle"], bundle_size=32)
        validate_manifest(VALID_MANIFEST, debuggable=False)

    def test_rejects_missing_or_empty_bundle(self):
        for entries, size in ((["assets/something-else"], 20), (["assets/index.android.bundle"], 0)):
            with self.subTest(entries=entries, size=size), self.assertRaises(ValueError):
                validate_bundle_entries(entries, size)

    def test_rejects_debuggable_or_development_launcher_manifests(self):
        with self.assertRaisesRegex(ValueError, "debuggable"):
            validate_manifest(VALID_MANIFEST, debuggable=True)
        dev_launcher = VALID_MANIFEST.replace("</application>",
            '<activity android:name="expo.modules.devlauncher.launcher.DevLauncherActivity" /></application>')
        with self.assertRaisesRegex(ValueError, "development launcher"):
            validate_manifest(dev_launcher, debuggable=False)

    def test_rejects_missing_launcher_activity(self):
        with self.assertRaisesRegex(ValueError, "normal MainActivity"):
            validate_manifest('<manifest><application /></manifest>', debuggable=False)

    def test_fixture_zip_contains_nonempty_embedded_bundle(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            fixture = Path(temporary_directory) / "fixture.apk"
            with zipfile.ZipFile(fixture, "w") as apk:
                apk.writestr("assets/index.android.bundle", b"standalone-js")
            with zipfile.ZipFile(fixture) as apk:
                validate_bundle_entries(apk.namelist(), apk.getinfo("assets/index.android.bundle").file_size)

    def test_cli_fails_missing_bundle_before_manifest_inspection(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            fixture = Path(temporary_directory) / "missing-bundle.apk"
            metadata = Path(temporary_directory) / "metadata.json"
            with zipfile.ZipFile(fixture, "w") as apk:
                apk.writestr("assets/other.bundle", b"not the app bundle")
            tool = Path(__file__).resolve().parents[1] / "scripts" / "android_apk_delivery.py"
            result = subprocess.run(
                [sys.executable, str(tool), "--apk", str(fixture), "--variant", "preview",
                 "--environment", "sandbox", "--source-commit", "fixture-commit", "--metadata", str(metadata)],
                capture_output=True, text=True, check=False,
            )
            self.assertEqual(result.returncode, 1)
            self.assertIn("missing the embedded assets/index.android.bundle", result.stderr)
            self.assertFalse(metadata.exists())


if __name__ == "__main__":
    unittest.main()
