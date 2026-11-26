# Production smoke (#384)

The dev-server Playwright suite (`e2e/*.spec.ts`) never sees what only a **production build on a real host**
shows: hashed assets under a sub-path, the build-stamped service worker, the host's COOP/COEP headers,
`.wasm` / `.wgsl` file types, the baked `config.js` key, minification. `e2e/prod/` runs against exactly that —
`vite preview` of `build/`, or a deployed site — under a console / network gate.

```bash
npm run build                                   # build/ (a key can be baked in: REACT_APP_MAPS_API_KEY)
npm run test:e2e:prod                           # vite preview of build/, keyless unless a key is available
E2E_MAPS_API_KEY=… npm run test:e2e:prod        # hand the page a key at run time via config.js (never built in)
npm run test:e2e:prod -- --live https://test.1ink.us/streetview/ --expect-sha <40-hex>
npm run test:e2e:prod -- --screens out/screens  # also write each flow's screenshot there (State of the App)
npm run test:e2e:prod -- -- --grep cabin        # after a bare `--`: Playwright's own arguments
```

`scripts/e2e-prod.mjs` sets `E2E_PROD=1` (which swaps the dev lanes in `playwright.config.ts` for the one `prod`
project), starts `vite preview --base /streetview/` (or none when live), runs the specs and writes
`test-results/prod-report/SUMMARY.md` — result, request count, console errors / warnings, uncaught errors and
failed requests per test, with the full text — also appended to `$GITHUB_STEP_SUMMARY`.
On a machine whose Chromium is not the one this Playwright pins, `E2E_CHROMIUM_PATH=/path/to/chrome` uses it
instead (and turns video off).

## Where it runs

