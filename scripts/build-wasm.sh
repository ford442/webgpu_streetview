#!/usr/bin/env bash
# scripts/build-wasm.sh
# Build the WebGPU StreetView WASM module from C++ via Emscripten.
#
# Prerequisites:
#   source /path/to/emsdk/emsdk_env.sh    # activate emcc (pin: cpp/emsdk.version)
#
# Output:
#   public/wasm/streetview-wasm.wasm      – standalone WASM (no JS glue)
#   public/wasm/streetview-wasm.wasm.sha256 – SHA-256 of the C++ inputs
#
# Usage:
#   bash scripts/build-wasm.sh [--release|--debug]
#
# Env:
#   STREETVIEW_WASM_SIMD=ON   pass -DSTREETVIEW_WASM_SIMD=ON (CI only; not shipped)
#   CI=true                   fail if emcc is missing (do not reuse a stale binary)

set -euo pipefail

activate_emsdk() {
  local candidate
  for candidate in \
    "${EMSDK_ENV:-}" \
    "${EMSDK:-}/emsdk_env.sh" \
    /content/buil*/emsdk/emsdk_env.sh \
    "$HOME"/emsdk/emsdk_env.sh; do
    [ -n "$candidate" ] || continue
    for resolved in $candidate; do
      if [ -f "$resolved" ]; then
        # shellcheck disable=SC1090
        source "$resolved" && return 0
      fi
    done
  done
  return 0
}
activate_emsdk

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CPP_DIR="$REPO_ROOT/cpp"
OUT_DIR="$REPO_ROOT/public/wasm"
WASM_OUT="$OUT_DIR/streetview-wasm.wasm"
HASH_OUT="$OUT_DIR/streetview-wasm.wasm.sha256"
GLUE_JS="$OUT_DIR/streetview-wasm.js"

mkdir -p "$OUT_DIR"

BUILD_TYPE="Release"
for arg in "$@"; do
  case "$arg" in
    --release) BUILD_TYPE="Release" ;;
    --debug)   BUILD_TYPE="Debug" ;;
    --wat-only)
      echo "ERROR: --wat-only is retired. The shipped module is built from C++ with emcc." >&2
      echo "       See docs/WASM_BRIDGE.md." >&2
      exit 1
      ;;
  esac
done

SOURCE_HASH="$(node "$REPO_ROOT/scripts/wasm-source-hash.mjs")"

if ! command -v emcc &>/dev/null; then
  if [ "${CI:-}" = "true" ]; then
    echo "ERROR: emcc is required in CI. Install the SDK pinned in cpp/emsdk.version" >&2
    echo "       (see WASM.md / mymindstorm/setup-emsdk)." >&2
    exit 1
  fi
  if [ -f "$WASM_OUT" ] && [ -f "$HASH_OUT" ] && [ "$(tr -d '[:space:]' < "$HASH_OUT")" = "$SOURCE_HASH" ]; then
    echo "==> emcc not found; C++ source hash matches committed wasm — skipping rebuild."
    exit 0
  fi
  echo "ERROR: emcc not found and the C++ sources do not match public/wasm/streetview-wasm.wasm.sha256." >&2
  echo "       Install Emscripten (pin: $(tr -d '[:space:]' < "$CPP_DIR/emsdk.version")) and retry." >&2
  echo "       See WASM.md." >&2
  exit 1
fi

echo "==> Emscripten detected ($(emcc --version | head -1))"
echo "==> Building C++ → WASM via Emscripten …"

BUILD_DIR="$CPP_DIR/build-emscripten"
mkdir -p "$BUILD_DIR"
cd "$BUILD_DIR"

CXXFLAGS="-O3"
if [[ "$BUILD_TYPE" == "Debug" ]]; then
  CXXFLAGS="-O0 -g"
fi

SIMD_CMAKE=()
if [[ "${STREETVIEW_WASM_SIMD:-}" == "ON" || "${STREETVIEW_WASM_SIMD:-}" == "1" ]]; then
  SIMD_CMAKE=(-DSTREETVIEW_WASM_SIMD=ON)
  echo "==> STREETVIEW_WASM_SIMD=ON (autovectorization only; do not ship this binary)"
fi

emcmake cmake "$CPP_DIR" \
  -DCMAKE_BUILD_TYPE="$BUILD_TYPE" \
  -DCMAKE_CXX_FLAGS="$CXXFLAGS" \
  "${SIMD_CMAKE[@]}"

emmake make -j"$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)"

# STANDALONE_WASM must not emit JS glue. A leftover embind .js would be copied
# into build/ by Vite and precached by the service worker.
rm -f "$GLUE_JS"

if [ ! -f "$WASM_OUT" ] || [ ! -s "$WASM_OUT" ]; then
  echo "ERROR: expected non-empty $WASM_OUT after emcc link." >&2
  exit 1
fi

# Record the C++ source hash so verify-build.sh can detect staleness.
# SIMD CI rebuilds must not rewrite the committed hash of the scalar ship binary.
if [[ "${STREETVIEW_WASM_SIMD:-}" != "ON" && "${STREETVIEW_WASM_SIMD:-}" != "1" ]]; then
  printf '%s\n' "$SOURCE_HASH" > "$HASH_OUT"
  echo "==> C++ source hash written: $SOURCE_HASH"
fi

echo "==> Emscripten build done."
echo "    WASM: $WASM_OUT ($(wc -c < "$WASM_OUT") bytes)"
