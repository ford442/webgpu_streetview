#!/usr/bin/env bash
# Patch CRA IIFE bundles so Cesium 1.140+ ESM-only code runs without
# "Cannot use 'import.meta' outside a module" (see AGENTS.md).
set -euo pipefail

BUILD_DIR="${1:-build}"
PATCHED=0

patch_file() {
  local file="$1"
  if grep -qE 'import\.meta|__webpack_module__' "$file" 2>/dev/null; then
    sed -i 's/import\.meta/({url:typeof window!=="undefined"?window.location.href:""})/g' "$file"
    sed -i 's/__webpack_module__/undefined/g' "$file"
    echo "  patched $(basename "$file")"
    PATCHED=1
  fi
}

if [ ! -d "$BUILD_DIR/static/js" ]; then
  echo "⚠️  No $BUILD_DIR/static/js — skipping Cesium patch"
  exit 0
fi

for file in "$BUILD_DIR"/static/js/*.js; do
  [ -f "$file" ] || continue
  patch_file "$file"
done

if [ "$PATCHED" -eq 1 ]; then
  echo "✅ Cesium / import.meta compatibility patch applied"
else
  echo "✅ No import.meta patterns found in JS bundles (patch not needed)"
fi