| Lane | What | Key |
| --- | --- | --- |
| PR — `ci.yml` `e2e-prod` | the exact `build/` the `test-and-build` job made (artifact `production-build`), `vite preview` | none → the keyless half |
| Nightly — `nightly-probe.yml` `production-smoke` | a build with the key baked in, `vite preview` on :3000 (the key's referrer allowlist) | `REACT_APP_MAPS_API_KEY` → every flow |
| Deploy — `deploy.yml`, after `verify:live` | the **live** URL of the target, `--expect-sha ${{ github.sha }}` | baked into the deployed bundle → every flow; the workflow fails on any error |

## The gate (`e2e/prod/gate.ts`, `fixtures.ts`)

An automatic fixture watches every test's page and fails it on **any** `console.error`, uncaught `pageerror`,
failed request (any origin), 4xx/5xx for a same-origin request, or a same-origin *file* (`.js`, `.wasm`, `.wgsl`, …)
answered `text/html` — the SPA fallback that dresses a missing asset as a 200 (`vite preview` does it; so can a host).
Warnings are counted and listed, not failed. `gate.spec.ts` proves each of these is caught and that the gate cannot
pass vacuously.

* **Allowlist** — `e2e/prod/gateAllowlist.ts`. Known third-party noise only, reviewed, each entry with a reason and the
  run it was seen in. It starts **empty**: add an entry only for something the app does not control, never for our own error.
* **`gate.expect(channel, pattern, reason)`** — a test that provokes an error on purpose (an aborted route, no WebGPU).
  It permits the message and **fails the test if it never appears**, so an expectation cannot outlive its behaviour.

## Flows (every one has a spec; keyed = needs a Maps key)

| # | Flow | Spec | Asserts |
| --- | --- | --- | --- |
| – | Build identity | `boot.spec.ts` | `build-info.json` and `window.__SV__.build.sha` equal the expected commit (`--expect-sha` / local `build/build-info.json`); a live build is not `dirty` |
| – | Hosting contract | `boot.spec.ts` | COOP `same-origin` / COEP `credentialless` once each, `crossOriginIsolated`, `SharedArrayBuffer`; service worker `activated` with the stamped cache id (`streetview-sw-<id>-static`, never `dev`) and a stamped shader list; wasm validates, shaders are WGSL |
| 1 | Cold boot → first frame (keyed) | `boot.spec.ts` | `webgpuProbe.stage === 'ok'` (so the `wasm` stage passed), `rendererType === 'webgpu'`, `streetview` / `weather` passes ready, **no failed pass** (any failed optional pass would be listed with its reason), a frame encoded (`renderScale` published) |
| 2 | Look, pan, hops (keyed) | `street-view.spec.ts` | a drag changes the POV; `W` hops arm and release hold-pause with **no** `__STREETVIEW_PROBE__` warning; hops stay inside `callBudget` |
| 3 | Search → teleport | `search.spec.ts` | shell + Nearby off + no Places traffic on load; keyed: a pasted coordinate teleports with 1–3 `teleport-prefetch` lookups and **no** Places / Geocoding call |
| 4 | Car / cabin (keyed) | `car.spec.ts` | Car Mode → dashboard + cabin renderer ready; pointer lock in (click) and out (`exitPointerLock` — what Esc does, via `pointerlockchange`); `window.__VEHICLE__` advances while driving; `__CABIN_AUDIO_PROBE__` ready, `worklet-wasm`, quanta rendered, one `AudioContext` |
| 5 | Trip planner → drive | `trip.spec.ts` | panel keeps keys from the street view; unreachable routing is an error, never a fake route; keyed: a routed drive (recorded OSRM response, `e2e/fixtures/trip/`) plans, drives, and over 60 m of on-route hops **every extra `getPanorama` is a counted route re-snap — zero otherwise** |
| 6 | Fallbacks (keyed) | `fallbacks.spec.ts` | no `navigator.gpu` → the blocking "WebGPU is required" UI, probe stage `navigator`; with `?webgl2=1` the amber "WebGL2 fallback active" banner; `?cabin=webgl`, `?portal=off`, `?no_gpu_compute` each boot, enter the cabin, and report their fallback on the probes |
| 7 | Missing / invalid key | `maps-key.spec.ts` | missing → "No Google Maps API key" banner. Invalid → **known defect, below** |

Without a key the keyed flows skip (and say why). Live runs spend metered Maps calls: a page boot, a handful of
hops, one teleport, a short drive — the specs read `callBudget` and stay well inside it, but a live run is not free.

## Known defect found by this suite

**An invalid Maps key never reaches the red "authentication failed" banner.** Google reports it through
`gm_authFailure`, but `services/maps/loader.ts` has already resolved the load and ignores every auth failure for
1.2 s afterwards (`AUTH_FAILURE_IGNORE_WINDOW_MS`, "post-success debounce window" — meant for a stale failure of a
*previous* key, but `gm_authFailure` carries no key, so a fresh failure looks the same). The user is left on Google's
own "Oops! Something went wrong" overlay. `maps-key.spec.ts` pins the current behaviour (Google's error, no banner) with
the gate still fatal: green while it is broken, red the day the banner appears (then assert `toBeVisible()` and drop the
note). Both key cases skip on a build with a compiled key — it wins over the runtime `config.js` — so they run in the PR
lane, not the keyed nightly. Not fixed in #384 — it needs a way to tell a stale
failure from a current one.

## Adding to the suite

* A new flow is a spec in `e2e/prod/` using `./fixtures` (`test`, not Playwright's) so the gate watches it, and
  `openApp(page, '?flag')` — a **relative** URL, so a `/streetview/` sub-path survives. Keyed → `test.skip(!KEYED, NEEDS_KEY)`.
* Read state from the probes (`window.__SV__`, `webgpuProbe`, `__STREETVIEW_PROBE__`, `__VEHICLE__`, …), not pixels.
* Keep live cost in mind: every `openApp` of a keyed page is a Maps load.
* The host answers bursts with 429 + `Retry-After`; `openApp` waits it out for the *document* only. A 429 on an asset
  is a real failure the gate reports (Playwright's `flaky` count in the summary shows a retry that hid one).
