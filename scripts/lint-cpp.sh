#!/usr/bin/env bash
# C++ lint: clang-format (cpp/.clang-format, checked, never rewritten here)
# and clang-tidy (cpp/.clang-tidy: bugprone-*, clang-analyzer-* and
# performance-* findings are errors; modernize-* and
# cppcoreguidelines-pro-bounds-* only print).
#
# tidy runs twice when it can: over the host compile database (cpp/build-host)
# and over the Emscripten one (cpp/build-emscripten, written by
# `npm run build:wasm`) — the -msimd128 wasm32 compile takes the
# <wasm_simd128.h> branches the host never sees. Missing tidy/format or a
# missing host database fails, so CI cannot silently skip; the emscripten
# pass is skipped (with a note) when that tree or em++ is absent.
#
#   npm run lint:cpp
#   npm run format:cpp      # rewrite in place instead of checking
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB="${ROOT}/cpp/build-host"
EM_DB="${ROOT}/cpp/build-emscripten"
# Every .cpp in cpp/src must be listed here — a new translation unit that is
# not in this list is silently never linted.
SOURCES=(
  "${ROOT}/cpp/src/noise_module.cpp"
  "${ROOT}/cpp/src/geodesy_module.cpp"
  "${ROOT}/cpp/src/audio_module.cpp"
  "${ROOT}/cpp/src/hrtf_module.cpp"
  "${ROOT}/cpp/src/luma_module.cpp"
  "${ROOT}/cpp/src/cabin_dsp_module.cpp"
  "${ROOT}/cpp/src/depth_module.cpp"
  "${ROOT}/cpp/src/graph_module.cpp"
  "${ROOT}/cpp/src/runtime.cpp"
)
# Formatted (not tidied): headers, tests and fuzz harnesses too. Vendored code
# and the generated goldens header are left alone.
mapfile -t FORMATTED < <(cd "$ROOT" && ls cpp/src/*.cpp cpp/include/streetview/*.h \
  cpp/tests/*.cpp cpp/fuzz/*.cpp cpp/fuzz/*.h | grep -v 'goldens_generated\.h$')

if ! command -v clang-format >/dev/null 2>&1; then
  echo "lint:cpp: clang-format not found (install clang-format)" >&2
  exit 1
fi
if [[ "${1:-}" == "--fix" ]]; then
  (cd "$ROOT" && clang-format -i --style=file:cpp/.clang-format "${FORMATTED[@]}")
  echo "lint:cpp: formatted ${#FORMATTED[@]} files"
  exit 0
fi
(cd "$ROOT" && clang-format --dry-run --Werror --style=file:cpp/.clang-format "${FORMATTED[@]}") || {
  echo "lint:cpp: run npm run format:cpp" >&2
  exit 1
}

if [[ ! -f "${DB}/compile_commands.json" ]]; then
  echo "lint:cpp: missing ${DB}/compile_commands.json — run npm run test:cpp first" >&2
  exit 1
fi

if ! command -v clang-tidy >/dev/null 2>&1; then
  echo "lint:cpp: clang-tidy not found (install clang-tidy)" >&2
  exit 1
fi

clang-tidy -p "${DB}" --config-file="${ROOT}/cpp/.clang-tidy" "${SOURCES[@]}"

# The wasm32 pass parses emsdk's libc++, which only supports the clang it
# ships with and the release before; an older clang-tidy cannot even parse
# <algorithm> there (missing __builtin_clzg …, then a crash). Point
# EM_CLANG_TIDY at a new enough one (e.g. clang-tidy-23 for emsdk 6.0.6's
# LLVM 24); otherwise the pass is skipped, loudly.
EM_TIDY="${EM_CLANG_TIDY:-clang-tidy}"
major() { "$1" --version 2>/dev/null | grep -oE 'version [0-9]+' | head -1 | grep -oE '[0-9]+'; }
if [[ ! -f "${EM_DB}/compile_commands.json" ]] || ! command -v em++ >/dev/null 2>&1; then
  echo "lint:cpp: no cpp/build-emscripten database or em++ — wasm32 tidy pass skipped"
elif ! command -v "${EM_TIDY}" >/dev/null 2>&1; then
  echo "lint:cpp: ${EM_TIDY} not found — wasm32 tidy pass skipped"
else
  EM_CLANG="$(dirname "$(command -v em++)")/../bin/clang"
  [[ -x "${EM_CLANG}" ]] || EM_CLANG="${EMSDK:-}/upstream/bin/clang"
  need=$(( $(major "${EM_CLANG}") - 1 ))
  have=$(major "${EM_TIDY}")
  if [[ -z "${have}" || "${have}" -lt "${need}" ]]; then
    echo "lint:cpp: ${EM_TIDY} is LLVM ${have:-?}; emsdk's libc++ needs >= ${need} — wasm32 tidy pass skipped (set EM_CLANG_TIDY)"
  else
    # clang-tidy's own clang reads the em++ entries as host commands: give it
    # emcc's target, sysroot and include setup (`em++ --cflags`).
    EXTRA=()
    for flag in $(em++ --cflags); do EXTRA+=("--extra-arg=${flag}"); done
    "${EM_TIDY}" -p "${EM_DB}" --config-file="${ROOT}/cpp/.clang-tidy" "${EXTRA[@]}" "${SOURCES[@]}"
  fi
fi
