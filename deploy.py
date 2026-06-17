#!/usr/bin/env python3
"""
project_deploy_template.py

Copy this file into your project as `deploy.py` (or deploy_contabo.py).
Customize the constants at the top for your project.

Usage:
  1. Build your project:  npm run build   (or python build, etc.)
  2. python deploy.py

This script contacts https://storage.noahcohn.com (your Contabo storage manager)
to upload your entire build as a single zip archive.  The server extracts it and
pushes all files over one persistent SFTP connection — much faster than uploading
files individually.

Actual FTP/SFTP credentials never leave the VPS.

Requirements:
  pip install requests
"""

import io
import os
import re
import sys
import zipfile
from pathlib import Path
from typing import Optional

import requests

# Patterns that identify placeholder / template values — not real keys.
_PLACEHOLDER_PATTERNS = [
    re.compile(r'^your[_-]?(google[_-]?)?maps[_-]?api[_-]?key', re.I),
    re.compile(r'^YOUR_MAPS_API_KEY$'),
    re.compile(r'^placeholder', re.I),
    re.compile(r'^<.*>$'),
    re.compile(r'replace', re.I),
    re.compile(r'^AIzaSy-placeholder', re.I),
]


def _is_placeholder(key: str) -> bool:
    if not key:
        return True
    return any(p.search(key) for p in _PLACEHOLDER_PATTERNS)


def _validate_build_index(build_path: Path) -> None:
    """Reject builds whose index.html looks like an unprocessed CRA template."""
    index_html = build_path / "index.html"
    if not index_html.is_file():
        print(f"\nERROR: {index_html} is missing. Run 'npm run build' first.")
        sys.exit(1)

    content = index_html.read_text(encoding="utf-8", errors="replace")
    problems: list[str] = []
    if "%PUBLIC_URL%" in content:
        problems.append("contains unprocessed %PUBLIC_URL% (public/index.html was deployed instead of build/index.html)")
    if "static/js/main" not in content:
        problems.append("does not reference static/js/main.*.js (React bundle will never load)")

    if problems:
        print("\n" + "!" * 70)
        print("  ERROR: build/index.html is not safe to deploy:")
        for item in problems:
            print(f"    - {item}")
        print("  Fix: run 'npm run build' and deploy the build/ directory output.")
        print("!" * 70 + "\n")
        sys.exit(1)

    print("  build/index.html looks valid (main JS bundle present, no %PUBLIC_URL%).")


def _validate_maps_key(key: str) -> None:
    """Warn loudly if key looks wrong; optionally do a live probe."""
    if not key or _is_placeholder(key):
        print("\n" + "!" * 70)
        print("  WARNING: MAPS_API_KEY is empty or a placeholder value.")
        print("  The deployed app will show 'This page can't load Google Maps correctly'.")
        print("  Set a real key:  MAPS_API_KEY=AIzaSy... python deploy.py")
        print("!" * 70 + "\n")
        return

    if not re.match(r'^AIzaSy[A-Za-z0-9_-]{33}$', key):
        print(f"\nWARNING: MAPS_API_KEY doesn't match the expected AIzaSy... format (length {len(key)}).")
        print("  Double-check the key is correct before deploying.\n")
        return

    # Quick live probe: fetch the Maps JS bootstrap and look for auth error markers.
    # This catches: billing disabled, API not enabled, key entirely invalid.
    # It does NOT catch referrer restrictions (those only fire in a browser with
    # a matching Origin/Referer header) — verify those manually in GCP Console.
    print(f"  Probing Maps JS API with key {key[:8]}...{key[-4:]} (checks billing & API-enabled)…", end=" ", flush=True)
    try:
        resp = requests.get(
            "https://maps.googleapis.com/maps/api/js",
            params={"key": key, "v": "weekly"},
            timeout=10,
            headers={"User-Agent": "deploy-preflight/1.0"},
        )
        body = resp.text
        if resp.status_code != 200:
            print(f"FAIL (HTTP {resp.status_code})")
            print("  WARNING: Maps JS API returned non-200 — key may be invalid or APIs not enabled.")
        elif any(marker in body for marker in ("InvalidKey", "MapsInvalidKey", "AuthFailure", "ApiNotActivatedMapError")):
            print("FAIL (auth/activation error in response)")
            print("  WARNING: Maps JS API returned an auth or activation error.")
            print("  Check: key validity, Maps JS API enabled, billing active.")
        else:
            print("OK")
            print("  NOTE: Referrer restrictions cannot be verified from a script.")
            print("        Confirm test.1ink.us and go.1ink.us are in the key's allowlist in GCP Console.")
    except Exception as exc:
        print(f"SKIP (network error: {exc})")

