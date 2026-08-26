#!/bin/bash
# scripts/check-bundle-budget.sh
# Fail the build if the production JS bundle regresses past documented budgets.
# Invoked from scripts/verify-build.sh after vite build.
#
# Budgets (see docs/DEVELOPER_CONTEXT.md §6):
#   MAIN_GZIP_BUDGET_BYTES  — gzipped main.*.js (re-baselined for Vite ESM)
#   CESIUM_MAX_HITS         — "Cesium" string matches in main (CDN loader URL = 1)
#   CHUNK_GZIP_BUDGET_BYTES — per lazy *.chunk.js (catches Cesium leaking into a chunk)

set -euo pipefail

BUILD_DIR="${1:-build}"
MAIN_GZIP_BUDGET_BYTES="${MAIN_GZIP_BUDGET_BYTES:-409600}"   # 400 KiB
CESIUM_MAX_HITS="${CESIUM_MAX_HITS:-1}"
CHUNK_GZIP_BUDGET_BYTES="${CHUNK_GZIP_BUDGET_BYTES:-102400}" # 100 KiB default, per lazy chunk

# Per-chunk overrides, keyed by the chunk's logical name (its filename up to
# the content-hash segment, e.g. "carModeRuntime.<hash>.chunk.js"). Anything
# not listed here still uses CHUNK_GZIP_BUDGET_BYTES above.
declare -A CHUNK_GZIP_BUDGET_OVERRIDES=(
  # three.js bump to a WebGPURenderer-capable release (r160 -> pinned 0.180,
  # cabin/pano device-unification "one GPUDevice, one frame" effort) shifted
  # more of three's own shared payload into this already-lazy car-mode chunk
  # (measured ~108 KiB, was ~32 KiB pre-bump) — see AGENTS.md "Car Mode
  # Rendering Stack".
  ["carModeRuntime"]=143360   # 140 KiB
  # three/webgpu (the node-material/TSL renderer) loads only behind the
  # experimental `?cabin=webgpu` escape hatch (createCabinRenderer.ts /
  # preloadWebGPUCabinRenderer) as its own further-lazy chunk — nobody on the
  # default WebGL path fetches it. Budgeted generously since three/webgpu is
  # inherently large and this never ships to default users.
  ["three.webgpu"]=204800     # 200 KiB
)

ERRORS=0

if [ ! -d "$BUILD_DIR/static/js" ]; then
  echo "❌ ERROR: $BUILD_DIR/static/js missing — run npm run build first."
  exit 1
fi

mapfile -t MAIN_JS_FILES < <(find "$BUILD_DIR/static/js" -maxdepth 1 -name 'main.*.js' | sort)
if [ "${#MAIN_JS_FILES[@]}" -eq 0 ]; then
  echo "❌ ERROR: no main.*.js in $BUILD_DIR/static/js"
  exit 1
fi
if [ "${#MAIN_JS_FILES[@]}" -gt 1 ]; then
  echo "❌ ERROR: expected exactly one main.*.js, found ${#MAIN_JS_FILES[@]}:"
  printf '   %s\n' "${MAIN_JS_FILES[@]}"
  exit 1
fi

MAIN_JS="${MAIN_JS_FILES[0]}"
MAIN_GZIP=$(gzip -c "$MAIN_JS" | wc -c)
MAIN_RAW=$(wc -c < "$MAIN_JS" | tr -d ' ')

echo "📦 Bundle budget check"
echo "   main: $MAIN_JS"
echo "   raw:  ${MAIN_RAW} bytes"
echo "   gzip: ${MAIN_GZIP} bytes (budget ${MAIN_GZIP_BUDGET_BYTES})"

if [ "$MAIN_GZIP" -gt "$MAIN_GZIP_BUDGET_BYTES" ]; then
  echo "❌ ERROR: main.*.js gzip ${MAIN_GZIP} exceeds budget ${MAIN_GZIP_BUDGET_BYTES}"
  ERRORS=$((ERRORS + 1))
else
  echo "✅ main.*.js gzip within budget"
fi

CESIUM_HITS=$(grep -c Cesium "$MAIN_JS" || true)
echo "   Cesium hits in main: ${CESIUM_HITS} (max ${CESIUM_MAX_HITS})"
if [ "$CESIUM_HITS" -gt "$CESIUM_MAX_HITS" ]; then
  echo "❌ ERROR: Cesium appears to be bundled into main.js (hits=${CESIUM_HITS} > ${CESIUM_MAX_HITS})."
  echo "   Keep GlobeView lazy + CDN loadCesiumSDK(); see docs/DEVELOPER_CONTEXT.md §6."
  ERRORS=$((ERRORS + 1))
else
  echo "✅ Cesium-in-main check passed"
fi

shopt -s nullglob
CHUNK_FILES=("$BUILD_DIR"/static/js/*.chunk.js)
if [ "${#CHUNK_FILES[@]}" -eq 0 ]; then
  echo "ℹ️  No lazy *.chunk.js files"
else
  for chunk in "${CHUNK_FILES[@]}"; do
    chunk_name="$(basename "$chunk")"
    chunk_budget="$CHUNK_GZIP_BUDGET_BYTES"
    for prefix in "${!CHUNK_GZIP_BUDGET_OVERRIDES[@]}"; do
      if [[ "$chunk_name" == "$prefix".* ]]; then
        chunk_budget="${CHUNK_GZIP_BUDGET_OVERRIDES[$prefix]}"
        break
      fi
    done
    CHUNK_GZIP=$(gzip -c "$chunk" | wc -c)
    echo "   chunk: ${chunk_name} gzip ${CHUNK_GZIP} bytes (budget ${chunk_budget})"
    if [ "$CHUNK_GZIP" -gt "$chunk_budget" ]; then
      echo "❌ ERROR: ${chunk_name} gzip ${CHUNK_GZIP} exceeds chunk budget ${chunk_budget}"
      ERRORS=$((ERRORS + 1))
    fi
  done
  if [ "$ERRORS" -eq 0 ]; then
    echo "✅ lazy chunk gzip within budget"
  fi
fi

if [ "$ERRORS" -gt 0 ]; then
  echo "❌ Bundle budget check failed with ${ERRORS} error(s)."
  exit 1
fi

echo "✅ Bundle budget check passed"
exit 0
