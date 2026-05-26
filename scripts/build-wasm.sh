#!/usr/bin/env bash
# scripts/build-wasm.sh
# Build the WebGPU StreetView WASM module.
#
# Prerequisites:
#   Option A – Emscripten (full C++ build):
#     source /path/to/emsdk/emsdk_env.sh    # activate emcc
#
#   Option B – wabt (WAT → WASM, no Emscripten required):
#     npm install   # installs wabt as a devDependency
#     node scripts/build-wasm.sh  # uses the Node.js wabt API automatically
#
# Output:
#   public/wasm/streetview-wasm.wasm   – compiled WASM binary
#   public/wasm/streetview-wasm.js     – Emscripten JS glue (Option A only)
#
# Usage:
#   bash scripts/build-wasm.sh [--release] [--wat-only]
#
#   --release    Pass -O3 to Emscripten (default when EMSCRIPTEN is detected).
#   --wat-only   Always use the WAT→WASM path, even if emcc is available.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CPP_DIR="$REPO_ROOT/cpp"
WAT_SRC="$CPP_DIR/src/streetview-wasm.wat"
OUT_DIR="$REPO_ROOT/public/wasm"
WASM_OUT="$OUT_DIR/streetview-wasm.wasm"
JS_OUT="$OUT_DIR/streetview-wasm.js"

mkdir -p "$OUT_DIR"

USE_WAT_ONLY=false
BUILD_TYPE="Release"

for arg in "$@"; do
  case "$arg" in
    --wat-only) USE_WAT_ONLY=true ;;
    --release)  BUILD_TYPE="Release" ;;
    --debug)    BUILD_TYPE="Debug" ;;
  esac
done

# ---------------------------------------------------------------------------
# Option A: Emscripten build
# ---------------------------------------------------------------------------
if ! $USE_WAT_ONLY && command -v emcc &>/dev/null; then
  echo "==> Emscripten detected ($(emcc --version | head -1))"
  echo "==> Building C++ → WASM via Emscripten …"

  BUILD_DIR="$CPP_DIR/build-emscripten"
  mkdir -p "$BUILD_DIR"
  cd "$BUILD_DIR"

  CXXFLAGS="-O3"
  if [[ "$BUILD_TYPE" == "Debug" ]]; then
    CXXFLAGS="-O0 -g"
  fi

  # Configure with Emscripten's CMake toolchain.
  emcmake cmake "$CPP_DIR" \
    -DCMAKE_BUILD_TYPE="$BUILD_TYPE" \
    -DCMAKE_CXX_FLAGS="$CXXFLAGS"

  emmake make -j"$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)"

  echo "==> Emscripten build done."
  echo "    WASM: $WASM_OUT"
  echo "    JS glue: $JS_OUT"
  exit 0
fi

# ---------------------------------------------------------------------------
# Option B: WAT → WASM via Node.js + wabt
# ---------------------------------------------------------------------------
echo "==> emcc not found (or --wat-only requested). Compiling WAT → WASM via wabt …"

if ! command -v node &>/dev/null; then
  echo "ERROR: Node.js is required when Emscripten is not available." >&2
  exit 1
fi

node - "$REPO_ROOT" <<'NODE_EOF'
const wabt = require('wabt');
const fs   = require('fs');
const path = require('path');

const repoRoot = process.argv[2];
const watSrc   = path.join(repoRoot, 'cpp', 'src', 'streetview-wasm.wat');
const outDir   = path.join(repoRoot, 'public', 'wasm');
const wasmOut  = path.join(outDir, 'streetview-wasm.wasm');

fs.mkdirSync(outDir, { recursive: true });

wabt().then(w => {
  const source = fs.readFileSync(watSrc, 'utf8');
  const module = w.parseWat(watSrc, source, {});
  module.validate();
  const { buffer } = module.toBinary({});
  fs.writeFileSync(wasmOut, buffer);
  module.destroy();
  console.log(`==> Written ${buffer.byteLength} bytes to ${wasmOut}`);
}).catch(err => {
  console.error('wabt compilation failed:', err.message);
  process.exit(1);
});
NODE_EOF

echo "==> WAT build done."
echo "    WASM: $WASM_OUT"
