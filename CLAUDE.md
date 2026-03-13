# CLAUDE.md — Developer Guide for AI Agents

This file provides the essential context needed to safely work on this codebase.
Read this before making any changes.

---

## What This Project Is

**WebGPU StreetView** is a React/TypeScript app that wraps the Google Maps JavaScript API
to create an immersive first-person street navigation experience. It captures the hidden
Google Maps Street View canvas via `MutationObserver` and re-renders it through a custom
WebGPU pipeline, enabling GPU-accelerated post-processing effects unavailable in the native
Maps UI. On top of the panorama it composites a Three.js 3D car interior.

**Live URL**: https://test.1ink.us/streetview
**Deploy**: `npm run build` then `python deploy.py` (SFTP upload to test.1ink.us)

---

## Stack at a Glance

| Layer | Technology | File/Location |
|---|---|---|
| Framework | React 19 + TypeScript 4.9 | `src/` |
| Build | Create React App (react-scripts 5) | `package.json` |
| GPU rendering | WebGPU (WGSL shaders) | `src/renderer/`, `public/shaders/` |
| 3D overlay | Three.js 0.160 | `src/car/` |
| Maps | Google Maps JS API (loaded dynamically) | `src/components/StreetView.tsx` |
| State | React hooks only (`useState`, `useRef`) | local to components |

---

## Common Commands

```bash
npm install          # install deps
npm start            # dev server → http://localhost:3000
npm run build        # production build → build/
npm test             # jest + react-testing-library
python deploy.py     # deploy build/ via SFTP (prompts for password)
```

---

## Architecture in One Picture

```
Google Maps API (hidden DOM)
        │
        │ MutationObserver
        ▼
  StreetView.tsx ──canvas ref──► App.tsx ──► WebGPUCanvas.tsx
                                                   │
                                            Renderer.ts (WebGPU)
                                           ┌────────────────────┐
                                           │ Pass 1: panorama   │
                                           │  streetview.wgsl   │
                                           │  → rgba16float HDR │
                                           │ Pass 2: post-proc  │
                                           │  weather-post.wgsl │
                                           │  → screen canvas   │
                                           └────────────────────┘
                                                   │ (layered on top)
                                           CarInterior.ts (Three.js)
                                           DashboardUI.tsx (React)
```

**Navigation flow**: User input → `InputHandler.tsx` → App state (`heading`/`pitch`/`zoom`)
→ `panorama.setPov()` → Google Maps rotates hidden canvas → Renderer uploads new pixels.

---

## Critical Files

| File | Role |
|---|---|
| `src/App.tsx` | Central mediator. Owns all state. Do not duplicate state here. |
| `src/components/StreetView.tsx` | Canvas scraper — extremely fragile (see below) |
| `src/renderer/Renderer.ts` | WebGPU orchestrator: dual-pass render pipeline |
| `src/components/InputHandler.tsx` | Global `window` event listeners (see below) |
| `src/utils/navigation.ts` | `findBestLink()` — do not break heading math |
| `public/shaders/streetview.wgsl` | Pass 1 shader: panorama texture + zoom/pan |
| `public/shaders/weather-post.wgsl` | Pass 2 shader: HDR color grading + rain/snow |
| `src/car/CarInterior.ts` | Three.js 3D car scene |
| `src/car/VehicleManager.ts` | Vehicle configs (sedan, convertible, lab, limo) |
| `src/config/visualPresets.ts` | Quality levels (low/medium/high/ultra) |

---

## Danger Zones — Read Before Touching

### 1. Canvas Scraping (`src/components/StreetView.tsx`)

Google Maps does **not** expose a public canvas API. The code uses `MutationObserver`
to watch the DOM, collects all `<canvas>` elements, sorts by area, and picks the
largest one ≥256×256 pixels.

**Risk**: If Google changes their internal DOM structure, canvas detection silently breaks.
`onCanvasReady` simply won't fire and the WebGPU output stays black.
**Do not** add assumptions about canvas element IDs, class names, or tree depth.

### 2. Input Event Hijacking (`src/components/InputHandler.tsx`)

Listeners are attached to `window`. Every UI overlay (panels, modals, inputs) **must**
call `e.stopPropagation()` on mouse and keyboard events, or the panorama will spin when
the user types or clicks buttons.

### 3. Navigation Math (`src/utils/navigation.ts` → `findBestLink`)

`findBestLink` maps `'forward' | 'backward' | 'left' | 'right'` to the nearest available
panorama link by angle difference. The 45° threshold is intentional. Small errors here
cause the user to walk backwards or loop in circles. Test any changes manually in cruise
mode.

