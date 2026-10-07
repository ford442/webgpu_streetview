# Historical time machine

Tracking: #221 (stills hop, shipped) → year-strip / GPU wipe product issue.

## What ships (slices 1–3)

- **Year strip** (`src/components/HistoricalTimeline.tsx`): one chip per crawled
  `imageDate`. Clicking a chip calls `onSelectDate` → `teleportToPanoSafe`, i.e.
  the same hold-pause hop (`armHold()`) as `?year=`; the strip never touches the
  Maps canvas and `window.__STREETVIEW_PROBE__` sees an ordinary hop. Left/Right
  arrows move focus between chips. The panel `stopPropagation`s mouse, pointer,
  touch, wheel and key events.
- **Honest empty state**: one date → "Google only published one capture here
  (…)"; zero dates → "Google has no Street View capture dates near this spot".
  No slider is drawn with fewer than two dates.
- **Compare** uses the pair from `useHistoricalCompare` (`captureCompareStill`
  → `renderer.getCanvasDataURL()`), which is the **presented frame**. When
  `renderer.isCabinCompositedInFrame()` is true the one-frame compositor already
  drew the cabin into the swap chain, so the still has it; otherwise
  (free-look, `?cabin=webgl`, any compositor stand-down) it is road-only. The
  decision goes through `needsCabinOverlayLatch` — the 2D latch stays for the
  WebGL hatch and is never used for compare. Each still records
  `beforeIncludesCabin` / `afterIncludesCabin` and the panel's scope line
  (`compareStillScopeLabel`) says what the pair holds. No cabin crop is faked.

## Crawl budget (billing)

- Street View Service `getPanorama` only. No Static API, no Street View Publish,
  no tile/Cache Storage/IndexedDB of Google imagery; `swPolicy` is unchanged.
- `MAX_PANORAMA_CALLS_PER_CRAWL = 12` (`src/utils/historicalImagery.ts`) caps
  center + ring; `buildSamplePoints` clamps `sampleCount` to it. Default crawl is
  **9 calls** (center + 8 points at 10 m).
- A crawl runs at most once per settled position (400 ms debounce in
  `useHistoricalImagery`) and is skipped on a fresh (7-day) localStorage hit for
  the ~11 m grid cell. That cache stores only `panoId` / `imageDate` / lat-lng
  metadata, never imagery.
- Results are deduped by `panoId`, then by `imageDate`.
- The ring uses the WASM `offset_latlng` export (#278) with its JS twin.
- Shared-session guests do not crawl; they follow the host `panoId` / `imageDate`.

## Year-chip wipe (slice 2)

- A chip click resolves a reveal in `ConnectedChrome` (`resolveYearChipReveal`):
  a **wipe** whose direction follows the chronological strip (+1 to a later
  year, sweeping in from the left; -1 back), or a **cut** when
  `prefers-reduced-motion` or the app's reduced-motion setting is on.
  `teleportToPanoSafe(panoId, { reveal })` passes it to `teleportToPano`, which
  still arms the ordinary hold (`armHold()`).
- On release `useStreetView` ends the hold, then: **cut** → finishes at once (no
  shader, no crossfade); **wipe** → `renderer.beginHistoricalWipe(direction)`
  and ramps `setHistoricalWipeProgress(wipeProgressAt(…))` over
  `HISTORICAL_WIPE_DURATION_MS`; if the renderer declines (WebGL backend, no
  pipeline, no snapshot) it keeps the usual 250 ms crossfade.
- `HistoricalWipePass` (`src/renderer/HistoricalWipePass.ts`,
  `public/shaders/historical-wipe.wgsl`) is its own pipeline, loaded like the
  cabin composite, independent of `?legacyTransitions`. Uniform: 4 floats —
  progress, direction, two pads (`historicalWipe.ts`); the 40-float weather
  block is untouched.
- It draws **over pass 1** into the HDR intermediate (`loadOp: 'load'`), so
  weather, droplets/the windshield portal and the cabin composite see one
  frame. Its only texture is the hold-pause snapshot
  (`TransitionManager.previousFrame`); the "after" is whatever pass 1 drew. It
  has no upload path, and `Renderer` does not encode it while `holdActive`, so
  `uploadLiveSource`'s probe warning stays the guard for any future bypass.
- Known limit: the "before" is sampled without the digital-zoom/look-around
  remap the hold shader applies, so a hop taken while zoomed in shows the
  snapshot unzoomed on the unswept side.

## Verifying

- Vitest: `src/renderer/historicalWipe.test.ts` (progress, reduced-motion cut,
  uniform/WGSL parity), `src/renderer/Renderer.historicalWipe.test.ts` (no live
  upload while held, binds only the snapshot),
  `src/hooks/__tests__/useStreetView.historicalReveal.test.tsx` (cut / wipe /
  fallback release), `src/hooks/useHistoricalCompare.test.ts`.
- Keyed browser check (manual — no keyless harness mounts a real hop): click a
  year chip, watch the sweep; `window.__STREETVIEW_PROBE__.getWarnings()` is
  `[]`; with rain on, droplets refract the held frame during the hold and the
  wipe frame after it. Toggle reduced motion and the same hop is a cut.

Billing and caching are unchanged by slices 2–3: no new Maps calls, crawl
budget 12, `swPolicy` network-only for Google hosts.
