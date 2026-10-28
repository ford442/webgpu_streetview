#!/usr/bin/env bash
# scripts/build-wasm.sh
# Build the WebGPU StreetView WASM module from C++ via Emscripten.
#
# Prerequisites:
#   source /path/to/emsdk/emsdk_env.sh    # activate emcc (pin: cpp/emsdk.version)
#
# Output (cpp/build-emscripten/out/ — never the tracked tree):
#   streetview-wasm.wasm       scalar reference: CI golden-tests it, never deployed
#   streetview-wasm.simd.wasm  SIMD128 — every main-thread kernel
#   streetview-dsp.simd.wasm   SIMD128 cabin engine, fixed memory — the AudioWorklet
#
# With --update (CI and explicit local runs only) the two shipped binaries are
# copied into public/wasm/ together with streetview-wasm.wasm.sha256 (SHA-256
# of the C++ inputs, which verify-build.sh checks). Without it nothing tracked
# changes: the script only reports whether public/wasm/ matches this build.
#
# Usage:
#   bash scripts/build-wasm.sh [--release|--debug] [--update]
#   npm run build:wasm            # build + compare
#   npm run build:wasm:update     # build + copy into public/wasm/
#
# Env:
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
PUBLIC_DIR="$REPO_ROOT/public/wasm"
BUILD_DIR="$CPP_DIR/build-emscripten"
OUT_DIR="$BUILD_DIR/out"
# Shipped (copied by --update) and reference-only binaries.
SHIPPED=(streetview-wasm.simd.wasm streetview-dsp.simd.wasm)
REFERENCE=(streetview-wasm.wasm)
HASH_OUT="$PUBLIC_DIR/streetview-wasm.wasm.sha256"

BUILD_TYPE="Release"
UPDATE=0
for arg in "$@"; do
  case "$arg" in
    --release) BUILD_TYPE="Release" ;;
    --debug)   BUILD_TYPE="Debug" ;;
    --update)  UPDATE=1 ;;
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
  if [ "$UPDATE" = "0" ] && [ -f "$HASH_OUT" ] && [ "$(tr -d '[:space:]' < "$HASH_OUT")" = "$SOURCE_HASH" ]; then
    echo "==> emcc not found; C++ source hash matches the committed wasm — nothing to build."
    exit 0
  fi
  echo "ERROR: emcc not found and the C++ sources do not match public/wasm/streetview-wasm.wasm.sha256." >&2
  echo "       Install Emscripten (pin: $(tr -d '[:space:]' < "$CPP_DIR/emsdk.version")) and retry." >&2
  echo "       See WASM.md." >&2
  exit 1
fi

# The committed binary must be byte-identical to a rebuild (CI diffs it), and
# different emcc releases emit different bytes — so a mismatched SDK fails here
# instead of producing a binary CI will reject. STREETVIEW_ALLOW_EMCC_MISMATCH=1
# is an escape hatch for local experiments; never commit its output.
EMSDK_PIN="$(tr -d '[:space:]' < "$CPP_DIR/emsdk.version")"
EMCC_VERSION="$(emcc --version | head -1 | sed -nE 's/.* ([0-9]+\.[0-9]+\.[0-9]+)( .*)?$/\1/p')"
if [ "$EMCC_VERSION" != "$EMSDK_PIN" ]; then
  if [ "${STREETVIEW_ALLOW_EMCC_MISMATCH:-}" = "1" ]; then
    echo "WARNING: emcc $EMCC_VERSION != pinned $EMSDK_PIN (STREETVIEW_ALLOW_EMCC_MISMATCH=1); do not commit this binary." >&2
  else
    echo "ERROR: emcc ${EMCC_VERSION:-<unparsed>} does not match the pin in cpp/emsdk.version ($EMSDK_PIN)." >&2
    echo "       ./emsdk install $EMSDK_PIN && ./emsdk activate $EMSDK_PIN && source ./emsdk_env.sh" >&2
    exit 1
  fi
fi

echo "==> Emscripten detected ($(emcc --version | head -1))"
echo "==> Building C++ → WASM via Emscripten …"

mkdir -p "$BUILD_DIR"
cd "$BUILD_DIR"

# Optimisation level comes from CMAKE_BUILD_TYPE only (see cpp/CMakeLists.txt).
# CMAKE_CXX_FLAGS is passed empty so a stale cache entry from an older script
# (which passed -O3 here) cannot leak into the build.
emcmake cmake "$CPP_DIR" \
  -DCMAKE_BUILD_TYPE="$BUILD_TYPE" \
  -DCMAKE_CXX_FLAGS=""

emmake make -j"$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)"

for name in "${SHIPPED[@]}" "${REFERENCE[@]}"; do
  if [ ! -s "$OUT_DIR/$name" ]; then
    echo "ERROR: expected non-empty $OUT_DIR/$name after emcc link." >&2
    exit 1
  fi
  echo "    $name ($(wc -c < "$OUT_DIR/$name") bytes)"
done

if [ "$UPDATE" = "1" ]; then
  mkdir -p "$PUBLIC_DIR"
  for name in "${SHIPPED[@]}"; do cp "$OUT_DIR/$name" "$PUBLIC_DIR/$name"; done
  # The scalar binary is the reference, not an artifact: never deployed.
  rm -f "$PUBLIC_DIR/streetview-wasm.wasm" "$PUBLIC_DIR/streetview-wasm.js"
  # Record the C++ source hash so verify-build.sh can detect staleness.
  printf '%s\n' "$SOURCE_HASH" > "$HASH_OUT"
  echo "==> Copied ${SHIPPED[*]} into public/wasm/ (source hash $SOURCE_HASH)."
else
  stale=0
  for name in "${SHIPPED[@]}"; do
    if ! cmp -s "$OUT_DIR/$name" "$PUBLIC_DIR/$name"; then
      echo "==> public/wasm/$name differs from this build." >&2
      stale=1
    fi
  done
  if [ "$stale" = "1" ]; then
    echo "    Run 'npm run build:wasm:update' to copy it (then gen:wasm-goldens if the C++ changed)." >&2
  else
    echo "==> public/wasm/ matches this build."
  fi
fi
echo "==> Emscripten build done."
