# Historical time machine

Tracking: #221 (stills hop, shipped) → year-strip / GPU wipe product issue.

## What ships (slice 1)

- **Year strip** (`src/components/HistoricalTimeline.tsx`): one chip per crawled
  `imageDate`. Clicking a chip calls `onSelectDate` → `teleportToPanoSafe`, i.e.
  the same hold-pause hop (`armHold()`) as `?year=`; the strip never touches the
  Maps canvas and `window.__STREETVIEW_PROBE__` sees an ordinary hop. Left/Right
  arrows move focus between chips. The panel `stopPropagation`s mouse, pointer,
  touch, wheel and key events.
- **Honest empty state**: one date → "Google only published one capture here
  (…)"; zero dates → "Google has no Street View capture dates near this spot".
  No slider is drawn with fewer than two dates.
- **Compare** still uses the JPEG pair from `useHistoricalCompare`
  (`renderer.getCanvasDataURL()`), which is **road-only** — the panel says so.
  No cabin crop is faked until the #273 compositor feeds `captureCompositedStill`.

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

## Next slices

2. GPU wipe of a frozen before-texture vs the live after, as its own small
   pipeline with a 4-float uniform (40-float weather layout untouched).
   Reduced-motion: instant cut.
3. Capture/cinema sidecar via the composited still once #273 is default.
