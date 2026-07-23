#!/usr/bin/env python3
"""
Deploy WebGPU StreetView to test.1ink.us / go.1ink.us via the Contabo storage
manager bundle API. Credentials are read from environment variables only —
never commit DEPLOY_TOKEN or MAPS_API_KEY to the repository.

Usage:
  npm run build   # or let deploy.py run it when build/ is missing
  export DEPLOY_TOKEN='...'   # from VPS / storage manager config
  MAPS_API_KEY='AIzaSy...' python deploy.py

Environment variables:
  DEPLOY_TOKEN       (required) Auth token for the bundle upload API
  MAPS_API_KEY       (recommended) Baked into static/js/*.js at deploy time
                     (Vite emits build/static/js/main.[hash].js — same layout as former CRA)
  DEPLOY_TARGET      test (default) | go
  CONTABO_BASE_URL   https://storage.noahcohn.com (default)
  PROJECT_NAME       streetview (default)
  BUILD_DIR          build (default)
  DEPLOY_FOLDER      Remote folder override (default: PROJECT_NAME)

Requirements:
  pip install requests
"""

from __future__ import annotations

import io
import os
import re
import subprocess
import sys
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import requests

MAPS_KEY_SENTINEL = "__RUNTIME_MAPS_KEY_SENTINEL__"

# Patterns that identify placeholder / template Maps keys — not real keys.
_PLACEHOLDER_PATTERNS = [
    re.compile(r"^your[_-]?(google[_-]?)?maps[_-]?api[_-]?key", re.I),
    re.compile(r"^YOUR_MAPS_API_KEY$"),
    re.compile(r"^placeholder", re.I),
    re.compile(r"^<.*>$"),
    re.compile(r"replace", re.I),
    re.compile(r"^AIzaSy-placeholder", re.I),
]

# Committed-source patterns scanned by scripts/check-deploy-secrets.sh (not duplicated here).


def refuse_if_secrets_in_source(repo_root: Path | None = None) -> None:
    """Fail fast if known deploy credentials appear in tracked source files."""
    root = repo_root or Path(__file__).resolve().parent
    script = root / "scripts" / "check-deploy-secrets.sh"
    if not script.is_file():
        print("Warning: scripts/check-deploy-secrets.sh missing — skipping credential self-test.")
        return

    result = subprocess.run(["bash", str(script)], cwd=root, capture_output=True, text=True)
    if result.stdout:
        print(result.stdout.rstrip())
    if result.returncode != 0:
        if result.stderr:
            print(result.stderr.rstrip())
        sys.exit(1)


@dataclass(frozen=True)
class DeployConfig:
    project_name: str
    build_dir: str
    contabo_base_url: str
    deploy_folder: str
    deploy_target: str
    deploy_token: str
    maps_api_key: Optional[str]


def _is_placeholder(key: str) -> bool:
    if not key:
        return True
    return any(p.search(key) for p in _PLACEHOLDER_PATTERNS)


def load_deploy_config() -> DeployConfig:
    """Load deploy settings from environment variables."""
    deploy_token = os.environ.get("DEPLOY_TOKEN", "").strip()
    if not deploy_token:
        print("\nERROR: DEPLOY_TOKEN environment variable is required.")
        print("  The Contabo bundle upload API authenticates with this token.")
        print("  Obtain it from your VPS / storage manager configuration.")
        print("\n  Example:")
        print("    export DEPLOY_TOKEN='your_token_from_vps_env'")
        print("    MAPS_API_KEY='AIzaSy...' python deploy.py")
        print("\n  For GitHub Actions, store DEPLOY_TOKEN as a repository secret.")
        sys.exit(1)

    deploy_target = os.environ.get("DEPLOY_TARGET", "test").strip().lower()
    if deploy_target not in ("test", "go"):
        print(f"\nERROR: DEPLOY_TARGET must be 'test' or 'go' (got {deploy_target!r}).")
        sys.exit(1)

    maps_key = os.environ.get("MAPS_API_KEY", "").strip() or None

    return DeployConfig(
        project_name=os.environ.get("PROJECT_NAME", "streetview").strip() or "streetview",
        build_dir=os.environ.get("BUILD_DIR", "build").strip() or "build",
        contabo_base_url=os.environ.get("CONTABO_BASE_URL", "https://storage.noahcohn.com").strip()
        or "https://storage.noahcohn.com",
        deploy_folder=os.environ.get("DEPLOY_FOLDER", "").strip(),
        deploy_target=deploy_target,
        deploy_token=deploy_token,
        maps_api_key=maps_key,
    )


