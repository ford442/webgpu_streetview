#!/usr/bin/env python3
"""
Deploy WebGPU StreetView to test.1ink.us / go.1ink.us via the Contabo storage
manager bundle API. Credentials are read from environment variables only —
never commit DEPLOY_TOKEN or MAPS_API_KEY to the repository.

Usage:
  npm run build   # or let deploy.py run it when build/ is missing
  export DEPLOY_TOKEN='...'   # from VPS / storage manager config
  MAPS_API_KEY='AIzaSy...' python deploy.py
  python deploy.py --dry-run [--out bundle.zip]   # size the zip, upload nothing

Environment variables:
  DEPLOY_TOKEN       (required unless --dry-run) Auth token for the bundle upload API
  MAPS_API_KEY       (recommended) Baked into static/js/*.js at deploy time
                     (Vite emits build/static/js/main.[hash].js — same layout as former CRA)
  CESIUM_ION_TOKEN   (optional) Baked into static/js/*.js the same way, so full-screen
                     GlobeView uses real Ion world terrain/imagery instead of
                     the flat ellipsoid + CartoCDN fallback
  DEPLOY_TARGET      test (default) | go
  CONTABO_BASE_URL   https://storage.noahcohn.com (default)
  PROJECT_NAME       streetview (default)
  BUILD_DIR          build (default)
  DEPLOY_FOLDER      Remote folder override (default: PROJECT_NAME)
  DEPLOY_PART_MAX_MB Largest raw payload per upload POST, in MiB (default 8; 0 = one
                     bundle). build/ goes up as several smaller bundles, index.html
                     last, because a single 46 MB POST was answered with
                     400 "error parsing the body" (#358) while 3.7 MB had passed.
                     A part the API still rejects (400/413) is split and retried.

Requirements:
  pip install requests
"""

from __future__ import annotations

import argparse
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
CESIUM_ION_TOKEN_SENTINEL = "__RUNTIME_CESIUM_ION_TOKEN_SENTINEL__"

# Raw bytes per upload POST. The last good deploy (run 6) sent 3.7 MB; the first bad one
# (run 7, 2026-10-27) sent one 46 MB body and got 400 "There was an error parsing the body".
DEFAULT_PART_MAX_MB = 8
# Statuses that mean "this body was refused" — worth splitting the part and trying again.
_SPLITTABLE_STATUSES = (400, 413)
_TRANSIENT_RETRIES = 2

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
    cesium_ion_token: Optional[str]
    part_max_bytes: int = DEFAULT_PART_MAX_MB * 1024 * 1024


def _is_placeholder(key: str) -> bool:
    if not key:
        return True
    return any(p.search(key) for p in _PLACEHOLDER_PATTERNS)


