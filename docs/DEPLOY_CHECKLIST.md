# Deploy Checklist — WebGPU StreetView (map loading edition)

Use this before every production deploy to `test.1ink.us` or `go.1ink.us`. Most "app won't load / black / Google Maps error" incidents are caused by missing one of these items.

## 1. Google Cloud API Key (the #1 cause of "This page can't load Google Maps correctly")

- [ ] The key you will use has **HTTP referrer (website) restrictions** that include **both**:
  - `https://test.1ink.us/*`
  - `https://go.1ink.us/*`
  - `http://localhost:3000/*` (and 3001 for good measure)
- [ ] **Maps JavaScript API** is enabled for the project (APIs & Services → Library).
- [ ] **Maps Directions API** is enabled (needed for route planning / globe).
- [ ] **Geocoding API** is enabled **and** listed on this key’s API restrictions (same HTTP-referrer browser key as Maps JS — not a Compute Engine credential). Without it, reverse-geocode and address search return `REQUEST_DENIED`.
- [ ] Billing account is linked to the project and has no payment failures / alerts firing.
- [ ] (Recommended) Budget alerts + "prevent overspend" are configured.

**Verify after deploy:**
- The live `config.js` (or the baked bundle) must be using a key that passes the above.

## 2. Key provisioning for this deploy

Current deploy = `python deploy.py` (builds a zip and POSTs to the Contabo storage manager).

**Required environment variable:**
- [ ] `DEPLOY_TOKEN` is set in your shell or CI secrets (never committed to git). Without it, `deploy.py` exits immediately.

Options for the Maps key (in order of preference for prod):

- [ ] `MAPS_API_KEY=AIzaSy...real... python deploy.py`  ← bakes key into `static/js/main.*.js` at deploy time.
- [ ] `export REACT_APP_MAPS_API_KEY=AIzaSy...real...` then `npm run build` then `python deploy.py`.
- [ ] After a deploy, manually edit the deployed `/streetview/config.js` on the origin server (emergency only).

Never commit a real key to `public/config.js` or `.env`.

Run the build-time validator:
```bash
npm run build   # runs prebuild warning + scripts/verify-build.sh + check-deploy-secrets.sh
```

## 3. Build & verification (local)

- [ ] `npm run build` succeeds with no critical errors.
- [ ] `./scripts/verify-build.sh` (or the step at end of build) passes:
  - `config.js` is safe (empty or the one you intend).
  - No obvious placeholder.
  - (Note: the previous hard block on the historical key has been removed; it is now used intentionally with proper referrer restrictions.)
- [ ] (Optional but powerful) Temporarily set a dev key with localhost referrers and `npm start`; confirm the demo loads cleanly before the prod deploy.

## 4. The deploy command

```bash
# Required: deploy API token (from VPS / storage manager config)
export DEPLOY_TOKEN='your_token_here'

# Best: bake Maps key at deploy time
MAPS_API_KEY="AIzaSyYourRealKeyForBothHosts" python deploy.py

# Target go.1ink.us instead of test.1ink.us
DEPLOY_TARGET=go MAPS_API_KEY="AIzaSy..." python deploy.py
```

`deploy.py` runs `scripts/check-deploy-secrets.sh` first — it **refuses to deploy** if hardcoded passwords or tokens are found in `deploy.py` / `scripts/*.sh`, or if `deploy_old.py` still exists.

After the script says "complete", immediately do the post-deploy checks below.

## 5. Post-deploy verification (within 2 minutes of upload)

1. `curl -I https://test.1ink.us/streetview/config.js` (and the go.1ink.us equivalent) — expect 200 and your key text (not empty string).
2. Hard refresh (Ctrl/Cmd + Shift + R) the live URL(s).
3. Dismiss welcome modal → Street View should appear with real imagery (no black, no loading spinner forever, no Google error watermark in top-left).
4. Open DevTools Console:
   - No `[Maps Loader] ... auth failure`
   - No "can't load Google Maps correctly"
   - The poller log "Late Maps API key detected" may appear once (harmless).
5. Test basic navigation (WASD, click to advance). Try Cruise briefly.
6. If using the Globe or Directions features, they should also work (they need the same key + Directions API).

## 6. If it is still broken after deploy

- Check the red `AppBanners` (top of screen) for the exact diagnostic.
- Look at Network tab for the `maps/api/js?key=...` request — the response or subsequent calls will often say what Google rejected.
- Common remaining causes after the checklist:
  - The key used in the artifact is still the wrong one (check the served config.js or search the main.*.js for the key suffix).
  - Referrer patterns use `http` vs `https`, missing `/*`, or only one of the two hosts.
  - The project has the APIs enabled but the specific key credential does not have them restricted to (or the restriction is too narrow).
  - **COEP must be `credentialless`, not `require-corp`**. Both test/go currently need this: `require-corp` blocks Google Maps `StaticMapService`, `QuotaService`, and Street View Static API images (`ERR_BLOCKED_BY_RESPONSE.NotSameOriginAfterDefaultedToSameOriginByCoep`), which causes the Maps error overlay and visible flicker. The repo ships `public/.htaccess` with the correct headers for Apache; for nginx, set the same on the server.

Update the key in GCP, re-run the deploy with the correct `MAPS_API_KEY=...`, and re-verify.

## 7. Related GitHub issues (the "map loading" cluster)

These open issues capture the symptoms and remaining engineering work:
- #84 Maps API key not available at load time — config.js race
- #85 StreetView component never re-initializes when apiKey prop changes
- #86 No visible error UI when Google Maps auth fails
- #87 Canvas detection fails silently when pano div is hidden
- #88 Improve loading sequence: show spinner/status while Maps API and first panorama load
- #89 (this one) Deploy checklist

See the comments on each for the latest codebase status and partial fixes (reactive key poller, init guard reset, deploy.py injection support, etc.).

## 8. CI & GitHub Actions

- `.github/workflows/ci.yml` runs on every push/PR to `main`: typecheck, tests, **deploy secret scan** (`scripts/check-deploy-secrets.sh`), `deploy_secrets.test.py`, then `npm run build`. No deploy secrets required for CI.
- `.github/workflows/deploy.yml` — optional manual deploy (`workflow_dispatch`). Requires repository secrets:
  - **`DEPLOY_TOKEN`** — Contabo bundle upload auth token
  - **`MAPS_API_KEY`** — production Maps key (referrer-restricted)
- `.github/workflows/nightly-probe.yml` runs `npm run probe:hold-pause` against a real dev server on a daily schedule (and via manual dispatch). Requires:
  - **`REACT_APP_MAPS_API_KEY`** — a Maps key with `http://localhost:3000/*` in its referrer allowlist.
- Configure secrets under Settings → Secrets and variables → Actions on the repo.

## 9. Deploy credential hygiene

- [ ] **Never** commit `DEPLOY_TOKEN`, SFTP passwords, or production Maps keys to git.
- [ ] `deploy_old.py` (legacy SFTP script with hardcoded password) must stay deleted.
- [ ] Run `./scripts/check-deploy-secrets.sh` before every deploy (also runs automatically via `verify-build.sh` and `deploy.py`).
- [ ] Copy `.env.deploy.example` to your local shell profile or password manager — not into the repo.

## 10. One-time / periodic

- [ ] Rotate the production key every 90 days (create new restricted key, deploy with it, delete old).
- [ ] Review the GCP project's enabled APIs and billing monthly.
- [ ] After any change to `public/index.html` (script order) or the loader, re-test a full deploy cycle on a staging origin if possible.

---

Last updated: after expanding issues #84–#89 and adding runtime key support back to deploy.py.