# ============================================================
# PER-PROJECT CONFIGURATION - EDIT THESE
# ============================================================
PROJECT_NAME: str = 'streetview'
BUILD_DIR: str = 'build'
CONTABO_BASE_URL: str = "https://storage.noahcohn.com"
DEPLOY_FOLDER: str = ""  # override remote target folder; empty = use PROJECT_NAME

# Optional deploy token (recommended for security).
# Set via environment: export DEPLOY_TOKEN="your_long_token_from_vps_env"
DEPLOY_TOKEN: Optional[str] = "6de44dca5425348f2e2ef9456fc820bfe56a5ace68bddeb6da4a1c2a9d9cadc0"

# Maps API key injection for runtime config (supports "MAPS_API_KEY=... python deploy.py"
# even with the current bundle-upload mechanism). This directly addresses repeated
# map loading failures after deploys (see #89, #84).
MAPS_API_KEY: Optional[str] = os.environ.get("MAPS_API_KEY", "").strip() or None
# Sentinel string in src/App.tsx — deploy.py replaces it inside static/js/*.js bundles
# (same delivery model as go.1ink.us, which bakes the key into main.js).
MAPS_KEY_SENTINEL = "__RUNTIME_MAPS_KEY_SENTINEL__"
# ============================================================


def _inject_maps_key_into_bundle(data: bytes, key: str) -> bytes:
    """Replace quoted deploy sentinel literals with the real Maps API key.

    IMPORTANT: only replace quoted strings like "__RUNTIME_MAPS_KEY_SENTINEL__".
    A global replace also corrupts the placeholder regex /^__RUNTIME_MAPS_KEY_SENTINEL__$/
    into /^AIzaSy...$/ which then rejects the real key as a 'placeholder'.
    Also ensure a window.MAPS_API_KEY assignment exists near the top for
    maximum compatibility (belt-and-suspenders).
    """
    quoted = (
        f'"{MAPS_KEY_SENTINEL}"'.encode("utf-8"),
        f"'{MAPS_KEY_SENTINEL}'".encode("utf-8"),
    )
    patched = data
    changed = False
    for needle in quoted:
        if needle in patched:
            replacement = f'"{key}"'.encode("utf-8") if needle.startswith(b'"') else f"'{key}'".encode("utf-8")
            patched = patched.replace(needle, replacement)
            changed = True

    # Belt-and-suspenders: also inject an early window assignment if not already present.
    # This makes the key visible to the top-level INITIAL_MAPS_KEY evaluation even
    # if the sentinel replacement site was inlined/mangled by the minifier.
    if changed or MAPS_KEY_SENTINEL.encode("utf-8") not in patched:  # if we patched or no sentinel left
        key_assignment = f'window.MAPS_API_KEY="{key}";'.encode("utf-8")
        if key_assignment not in patched:
            patched = key_assignment + b"\n" + patched

    return patched if (changed or MAPS_KEY_SENTINEL.encode("utf-8") not in patched) else data


def _repair_index_html(index_html: bytes, build_path: Path) -> bytes:
    """Ensure index.html references the CRA main.js bundle (not just public/ template)."""
    text = index_html.decode("utf-8", errors="replace")
    if "static/js/main" in text:
        return index_html

    manifest_path = build_path / "asset-manifest.json"
    if not manifest_path.is_file():
        return index_html

    import json

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    main_js = manifest.get("files", {}).get("main.js", "")
    main_css = manifest.get("files", {}).get("main.css", "")
    if not main_js:
        return index_html

    insert = ""
    if main_css and main_css not in text:
        insert += f'<link href="{main_css}" rel="stylesheet">'
    if main_js not in text:
        insert += f'<script defer="defer" src="{main_js}"></script>'

    if not insert:
        return index_html

    if "</head>" in text:
        repaired = text.replace("</head>", f"{insert}</head>", 1)
    else:
        repaired = insert + text

    print("  ! index.html repaired — injected CRA bundle script tags from asset-manifest.json")
    return repaired.encode("utf-8")


