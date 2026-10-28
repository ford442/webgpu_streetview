#!/usr/bin/env bash
# scripts/fuzz-cpp.sh
# Build the libFuzzer harnesses (cpp/fuzz/, clang + ASan/UBSan, SIMDe path)
# and run each for FUZZ_SECONDS (default 60). A crash fails the script and
# leaves the reproducer (crash-*) in cpp/build-fuzz/artifacts/<target>/.
#
#   bash scripts/fuzz-cpp.sh [target ...]     # default: every harness
#   FUZZ_SECONDS=600 npm run fuzz:cpp
#
# The corpora in cpp/build-fuzz/corpus/ persist between local runs (CI caches
# them); none is committed.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD_DIR="$REPO_ROOT/cpp/build-fuzz"
SECONDS_PER_TARGET="${FUZZ_SECONDS:-60}"
CXX_COMPILER="${FUZZ_CXX:-clang++}"
TARGETS=("$@")
if [ "${#TARGETS[@]}" -eq 0 ]; then
  TARGETS=(fuzz_luma fuzz_polyline fuzz_dsp fuzz_depth)
fi

cmake -S "$REPO_ROOT/cpp" -B "$BUILD_DIR" -DCMAKE_BUILD_TYPE=RelWithDebInfo \
  -DCMAKE_CXX_COMPILER="$CXX_COMPILER" -DSTREETVIEW_FUZZ=ON -DBUILD_TESTING=OFF >/dev/null
cmake --build "$BUILD_DIR" -j"$(nproc 2>/dev/null || echo 4)" --target "${TARGETS[@]}"

failed=0
for target in "${TARGETS[@]}"; do
  corpus="$BUILD_DIR/corpus/$target"
  artifacts="$BUILD_DIR/artifacts/$target"
  mkdir -p "$corpus" "$artifacts"
  echo "==> $target for ${SECONDS_PER_TARGET}s"
  if ! "$BUILD_DIR/fuzz/$target" "$corpus" \
      -max_total_time="$SECONDS_PER_TARGET" -max_len=65536 -timeout=10 -rss_limit_mb=2048 \
      -artifact_prefix="$artifacts/" -print_final_stats=1 2>"$BUILD_DIR/$target.log"; then
    echo "❌ $target found a crash:" >&2
    tail -40 "$BUILD_DIR/$target.log" >&2
    failed=1
  else
    grep -E "stat::number_of_executed_units|cov:" "$BUILD_DIR/$target.log" | tail -2
  fi
done
exit "$failed"
