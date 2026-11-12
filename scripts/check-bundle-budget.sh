#!/bin/bash
# scripts/check-bundle-budget.sh
# Fail the build if the production JS bundle regresses past documented budgets.
# Invoked from scripts/verify-build.sh after vite build.
#
# Budgets and contracts live in scripts/chunks.json (#368) — see docs/DEVELOPER_CONTEXT.md §6:
#   main.gzipBudgetBytes / main.cesiumMaxHits  — gzipped main.*.js, "Cesium" string matches in main
#   defaultChunkGzipBudgetBytes, chunks[].gzipBudgetBytes — per lazy *.chunk.js
#   workers[].gzipBudgetBytes, forbiddenBundleText, forbiddenAssets — the depth Worker / ORT / model files
# Which modules may sit in which chunk, and the single-instance modules, are checked against
# build/chunk-graph.json by scripts/check-chunk-graph.mjs (called from verify-build.sh).
# Env overrides (MAIN_GZIP_BUDGET_BYTES, CESIUM_MAX_HITS, CHUNK_GZIP_BUDGET_BYTES,
# DEPTH_WORKER_GZIP_BUDGET_BYTES) still win, for experiments.

set -euo pipefail

BUILD_DIR="${1:-build}"
SCRIPT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONTRACTS="$SCRIPT_ROOT/scripts/chunks.json"

# One node call turns the contract file into shell assignments (numbers and plain names only).
eval "$(node -e '
const c = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
const out = [];
out.push(`CONTRACT_MAIN_BUDGET=${c.main.gzipBudgetBytes}`);
out.push(`CONTRACT_CESIUM_MAX=${c.main.cesiumMaxHits}`);
out.push(`CONTRACT_DEFAULT_CHUNK_BUDGET=${c.defaultChunkGzipBudgetBytes}`);
out.push("declare -A CHUNK_GZIP_BUDGET_OVERRIDES=(" + c.chunks.filter((x) => x.gzipBudgetBytes).map((x) => `["${x.name}"]=${x.gzipBudgetBytes}`).join(" ") + ")");
const w = (c.workers || [])[0];
out.push(`CONTRACT_WORKER_BUDGET=${w ? w.gzipBudgetBytes : 16384}`);
out.push("FORBIDDEN_BUNDLE_TEXT_RE=\"" + (c.forbiddenBundleText || []).join("|") + "\"");
console.log(out.join("\n"));
' "$CONTRACTS")"

MAIN_GZIP_BUDGET_BYTES="${MAIN_GZIP_BUDGET_BYTES:-$CONTRACT_MAIN_BUDGET}"
CESIUM_MAX_HITS="${CESIUM_MAX_HITS:-$CONTRACT_CESIUM_MAX}"
CHUNK_GZIP_BUDGET_BYTES="${CHUNK_GZIP_BUDGET_BYTES:-$CONTRACT_DEFAULT_CHUNK_BUDGET}"

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

# Scene depth (#320): onnxruntime-web is imported from a pinned CDN URL inside
# the depth Worker, and the model is fetched at run time from models/depth/.
# Neither may ever be bundled: no ORT runtime code (its wasm loader names the
# `ort-wasm-simd-threaded` files; its C API exports `OrtCreateSession`) and no
# .onnx under build/static. The Worker itself stays a few KB.
DEPTH_WORKER_GZIP_BUDGET_BYTES="${DEPTH_WORKER_GZIP_BUDGET_BYTES:-$CONTRACT_WORKER_BUDGET}"
ORT_IN_BUNDLE=$(grep -l -E "$FORBIDDEN_BUNDLE_TEXT_RE" "$BUILD_DIR"/static/js/*.js 2>/dev/null || true)
if [ -n "$ORT_IN_BUNDLE" ]; then
  echo "❌ ERROR: onnxruntime-web code is bundled into: ${ORT_IN_BUNDLE}"
  echo "   Load it from DEPTH_RUNTIME_URL inside the depth Worker (src/renderer/depth/)."
  ERRORS=$((ERRORS + 1))
fi
ONNX_IN_STATIC=$(find "$BUILD_DIR/static" -name '*.onnx' 2>/dev/null || true)
if [ -n "$ONNX_IN_STATIC" ]; then
  echo "❌ ERROR: a model file is bundled: ${ONNX_IN_STATIC} (models live in models/depth/, fetched at run time)"
  ERRORS=$((ERRORS + 1))
fi
for worker in "$BUILD_DIR"/static/js/depthWorker.*.worker.js; do
  [ -e "$worker" ] || continue
  WORKER_GZIP=$(gzip -c "$worker" | wc -c)
  echo "   depth worker: $(basename "$worker") gzip ${WORKER_GZIP} bytes (budget ${DEPTH_WORKER_GZIP_BUDGET_BYTES})"
  if [ "$WORKER_GZIP" -gt "$DEPTH_WORKER_GZIP_BUDGET_BYTES" ]; then
    echo "❌ ERROR: the depth Worker grew past its budget — is the runtime being bundled?"
    ERRORS=$((ERRORS + 1))
  fi
done
if [ -z "$ORT_IN_BUNDLE" ] && [ -z "$ONNX_IN_STATIC" ]; then
  echo "✅ scene-depth runtime and model not bundled"
fi

if [ "$ERRORS" -gt 0 ]; then
  echo "❌ Bundle budget check failed with ${ERRORS} error(s)."
  exit 1
fi

echo "✅ Bundle budget check passed"
exit 0
