#!/usr/bin/env bash
# scripts/check-maps-key.sh
#
# Pre-deploy Maps API key validator.
# Usage:
#   MAPS_API_KEY=AIzaSy... ./scripts/check-maps-key.sh
#   ./scripts/check-maps-key.sh AIzaSy...   (positional arg also accepted)
#
# Checks:
#   1. Key is present and not a placeholder
#   2. Key matches the AIzaSy... format
#   3. Maps JavaScript API probe (billing, API-enabled) — NOT referrer restrictions
#
# Exit codes:
#   0 — key looks usable (referrers still require manual GCP Console check)
#   1 — key is missing, placeholder, or failed the live probe

set -euo pipefail

KEY="${1:-${MAPS_API_KEY:-}}"

RED='\033[0;31m'
YEL='\033[1;33m'
GRN='\033[0;32m'
NC='\033[0m'

fail()  { echo -e "${RED}FAIL${NC}  $*" >&2; exit 1; }
warn()  { echo -e "${YEL}WARN${NC}  $*"; }
ok()    { echo -e "${GRN} OK ${NC}  $*"; }

echo "=== Maps API key pre-deploy check ==="
echo

# 1. Presence
if [[ -z "$KEY" ]]; then
  fail "No key provided. Pass via MAPS_API_KEY env or as the first argument."
fi

# 2. Placeholder detection
PLACEHOLDER_RE='(your[_-]?(google[_-]?)?maps[_-]?api[_-]?key|YOUR_MAPS_API_KEY|placeholder|replace|<.*>|AIzaSy-placeholder)'
if echo "$KEY" | grep -qiE "$PLACEHOLDER_RE"; then
  fail "Key looks like a placeholder: '$KEY'"
fi

ok "Key is not a placeholder"

# 3. Format check
if ! echo "$KEY" | grep -qE '^AIzaSy[A-Za-z0-9_-]{33}$'; then
  warn "Key doesn't match expected AIzaSy...[33 chars] format (length ${#KEY})."
  warn "Continuing — some valid keys may be longer."
fi

# 4. Live probe — curl the Maps JS bootstrap
echo "  Probing Maps JS API (billing + enabled check)..."
HTTP_STATUS=$(curl -s -o /tmp/maps_probe_body.txt -w "%{http_code}" \
  --max-time 10 \
  -H "User-Agent: deploy-preflight/1.0" \
  "https://maps.googleapis.com/maps/api/js?key=${KEY}&v=weekly")

BODY=$(cat /tmp/maps_probe_body.txt 2>/dev/null || echo "")
rm -f /tmp/maps_probe_body.txt

if [[ "$HTTP_STATUS" != "200" ]]; then
  fail "Maps JS API returned HTTP $HTTP_STATUS — key may be invalid or API not enabled."
fi

# Check for known error markers in the response body
for MARKER in "InvalidKey" "MapsInvalidKey" "AuthFailure" "ApiNotActivatedMapError" "MapsApiAccessError"; do
  if echo "$BODY" | grep -q "$MARKER"; then
    fail "Maps JS API response contains '$MARKER' — check key validity, API enablement, and billing."
  fi
done

ok "Maps JS API probe passed (HTTP 200, no auth error markers)"

echo
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${YEL}IMPORTANT — manual check still required:${NC}"
echo "  Referrer restrictions CANNOT be verified from a script."
echo "  Go to GCP Console → APIs & Services → Credentials → your key:"
echo "    • HTTP referrer (website) restrictions must include:"
echo "        https://test.1ink.us/*"
echo "        https://go.1ink.us/*"
echo "        http://localhost:3000/*"
echo "    • APIs enabled for this key: Maps JavaScript API, Directions API"
echo "    • Billing account linked and active"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo
echo -e "${GRN}Key check passed. Proceed with:${NC}"
echo "  MAPS_API_KEY=\"$KEY\" python deploy.py"
echo
