# WebGPU StreetView

A high-performance Google Maps Street View viewer with an immersive 3D car interior experience, built with React 19, WebGPU, and Three.js.

[![React](https://img.shields.io/badge/React-19.1.1-61DAFB?logo=react)](https://react.dev/)
[![WebGPU](https://img.shields.io/badge/WebGPU-Latest-FF6B00)](https://gpuweb.github.io/)
[![TypeScript](https://img.shields.io/badge/TypeScript-4.9-3178C6?logo=typescript)](https://www.typescriptlang.org/)
[![Three.js](https://img.shields.io/badge/Three.js-0.160-000000?logo=three.js)](https://threejs.org/)

**Live demo**: https://test.1ink.us/streetview

---

## Overview

WebGPU StreetView intercepts the hidden canvas rendered by the Google Maps JavaScript API and re-draws it using a custom WebGPU pipeline. This unlocks GPU-accelerated post-processing — HDR color grading, procedural rain and snow, vignette — that would not be possible through the Maps API alone. On top of the panorama it layers a fully animated Three.js car interior, turning the browser into a virtual road-trip cockpit.

```
Composite Browser Output
├── Three.js car interior (WebGL canvas overlay)
├── React dashboard UI (DashboardUI.tsx)
├── Pass 2: weather + color grading  (weather-post.wgsl → screen)
├── Pass 1: panorama render          (streetview.wgsl  → rgba16float HDR)
└── Hidden Google Maps StreetViewPanorama (DOM canvas)
```

---

## Features

### Rendering Pipeline
- **WebGPU dual-pass pipeline** — panorama captured into an `rgba16float` HDR intermediate texture, composited with weather and color-grading effects before display
- **WGSL shaders** loaded at runtime from `public/shaders/`; no shader compilation at build time
- **HDR color grading** — vibrance, saturation, contrast, exposure, color temperature, tint; adjustable live via the Color Grading panel
- **Procedural weather** — multi-layer rain streaks (4 tilted layers) and drifting snowflakes (5 size-varying layers) composited in the post-process pass; intensity and wind are live uniforms
- **Quality presets** — Low / Medium / High / Ultra, auto-detected from device memory + CPU cores; smoothly degrade bloom, depth-of-field, film grain, shadow maps, anisotropy

### Navigation
- **360° free-look** — mouse drag for heading & pitch, scroll to zoom, WASD for directional movement
- **Cruise mode** — automatically advances to the nearest panorama link on a timer; works standalone or follows a planned route
- **Route planning** — Google Directions API walking paths; cruise mode follows waypoints sequentially
- **Bookmarks** — named positions persisted to `localStorage`
- **Location history** — breadcrumb trail of visited panoramas with one-click recall
- **MiniMap** — secondary Google Map with heading indicator, route polyline, click-to-teleport
- **Compass** — real-time cardinal direction overlay

### Car Mode
- **Four vehicle types** — Executive Sedan, Sport Convertible, Mobile Science Lab, Stretch Limousine; each with unique dashboard layout, feature set, and accent color theme
- **Three.js interior** — all geometry built procedurally; no external 3D asset files required
- **Interactive steering wheel** — A/D keys rotate with smooth lerp and auto-centering; ±90° lock-to-lock range
- **Animated windshield wipers** — dual wiper sweep on sine curve; toggle via dashboard button
- **Live dashboard gauges** — speedometer, tachometer, fuel level updated from cruise speed
- **Rearview mirror** — reflective glass geometry above dashboard
- **Side mirrors** — high-reflectivity metallic glass (roughness 0.05, metalness 1.0) on door panels
- **Window rain shader** — rain droplets and streaks on glass (GLSL, Three.js `ShaderMaterial`)
- **Dashboard glow** — emissive instrument cluster driven by speed and audio uniforms
- **Convertible** — open-top variant; Limousine — starfield ceiling; Science Lab — sensor/data displays

### Audio
- **Web Audio API** — `AudioAnalyzer.ts` analyzes radio stream for audio-reactive dashboard glow
- **Wind audio** — `WindAudio.ts` synthesizes wind noise that scales with cruise speed

### Accessibility & UX
- **Full keyboard navigation** — every feature reachable without a mouse
- **Configurable shortcuts** — remappable via `useKeyboardShortcuts`
- **ARIA live-region announcements** — `useAnnouncer` fires screen reader updates on navigation
- **Accessibility panel** — UI zoom, high-contrast, reduced motion toggles
- **Welcome modal** — first-run control reference
- **Loading overlay** — granular loading states via `useLoadingState`
- **Snapshot gallery** — capture WebGPU canvas as PNG with metadata sidecar
- **Performance stats overlay** — live FPS, GPU frame time, texture upload time (press **P**)
- **Mobile UI** — touch-friendly fallback layout via `useDeviceDetection`

---

## Quick Start

### Requirements

- Node.js 18+
- Chrome 113+, Edge 113+, or Firefox Nightly with `dom.webgpu.enabled`
- Google Maps API key with **Maps JavaScript API**, **Street View Static API**, and **Directions API** enabled

### Setup

```bash
git clone <repo-url>
cd webgpu_streetview
npm install
npm start          # dev server at http://localhost:3000
```

The Google Maps API key is currently hardcoded in `src/App.tsx`. For production, move it to an environment variable:

```bash
# .env (do not commit)
REACT_APP_MAPS_API_KEY=your_key_here
```

### Build & Deploy

```bash
npm run build          # production bundle → build/
npm test               # run test suite
python deploy.py       # SFTP upload to test.1ink.us (prompts for password)
```

---

## Controls

### Free Look Mode (default)

| Input | Action |
|---|---|
| Mouse drag | Pan heading and pitch |
| Scroll wheel | Zoom in / out |
| W | Move forward |
| A / D | Turn left / right |
| S | Reverse heading |
| +/- | Increase / decrease zoom |
| R | Reset view |
| Click | Move forward |

### Car Mode

| Input | Action |
|---|---|
| A / D or arrow keys | Steer wheel (lerp animated, ±90°) |
| W | Move forward |
| Mouse drag | Head look, independent of steering |
| Scroll | Zoom |
| Dashboard wiper button | Toggle wipers |
| Dashboard lights button | Toggle headlights |

### Global Keyboard Shortcuts

| Key | Action |
|---|---|
| C | Toggle Car Mode |
| B | Toggle Bookmark Panel |
| H | Toggle History Panel |
| P | Toggle Performance Stats |
| Space | Take snapshot |
| 1–5 | Quick view presets |
| Esc | Close open panel |

---

## Project Structure

```
webgpu_streetview/
├── public/
│   ├── index.html
│   ├── images/
│   └── shaders/                   # WGSL shaders (static files, not bundled)
│       ├── streetview.wgsl        # Pass 1: panorama texture + zoom/pan
│       ├── weather-post.wgsl      # Pass 2: HDR color grading + rain/snow
│       ├── carview.wgsl           # Car windshield post-process
│       └── texture.wgsl           # Debug passthrough
├── src/
│   ├── App.tsx                    # Central controller and state owner
│   ├── index.tsx
│   ├── style.css
│   ├── components/
│   │   ├── StreetView.tsx         # Google Maps loader + MutationObserver canvas scraper
│   │   ├── WebGPUCanvas.tsx       # Mounts renderer, drives render loop
│   │   ├── InputHandler.tsx       # Window-level mouse/keyboard capture
│   │   ├── MiniMap.tsx            # Secondary map: heading, route, teleport
│   │   ├── Compass.tsx
│   │   ├── BookmarkPanel.tsx
│   │   ├── HistoryPanel.tsx
│   │   ├── SnapshotGallery.tsx
│   │   ├── ColorGradingPanel.tsx  # Live HDR uniform sliders
│   │   ├── VehicleSelector.tsx
│   │   ├── AccessibilityPanel.tsx
│   │   ├── PerformanceStatsOverlay.tsx
│   │   ├── LoadingOverlay.tsx
│   │   ├── WelcomeModal.tsx
│   │   └── MobileUI.tsx
│   ├── renderer/
│   │   ├── Renderer.ts            # WebGPU device, textures, dual-pass pipeline
│   │   └── types.ts               # RenderMode type
│   ├── car/
│   │   ├── index.ts               # Public car mode API (init/toggle/update/dispose)
│   │   ├── CarInterior.ts         # Three.js procedural interior geometry
│   │   ├── DashboardUI.tsx        # React dashboard overlay
│   │   ├── RearviewMirror.ts
│   │   ├── SelectivePostProcessing.ts
│   │   ├── VehicleManager.ts      # Vehicle type configs
│   │   └── variants/              # ConvertibleMode, LimousineMode, ScienceLabMode
│   ├── hooks/
│   │   ├── useKeyboardShortcuts.tsx
│   │   ├── useBookmarks.ts
│   │   ├── useLocationHistory.ts
│   │   ├── useSnapshots.ts
│   │   ├── usePerformanceMonitor.ts
│   │   ├── useLoadingState.ts
│   │   ├── useLoadingIntegrations.ts
│   │   ├── useTouchControls.ts
│   │   ├── useDeviceDetection.ts
│   │   ├── useTransition.ts
│   │   └── useVehicleSettings.ts
│   ├── effects/
│   │   ├── PostProcessing.ts
│   │   ├── LightingEffects.ts
│   │   └── WindAudio.ts
│   ├── animation/
│   │   └── PhysicsAnimations.ts   # Spring physics for UI and camera sway
│   ├── audio/
│   │   └── AudioAnalyzer.ts
│   ├── materials/
│   │   └── PBRMaterials.ts        # Three.js PBR material presets
│   ├── shaders/                   # GLSL shaders (inlined for Three.js)
│   │   ├── windowRain.ts
│   │   ├── dashboardGlow.ts
│   │   └── starfield.ts
│   ├── config/
│   │   └── visualPresets.ts       # Low/Medium/High/Ultra presets + auto-detection
│   ├── store/
│   │   └── loadingState.ts
│   └── utils/
│       ├── navigation.ts          # findBestLink() algorithm
│       ├── performance.ts
│       └── memoryProfiler.ts
├── deploy.py                      # SFTP deploy script
├── package.json
├── CLAUDE.md                      # AI agent guide — danger zones and conventions
├── DEVELOPER_CONTEXT.md           # Architecture deep-dive
├── CAR_MODE_ENHANCEMENTS.md       # Car feature implementation notes
└── feature_expansion_plan.md      # Future roadmap
```

---

## Architecture Deep Dive

### How Canvas Scraping Works

The Google Maps API renders Street View into internal `<canvas>` elements inside a DOM subtree it manages internally. There is no official API to access this canvas. `StreetView.tsx` sets up a `MutationObserver` on the panorama container, collects every `<canvas>` it finds, sorts them by pixel area, and selects the largest one that exceeds 256×256 pixels as the active panorama canvas. This reference flows up through `App.tsx` → `WebGPUCanvas.tsx` → `Renderer.ts`, which uploads it every frame with `copyExternalImageToTexture`.

**Risk**: Any Google Maps DOM restructure will silently break canvas detection. Symptom: black WebGPU canvas.

### WebGPU Render Pipeline

**Pass 1** — `streetview.wgsl`
- Source: Google Maps canvas → `copyExternalImageToTexture` → `rgba8unorm` GPU texture
- Vertex shader: fullscreen triangle-strip (no geometry buffer)
- Fragment shader: samples texture with zoom + pan uniforms `[time, zoom, panX, panY]`; UV wraps horizontally, clamps vertically
- Output target: `rgba16float` intermediate HDR texture

**Pass 2** — `weather-post.wgsl`
- Source: HDR intermediate texture
- Fragment shader: color grading chain (vibrance → saturation → contrast → temperature/tint → exposure), then procedural rain + snow composited additively
- Output target: swap-chain surface (screen)

The intermediate HDR texture is lazily created and resized in `ensureIntermediateTexture()` when canvas dimensions change.

### Navigation Algorithm (`findBestLink`)

`findBestLink(panorama, direction, currentHeading)` in `src/utils/navigation.ts`:

1. Maps `direction` to a heading offset: forward=0°, right=90°, backward=180°, left=270°
2. Iterates `panorama.getLinks()` entries, computes angular distance to target with wrap-around
3. Returns the link within 45° of target, or `null` if none qualify

Cruise mode calls this every few seconds to automatically advance. Small math errors here cause users to walk backwards or loop — be careful modifying this function.

### Car Mode Rendering

Car mode runs a separate Three.js WebGL render loop on a transparent canvas layered above the WebGPU output. `CarInterior.ts` builds all geometry procedurally using `THREE.BoxGeometry`, `THREE.CylinderGeometry`, and custom `THREE.Shape` extrusions — no external GLTF/OBJ files. `DashboardUI.tsx` is a React overlay in normal DOM on top of both canvases; its buttons call functions exported from `src/car/index.ts` without going through App-level React state.

### Quality Preset Auto-Detection

`detectRecommendedQuality()` in `src/config/visualPresets.ts` scores the device:

| Signal | Points |
|---|---|
| RAM >= 8 GB (`navigator.deviceMemory`) | +3 |
| CPU cores >= 8 | +3 |
| WebGPU available | +1 |
| High pixel ratio (>2) | -1 |
| Mobile user-agent | -2 |

Score >= 7 → Ultra, >= 5 → High, >= 3 → Medium, else → Low.

---

## Shader Reference

### `public/shaders/streetview.wgsl` — uniforms

```wgsl
@group(0) @binding(2) var<uniform> uniforms: vec4<f32>;
// .x = time (seconds)
// .y = zoom  (1.0 = normal)
// .z = panX  (heading / 360)
// .w = panY  (pitch+90 / 180)
```

Outputs to `rgba16float`.

### `public/shaders/weather-post.wgsl` — uniform layout

```
Index  Field            Range / Notes
  0    vibrance         color grading
  1    saturation
  2    contrast
  3    exposure
  4    temperature
  5    tint
  6    time             seconds, loops at 10000
  7    rainIntensity    0–2
  8    snowIntensity    0–2
  9    wind             -1.0 (left) to +1.0 (right)
 10    speed            0.5–2.0 global animation speed
11-15  padding
```

---

## Known Limitations

| Issue | Detail |
|---|---|
| WebGPU required | Chrome 113+ / Edge 113+. Falls back to the raw Google Maps canvas if unavailable. |
| Canvas scraping fragility | Google Maps DOM changes will silently break the canvas feed. |
| Input hijacking | `InputHandler` is window-scoped. All UI overlays must call `e.stopPropagation()`. |
| Mobile | WebGPU on mobile is limited; full car mode requires desktop or high-end tablet. |
| No offline mode | Requires internet for Map tiles and Street View imagery. |
| API key exposure | Key hardcoded in `App.tsx`. Use env var + HTTP referrer restriction in production. |
| API rate limits | Google Directions API has quotas; heavy route planning may trigger throttling. |

---

## Browser Support

| Browser | Version | Status |
|---|---|---|
| Chrome | 113+ | Full support |
| Edge | 113+ | Full support |
| Firefox Nightly | latest | Enable `dom.webgpu.enabled` in about:config |
| Safari | TBD | WebGPU implementation in progress |
| Mobile browsers | varies | Limited; mobile UI fallback active |

---

## Development Reference

### Adding a New Shader Effect

1. Create `public/shaders/my-effect.wgsl`
2. Add `createMyEffectPipeline()` in `Renderer.ts` — fetch shader, build `GPURenderPipeline`
3. Insert a new render pass in `renderStreetView()` at the correct point in the chain
4. Add a boolean toggle to `visualPresets.ts` to disable it at lower quality tiers

### Adding a New UI Panel

1. Create component in `src/components/MyPanel.tsx`
2. Add open/close state in `App.tsx` and wire the toggle
3. Register shortcut in `useKeyboardShortcuts.tsx`
4. Add `e.stopPropagation()` on **all** mouse and keyboard events inside the panel

### Adding a New Vehicle

1. Add entry to `VEHICLES` record in `src/car/VehicleManager.ts`
2. Implement variant class in `src/car/variants/` if needed
3. Export from `src/car/variants/index.ts`
4. Add option to `VehicleSelector.tsx`

### Debugging Checklist

| Symptom | Likely Cause | Where to look |
|---|---|---|
| Black screen | Canvas detection failed | StreetView.tsx console logs |
| Panorama frozen | `copyExternalImageToTexture` error | Renderer.ts try/catch |
| Navigation loops | `findBestLink` angle math | navigation.ts |
| Camera spins on UI click | Missing `stopPropagation` | New component's event handlers |
| WebGPU unavailable | Old browser or non-HTTPS | `navigator.gpu` in console |
| Car mode invisible | Three.js canvas z-index | CarInterior.ts canvas style |

---

## Documentation Files

| File | Contents |
|---|---|
| `CLAUDE.md` | AI agent guide — commands, danger zones, conventions |
| `DEVELOPER_CONTEXT.md` | Architecture deep-dive, complexity hotspots, data flows |
| `CAR_MODE_ENHANCEMENTS.md` | Car feature implementation details |
| `src/docs/GRAPHICS.md` | Graphics pipeline, material system, shader reference |
| `feature_expansion_plan.md` | Planned features roadmap |

---

## Dependencies

| Package | Version | Purpose |
|---|---|---|
| react | 19.1.1 | UI framework |
| react-dom | 19.1.1 | DOM renderer |
| three | 0.160.0 | 3D car interior (WebGL) |
| @webgpu/types | 0.1.64 | WebGPU TypeScript types |
| @xenova/transformers | latest | ML utilities (experimental) |
| typescript | 4.9.5 | Type checking |
| react-scripts | 5.0.1 | Build tooling (Create React App) |

Dev: `@types/google.maps`, `@types/three`

---

## Contributing

```bash
git checkout -b claude/my-feature-<session-id>
# make changes
git commit -m "feat: describe what and why"
git push -u origin claude/my-feature-<session-id>
# open pull request
```

Code conventions: TypeScript strict mode, functional components with hooks, no `any`, `e.stopPropagation()` on all overlay events, cleanup in every `useEffect` that registers timers or observers.

---

## License

[Specify license here]

---

**Status**: Active Development | **Version**: 0.1.0 | **Last Updated**: March 2026