def refuse_if_secrets_in_source(repo_root: Path | None = None) -> None:
    """Fail fast if known deploy credentials appear in tracked source files."""
    root = repo_root or Path(__file__).resolve().parent
    script = root / "scripts" / "check-deploy-secrets.sh"
    if not script.is_file():
        print("Warning: scripts/check-deploy-secrets.sh missing — skipping credential self-test.")
        return

    result = subprocess.run(["bash", str(script)], cwd=root, capture_output=True, text=True)
    if result.stdout:
        print(result.stdout.rstrip())
    if result.returncode != 0:
        if result.stderr:
            print(result.stderr.rstrip())
        sys.exit(1)


def _build_index_problems(build_path: Path) -> list[str]:
    index_html = build_path / "index.html"
    if not index_html.is_file():
        return ["build/index.html is missing"]

    content = index_html.read_text(encoding="utf-8", errors="replace")
    problems: list[str] = []
    if "%PUBLIC_URL%" in content:
        problems.append(
            "contains unprocessed %PUBLIC_URL% (public/index.html was deployed instead of build/index.html)"
        )
    if "static/js/main" not in content:
        problems.append("does not reference static/js/main.*.js (React bundle will never load)")
    if 'type="module"' not in content:
        problems.append(
            'main script is missing type="module" (Vite ESM bundle will throw on import.meta)'
        )
    return problems


def _ensure_production_build(build_path: Path) -> None:
    repo_root = Path(__file__).resolve().parent
    needs_build = not build_path.is_dir()
    problems: list[str] = []

    if not needs_build:
        problems = _build_index_problems(build_path)
        needs_build = bool(problems)

    if not needs_build:
        return

    reason = problems[0] if problems else "build/ directory is missing"
    print(f"\n  build/ is not deployable ({reason}).")
    print("  Running 'npm run build' to produce a production bundle...\n")
    result = subprocess.run(["npm", "run", "build"], cwd=repo_root, env=os.environ.copy())
    if result.returncode != 0:
        print("\nERROR: 'npm run build' failed. Fix build errors, then run deploy again.")
        sys.exit(1)
    print("\n  npm run build completed successfully.\n")


def _validate_build_index(build_path: Path) -> None:
    problems = _build_index_problems(build_path)
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
    if not key or _is_placeholder(key):
        print("\n" + "!" * 70)
        print("  WARNING: MAPS_API_KEY is empty or a placeholder value.")
        print("  The deployed app will show 'This page can't load Google Maps correctly'.")
        print("  Set a real key:  MAPS_API_KEY=AIzaSy... python deploy.py")
        print("!" * 70 + "\n")
        return

    if not re.match(r"^AIzaSy[A-Za-z0-9_-]{33}$", key):
        print(f"\nWARNING: MAPS_API_KEY doesn't match the expected AIzaSy... format (length {len(key)}).")
        print("  Double-check the key is correct before deploying.\n")
        return

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
        else:
            print("OK")
            print("  NOTE: Referrer restrictions cannot be verified from a script.")
            print("        Confirm test.1ink.us and go.1ink.us are in the key's allowlist in GCP Console.")
    except Exception as exc:
        print(f"SKIP (network error: {exc})")


def _inject_maps_key_into_bundle(data: bytes, key: str) -> bytes:
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

    if changed or MAPS_KEY_SENTINEL.encode("utf-8") not in patched:
        key_assignment = f'window.MAPS_API_KEY="{key}";'.encode("utf-8")
        if key_assignment not in patched:
            patched = key_assignment + b"\n" + patched

    return patched if (changed or MAPS_KEY_SENTINEL.encode("utf-8") not in patched) else data


def _repair_index_html(index_html: bytes, build_path: Path) -> bytes:
    text = index_html.decode("utf-8", errors="replace")
    changed = False
    if "%PUBLIC_URL%" in text:
        text = text.replace("%PUBLIC_URL%", ".")
        changed = True
        print("  ! index.html repaired — replaced leftover %PUBLIC_URL% with '.'")

    if "static/js/main" in text:
        return text.encode("utf-8") if changed else index_html

    manifest_path = build_path / "asset-manifest.json"
    if not manifest_path.is_file():
        return text.encode("utf-8") if changed else index_html

    import json

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    main_js = manifest.get("files", {}).get("main.js", "")
    main_css = manifest.get("files", {}).get("main.css", "")
    if not main_js:
        return text.encode("utf-8") if changed else index_html

    insert = ""
    if main_css and main_css not in text:
        insert += f'<link href="{main_css}" rel="stylesheet">'
    if main_js not in text:
        insert += f'<script type="module" crossorigin src="{main_js}"></script>'

    if not insert:
        return text.encode("utf-8") if changed else index_html

    if "</head>" in text:
        repaired = text.replace("</head>", f"{insert}</head>", 1)
    else:
        repaired = insert + text

    print("  ! index.html repaired — injected CRA bundle script tags from asset-manifest.json")
    return repaired.encode("utf-8")


