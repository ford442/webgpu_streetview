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

### Session call meter (every Street View lookup, in one place)

`src/services/maps/callBudget.ts` counts every `StreetViewService.getPanorama`
the app makes (teleport prefetch, historical ring crawl, route-prefetch link
collection, the trip link-graph prefetch (`trip-prefetch`), trip replay
(`replay`), globe snap, pano image-date / IBL lookups, the route re-snap, the
coverage map's `coverage-graph` / `coverage-poi` / `coverage-map-click`) and
every place-search call, per kind and per call site, and caps each kind for the
session.

| Kind | Cap | Notes |
|------|-----|-------|
| `panorama` | 2000 / session | A runaway guard; a teleport is 1 call, a historical crawl 12, a route re-snap 1, on-route following **0**, trip prefetch ≈ route length / 10 m, a replayed hop 1 |
| `placeSearch` | counted only | capped by its own `PlaceSearchBudget` (80, above) |
| `directions` | **0** | Google `DirectionsService` — no provider uses it; raising the cap is a billing decision |
| `routing` | 40 / session | OSRM-compatible route requests (not Google, not billed — see below) |

```js
window.__STREETVIEW_PROBE__.getCallBudget(); // { total, byKind: {used, cap, remaining, blocked}, bySource }
```

### Routed road trips (Trip planner) — **no Google Directions**

Routes come from an **OSRM-compatible HTTP endpoint**, not Google:
`window.ROUTING_ENDPOINT` in `public/config.js` (unset = the public OSRM demo
server, for development / low volume only; `""` = routing off). One route
request per planned trip (and one per guest in a shared session).

| Guard | Default | Where |
|-------|---------|-------|
| Route provider | OSRM-compatible, `billable: false` | `src/services/routing/routingConfig.ts` |
| Google Directions provider | **not implemented / off** | `directions` meter cap 0 — add one only with a row here first |
| Route-following hop | **0** extra Maps calls (`getLinks` + `setPano` only, no prefetch hint) | `useCruiseMode.route.test.tsx` asserts it |
| Off-route re-snap | 1 metered `getPanorama` after 2 off-route hops | `app/useTripBindings.ts` (`route-resnap`) |
| "Save for offline" (trip link-graph prefetch) | **opt-in**, cost shown and confirmed first: ≈1 `getPanorama` per 10 m of route (one per pano walked), hard stop at 1.25× the estimate and at the session `panorama` cap; stores pano id / position / link ids + headings / capture date only — **never imagery** | `offline/tripPrefetch.ts` (`trip-prefetch`); `tripPrefetch.test.ts` |
| Offline drive over a saved graph | **0** Maps calls to plan a hop (`graph_astar` over IndexedDB data); the hop is still `setPano` | `tripController.ts` `planGraphHop`; `useCruiseMode.route.test.tsx` |
| Trip recording | **0** calls — samples the loaded panorama, `povStore` and the user's settings per hop | `trip/tripRecorder.ts` |
| Trip replay (local, `?trip=` link, shared-session guest) | user-initiated; **1 metered `getPanorama` by pano id per replayed hop** (button shows the count), stops at the session cap; a vanished pano with a recorded date costs one historical crawl (≤ 12, `historical-crawl`) | `trip/tripReplay.ts` (`replay`); `trip.test.ts` |
| Cache | route in memory only; trip graphs and recordings in IndexedDB (metadata); Google imagery still `network-only` | `swPolicy.ts` |

**Not Google, not billed, but with usage policies**: Open-Meteo live conditions
(opt-in, ≤ 1 request / 10 min while within 25 km, CC BY 4.0 attribution shown,
free tier is non-commercial) and Radio Browser station lookups (> 50 km moved).

**Checks before shipping a change to this feature**:

- [ ] `npx vitest run src/hooks/__tests__/useCruiseMode.route.test.tsx` — on-route hops make zero `getPanorama` calls
- [ ] No route source with `billable: true` is selectable without a row in this file
- [ ] Route responses are never written to Cache Storage / IndexedDB

### Coverage map (🛰 Coverage / `g`) — Maps JS map + metered lookups

`src/components/CoverageMap.tsx` (lazy chunk) shows where Street View exists,
on a **Google** top-down map or a **Cesium** view. Nothing billable runs
until the user opens the panel, and each extra source is its own toggle.

| Source | Default | Cost | Where |
|--------|---------|------|-------|
| Google top-down map | built on first open in Google mode, kept while the panel is open | 1 Dynamic Maps load per open | `coverageMap/googleCoverageMap.ts` |
| `StreetViewCoverageLayer` | **off**; attached only while "Street View coverage" is checked | coverage tile traffic on every pan / zoom | same |
| Linked-pano graph (Cesium) | **off**; "Linked panos" | ≤ 30 `getPanorama` per walk, ≤ 240 / session, metered `coverage-graph`; cached per pano id, re-walks only when the current pano leaves the drawn graph | `services/maps/panoCoverageGraph.ts` |
| POI coverage colouring | **off**; "POI coverage" (needs Nearby POIs, itself off) | ≤ 20 `getPanorama` (50 m) per batch, metered `coverage-poi`; free when a graph node is within 50 m; cached per place id | `search/poiCoverage.ts` |
| Map click → jump | per click | 1 `getPanorama` (60 m), metered `coverage-map-click` | `CoverageMap.tsx` |
| Cesium base imagery | Ion token → CartoCDN | not Google | `utils/cesiumImagery.ts` |

**Not used, on purpose:** Google coverage tiles inside Cesium
(`UrlTemplateImageryProvider` against Google's tile hosts). The Maps Platform
terms don't allow fetching Maps tiles outside a Maps SDK / API. The sanctioned
route is the **Map Tiles API** (2D tiles with the `layerStreetview` overlay,
session token, Google attribution), which is a separate SKU and needs its own
row here before anyone wires it. The same goes for Photorealistic 3D Tiles.

**Checks before shipping a change to this feature**:

- [ ] `npx vitest run src/components/CoverageMap.test.tsx src/services/maps/panoCoverageGraph.test.ts src/search/poiCoverage.test.ts`
- [ ] With the panel open and every box unchecked, Network shows no `getPanorama` (`GetMetadata`) and no coverage-tile requests
- [ ] `window.__STREETVIEW_PROBE__.getCallBudget().bySource` lists only `coverage-*` sources you toggled

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
- [Incident report (2026-05-08)](#appendix-incident-report-2026-05-08) - below
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

**When in doubt, check the incident appendix below or `docs/GOOGLE_CLOUD_API_SETUP_GUIDE.md`.**

---

# Appendix: incident report (2026-05-08)

_Merged from the former `BILLING_WARNINGS.md`._

## Critical Issue: Unexpected $300-800 Overnight Charges

**Status**: This project has experienced unexpected Google Cloud billing charges (2026-05-08) from enabling multiple APIs without proper safeguards. This document exists to prevent similar incidents in the future.

#### What Happened

- Multiple Google Cloud APIs were enabled on the same project
- API keys were created without **HTTP Referrer restrictions** (aka "Website restrictions")
- Within hours, unauthorized or misconfigured requests incurred significant costs
- The breach was not discovered until the cost was already substantial

#### Root Cause Analysis

1. **No Website Restrictions**: API keys were globally accessible, allowing anyone to use them
2. **Multiple Enabled APIs**: Each API can be exploited independently
3. **No Cost Alerts**: Budget notifications were not configured
4. **No API Usage Monitoring**: Changes went unnoticed until billing review

---

## Prevention Checklist

#### 🔴 BEFORE Enabling Any Google Cloud API

- [ ] **Create a new GCP Project** - Do NOT use personal/shared projects for public applications
- [ ] **Set up billing alerts** - Configure budget notifications at $10, $25, $50, etc.
- [ ] **Enable cost monitoring** - Use GCP Cost Management dashboard
- [ ] **Plan API costs** - Review pricing for each API you need
- [ ] **Use separate API keys** for different purposes (public vs. backend)

#### 🔴 WHEN Creating API Keys

- [ ] **Set HTTP Referrer restrictions** - Restrict to your domain(s) only
  - Go to: **APIs & Services → Credentials → Select Key → Application Restrictions → HTTP referrers**
  - Example: `localhost:3000/*`, `yourdomain.com/*`
- [ ] **Rotate keys regularly** - Every 90 days minimum
- [ ] **Enable API-specific quotas** - Limit requests per day/hour if possible
- [ ] **Document restrictions** - Record which key is for which service
- [ ] **Never commit API keys** to version control - Use `.env` files

#### 🔴 AFTER Deploying to Production

- [ ] **Monitor daily costs** - Set up email alerts for cost spikes
- [ ] **Review API usage logs** - Check for unusual patterns
- [ ] **Audit all enabled APIs** - Disable unused ones immediately
- [ ] **Implement request rate limiting** on your backend
- [ ] **Consider using Cloud Endpoints** for API management and protection

---

## For This Project (WebGPU StreetView)

#### Current Setup Issues

The project currently uses:
- **Google Maps JavaScript API** (required for Street View)
- **Google Geocoding API** (address search / reverse geocode)
- **Street View Static API** (opt-in rearview feed only — see `BILLING_SAFETY_CHECKLIST.md`)
- **API Key**: runtime `public/config.js` / deploy-time `MAPS_API_KEY` (never hardcoded; referrer-restricted)

#### Required Changes

1. **Environment Variables**
   ```bash
   # .env (NOT COMMITTED)
   REACT_APP_MAPS_API_KEY=your_key_here
   ```

2. **Create Multiple API Keys** in GCP:
   - **Key 1 (Street View)**: Restrict to `localhost:3000/*` for development
   - **Key 2 (Production)**: Restrict to your production domain only

3. **Website Restrictions Setup**
   ```
   Go to: Google Cloud Console
   → APIs & Services
   → Credentials
   → Click on your API key
   → Application Restrictions
   → Select "HTTP referrers (websites)"
   → Add: localhost:3000/*, https://yourdomain.com/*
   ```

4. **Update CLAUDE.md**
   - Move hardcoded API key warning to required section
   - Document `.env` setup process
   - Link to this billing warnings document

---

## Emergency Response

#### If You Notice Unexpected Charges

1. **Immediately disable the API key** in Google Cloud Console
   - Go to: **APIs & Services → Credentials**
   - Click the key → **Disable**

2. **Review usage logs**
   - Go to: **Logs Router** or **Cloud Logging**
   - Search for unusual requests from unknown IPs

3. **Check enabled APIs**
   - Go to: **APIs & Services → Enabled APIs & Services**
   - Disable any APIs not actively used

4. **Contact Google Cloud Support**
   - Request review of charges for potential refund
   - Explain the API key exposure
   - Ask about credit reversal

5. **Rotate all API keys**
   - Delete exposed keys
   - Create new keys with proper restrictions
   - Update all applications

---

## Monitoring & Maintenance

#### Monthly Tasks

- [ ] Review GCP **Billing Dashboard** for cost trends
- [ ] Check **API usage** for each enabled API
- [ ] Verify all API keys have **website restrictions**
- [ ] Confirm **budget alerts** are still configured
- [ ] Audit **API permissions** used by application

#### Quarterly Tasks

- [ ] Rotate all API keys (create new, delete old)
- [ ] Review enabled APIs - disable unused ones
- [ ] Update documentation with current API key restrictions
- [ ] Test that rate limiting / quotas are enforced

---

## Resources

- [Google Cloud API Security Best Practices](https://cloud.google.com/docs/authentication/application-default-credentials)
- [API Key Restrictions](https://cloud.google.com/docs/authentication/api-keys#api_key_restrictions)
- [GCP Billing Alerts](https://cloud.google.com/billing/docs/how-to/budgets)
- [Cloud Logging for API Usage](https://cloud.google.com/logging/docs)

---

## Future Notes

As more information becomes available about what specifically triggered the charges, updates will be added below.

**Date**: 2026-05-08
**Next Review**: 2026-05-15 (when issue investigation completes)

---

**IMPORTANT**: Do not proceed with deploying this application to production until API keys are properly restricted and billing alerts are configured.
