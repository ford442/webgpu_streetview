# DEVELOPER_CONTEXT.md

> **Start with [`AGENTS.md`](../AGENTS.md)** for the current architecture map, danger zones, build/test commands, and agent workflows. This file is a **deep-dive supplement** only — it does not duplicate the SSOT.

## When to read this file

- Graphics pipeline internals (dual-pass HDR, hold-pause, shader uniform layout)
- Cesium globe / MiniMap imagery resolution
- WASM bridge and billable API surfaces

For day-to-day agent work, `AGENTS.md` + `CLAUDE.md` are sufficient.

---

## 1. High-Level Architecture (current)

### Core purpose
WebGPU-accelerated Street View viewer: scrape the hidden Google Maps panorama canvas, render through a custom WGSL pipeline (HDR + weather post-process), optionally layer a Three.js car interior.

### Composition (post–AppShell refactor)
```
App.tsx
├── AppProviders (StreetViewProvider, ViewModeProvider, EnvironmentSettingsProvider)
└── AppShell
    ├── StreetViewStage (scraper + WebGPU + loading overlay)
    ├── ConnectedChrome (toolbar + panels + lazy GlobeView)
    └── MainView → FreeLookView | CarModeView
```

State lives in **providers and colocated hooks** under `src/app/` and `src/hooks/` — not in `App.tsx`.

### API keys
- **Maps**: runtime `window.MAPS_API_KEY` via `public/config.js` (deploy bake) → `REACT_APP_MAPS_API_KEY` / `VITE_MAPS_API_KEY` fallback. See `src/app/mapsKeyUtils.ts` and `useMapsBootstrap.ts`.
- **Never** hardcode production keys in source. The committed `public/config.js` is intentionally empty.

---

## 2. Feature entry points

| Feature | Entry |
|---------|-------|
| Street View scrape | `src/components/StreetView.tsx` |
| WebGPU render loop | `src/components/WebGPUCanvas.tsx` → `src/renderer/Renderer.ts` |
| Hold-pause transitions | `src/hooks/useStreetView.tsx` + `src/utils/panoramaStability.ts` |
| Free-look input | `src/components/FreeLookInputHandler.tsx` |
| Car mode | `src/views/CarModeView.tsx` + `src/views/car/*` hooks |
| Globe | `src/components/GlobeView.tsx` + `src/components/globe/*` |
| Cruise / navigation | `src/utils/navigation.ts`, toolbar in `AppToolbar.tsx` |

---

## 3. Complexity hotspots

### Canvas scraper (`StreetView.tsx`)
MutationObserver heuristics; container must stay `opacity: 1`. See `src/utils/scraperHealth.ts` and `AGENTS.md` danger zone §1.

### Hold-pause (`Renderer.ts`, `WebGPUCanvas.tsx`, `useStreetView.tsx`)
Never upload live GMaps canvas while `holdActive`. Regression guard: `window.__STREETVIEW_PROBE__`.

### Shader uniform layout
Single source of truth: `src/renderer/weatherUniformLayout.ts` — must match both `weather-post.wgsl` and `weather-post-compute.wgsl`.

### Cesium typing
CDN-loaded Cesium is typed via `src/types/cesium.ts` + global ambient in `src/types/cesium.d.ts`. Globe POI/autopilot visuals live in `src/components/globe/`.

---

## 4. Removed / stale documentation

- **Fluid simulation** shaders described in older docs are **not implemented**. `RenderMode` is `'streetview'` only unless legacy transition shaders are opt-in (`?legacyTransitions=1`).
- **CRA / App.tsx mediator** pattern is superseded by `AppProviders` + `AppShell` (foundation arc #169–#200).

---

## 5. Further reading

- [`docs/RENDERER_FALLBACK.md`](./RENDERER_FALLBACK.md) — WebGPU / WebGL2 / compute weather paths
- [`docs/WASM_BRIDGE.md`](./WASM_BRIDGE.md) — C++/WAT noise tile
- [`BILLING_SAFETY_CHECKLIST.md`](../BILLING_SAFETY_CHECKLIST.md) — rear-view Static API

_Last updated: foundation refactor split (CarModeView hooks, Globe types, docs SSOT pass)._
