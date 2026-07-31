#!/bin/bash
# scripts/verify-build.sh
# Post-build safety verification for WebGPU StreetView.
# Run automatically via "npm run build" (after vite build) or manually:
#   ./scripts/verify-build.sh
#
# Exits non-zero if the build looks unsafe to deploy (real keys, bad config, etc.).
# This is the last line of defense before python deploy.py.

set -euo pipefail

BUILD_DIR="${1:-build}"
ERRORS=0
SCRIPT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "🔍 Verifying build in ${BUILD_DIR}/ ..."

if [ ! -d "$BUILD_DIR" ]; then
  echo "❌ ERROR: $BUILD_DIR directory does not exist. Run 'npm run build' first."
  exit 1
fi

echo "ℹ️  Historical key check disabled (key is intentionally used with referrer restrictions)"

# ---------------------------------------------------------------------------
# 1a. WASM binary: must exist, be non-empty, and not be stale vs WAT source.
# ---------------------------------------------------------------------------
WASM_FILE="$BUILD_DIR/wasm/streetview-wasm.wasm"
WAT_SRC="$SCRIPT_ROOT/cpp/src/streetview-wasm.wat"
WASM_HASH_FILE="$SCRIPT_ROOT/public/wasm/streetview-wasm.wasm.sha256"

if [ ! -f "$WASM_FILE" ]; then
  echo "❌ ERROR: $WASM_FILE is missing."
  echo "   Run 'npm run build:wasm' then 'vite build' (or simply 'npm run build')."
  ERRORS=$((ERRORS+1))
else
  WASM_BYTES=$(wc -c < "$WASM_FILE")
  if [ "$WASM_BYTES" -eq 0 ]; then
    echo "❌ ERROR: $WASM_FILE is empty (0 bytes). WASM build may have failed silently."
    ERRORS=$((ERRORS+1))
  else
    echo "✅ build/wasm/streetview-wasm.wasm present (${WASM_BYTES} bytes)"
  fi

  # Staleness check: compare the WAT source hash recorded at build time against
  # the current WAT source.  A mismatch means the WAT was modified after the
  # last 'npm run build:wasm' — the committed binary may be out of date.
  if [ -f "$WASM_HASH_FILE" ] && [ -f "$WAT_SRC" ] && command -v sha256sum &>/dev/null; then
    RECORDED_HASH=$(cat "$WASM_HASH_FILE")
    CURRENT_HASH=$(sha256sum "$WAT_SRC" | awk '{print $1}')
    if [ "$RECORDED_HASH" != "$CURRENT_HASH" ]; then
      echo "❌ ERROR: WAT source has changed since the last WASM build."
      echo "   Run 'npm run build:wasm' to regenerate the binary, then rebuild."
      ERRORS=$((ERRORS+1))
    else
      echo "✅ WASM binary is up-to-date with WAT source (hash match)"
    fi
  elif [ ! -f "$WASM_HASH_FILE" ]; then
    echo "⚠️  WASM source hash file missing ($WASM_HASH_FILE)."
    echo "   Run 'npm run build:wasm' to generate it."
  fi
fi

# 2. Verify config.js exists and is safe (empty or placeholder, never a real key)
CONFIG_JS="$BUILD_DIR/config.js"
if [ ! -f "$CONFIG_JS" ]; then
  echo "❌ ERROR: $CONFIG_JS is missing (Vite should have copied it from public/)."
  ERRORS=$((ERRORS+1))
else
  if grep -q 'window.MAPS_API_KEY = ""' "$CONFIG_JS" || grep -q 'PLACEHOLDER' "$CONFIG_JS" || grep -q 'YOUR_REAL' "$CONFIG_JS"; then
    echo "✅ config.js is safe (empty/placeholder as expected)"
  else
    if grep -q 'AIzaSy' "$CONFIG_JS"; then
      echo "❌ WARNING: config.js appears to contain a real API key. This should only happen via MAPS_API_KEY=... during deploy.py"
      ERRORS=$((ERRORS+1))
    else
      echo "✅ config.js present (content looks non-real)"
    fi
  fi