def build_zip(build_path: Path) -> bytes:
    """Zip the contents of build_path into an in-memory archive.
    If MAPS_API_KEY env is set, bake it into static/js/*.js by replacing
    __RUNTIME_MAPS_KEY_SENTINEL__ (go.1ink.us style — key lives in main.js).
    """
    buf = io.BytesIO()
    bundle_patched = False
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for file in sorted(build_path.rglob("*")):
            if file.is_dir():
                continue
            rel = file.relative_to(build_path)
            # Skip common junk
            parts = rel.parts
            if any(p in (".git", "node_modules", "__pycache__") for p in parts):
                continue

            file_data = file.read_bytes()

            if str(rel) == "index.html":
                file_data = _repair_index_html(file_data, build_path)

            if (
                MAPS_API_KEY
                and len(parts) >= 2
                and parts[0] == "static"
                and parts[1] == "js"
                and str(rel).endswith(".js")
            ):
                patched = _inject_maps_key_into_bundle(file_data, MAPS_API_KEY)
                if patched != file_data:
                    print(f"  + {rel} (Maps API key baked into bundle)")
                    zf.writestr(str(rel), patched)
                    bundle_patched = True
                    continue

            zf.writestr(str(rel), file_data)
            print(f"  + {rel}")

    if MAPS_API_KEY:
        if not bundle_patched:
            print("\n" + "!" * 70)
            print(f"  ERROR: MAPS_API_KEY provided but '{MAPS_KEY_SENTINEL}' was not found")
            print("  in build/static/js/*.js. Run 'npm run build' first, then deploy again.")
            print("!" * 70 + "\n")
            sys.exit(1)
        print(f"\n[deploy] Maps API key baked into JS bundle (length {len(MAPS_API_KEY)}).")
        print("         Same delivery as go.1ink.us — no config.js required.")
        print("         Ensure the key's referrer allowlist covers test.1ink.us and go.1ink.us.")
    return buf.getvalue()


def deploy_bundle(build_path: Path) -> bool:
    """Zip the build and upload it as a single bundle."""
    target_folder = DEPLOY_FOLDER or PROJECT_NAME
    url = f"{CONTABO_BASE_URL}/api/deploy/{PROJECT_NAME}/bundle"
    headers = {}
    if DEPLOY_TOKEN:
        headers["X-Deploy-Token"] = DEPLOY_TOKEN

    print("Building zip archive...")
    if MAPS_API_KEY:
        print(f"  MAPS_API_KEY provided (masked: {MAPS_API_KEY[:8]}...{MAPS_API_KEY[-4:]}) — will bake into JS bundle")
    else:
        print("  No MAPS_API_KEY env — bundle must already contain a key (REACT_APP_MAPS_API_KEY at build time)")
    zip_bytes = build_zip(build_path)
    print(f"Archive size: {len(zip_bytes) / 1024:.1f} KB\n")

    print("Uploading bundle...")
    try:
        response = requests.post(
            url,
            files={"bundle": ("build.zip", zip_bytes, "application/zip")},
            data={"target_folder": target_folder},
            headers=headers,
            timeout=300,
        )
    except Exception as exc:
        print(f"  \u2717 Upload exception: {exc}")
        return False

    if response.status_code == 200:
        data = response.json()
        print(f"  \u2713 {data.get('uploaded', 0)} files uploaded")
        if data.get("failed"):
            print("  Failures:")
            for f in data["failed"]:
                print(f"    \u2717 {f['path']}: {f['error']}")
        return not data.get("failed")
    else:
        print(f"  \u2717 {response.status_code}: {response.text[:400]}")
        return False


def main():
    print(f"\n=== Deploying '{PROJECT_NAME}' via Contabo -> storage.1ink.us ===\n")

    build_path = Path(BUILD_DIR)
    if not build_path.exists() or not build_path.is_dir():
        print(f"ERROR: Build directory '{BUILD_DIR}/' does not exist.")
        print("Please run your build command first (e.g. `npm run build`).")
        sys.exit(1)

    # --- Pre-deploy build + Maps key validation ---
    print("Checking build/index.html...")
    _validate_build_index(build_path)
    print("Checking Maps API key...")
    _validate_maps_key(MAPS_API_KEY or "")
    # ----------------------------------------

    try:
        health = requests.get(f"{CONTABO_BASE_URL}/api/deploy/health", timeout=10)
        if health.status_code == 200:
            print(f"Contabo deploy service: {health.json().get('status', 'unknown')}")
    except Exception:
        print("Warning: Could not contact storage.noahcohn.com (continuing anyway).")

    print()
    success = deploy_bundle(build_path)

    print(f"\n=== {'Deployment complete' if success else 'Deployment finished with errors'} ===")
    if success:
        print("Post-deploy verification (do this now):")
        print("  1. curl -s https://test.1ink.us/streetview/static/js/main.*.js | grep -o 'AIzaSy[^\"]*' | head -1")
        print("  2. Hard refresh the demo; no 'This page can't load Google Maps correctly'")
        print("  3. Check GCP: key has referrers for both hosts + billing + JS API + Directions enabled")
        print("  4. curl -sI https://test.1ink.us/streetview/ | grep -i cross-origin-embedder")
        print("     Expect 'credentialless' (NOT 'require-corp') — require-corp blocks Google Maps sub-requests and causes flicker.")
        print("See docs/DEPLOY_CHECKLIST.md and GitHub issues #84 #89.")
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
