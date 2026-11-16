#!/usr/bin/env python3
"""Validate a standalone Android APK and write its delivery provenance."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable


DEV_LAUNCHER_COMPONENTS = (
    "expo.modules.devlauncher.launcher.DevLauncherActivity",
    "expo.modules.devlauncher.compose.AuthActivity",
    "expo.modules.devlauncher.launcher.errors.DevLauncherErrorActivity",
)


def validate_bundle_entries(entries: Iterable[str], bundle_size: int) -> None:
    if "assets/index.android.bundle" not in set(entries):
        raise ValueError("APK is missing the embedded assets/index.android.bundle.")
    if bundle_size <= 0:
        raise ValueError("APK contains an empty assets/index.android.bundle.")


def validate_manifest(manifest_text: str, debuggable: bool) -> None:
    if debuggable:
        raise ValueError("APK manifest is debuggable; a Metro-free installable artifact is required.")
    for component in DEV_LAUNCHER_COMPONENTS:
        if component in manifest_text:
            raise ValueError(f"APK manifest includes the development launcher component: {component}.")
    if "MainActivity" not in manifest_text or "android.intent.action.MAIN" not in manifest_text or \
            "android.intent.category.LAUNCHER" not in manifest_text:
        raise ValueError("APK manifest does not declare the app's normal MainActivity launcher entry.")


def find_apkanalyzer() -> str | None:
    configured = os.environ.get("APKANALYZER")
    if configured and Path(configured).is_file():
        return configured
    found = shutil.which("apkanalyzer")
    if found:
        return found
    for sdk_root in (os.environ.get("ANDROID_HOME"), os.environ.get("ANDROID_SDK_ROOT")):
        if sdk_root:
            candidate = Path(sdk_root) / "cmdline-tools" / "latest" / "bin" / "apkanalyzer"
            if candidate.is_file():
                return str(candidate)
            candidate = Path(sdk_root) / "tools" / "bin" / "apkanalyzer"
            if candidate.is_file():
                return str(candidate)
    return None


def inspect_manifest(apk: Path) -> tuple[str, bool]:
    analyzer = find_apkanalyzer()
    if analyzer:
        manifest = subprocess.run(
            [analyzer, "manifest", "print", str(apk)], check=True, capture_output=True, text=True
        ).stdout
        debuggable_output = subprocess.run(
            [analyzer, "manifest", "debuggable", str(apk)], check=True, capture_output=True, text=True
        ).stdout.strip().lower()
        if debuggable_output not in ("true", "false"):
            raise ValueError(f"Unexpected APK Analyzer debuggable result: {debuggable_output!r}.")
        return manifest, debuggable_output == "true"

    aapt = shutil.which("aapt")
    if not aapt:
        raise RuntimeError("Android APK Analyzer and aapt are unavailable; cannot verify the compiled manifest.")
    xmltree = subprocess.run(
        [aapt, "dump", "xmltree", str(apk), "AndroidManifest.xml"], check=True, capture_output=True, text=True
    ).stdout
    badging = subprocess.run([aapt, "dump", "badging", str(apk)], check=True, capture_output=True, text=True).stdout
    return xmltree, "application-debuggable" in badging


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as apk_file:
        for chunk in iter(lambda: apk_file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def source_commit(explicit: str | None) -> str:
    value = explicit or os.environ.get("GITHUB_SHA")
    if not value:
        value = subprocess.run(["git", "rev-parse", "HEAD"], check=True, capture_output=True, text=True).stdout.strip()
    if not value:
        raise ValueError("Cannot determine the source commit for APK provenance.")
    return value


def validate_and_write_metadata(apk: Path, variant: str, environment: str, commit: str, metadata: Path) -> dict:
    if not apk.is_file():
        raise FileNotFoundError(f"APK not found: {apk}")
    with zipfile.ZipFile(apk) as archive:
        names = archive.namelist()
        try:
            bundle_size = archive.getinfo("assets/index.android.bundle").file_size
        except KeyError:
            bundle_size = 0
        validate_bundle_entries(names, bundle_size)

    manifest_text, debuggable = inspect_manifest(apk)
    validate_manifest(manifest_text, debuggable)
    record = {
        "artifact": apk.name,
        "sha256": sha256_file(apk),
        "sourceCommit": commit,
        "buildVariant": variant,
        "appEnvironment": environment,
        "standaloneBundle": "assets/index.android.bundle",
        "debuggable": False,
        "developmentLauncher": False,
        "validatedAtUtc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }
    metadata.parent.mkdir(parents=True, exist_ok=True)
    metadata.write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8")
    return record


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apk", required=True, type=Path)
    parser.add_argument("--variant", required=True, choices=("preview",))
    parser.add_argument("--environment", required=True, choices=("sandbox",))
    parser.add_argument("--source-commit")
    parser.add_argument("--metadata", required=True, type=Path)
    args = parser.parse_args()
    try:
        record = validate_and_write_metadata(
            args.apk, args.variant, args.environment, source_commit(args.source_commit), args.metadata
        )
    except (OSError, ValueError, RuntimeError, subprocess.CalledProcessError, zipfile.BadZipFile) as error:
        print(f"APK delivery validation failed: {error}", file=sys.stderr)
        return 1
    print(f"Validated {record['artifact']} ({record['sha256']}) as {record['buildVariant']} / {record['appEnvironment']}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
