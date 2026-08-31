# 🛡️ Billing Safety Checklist - Quick Reference

**Use this checklist EVERY TIME you work with Google Cloud APIs.**

---

## Before Enabling Any API

- [ ] Project created specifically for this application (not personal account)
- [ ] Billing account linked with notifications enabled
- [ ] Budget alerts configured at: $10, $25, $50, $100
- [ ] Cost Management → "Prevent overspend" enabled

---

## When Creating API Keys

- [ ] API key created in Google Cloud Console
- [ ] **IMMEDIATELY set HTTP referrer restrictions** (do NOT skip!)
  - Development: `localhost:3000/*`, `localhost:3001/*`, etc.
  - Production: Your actual domain only
- [ ] API-specific restrictions applied (Maps JS, not all APIs)
- [ ] Key labeled with purpose: `app-name-env-domain`
- [ ] Key added to `.env.local` or passed via `MAPS_API_KEY=... python deploy.py` (NOT hardcoded in source)
- [ ] `.env.local` file is in `.gitignore` (don't commit)

---

## When Deploying

- [ ] `DEPLOY_TOKEN` exported from secure storage (never committed to git)
- [ ] `./scripts/check-deploy-secrets.sh` passes (no hardcoded deploy credentials in repo)
- [ ] Production Maps key passed via `MAPS_API_KEY` env var or GitHub Actions secret
- [ ] See `docs/DEPLOY_CHECKLIST.md` for full pre/post deploy steps

---

## After Deploying

- [ ] Check billing daily for first week
- [ ] Review API usage logs weekly
- [ ] Verify website restrictions still in place
- [ ] Test that requests from wrong domain are rejected
- [ ] Confirm all API keys have restrictions (no exceptions!)

---

## Monthly Maintenance

- [ ] Review Google Cloud billing dashboard
- [ ] Check all enabled APIs (disable unused ones)
- [ ] Verify all API keys have restrictions
- [ ] Test budget alerts are working
- [ ] Document any cost changes

---

## Billable In-App Features

Most of the app runs on the Maps **JavaScript** API (one panorama session). These
features spend *additional* per-request quota and each ships its own guard rails.

### Place search, autocomplete, and nearby POIs (Maps JS **Places** + optional Static)

Destination search lives in `src/search/` and `src/hooks/usePlaceSearch.ts`.
Autocomplete / Place Details / Nearby Search run only after **explicit typing
or toggling Nearby POIs**. Coordinate paste and panorama-id paste never call
Places. Nearby POIs default **off** for the session.

| Guard | Default | Where |
|-------|---------|-------|
| Nearby POI toggle | **off** | Search bar checkbox; `PlaceSearchBudget.setNearbyEnabled` |
| Autocomplete debounce | 350 ms | `PLACE_SEARCH_DEFAULTS.autocompleteDebounceMs` |
| Nearby throttle | 4000 ms between batches | `PlaceSearchBudget.allow('nearby')` |
| Session request budget (all meters) | 80 | `PLACE_SEARCH_DEFAULTS.maxSessionRequests` |
| Consecutive-error circuit breaker | 5 | `PLACE_SEARCH_DEFAULTS.maxConsecutiveErrors` |
| Nearby marker cap | 20 | `PLACE_SEARCH_DEFAULTS.maxNearbyMarkers` |
| Places library load | lazy `importLibrary('places')` | `placesClient.ts` — not at Maps boot |
| Static preview on POI ScoutCard | one-shot, budgeted | `buildBudgetedStaticPreviewUrl` |
| Cache | recent queries in `localStorage` only (text); never Google imagery | `recentSearches.ts` / `swPolicy` |

**Meters counted toward the session budget:** `autocomplete`, `placeDetails`,
`nearby`, `geocode` (forward), `staticPreview`, `streetViewLookup` (coverage).

**Reverse-geocode** (`src/utils/panoLocation.ts`) is opt-in (`includeAddress`) for
search / globe / full address, cached per panorama id. Cruise hops and the car
HUD use `getLocation().description` only — they do **not** call Geocoding.
`REQUEST_DENIED` logs once (`geocodeAuth`) and is never treated as a stuck hop.

**Kill switch** — from DevTools:

```js
window.__PLACE_SEARCH__.kill();    // refuse every subsequent Places/Static/geocode extra
window.__PLACE_SEARCH__.getStats(); // networkRequests, byMeter, budgetRemaining, killed
```

`kill()` is permanent for the life of the page. Nearby stays off until the user
checks the box; with the box unchecked, Network should show **zero** Places
traffic.

**Checks before shipping a change to this feature**:

- [ ] Nearby toggle still defaults **off**
- [ ] Coordinate / pano-id submit does not call Autocomplete
- [ ] Unit tests pass: `npx vitest run src/search/parseSearchQuery.test.ts src/search/placeSearchBudget.test.ts src/search/geocodeAuth.test.ts src/search/placesClient.geocode.test.ts src/utils/panoLocation.test.ts`
- [ ] Google imagery is still `network-only` in `src/offline/swPolicy.ts`

### Rear-view mirror imagery (Street View **Static** API)

`src/car/rearViewFeed.ts` fetches a rear-facing still at `carHeading + 180` so
the cabin mirror can show what is actually behind the car.

| Guard | Default | Where |
|-------|---------|-------|
| Opt-in toggle (persisted, **off** by default) | off | Car dashboard → **Rear**; `useRearViewFeed` |
| Throttle between network requests | 3000 ms | `REAR_VIEW_DEFAULTS.minIntervalMs` |
| Movement gate before a pose is even offered | 12 m / 20° / new pano | `useRearViewFeed` |
| Session request budget (hard stop) | 200 | `REAR_VIEW_DEFAULTS.maxSessionRequests` |
| Consecutive-failure circuit breaker | 5 | `REAR_VIEW_DEFAULTS.maxConsecutiveErrors` |
| Blocked entirely | offline, Maps auth failure, Low quality, no key | `RearViewFeed.setBlocked()` |
| Cache | session memory only, 48 entries, never persisted | `RearViewFeed` LRU |

**Kill switch** — from DevTools on any page running car mode:

```js
window.__REARVIEW_FEED__.kill();   // aborts in-flight, drops cache, permanent
window.__REARVIEW_FEED__.getStats(); // networkRequests, budgetRemaining, blockReason
```

`kill()` is permanent for the life of the page; re-enabling the toggle will not
resurrect it. Reload after the underlying billing issue is resolved.

**Checks before shipping a change to this feature**:

- [ ] Toggle still defaults **off** for a fresh profile (`localStorage` cleared)
- [ ] With the toggle off, DevTools → Network shows **zero** `maps/api/streetview` requests
- [ ] Throttle/dedupe unit tests pass: `npx vitest run src/car/__tests__/rearViewFeed.test.ts`
- [ ] Google imagery is still `network-only` in `src/offline/swPolicy.ts` (never SW-cached)

---

## Emergency (Unexpected Costs)

**DO THIS IMMEDIATELY** (within 5 minutes):

1. Go to **APIs & Services → Credentials**
2. Find the exposed API key
3. Click **"Delete"** (or **"Disable"**)
4. Go to **Cloud Logging** → search for unusual requests
5. Contact Google Cloud Support → request cost review

---

## Red Flags (Stop & Investigate)

🚨 **If you see ANY of these, take action immediately**:

- [ ] API key works without HTTP restrictions
- [ ] API key not mentioned in documentation
- [ ] Multiple API keys with overlapping restrictions
- [ ] Billing alert triggered without explanation
- [ ] Requests from IP addresses you don't recognize
- [ ] API usage spike with no code changes
- [ ] Same key used in development and production
- [ ] API key in git history
- [ ] `DEPLOY_TOKEN` or SFTP password committed to Python/shell deploy scripts
- [ ] `deploy_old.py` present in the repository

---

## Reference Files

📄 **Read these before deploying**:
- [`docs/DEPLOY_CHECKLIST.md`](./docs/DEPLOY_CHECKLIST.md) - Production deploy + credential hygiene
- [`.env.deploy.example`](./.env.deploy.example) - Required deploy environment variables
- [`BILLING_WARNINGS.md`](./BILLING_WARNINGS.md) - Full incident report
- [`docs/GOOGLE_CLOUD_API_SETUP_GUIDE.md`](./docs/GOOGLE_CLOUD_API_SETUP_GUIDE.md) - Complete setup steps
- [`CLAUDE.md`](./CLAUDE.md) - Maps key recovery behaviors

---

## One-Page Summary

| Task | What to Do | Why |
|------|-----------|-----|
| **Before API** | Create separate GCP project | Isolate risk |
| **Create Key** | Set HTTP referrer restrictions | Prevent unauthorized use |
| **Develop** | Use `.env` file, not hardcoded values | Avoid committing secrets |
| **Monitor** | Check billing weekly | Catch anomalies early |
| **Rotate** | New key every 90 days | Limit exposure window |
| **Incident** | Delete key immediately | Stop unauthorized charges |

---

**Remember**: A few minutes of setup now saves you $300-800+ in unexpected charges later.

**When in doubt, check `BILLING_WARNINGS.md` or `GOOGLE_CLOUD_API_SETUP_GUIDE.md`.**
