#!/bin/bash
# scripts/verify-build.sh
# Post-build safety verification for WebGPU StreetView.
# Run automatically via "npm run build" (after react-scripts) or manually:
#   ./scripts/verify-build.sh
#
# Exits non-zero if the build looks unsafe to deploy (real keys, bad config, etc.).
# This is the last line of defense before python deploy.py.

set -euo pipefail

BUILD_DIR="${1:-build}"
ERRORS=0

echo "🔍 Verifying build in ${BUILD_DIR}/ ..."

if [ ! -d "$BUILD_DIR" ]; then
  echo "❌ ERROR: $BUILD_DIR directory does not exist. Run 'npm run build' first."
  exit 1
fi

# 1. (Historical key block removed per maintainer decision)
#    The previous hard block on the old production key (AIzaSyBNfAGRfS1TNlH0EmxNfegqTsiwzYk6reM)
#    was intended to prevent unrestricted usage. With proper HTTP referrer restrictions
#    (test.1ink.us/* + go.1ink.us/*) this key is now intentionally used for the live demo.
#    We no longer treat its presence as a build error.
echo "ℹ️  Historical key check disabled (key is intentionally used with referrer restrictions)"

# 2. Verify config.js exists and is safe (empty or placeholder, never a real key)
CONFIG_JS="$BUILD_DIR/config.js"
if [ ! -f "$CONFIG_JS" ]; then
  echo "❌ ERROR: $CONFIG_JS is missing (CRA should have copied it from public/)."
  ERRORS=$((ERRORS+1))
else
  if grep -q 'window.MAPS_API_KEY = ""' "$CONFIG_JS" || grep -q 'PLACEHOLDER' "$CONFIG_JS" || grep -q 'YOUR_REAL' "$CONFIG_JS"; then
    echo "✅ config.js is safe (empty/placeholder as expected)"
  else
    # If it contains a real-looking key, that's bad for a committed build
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
    # This is expected to be the *current* build-time key if someone did export REACT_APP_... before npm run build,
    # or the key baked by deploy.py (MAPS_API_KEY=...).
    echo "ℹ️  Note: Main bundle contains an 'AIzaSy...' string (this is the build-time or deploy-baked key)."
    echo "    This is acceptable when using REACT_APP_MAPS_API_KEY at build time or MAPS_API_KEY with deploy.py."
    echo "    The old hard block on the historical key has been removed (referrer restrictions are now enforced on the key itself)."
  elif grep -q '__RUNTIME_MAPS_KEY_SENTINEL__' "$MAIN_JS"; then
    echo "✅ Deploy sentinel present in main bundle (deploy.py will bake MAPS_API_KEY)"
  else
    echo "❌ ERROR: main bundle has no API key and no deploy sentinel — Maps will not load"
    ERRORS=$((ERRORS+1))
  fi
fi

# 4. index.html deploy sanity (catches public/ template uploaded instead of build/)
INDEX_HTML="$BUILD_DIR/index.html"
if [ ! -f "$INDEX_HTML" ]; then
  echo "❌ ERROR: $INDEX_HTML is missing."
  ERRORS=$((ERRORS+1))
else
  if grep -q '%PUBLIC_URL%' "$INDEX_HTML"; then
    echo "❌ ERROR: build/index.html still contains %PUBLIC_URL% (unprocessed CRA template)."
    ERRORS=$((ERRORS+1))
  else
    echo "✅ index.html has no unprocessed %PUBLIC_URL% placeholders"
  fi

  if ! grep -q 'static/js/main' "$INDEX_HTML"; then
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
fi

# 5. Cesium / CRA IIFE: main bundle must not contain raw import.meta
MAIN_JS=$(find "$BUILD_DIR/static/js" -name 'main.*.js' | head -1)
if [ -n "$MAIN_JS" ]; then
  if grep -q 'import\.meta' "$MAIN_JS"; then
    echo "❌ ERROR: $MAIN_JS still contains import.meta — run ./scripts/patch-cesium-bundle.sh"
    ERRORS=$((ERRORS+1))
  else
    echo "✅ No raw import.meta in main bundle (Cesium patch OK)"
  fi
fi

# 6. Optional: size sanity (warn only)
BUNDLE_SIZE=$(du -sm "$BUILD_DIR" | cut -f1)
echo "ℹ️  Build size: ${BUNDLE_SIZE} MB"

# 7. Refuse committed deploy credentials (passwords, tokens)
SCRIPT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
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
