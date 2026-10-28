#!/usr/bin/env bash
# scripts/test-wasm-sanitizers.sh
# The doctest suite compiled by the pinned emcc with the shipped SIMD feature
# set (-msimd128 …) and -fsanitize=address,undefined, run under node: the
# real wasm_simd128.h path (not SIMDe) checked for UB and out-of-bounds
# accesses, goldens included. CI job `wasm-sanitizers`.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD_DIR="$REPO_ROOT/cpp/build-wasm-tests"
if ! command -v emcmake >/dev/null 2>&1; then
  for env in "${EMSDK:-}/emsdk_env.sh" "$HOME/emsdk/emsdk_env.sh"; do
    # shellcheck disable=SC1090
    if [ -f "$env" ]; then source "$env" >/dev/null; break; fi
  done
fi
command -v emcmake >/dev/null 2>&1 || { echo "emcmake not found (activate emsdk $(cat "$REPO_ROOT/cpp/emsdk.version"))" >&2; exit 1; }

emcmake cmake -S "$REPO_ROOT/cpp" -B "$BUILD_DIR" -DCMAKE_BUILD_TYPE=Debug \
  -DSTREETVIEW_WASM_TESTS=ON -DSTREETVIEW_SANITIZERS=ON
cmake --build "$BUILD_DIR" -j"$(nproc 2>/dev/null || echo 4)"
ctest --test-dir "$BUILD_DIR" --output-on-failure