def build_zip(build_path: Path, maps_api_key: Optional[str]) -> bytes:
    buf = io.BytesIO()
    bundle_patched = False
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for file in sorted(build_path.rglob("*")):
            if file.is_dir():
                continue
            rel = file.relative_to(build_path)
            parts = rel.parts
            if any(p in (".git", "node_modules", "__pycache__") for p in parts):
                continue

            file_data = file.read_bytes()

            if str(rel) == "index.html":
                file_data = _repair_index_html(file_data, build_path)

            if (
                maps_api_key
                and len(parts) >= 2
                and parts[0] == "static"
                and parts[1] == "js"
                and str(rel).endswith(".js")
            ):
                patched = _inject_maps_key_into_bundle(file_data, maps_api_key)
                if patched != file_data:
                    print(f"  + {rel} (Maps API key baked into bundle)")
                    zf.writestr(str(rel), patched)
                    bundle_patched = True
                    continue

            zf.writestr(str(rel), file_data)
            print(f"  + {rel}")

    if maps_api_key:
        if not bundle_patched:
            print("\n" + "!" * 70)
            print(f"  ERROR: MAPS_API_KEY provided but '{MAPS_KEY_SENTINEL}' was not found")
            print("  in build/static/js/*.js. Run 'npm run build' first, then deploy again.")
            print("!" * 70 + "\n")
            sys.exit(1)
        print(f"\n[deploy] Maps API key baked into JS bundle (length {len(maps_api_key)}).")
        print("         Ensure the key's referrer allowlist covers test.1ink.us and go.1ink.us.")
    return buf.getvalue()


def deploy_bundle(config: DeployConfig, build_path: Path) -> bool:
    target_folder = config.deploy_folder or config.project_name
    url = f"{config.contabo_base_url.rstrip('/')}/api/deploy/{config.project_name}/bundle"
    headers = {"X-Deploy-Token": config.deploy_token}

    print("Building zip archive...")
    if config.maps_api_key:
        print(
            f"  MAPS_API_KEY provided (masked: {config.maps_api_key[:8]}...{config.maps_api_key[-4:]}) "
            "— will bake into JS bundle"
        )
    else:
        print("  No MAPS_API_KEY env — bundle must already contain a key (REACT_APP_MAPS_API_KEY at build time)")

    zip_bytes = build_zip(build_path, config.maps_api_key)
    print(f"Archive size: {len(zip_bytes) / 1024:.1f} KB\n")

    print("Uploading bundle...")
    try:
        response = requests.post(
            url,
            files={"bundle": ("build.zip", zip_bytes, "application/zip")},
            data={"target_folder": target_folder, "target_site": config.deploy_target},
            headers=headers,
            timeout=300,
        )
    except Exception as exc:
        print(f"  ✗ Upload exception: {exc}")
        return False

    if response.status_code == 200:
        data = response.json()
        print(f"  ✓ {data.get('uploaded', 0)} files uploaded")
        if data.get("failed"):
            print("  Failures:")
            for f in data["failed"]:
                print(f"    ✗ {f['path']}: {f['error']}")
        return not data.get("failed")

    print(f"  ✗ {response.status_code}: {response.text[:400]}")
    if response.status_code in (401, 403):
        print("  Hint: check DEPLOY_TOKEN — it must match the value configured on the storage manager VPS.")
    return False


def main() -> None:
    refuse_if_secrets_in_source()
    config = load_deploy_config()
    site_host = "go.1ink.us" if config.deploy_target == "go" else "test.1ink.us"

    print(f"\n=== Deploying '{config.project_name}' via Contabo -> {site_host} (target={config.deploy_target}) ===\n")

    build_path = Path(config.build_dir)
    _ensure_production_build(build_path)
    print("Checking build/index.html...")
    _validate_build_index(build_path)
    print("Checking Maps API key...")
    _validate_maps_key(config.maps_api_key or "")

    try:
        health = requests.get(f"{config.contabo_base_url.rstrip('/')}/api/deploy/health", timeout=10)
        if health.status_code == 200:
            print(f"Contabo deploy service: {health.json().get('status', 'unknown')}")
    except Exception:
        print("Warning: Could not contact storage manager (continuing anyway).")

    print()
    success = deploy_bundle(config, build_path)

    print(f"\n=== {'Deployment complete' if success else 'Deployment finished with errors'} ===")
    if success:
        print("Post-deploy verification (do this now):")
        print(f"  1. curl -s https://{site_host}/streetview/static/js/main.*.js | grep -o 'AIzaSy[^\"]*' | head -1")
        print("  2. Hard refresh the demo; no 'This page can't load Google Maps correctly'")
        print("  3. Check GCP: key has referrers for both hosts + billing + JS API + Directions enabled")
        print(f"  4. curl -sI https://{site_host}/streetview/ | grep -i cross-origin-embedder")
        print("     Expect 'credentialless' (NOT 'require-corp').")
        print("See docs/DEPLOY_CHECKLIST.md")
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