### 4. Dual-Pass Render Pipeline (`src/renderer/Renderer.ts`)

- **Pass 1** (`streetview.wgsl`) renders to an `rgba16float` intermediate texture (HDR).
- **Pass 2** (`weather-post.wgsl`) reads that texture and writes to the canvas-format surface.

`ensureIntermediateTexture()` lazily creates/resizes the HDR texture. If canvas dimensions
change mid-frame the old texture view becomes invalid — do not cache `GPUTextureView` across frames.

### 5. Google Maps API Key

The key is hardcoded in `src/App.tsx`. **Do not commit new keys.** In production it should
be in an environment variable (`REACT_APP_MAPS_API_KEY`) and restricted by HTTP referrer.

---

## Ghost Code Warning

`AGENTS.md` and older docs reference a "Fluid Simulation" with velocity/advection shaders.
**This code does not exist.** `RenderMode` only supports `'streetview'`. Do not attempt
to wire up fluid simulation unless explicitly asked to implement it from scratch.

---

## Car Mode

Car mode layers a Three.js scene over the WebGPU canvas.

**Entry**: `src/car/index.ts` exports `initCarMode`, `toggleCarMode`, `updateCarMode`, `disposeCarMode`.
**Vehicles**: `sedan | convertible | science-lab | limousine` — configs in `VehicleManager.ts`.
  - **Future**: `streetcar | trolley` could be added as open-air transit models with exterior-facing viewports
**Dashboard**: `src/car/DashboardUI.tsx` (React). Buttons trigger car module functions directly.
**Animations**: Steering wheel (A/D), wipers (toggle), gauges updated via `updateCarGauges()`.

When adding new vehicle features, add config to `VehicleManager.ts` first, then implement
in `CarInterior.ts`. Do not put vehicle-specific logic in `App.tsx`.

---

## Shader System

WGSL shaders in `public/shaders/` are loaded at runtime via `fetch('./shaders/name.wgsl')`.
They are NOT bundled by webpack; they are static files served from `public/`.

When adding a new shader:
1. Put `.wgsl` file in `public/shaders/`
2. Add pipeline creation method in `Renderer.ts`
3. Insert pass into `renderStreetView()` in the correct order
4. Add a quality gate in `visualPresets.ts` if the effect is expensive

`weather-post.wgsl` uniforms layout:
```
[0] vibrance  [1] saturation  [2] contrast  [3] exposure
[4] temperature  [5] tint  [6] time  [7] rainIntensity
[8] snowIntensity  [9] wind  [10] speed  [11-15] padding
```

---

## Adding New UI Panels

1. Create component in `src/components/MyPanel.tsx`
2. Add state (`isMyPanelOpen`) and toggle in `App.tsx`
3. Register keyboard shortcut in `useKeyboardShortcuts.tsx`
4. Add `e.stopPropagation()` on **all** mouse and keyboard events inside the panel
5. Add skip link if the panel is a significant UI region

---

## Testing

```bash
npm test                  # runs all tests in watch mode
npm test -- --watchAll=false   # single run (CI)
```

Tests use Jest + React Testing Library. The test suite is thin — manual testing is still
required for WebGPU rendering and canvas detection. `findBestLink` is a good candidate
for unit tests if you add navigation logic.

---

## Deployment

```bash
npm run build          # creates build/
python deploy.py       # SFTP upload to test.1ink.us/streetview
```

`deploy.py` prompts for the server password. Do not hardcode credentials.

---

## Code Conventions

- **TypeScript strict mode** — no `any` unless absolutely necessary
- **Functional components** with hooks — no class components
- **PascalCase** for components, **camelCase** for everything else
- State owned as high as needed but no higher — prefer hooks over prop drilling
- `useCallback` for handlers passed to children
- Always return a cleanup function from `useEffect` if you register timers or observers
- `e.stopPropagation()` on all events inside UI overlays

---

## Quick Diagnostic Checklist

| Symptom | Likely Cause | Where to look |
|---|---|---|
| Black screen on load | Canvas detection failed | `StreetView.tsx` console logs |
| Panorama not updating | `copyExternalImageToTexture` silent error | `Renderer.ts` try/catch |
| Navigation loops / walks backward | `findBestLink` angle math | `navigation.ts` |
| UI buttons spin the camera | Missing `stopPropagation` | The new component's event handlers |
| WebGPU unavailable | Browser too old or no HTTPS | `navigator.gpu` check in console |
| Car mode not visible | Three.js canvas z-index | `CarInterior.ts` canvas style |
