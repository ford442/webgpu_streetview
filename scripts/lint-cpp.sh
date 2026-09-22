#!/usr/bin/env bash
# Advisory clang-tidy over the host C++ sources. WarningsAsErrors is empty in
# cpp/.clang-tidy, so findings print but do not fail the job. Missing tidy or a
# missing compilation database *does* fail — otherwise CI would silently skip.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB="${ROOT}/cpp/build-host"
# Every .cpp in cpp/src must be listed here — a new translation unit that is
# not in this list is silently never linted.
SOURCES=(
  "${ROOT}/cpp/src/noise_module.cpp"
  "${ROOT}/cpp/src/geodesy_module.cpp"
  "${ROOT}/cpp/src/audio_module.cpp"
  "${ROOT}/cpp/src/hrtf_module.cpp"
  "${ROOT}/cpp/src/luma_module.cpp"
  "${ROOT}/cpp/src/bindings.cpp"
)

if [[ ! -f "${DB}/compile_commands.json" ]]; then
  echo "lint:cpp: missing ${DB}/compile_commands.json — run npm run test:cpp first" >&2
  exit 1
fi

if ! command -v clang-tidy >/dev/null 2>&1; then
  echo "lint:cpp: clang-tidy not found (install clang-tidy)" >&2
  exit 1
fi

exec clang-tidy -p "${DB}" --config-file="${ROOT}/cpp/.clang-tidy" "${SOURCES[@]}"