def load_deploy_config(dry_run: bool = False) -> DeployConfig:
    """Load deploy settings from environment variables (a dry run needs no token)."""
    deploy_token = os.environ.get("DEPLOY_TOKEN", "").strip()
    if not deploy_token and not dry_run:
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
    cesium_ion_token = os.environ.get("CESIUM_ION_TOKEN", "").strip() or None

    raw_part_mb = os.environ.get("DEPLOY_PART_MAX_MB", "").strip()
    try:
        part_max_mb = float(raw_part_mb) if raw_part_mb else float(DEFAULT_PART_MAX_MB)
    except ValueError:
        print(f"\nERROR: DEPLOY_PART_MAX_MB must be a number of MiB (got {raw_part_mb!r}).")
        sys.exit(1)
    if part_max_mb < 0:
        print(f"\nERROR: DEPLOY_PART_MAX_MB must be >= 0 (got {raw_part_mb!r}).")
        sys.exit(1)

    return DeployConfig(
        project_name=os.environ.get("PROJECT_NAME", "streetview").strip() or "streetview",
        build_dir=os.environ.get("BUILD_DIR", "build").strip() or "build",
        contabo_base_url=os.environ.get("CONTABO_BASE_URL", "https://storage.noahcohn.com").strip()
        or "https://storage.noahcohn.com",
        deploy_folder=os.environ.get("DEPLOY_FOLDER", "").strip(),
        deploy_target=deploy_target,
        deploy_token=deploy_token,
        maps_api_key=maps_key,
        cesium_ion_token=cesium_ion_token,
        part_max_bytes=int(part_max_mb * 1024 * 1024),
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
    if not (build_path / "build-info.json").is_file():
        problems.append(
            "build-info.json is missing (nothing could prove which commit is live; rebuild with 'npm run build')"
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


def _inject_sentinel_into_bundle(data: bytes, sentinel: str, value: str, window_var: str) -> bytes:
    """Replace a baked `__RUNTIME_..._SENTINEL__` placeholder with a real secret,
    or prepend a `window.<var>=...` assignment if the sentinel isn't present
    (e.g. the value was never referenced at build time)."""
    quoted = (
        f'"{sentinel}"'.encode("utf-8"),
        f"'{sentinel}'".encode("utf-8"),
    )
    patched = data
    changed = False
    for needle in quoted:
        if needle in patched:
            replacement = f'"{value}"'.encode("utf-8") if needle.startswith(b'"') else f"'{value}'".encode("utf-8")
            patched = patched.replace(needle, replacement)
            changed = True

    if changed or sentinel.encode("utf-8") not in patched:
        assignment = f'window.{window_var}="{value}";'.encode("utf-8")
        if assignment not in patched:
            patched = assignment + b"\n" + patched

    return patched if (changed or sentinel.encode("utf-8") not in patched) else data


def _inject_maps_key_into_bundle(data: bytes, key: str) -> bytes:
    return _inject_sentinel_into_bundle(data, MAPS_KEY_SENTINEL, key, "MAPS_API_KEY")


def _inject_cesium_ion_token_into_bundle(data: bytes, token: str) -> bytes:
    return _inject_sentinel_into_bundle(data, CESIUM_ION_TOKEN_SENTINEL, token, "CESIUM_ION_TOKEN")


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


def collect_files(
    build_path: Path,
    maps_api_key: Optional[str],
    cesium_ion_token: Optional[str] = None,
) -> list[tuple[str, bytes]]:
    """Every deployable file of build/ as (posix relative path, bytes), secrets baked in."""
    files: list[tuple[str, bytes]] = []
    maps_key_patched = False
    for file in sorted(build_path.rglob("*")):
        if file.is_dir():
            continue
        rel = file.relative_to(build_path)
        parts = rel.parts
        if any(p in (".git", "node_modules", "__pycache__") for p in parts):
            continue
        if file.suffix == ".map":
            # Source maps are not served: they stay a CI artifact for symbolication.
            continue
        if str(rel) in ("chunk-graph.json", "architecture-report.html"):
            # Build diagnostics (scripts/check-chunk-graph.mjs, scripts/check-architecture.mjs): CI artifacts.
            continue

        file_data = file.read_bytes()

        if str(rel) == "index.html":
            file_data = _repair_index_html(file_data, build_path)

        is_js_bundle = (
            len(parts) >= 2
            and parts[0] == "static"
            and parts[1] == "js"
            and str(rel).endswith(".js")
        )
        if is_js_bundle and (maps_api_key or cesium_ion_token):
            patched = file_data
            if maps_api_key:
                patched = _inject_maps_key_into_bundle(patched, maps_api_key)
                if patched != file_data:
                    maps_key_patched = True
            if cesium_ion_token:
                patched = _inject_cesium_ion_token_into_bundle(patched, cesium_ion_token)
            if patched != file_data:
                print(f"  + {rel} (secrets baked into bundle)")
                files.append((rel.as_posix(), patched))
                continue

        files.append((rel.as_posix(), file_data))
        print(f"  + {rel}")

    if maps_api_key:
        if not maps_key_patched:
            print("\n" + "!" * 70)
            print(f"  ERROR: MAPS_API_KEY provided but '{MAPS_KEY_SENTINEL}' was not found")
            print("  in build/static/js/*.js. Run 'npm run build' first, then deploy again.")
            print("!" * 70 + "\n")
            sys.exit(1)
        print(f"\n[deploy] Maps API key baked into JS bundle (length {len(maps_api_key)}).")
        print("         Ensure the key's referrer allowlist covers test.1ink.us and go.1ink.us.")

    if cesium_ion_token:
        print(f"[deploy] Cesium Ion token baked into JS bundle (length {len(cesium_ion_token)}).")

    return files


def zip_files(files: list[tuple[str, bytes]]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for name, data in files:
            zf.writestr(name, data)
    return buf.getvalue()


def build_zip(
    build_path: Path,
    maps_api_key: Optional[str],
    cesium_ion_token: Optional[str] = None,
) -> bytes:
    """The whole of build/ as one archive (the `--out` artifact and the size report)."""
    return zip_files(collect_files(build_path, maps_api_key, cesium_ion_token))


def plan_parts(files: list[tuple[str, bytes]], max_bytes: int) -> list[list[tuple[str, bytes]]]:
    """Group files into upload parts of at most `max_bytes` raw bytes each.

    - `max_bytes <= 0` keeps the legacy single bundle.
    - A file larger than the cap is a part of its own (it cannot be split further).
    - `index.html` is always the last part, alone: a visitor never sees a new
      page before the hashed assets it references are on the server.
    """
    entry = [f for f in files if f[0] == "index.html"]
    rest = [f for f in files if f[0] != "index.html"]
    if max_bytes <= 0:
        return [files]
    parts: list[list[tuple[str, bytes]]] = []
    current: list[tuple[str, bytes]] = []
    size = 0
    for item in rest:
        n = len(item[1])
        if current and size + n > max_bytes:
            parts.append(current)
            current, size = [], 0
        current.append(item)
        size += n
    if current:
        parts.append(current)
    if entry:
        parts.append(entry)
    return parts


def describe_zip(zip_bytes: bytes, top: int = 10) -> list[tuple[str, int, int]]:
    """The `top` largest entries of a bundle as (name, stored bytes, raw bytes), largest stored first."""
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
        entries = [(i.filename, i.compress_size, i.file_size) for i in zf.infolist()]
    entries.sort(key=lambda e: e[1], reverse=True)
    return entries[:top]


def print_bundle_report(zip_bytes: bytes) -> None:
    """Size before upload: the Contabo API's 400 "error parsing the body" (#358) is
    suspected to be a body limit once the scene models joined build/models/."""
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
        count = len(zf.infolist())
    print(f"Archive size: {len(zip_bytes) / (1024 * 1024):.2f} MiB, {count} files")
    print("Largest entries (stored / raw):")
    for name, stored, raw in describe_zip(zip_bytes):
        print(f"  {stored / (1024 * 1024):8.2f} MiB / {raw / (1024 * 1024):8.2f} MiB  {name}")
    print()


def _describe_failure(response: "requests.Response") -> str:
    """Status, body and the headers that say WHO refused it (never the request's token)."""
    interesting = ("server", "content-type", "content-length", "via", "x-request-id", "retry-after")
    headers = ", ".join(f"{k}: {v}" for k, v in response.headers.items() if k.lower() in interesting)
    return f"{response.status_code}: {response.text[:400]} [{headers}]"


def _post_part(
    config: DeployConfig, url: str, target_folder: str, label: str, part: list[tuple[str, bytes]]
) -> tuple[bool, Optional[int]]:
    """POST one part. Returns (ok, refused_status); `refused_status` is set only for a 4xx the caller may split on."""
    zip_bytes = zip_files(part)
    mib = len(zip_bytes) / (1024 * 1024)
    for attempt in range(_TRANSIENT_RETRIES + 1):
        print(f"  ↑ {label}: {len(part)} file(s), {mib:.2f} MiB" + (f" (retry {attempt})" if attempt else ""))
        try:
            response = requests.post(
                url,
                files={"bundle": ("build.zip", zip_bytes, "application/zip")},
                data={"target_folder": target_folder, "target_site": config.deploy_target},
                headers={"X-Deploy-Token": config.deploy_token},
                timeout=300,
            )
        except Exception as exc:
            print(f"    ✗ upload exception: {exc}")
            continue

        if response.status_code == 200:
            data = response.json()
            print(f"    ✓ {data.get('uploaded', 0)} files uploaded")
            failed = data.get("failed") or []
            for f in failed:
                print(f"    ✗ {f['path']}: {f['error']}")
            return (not failed, None)

        print(f"    ✗ {_describe_failure(response)}")
        if response.status_code in (401, 403):
            print("    Hint: check DEPLOY_TOKEN — it must match the value configured on the storage manager VPS.")
            return (False, None)
        if response.status_code in _SPLITTABLE_STATUSES:
            return (False, response.status_code)
        if response.status_code < 500:
            return (False, None)
    return (False, None)


def _upload_part(
    config: DeployConfig, url: str, target_folder: str, label: str, part: list[tuple[str, bytes]]
) -> bool:
    """Upload a part; if the API refuses its body (400/413), halve it and try each half."""
    ok, refused = _post_part(config, url, target_folder, label, part)
    if ok or refused is None:
        return ok
    if len(part) == 1:
        name, data = part[0]
        print(
            f"    ✗ {name} ({len(data) / (1024 * 1024):.2f} MiB) is refused on its own — the bundle API's body limit is "
            "below this file's size. Raise it on the storage manager, or serve this file from elsewhere."
        )
        return False
    mid = len(part) // 2
    print(f"    ↳ {label} refused ({refused}); splitting {len(part)} files into {mid} + {len(part) - mid}")
    return _upload_part(config, url, target_folder, f"{label}a", part[:mid]) and _upload_part(
        config, url, target_folder, f"{label}b", part[mid:]
    )


def deploy_bundle(config: DeployConfig, build_path: Path, dry_run: bool = False, out: Optional[Path] = None) -> bool:
    target_folder = config.deploy_folder or config.project_name
    url = f"{config.contabo_base_url.rstrip('/')}/api/deploy/{config.project_name}/bundle"

    print("Building zip archive...")
    if config.maps_api_key:
        print(
            f"  MAPS_API_KEY provided (masked: {config.maps_api_key[:8]}...{config.maps_api_key[-4:]}) "
            "— will bake into JS bundle"
        )
    else:
        print("  No MAPS_API_KEY env — bundle must already contain a key (REACT_APP_MAPS_API_KEY at build time)")

    if config.cesium_ion_token:
        print(
            f"  CESIUM_ION_TOKEN provided (masked: {config.cesium_ion_token[:6]}...) "
            "— will bake into JS bundle for Ion world terrain/imagery"
        )
    else:
        print("  No CESIUM_ION_TOKEN env — GlobeView/MiniMap use the CartoCDN + ellipsoid fallback")

    files = collect_files(build_path, config.maps_api_key, config.cesium_ion_token)
    zip_bytes = zip_files(files)
    print_bundle_report(zip_bytes)
    parts = plan_parts(files, config.part_max_bytes)
    print(f"Upload plan: {len(parts)} part(s), at most {config.part_max_bytes / (1024 * 1024):.1f} MiB raw each (index.html last)")
    if out is not None:
        out.write_bytes(zip_bytes)
        print(f"Wrote {out}")
    if dry_run:
        print(f"Dry run: not uploading to {url} (target_folder={target_folder!r}).")
        return True

    print("Uploading bundle...")
    for i, part in enumerate(parts, start=1):
        if not _upload_part(config, url, target_folder, f"part {i}/{len(parts)}", part):
            if i < len(parts):
                print(f"  ✗ stopping at part {i}/{len(parts)}: index.html was NOT uploaded, so the live page still references the previous build's files (assuming the API keeps files it was not sent).")
            return False
    return True


def parse_args(argv: Optional[list[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Upload build/ to the Contabo bundle API.")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="build and size the zip, skip the health check and the upload (no DEPLOY_TOKEN needed)",
    )
    parser.add_argument("--out", type=Path, default=None, help="also write the zip to this path")
    return parser.parse_args(argv)


def main() -> None:
    args = parse_args()
    refuse_if_secrets_in_source()
    config = load_deploy_config(dry_run=args.dry_run)
    site_host = "go.1ink.us" if config.deploy_target == "go" else "test.1ink.us"

    print(f"\n=== Deploying '{config.project_name}' via Contabo -> {site_host} (target={config.deploy_target}) ===\n")

    build_path = Path(config.build_dir)
    _ensure_production_build(build_path)
    print("Checking build/index.html...")
    _validate_build_index(build_path)
    print("Checking Maps API key...")
    _validate_maps_key(config.maps_api_key or "")

    if args.dry_run:
        print()
        sys.exit(0 if deploy_bundle(config, build_path, dry_run=True, out=args.out) else 1)

    try:
        health = requests.get(f"{config.contabo_base_url.rstrip('/')}/api/deploy/health", timeout=10)
        if health.status_code == 200:
            print(f"Contabo deploy service: {health.json().get('status', 'unknown')}")
    except Exception:
        print("Warning: Could not contact storage manager (continuing anyway).")

    print()
    success = deploy_bundle(config, build_path, out=args.out)

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