fi

# 3. Check the main bundle does not contain any obvious real key patterns (defense in depth)
MAIN_JS=$(find "$BUILD_DIR/static/js" -name 'main.*.js' | head -1)
if [ -n "$MAIN_JS" ]; then
  if grep -q 'AIzaSy' "$MAIN_JS"; then
    echo "ℹ️  Note: Main bundle contains an 'AIzaSy...' string (this is the build-time or deploy-baked key)."
    echo "    This is acceptable when using REACT_APP_MAPS_API_KEY / VITE_MAPS_API_KEY at build time or MAPS_API_KEY with deploy.py."
  elif grep -q '__RUNTIME_MAPS_KEY_SENTINEL__' "$MAIN_JS"; then
    echo "✅ Deploy sentinel present in main bundle (deploy.py will bake MAPS_API_KEY)"
  else
    echo "❌ ERROR: main bundle has no API key and no deploy sentinel — Maps will not load"
    ERRORS=$((ERRORS+1))
  fi
else
  echo "❌ ERROR: no main.*.js under $BUILD_DIR/static/js"
  ERRORS=$((ERRORS+1))
fi

# 4. index.html deploy sanity
INDEX_HTML="$BUILD_DIR/index.html"
if [ ! -f "$INDEX_HTML" ]; then
  echo "❌ ERROR: $INDEX_HTML is missing."
  ERRORS=$((ERRORS+1))
else
  if grep -q '%PUBLIC_URL%' "$INDEX_HTML"; then
    echo "❌ ERROR: build/index.html still contains %PUBLIC_URL% (unprocessed template)."
    ERRORS=$((ERRORS+1))
  else
    echo "✅ index.html has no unprocessed %PUBLIC_URL% placeholders"
  fi

  if ! grep -qE 'static/js/main[^"]*\.js' "$INDEX_HTML"; then
    echo "❌ ERROR: build/index.html does not reference static/js/main.*.js"
    ERRORS=$((ERRORS+1))
  else
    echo "✅ index.html references the main JS bundle"
  fi

  if grep -q 'config.js' "$INDEX_HTML"; then
    echo "ℹ️  index.html still references config.js (optional; go.1ink.us uses bundle-only keys)"
  else
    echo "✅ index.html uses bundle-only Maps key delivery (go.1ink.us style)"
  fi

  # Vite emits native ES modules — import.meta requires type=module on the script tag.
  if grep -q 'type="module"' "$INDEX_HTML"; then
    echo "✅ index.html loads the bundle as type=module (import.meta OK)"
  else
    echo "❌ ERROR: index.html does not mark the main script as type=module (import.meta will throw)"
    ERRORS=$((ERRORS+1))
  fi
fi

# 5. Bundle size + Cesium-in-main budgets (hard fail)
if [ -f "$SCRIPT_ROOT/scripts/check-bundle-budget.sh" ]; then
  bash "$SCRIPT_ROOT/scripts/check-bundle-budget.sh" "$BUILD_DIR" || ERRORS=$((ERRORS+1))
else
  echo "❌ ERROR: scripts/check-bundle-budget.sh missing"
  ERRORS=$((ERRORS+1))
fi

# 6. Refuse committed deploy credentials (passwords, tokens)
if [ -f "$SCRIPT_ROOT/scripts/check-deploy-secrets.sh" ]; then
  bash "$SCRIPT_ROOT/scripts/check-deploy-secrets.sh" || ERRORS=$((ERRORS+1))
fi

if [ $ERRORS -gt 0 ]; then
  echo ""
  echo "❌ VERIFICATION FAILED with $ERRORS error(s). DO NOT DEPLOY THIS BUILD."
  exit 1
else
  echo ""
  echo "✅ BUILD VERIFICATION PASSED — safe to hand to deploy.py (with MAPS_API_KEY)."
  echo "   Next step on a machine with the secret:"
  echo "     MAPS_API_KEY=your_real_key_here python deploy.py"
  exit 0
fi
