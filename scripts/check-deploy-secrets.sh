#!/bin/bash
# scripts/check-deploy-secrets.sh
# Refuse deploy/CI when known credentials appear in committed deploy scripts.
#
# Usage: ./scripts/check-deploy-secrets.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ERRORS=0

echo "🔐 Checking for committed deploy credentials..."

if [ -f "$ROOT/deploy_old.py" ]; then
  echo "❌ deploy_old.py still present (legacy script contained hardcoded SFTP password)"
  ERRORS=$((ERRORS + 1))
fi

scan_file() {
  local file="$1"
  local pattern="$2"
  local description="$3"
  if grep -n -E "$pattern" "$file" >/dev/null 2>&1; then
    echo "❌ Found $description in $(basename "$file"):"
    grep -n -E "$pattern" "$file" | head -5
    ERRORS=$((ERRORS + 1))
  fi
}

# Only scan deploy automation — not docs, tests, or the checker itself.
for file in "$ROOT"/deploy.py "$ROOT"/scripts/*.sh; do
  [ -f "$file" ] || continue
  case "$(basename "$file")" in
    check-deploy-secrets.sh) continue ;;
  esac
  scan_file "$file" 'GoogleBez12' 'hardcoded SFTP password (GoogleBez12…)'
  scan_file "$file" '6de44dca5425348' 'hardcoded DEPLOY_TOKEN'
  scan_file "$file" "password[[:space:]]*=[[:space:]]*['\"][^'\"]{6,}['\"]" 'hardcoded password= assignment'
done

if [ $ERRORS -gt 0 ]; then
  echo ""
  echo "❌ DEPLOY SECRET CHECK FAILED with $ERRORS issue(s)."
  echo "   Remove secrets from source; use environment variables or GitHub Actions secrets."
  exit 1
fi

echo "✅ No known deploy credentials found in deploy scripts."
exit 0
