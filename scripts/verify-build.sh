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

# 1. Check that the sensitive historical key is NOT present anywhere in the build
FORBIDDEN_KEY="AIzaSyBNfAGRfS1TNlH0EmxNfegqTsiwzYk6reM"
if grep -r --binary-files=without-match -l "$FORBIDDEN_KEY" "$BUILD_DIR" 2>/dev/null; then
  echo "❌ CRITICAL: Historical production key found in build artifacts!"
  ERRORS=$((ERRORS+1))
else
  echo "✅ Historical key absent from build"
fi

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
    # This is expected to be the *current* build-time key if someone did export REACT_APP_... before npm run build.
    # We only fail hard on the *known historical bad key*.
    echo "ℹ️  Note: Main bundle contains an 'AIzaSy...' string (this is the build-time fallback key)."
    echo "    This is acceptable only if you intentionally built with REACT_APP_MAPS_API_KEY set."
    echo "    For the safest deploys, build without it and rely on deploy.py MAPS_API_KEY override."
  else
    echo "✅ No API key pattern found in main bundle (pure runtime config path)"
  fi
fi

# 4. Basic sanity: index.html must reference config.js
if ! grep -q 'config.js' "$BUILD_DIR/index.html"; then
  echo "❌ ERROR: build/index.html does not reference config.js"
  ERRORS=$((ERRORS+1))
else
  echo "✅ index.html correctly references config.js"
fi

# 5. Optional: size sanity (warn only)
BUNDLE_SIZE=$(du -sm "$BUILD_DIR" | cut -f1)
echo "ℹ️  Build size: ${BUNDLE_SIZE} MB"

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
