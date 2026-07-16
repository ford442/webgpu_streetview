# WebGPU StreetView — AI Agent Documentation

## Project Overview

**1ink.us Streetview** is a WebGPU-accelerated Google Maps Street View viewer that creates an immersive, interactive navigation experience. The application scrapes the Street View panorama from a hidden Google Maps canvas and renders it using a custom WebGPU shader pipeline, enabling HDR post-processing effects (color grading, rain, snow, fog, volumetric light shafts, lens flare, heat shimmer, chromatic aberration, dust particles, humidity haze) that are impossible through the native Maps API alone. It also layers a fully procedural Three.js car interior on top for a virtual road-trip cockpit.

### Core Purpose
The application acts as a custom renderer wrapper around the Google Maps JavaScript API. By capturing the panoramic view from a hidden Google Maps canvas and rendering it onto a WebGPU canvas, the architecture allows for GPU-accelerated rendering, real-time weather effects, and a dual-pass HDR pipeline.

### Live Deployment
- **URL**: https://test.1ink.us/streetview
- **Deployment Target**: 1ink.us server via SFTP (`deploy.py`)

---

## Technology Stack

| Layer | Technology | Version |
|-------|------------|---------|
| Frontend Framework | React | 19.1.1 |
| Language | TypeScript | 4.9.5 |
| Build Tool | Create React App (react-scripts) | 5.0.1 |
| Rendering API | WebGPU | Native browser API |
| 3D Overlay | Three.js | 0.160.0 |
| Shader Language | WGSL | WebGPU Shading Language |
| Maps Integration | Google Maps JavaScript API | Weekly |
| State Management | React Context + Hooks | Provider pattern |
| Testing | Jest + React Testing Library | CRA defaults |
| Globe Integration | Cesium | 1.140.0 |
| Additional | suncalc, @xenova/transformers, ajv, web-vitals | Various |

### Browser Support
- **Production**: `>0.2%, not dead, not op_mini all`
- **Development**: Last 1 Chrome, Firefox, Safari versions
- **WebGPU Required**: Chrome/Edge 113+, Firefox Nightly (with `dom.webgpu.enabled`)

---

## Build, Test, and Deploy Commands

```bash
# Install dependencies
npm install

# Start development server (port 3000)
npm start

# Create production build (outputs to build/)
npm run build

# Run tests (watch mode by default)
npm test

# Run tests once (CI mode)
npm test -- --watchAll=false

# Eject from react-scripts (irreversible)
npm run eject
```

### Deployment
```bash
# 1. Build production bundle
npm run build

# 2. Deploy to server (requires Python + paramiko)
python deploy.py
# - Uploads build/ to test.1ink.us/streetview via SFTP
```

---

## Project Structure

```
webgpu_streetview/
├── public/                          # Static assets (not bundled by webpack)
│   ├── index.html                   # HTML entry point
│   ├── images/                      # Static images
│   ├── cesium/                      # CesiumJS static assets (textures, workers, widgets)
│   └── shaders/                     # WGSL shader files loaded at runtime via fetch()
│       ├── streetview.wgsl          # Pass 1: panorama → HDR intermediate
│       ├── weather-post.wgsl        # Pass 2: HDR + weather/color grading → screen
│       ├── weather-post-compute.wgsl # Compute pipeline variant of weather post-process
│       ├── carview.wgsl             # Car windshield post-process
│       ├── texture.wgsl             # Debug passthrough
│       └── transition-*.wgsl        # GPU panorama transitions (fade, zoom, zoom-blur, zoom-chromatic)
├── src/
│   ├── App.tsx                      # Central controller. Renders providers + InnerApp.
│   ├── index.tsx                    # React 18+ createRoot entry point
│   ├── style.css                    # Global styles
│   ├── views/                       # Top-level view routing
│   │   ├── MainView.tsx             # Switches FreeLookView ↔ CarModeView based on viewMode
│   │   ├── FreeLookView.tsx         # Free-look street view mode
│   │   └── CarModeView.tsx          # Car interior mode
│   ├── components/                  # React components
│   │   ├── StreetView.tsx           # Google Maps loader + MutationObserver canvas scraper
│   │   ├── WebGPUCanvas.tsx         # Mounts renderer, drives render loop, syncs weather params
│   │   ├── FreeLookInputHandler.tsx # Window-level mouse/keyboard for free look
│   │   ├── CarInputHandler.tsx      # Window-level input for car mode (3 control modes)
│   │   ├── MiniMap.tsx              # Secondary map with heading, route, teleport
│   │   ├── Compass.tsx              # Cardinal direction overlay
│   │   ├── Controls.tsx             # Legacy overlay controls
│   │   ├── WelcomeModal.tsx         # Startup welcome modal
│   │   ├── LoadingOverlay.tsx       # Granular loading states UI
│   │   ├── BookmarkPanel.tsx        # Saved locations panel with cloud sync
│   │   ├── HistoryPanel.tsx         # Breadcrumb location history
│   │   ├── SnapshotGallery.tsx      # Canvas capture gallery
│   │   ├── ColorGradingPanel.tsx    # HDR uniform sliders
│   │   ├── WeatherPanel.tsx         # Rain/snow/wind/fog/time-of-day controls
│   │   ├── VehicleSelector.tsx      # Car type chooser
│   │   ├── AccessibilityPanel.tsx   # A11y settings panel
│   │   ├── PerformanceStatsOverlay.tsx # Live FPS / GPU stats
│   │   ├── GlobeView.tsx            # Cesium globe integration
│   │   ├── ScoutCard.tsx            # Location scout UI
│   │   └── MobileUI.tsx             # Touch-friendly fallback
│   ├── renderer/
│   │   ├── Renderer.ts              # WebGPU orchestrator: device, dual-pass pipeline, transitions
│   │   └── types.ts                 # RenderMode type
│   ├── car/                         # Three.js car interior system
│   │   ├── index.ts                 # Public car mode API (init/toggle/update/dispose)
│   │   ├── CarInterior.ts           # Procedural interior geometry
│   │   ├── DashboardUI.tsx          # React dashboard overlay
│   │   ├── DashboardLayout.tsx      # Dashboard zone layout primitives
│   │   ├── Gauges.tsx               # Speedometer / tachometer
│   │   ├── Controls.tsx             # Dashboard buttons / sliders
│   │   ├── RearviewMirror.ts        # Reflective mirror rendering
│   │   ├── SelectivePostProcessing.ts # Post-process settings manager
│   │   ├── VehicleManager.ts        # Vehicle configs (sedan, convertible, science-lab, limousine)
│   │   ├── theme.ts                 # Car interior theme tokens
│   │   ├── interior/                # Low-level interior building blocks
│   │   │   ├── GeometryFactory.ts
│   │   │   ├── MaterialFactory.ts
│   │   │   ├── LightingBuilder.ts
│   │   │   ├── LODManager.ts
│   │   │   ├── InteractionHelper.ts
│   │   │   ├── ClockRenderer.ts
│   │   │   ├── PostProcessingManager.ts
│   │   │   ├── RainSystem.ts
│   │   │   └── PerformanceProfiler.ts
│   │   ├── ui/                      # Reusable car dashboard UI primitives
│   │   │   ├── Button.tsx
│   │   │   ├── IconButton.tsx
│   │   │   ├── Slider.tsx
│   │   │   ├── ToggleGroup.tsx
│   │   │   ├── AudioVisualizer.tsx
│   │   │   ├── ControlPanel.tsx
│   │   │   ├── Icon.tsx
│   │   │   ├── icons.ts
│   │   │   ├── injectSliderStyles.ts
│   │   │   └── theme.tsx
│   │   └── variants/                # Vehicle-specific implementations
│   │       ├── ConvertibleMode.ts
│   │       ├── LimousineMode.ts
│   │       ├── ScienceLabMode.ts
│   │       └── index.ts
│   ├── hooks/                       # Custom React hooks + providers
│   │   ├── index.ts                 # Barrel export
│   │   ├── useStreetView.tsx        # StreetViewProvider: panorama, heading, pitch, zoom, advance, isTransitioning
│   │   ├── useViewMode.tsx          # ViewModeProvider: viewMode (freelook/car), carHeading, controlMode
│   │   ├── useEnvironmentSettings.tsx # EnvironmentSettingsProvider: weather, color grading, time of day
│   │   ├── useKeyboardShortcuts.tsx # Global shortcuts + accessibility helpers (useAnnouncer, useFocusTrap, SkipLink)
│   │   ├── useBookmarks.ts          # localStorage + cloud bookmark sync
│   │   ├── useLocationHistory.ts    # Visited panorama trail
│   │   ├── useSnapshots.ts          # Canvas snapshot management
│   │   ├── useVehicleSettings.ts    # Vehicle preference persistence
│   │   ├── usePerformanceMonitor.ts # FPS / frame time tracking with adaptive quality
│   │   ├── useLoadingState.ts       # Granular loading state machine
│   │   ├── useLoadingIntegrations.ts # Loading orchestration helpers
│   │   ├── useTransition.ts         # Animation / easing utilities
│   │   ├── useTouchControls.ts      # Touch gesture handling
│   │   ├── useDeviceDetection.ts    # Mobile / capability detection
│   │   ├── useGlobeMode.ts          # Cesium globe state
│   │   ├── useAutoNight.ts          # Automatic night mode
│   │   ├── useAdvanceSafe.ts        # Safe navigation with panorama-ready guards
│   │   ├── usePanoramaCache.ts      # Panorama pre-fetch cache
│   │   └── __tests__/               # Hook tests (mobile.test.tsx)
│   ├── effects/
│   │   ├── PostProcessing.ts
│   │   ├── LightingEffects.ts
│   │   ├── WindAudio.ts             # Procedural wind audio
│   │   └── index.ts
│   ├── animation/
│   │   ├── PhysicsAnimations.ts     # Spring physics for UI / camera
│   │   └── index.ts
│   ├── audio/
│   │   ├── AudioAnalyzer.ts         # Radio stream Web Audio analysis
│   │   └── index.ts
│   ├── materials/
│   │   ├── PBRMaterials.ts          # Three.js PBR presets
│   │   └── index.ts
│   ├── shaders/                     # GLSL shaders inlined for Three.js
│   │   ├── windowRain.ts
│   │   ├── dashboardGlow.ts
│   │   ├── starfield.ts
│   │   └── index.ts
│   ├── config/
│   │   ├── visualPresets.ts         # Low/Medium/High/Ultra quality + auto-detect
│   │   ├── cryptoCompanies.ts
│   │   ├── astronomicalConstants.ts
│   │   └── index.ts
│   ├── store/
│   │   ├── loadingState.ts          # Loading state store singleton
│   │   └── index.ts
│   ├── services/
│   │   ├── radioBrowserService.ts   # Radio station lookup
│   │   └── storageApi.ts            # Cloud storage API client
│   ├── docs/
│   │   └── GRAPHICS.md              # Graphics pipeline documentation
│   └── utils/
│       ├── navigation.ts            # findBestLink() + angle math + haversine
│       ├── navigation.test.ts       # Unit tests for navigation math
│       ├── geoTimeUtils.ts          # Sun/moon position, time-of-day colors
│       ├── performance.ts           # Performance helpers
│       ├── memoryProfiler.ts        # Heap usage tracking
│       └── index.ts
├── build/                           # Production build output
├── deploy.py                        # SFTP deployment script
├── package.json
├── tsconfig.json
├── .env                             # REACT_APP_* environment variables
├── CLAUDE.md                        # AI quick-reference (danger zones)
├── DEVELOPER_CONTEXT.md             # Architecture deep-dive
├── README.md                        # Human-facing README
└── feature_expansion_plan.md        # Roadmap
```

---

## Architecture Deep Dive

### State Management: Provider Pattern

State is no longer owned solely by `App.tsx`. Three React Context providers wrap the app:

1. **`StreetViewProvider`** (`src/hooks/useStreetView.tsx`)
   - Owns the `google.maps.StreetViewPanorama` ref, scraped canvas ref, heading, pitch, zoom, position, and `isTransitioning`.
   - `advance(direction, currentHeading?)` calls `findBestLink` and triggers `pano.setPano()`.
   - `teleport(lat, lng, targetHeading?, targetPitch?)` moves the panorama — shares the same `armHold()` hold-pause as `advance()` (see *Hold-Pause Transition* below).
   - `isTransitioning`/`isPanoramaReady` (hold-pause state) are set on advance/teleport and cleared once the new canvas passes the stability check in `src/utils/panoramaStability.ts` (not a fixed delay).
   - Maintains a `renderer` ref for GPU transition coordination.

2. **`ViewModeProvider`** (`src/hooks/useViewMode.tsx`)
   - Owns `viewMode: 'freelook' | 'car'`.
   - Manages car body `carHeading` (independent of head-look heading).
   - Tracks `controlMode`: `freeLook` | `uiMouse` | `carSteer`.
   - Tracks `headCoupling`: `rigid` (head turns with car) | `free` (head independent).
   - Supports temporary steering mode (`startTempSteerMode` / `endTempSteerMode`) triggered by clicking the steering wheel.
   - Initializes / toggles the Three.js car mode via `initCarMode()` from `src/car/index.ts`.

3. **`EnvironmentSettingsProvider`** (`src/hooks/useEnvironmentSettings.tsx`)
   - Owns all weather and color-grading uniforms: `rainIntensity`, `snowIntensity`, `wind`, `vibrance`, `saturation`, `contrast`, `exposure`, `temperature`, `tint`, `timeOfDay`, `fogDensity`, `nightIntensity`, `headlightsOn`, `domeLightOn`, `highBeam`, `isRoofOpen`, `shaderEffectsEnabled`, etc.
   - Exposes `applyTimeOfDayPreset('day' | 'sunrise' | 'sunset' | 'night')` and `applyColorGradingPreset(string)`.
   - Computes `ambientLightColor` CSS string for dashboard glass tinting.
   - Consumed by `WebGPUCanvas.tsx` and forwarded to `Renderer.updateWeatherParams()` every frame.

### View Routing

```
App.tsx
├── Providers (StreetViewProvider, ViewModeProvider, EnvironmentSettingsProvider)
└── InnerApp
    └── MainView
        ├── FreeLookView (when viewMode === 'freelook')
        └── CarModeView (when viewMode === 'car')
```

`MainView.tsx` simply reads `useViewMode().viewMode` and renders the appropriate view.

### Render Cycle: Canvas Scraping → WebGPU

1. **Google Maps API** loads in `StreetView.tsx` via dynamically injected `<script>` tag with `callback=initGoogleMaps`.
2. `MutationObserver` watches the panorama container, collects all `<canvas>` elements, sorts by pixel area, and selects the largest one ≥256×256 pixels.
3. The canvas ref flows: `StreetView.tsx` → `StreetViewProvider` (via `setCanvas`) → `App.tsx` → `WebGPUCanvas.tsx` → `Renderer.ts`.
4. `Renderer.ts` uploads the canvas every frame with `device.queue.copyExternalImageToTexture`.
5. The dual-pass pipeline renders to screen.

**Important**: The hidden Google Maps DOM element must maintain `opacity: 1`. Google Maps stops updating its internal render canvas when opacity drops too low. The element is pushed behind the WebGPU canvas via `zIndex: 0` vs `zIndex: 1`.

### WebGPU Dual-Pass Pipeline (`src/renderer/Renderer.ts`)

**Pass 1** — `streetview.wgsl`
- Source: Google Maps canvas → `copyExternalImageToTexture` → `rgba8unorm-srgb` GPU texture (stored in `videoTexture`).
- Vertex shader: fullscreen triangle-strip (no geometry buffer).
- Fragment shader: samples texture with zoom + pan uniforms `[time, zoom, panX, panY]`.
- Output target: `rgba16float` intermediate HDR texture (`intermediateTexture`).
- During panorama transitions, a transition pipeline (fade/zoom/zoom-blur/zoom-chromatic) is swapped in, blending `prevTexture` (snapshot of the departing panorama) with `videoTexture` (live incoming panorama).

**Pass 2** — `weather-post.wgsl`
- Source: HDR intermediate texture.
- Fragment shader: color grading chain (vibrance → saturation → contrast → temperature/tint → exposure), then procedural rain + snow composited additively, plus atmospheric effects (fog, light shafts, heat shimmer, lens flare, chromatic aberration, dust, humidity haze), nighttime mode, headlights, dome light, astronomical lighting (sun/moon), ACES tonemapping.
- Output target: swap-chain surface (screen).

The intermediate HDR texture is lazily created and resized in `ensureIntermediateTexture()` when canvas dimensions change. Do not cache `GPUTextureView` across frames.

A compute variant `weather-post-compute.wgsl` exists for potential compute-pipeline integration. It uses an `extraBuffer` storage array (index 0–36) mapped to the same weather parameters and exposes additional bindings for depth textures and data textures.

### WebGL2 Fallback / Debug Renderer

`src/renderer/createStreetViewRenderer.ts` selects the active post-processing backend. The default path tries WebGPU first, then WebGL2, then lets the app expose raw Street View if both renderer backends fail. Explicit flags:

```
?renderer=webgpu
?renderer=webgl
?webgpu
?webgl
```

The selected backend is exposed as `window.rendererType`, `window.usingWebGPU`, `window.usingWebGL`, and `window.rendererFallbackReason`. DevTools/automation can call `window.streetViewRendererDebug.setBackend('webgl' | 'webgpu' | 'auto')`.

The WebGL2 backend (`src/renderer/WebGLFallbackRenderer.ts`) shares the scraped panorama source, camera heading/pitch/zoom, and the same 40-float weather layout. It is an SDR single-pass approximation for debugging, not a full HDR parity renderer. It supports `?effect=raw|color|weather|fog|night|lighting` and `?wireframe` for effect isolation.

When porting WebGL debug effects back to WebGPU, keep `WebGPUCanvas.tsx`, `WeatherPostProcessor.ts`, `weather-post.wgsl`, and `WebGLFallbackRenderer.ts` aligned on weather uniform indices. See `docs/RENDERER_FALLBACK.md`.

### GPU Transition System

`Renderer.beginTransition(mode)` (legacy path, `prevTexture` via GPU→GPU `copyTextureToTexture`) supports the named crossfade modes below, but the **active** mechanism for `advance()`/`teleport()` is the **hold-pause** system described next.

Supported legacy modes: `fade`, `zoom`, `zoom-blur`, `zoom-chromatic`.

### Hold-Pause Transition (cruise hops, MiniMap/autopilot/globe teleports)

`useStreetView.tsx`'s `armHold()` (shared by `advance()` and `teleport()`) does three things before changing the panorama:
1. `renderer.beginHoldTransition(heading, pitch)` — GPU-snapshots `videoTexture` into `previousFrameTexture`, records `capturePanX/Y`, sets `holdActive = true`.
2. A CPU-side `<canvas>` snapshot of the outgoing frame (`transitionSource`, used by the WebGL fallback).
3. `setIsPanoramaReady(false)` + `setIsTransitioning(true)`.

While `holdActive`/`isPanoramaUpdatePaused` is true:
- `WebGPUCanvas.tsx` calls `renderer.renderHeldFrame(heading, pitch, zoom)` every frame instead of `renderStreetView(...)`. This **never uploads the live Google Maps canvas** — `streetview.wgsl`'s `holding` branch only samples `previousFrameTexture`, UV-shifted by the heading/pitch delta since capture (`samplePrevWithLookAround`), so mouse-look still pans the frozen frame and weather animation keeps running.
- `useStreetView.tsx`'s `pano_changed` listener polls the new (loading) hidden canvas with `getCanvasFingerprint()` until it reports `STABILITY_REQUIRED_STABLE_TICKS` consecutive identical fingerprints (and at least `STABILITY_MIN_DELAY_TICKS` have elapsed), then sets `isPanoramaReady = true`. A `STABILITY_MAX_TICKS` fallback prevents hanging forever on a status error or persistently-unstable canvas. **All of these constants live in `src/utils/panoramaStability.ts`** and are shared by this watcher, `StreetView.tsx`'s initial canvas-promotion poller, and `Renderer.ts`'s per-frame upload guard — change them in one place.
- Once ready, the release effect calls `renderer.endHoldTransition()` (clears `holdActive`) and runs a 250ms `requestAnimationFrame` crossfade via `setTransitionProgress(0→1)`.

**Regression guard**: `src/utils/streetViewProbe.ts` exposes `window.__STREETVIEW_PROBE__` with `getTimeline()` (armed/first-stable/released timestamps per hop) and `getWarnings()`. `Renderer.uploadLiveSource()` calls `streetViewProbe.warnLeak(...)` (a loud `console.warn`) if it's ever invoked while `holdActive` is true — i.e. if a future change bypasses the `renderStreetView()` hold guard. Call `window.__STREETVIEW_PROBE__.enablePixelWatch()` from DevTools to also flag abrupt brightness jumps in the visible canvas during a hold (opt-in; off by default). `scripts/hold-pause-probe.mjs` (`npm run probe:hold-pause`) drives this from Playwright against a running dev server.

### Navigation Algorithm (`findBestLink`)

`src/utils/navigation.ts`:
1. Maps `direction` to a heading offset: forward=0°, right=90°, backward=180°, left=270°.
2. Iterates `panorama.getLinks()`, computes angular distance to target with wrap-around.
3. Returns the link within 45° of target, or `null` if none qualify.

Small math errors here cause users to walk backwards or loop in circles. Test changes manually in cruise mode.

### Car Mode Rendering Stack

Car mode layers a separate Three.js WebGL scene on a transparent canvas above the WebGPU output:

```
Browser Output (top to bottom)
├── React DashboardUI.tsx (DOM overlay)
├── Three.js CarInterior.ts (WebGL canvas)
├── WebGPU weather-post.wgsl (Pass 2)
├── WebGPU streetview.wgsl (Pass 1)
└── Hidden Google Maps Panorama (DOM canvas)
```

- **`CarInterior.ts`** builds all geometry procedurally using `THREE.BoxGeometry`, `THREE.CylinderGeometry`, and custom `THREE.Shape` extrusions — no external GLTF/OBJ files.
- **`DashboardUI.tsx`** is a React overlay; its buttons call functions exported from `src/car/index.ts` directly (not through React state).
- **`RearviewMirror.ts`** renders a 180° behind view into the mirror surface using the Street View canvas.
- **Vehicles**: `sedan` | `convertible` | `science-lab` | `limousine`. Configs live in `VehicleManager.ts`. Vehicle switching is managed by the `VehicleManager` singleton.
- **`car/interior/`** contains low-level builders: `GeometryFactory`, `MaterialFactory`, `LightingBuilder`, `LODManager`, `PostProcessingManager`, `RainSystem`, `ClockRenderer`, `InteractionHelper`, `PerformanceProfiler`.
- **`car/ui/`** contains reusable dashboard primitives: `Button`, `IconButton`, `Slider`, `ToggleGroup`, `AudioVisualizer`, `ControlPanel`, `Icon`, and theme injection utilities.

### Input Handling

**FreeLookInputHandler.tsx**:
- Mouse drag on target → pan heading/pitch.
- Scroll wheel → zoom.
- Right-click → advance forward.
- WASD / Arrow keys → advance in directions.
- `c` key → toggle car mode.
- Guards against input when `document.activeElement` is an input/textarea.

**CarInputHandler.tsx**:
- Three control modes: `freeLook` (head look only), `uiMouse` (UI interaction, right-drag to steer), `carSteer` (mouse X steers car, A/D steer).
- Temporary steering mode: clicking the steering wheel in `freeLook` enters `carSteer` temporarily; releasing ends it.
- `h` key → toggle control mode.
- `c` key → recenter head to car body, or toggle view mode if already centered.
- `q` / `e` → snap steer ±45° in `carSteer` mode.

Both handlers attach **global `window` listeners** for `mousemove`, `mouseup`, `keydown`. Every UI overlay (panels, modals, inputs, dashboard buttons) **must** call `e.stopPropagation()` on mouse and keyboard events, or the panorama will spin when users type or click buttons.

### Accessibility System

`src/hooks/useKeyboardShortcuts.tsx` provides:
- `useKeyboardShortcuts(shortcuts, enabled)` — global key handler with modifier support.
- `useAnnouncer()` — ARIA live-region announcements for screen readers.
- `useFocusTrap(containerRef, isActive)` — traps Tab focus inside modals/panels.
- `SkipLink` — keyboard-only skip-to-main-content link.
- Accessibility settings persisted to `localStorage` under `webgpu_streetview_a11y_settings`.
- Body CSS classes toggled: `high-contrast`, `reduced-motion`, `large-text`, `keyboard-only-mode`.

### Performance & Adaptive Quality

`WebGPUCanvas.tsx` implements:
- **Adaptive frame skipping**: `shouldSkipFrame()` from `usePerformanceMonitor` can drop to 30fps.
- **Source-change detection**: forces full 60fps when the scraped canvas changes.
- **Transition boost**: forces full fps while `isTransitioning` is true.
- **Debounced resize**: 150ms debounce on window resize.
- **WebGPU device loss recovery**: reinitializes renderer on `device.lost`.

`usePerformanceMonitor` tracks FPS, frame time, and can auto-degrade quality when below thresholds (warning: 45fps, critical: 30fps).

---

## Critical Danger Zones

### 1. Canvas Scraping (`src/components/StreetView.tsx`)
Google Maps does **not** expose a public canvas API. The implementation uses `MutationObserver` to watch the DOM, sorts `<canvas>` elements by area, and heuristically picks the largest one ≥256×256 pixels.

**Risk**: If Google changes their internal DOM structure, canvas detection silently breaks and the WebGPU output stays black. Do not add assumptions about canvas IDs, class names, or tree depth.

### 2. Input Event Hijacking (`FreeLookInputHandler.tsx` / `CarInputHandler.tsx`)
Listeners are attached to `window`. Every UI overlay (panels, modals, inputs, dashboard buttons) **must** call `e.stopPropagation()` on mouse and keyboard events, or the panorama will spin when users type or click buttons.

### 3. WebGPU Texture Lifecycle (`Renderer.ts`)
- `ensureIntermediateTexture()` lazily creates/resizes the HDR texture.
- `videoTexture` is recreated when the scraped canvas changes dimensions.
- `copyExternalImageToTexture` is wrapped in try-catch to survive transient resize errors.
- Do not cache `GPUTextureView` across frames — the underlying texture may be recreated.

### 4. Hold-Pause / `isTransitioning` + `isPanoramaReady` Coordination
`StreetViewProvider` sets `isTransitioning = true` and `isPanoramaReady = false` when `advance()`/`teleport()` arm the hold (see *Hold-Pause Transition* above), and only flips `isPanoramaReady` back to `true` once the new hidden canvas passes the shared stability check — not a fixed delay. `WebGPUCanvas.tsx` reads `isPanoramaUpdatePaused` (`isTransitioning && !isPanoramaReady`) to render the frozen GPU snapshot (`renderHeldFrame`) instead of uploading the live (still-loading) canvas, and forces full fps during the hold/release. If this wiring breaks — the `holdActive` guard in `Renderer.renderStreetView()`/`uploadLiveSource()`, or the `isPanoramaUpdatePaused` check in `WebGPUCanvas.tsx` — cruise mode will flash blurry/low-res tiles on every hop. `window.__STREETVIEW_PROBE__` (`src/utils/streetViewProbe.ts`) is the regression guard for exactly this: it warns loudly if the live canvas is ever uploaded while a hold is active.

### 5. API Key Management & Referrer Restrictions (Root Cause of Issue #72)
The live demo at `test.1ink.us/streetview` historically showed "This page can't load Google Maps correctly" because the key baked into the bundle (or served via the committed `public/config.js`) had HTTP referrer restrictions that only allowed `go.1ink.us` (or localhost), not `test.1ink.us`.

**Current correct architecture** (as of the fixes for #72):
- **Primary (prod deploys)**: Runtime `window.MAPS_API_KEY` via `public/config.js` (injected by `deploy.py` when you pass `MAPS_API_KEY=...`).
- **Fallback**: `REACT_APP_MAPS_API_KEY` baked at build time.
- The committed `public/config.js` must **never** contain a real key (now empty + example file provided).
- `.env` (plain) is gitignored; real dev keys only in `.env.local`.
- Every production key **must** list **all** demo hosts under HTTP referrers:
  ```
  https://test.1ink.us/*
  https://go.1ink.us/*
  ```
- The `gm_authFailure` global + `onMapsAuthFailure()` + React banners + DOM post-load scanner in `src/services/maps/loader.ts` give excellent visibility. The prebuild warning + deploy.py loud checks make the mistake obvious before it reaches users.

**Never** rely on a single baked key for multiple hosts with different restrictions. Always prefer the runtime override for the official demo. Do not commit new keys.

### 6. Shader Uniform Layouts
`weather-post.wgsl` expects a 40-float (160-byte) uniform buffer:
```
[0-5]   vibrance, saturation, contrast, exposure, temperature, tint
[6-10]  time, rainIntensity, snowIntensity, wind, speed
[11-15] nightIntensity, headlightsOn, highBeam, headlightHeading, headlightPitch
[16-17] domeLightOn, domeLightIntensity
[18-21] sunAzimuth, sunAltitude, moonAzimuth, moonAltitude
[22-31] fogIntensity, fogDensity, fogHeight, fogColorIndex, lightShaftsIntensity, heatShimmerIntensity, lensFlareIntensity, chromaticAberration, dustIntensity, humidityHaze
[32]    shaderEffectsEnabled
[33-34] cameraHeading, cameraPitch
[35]    padding
[36]    sunrise
[37]    anamorphicStreak
[38-39] padding
```

The main `streetview.wgsl` uniform buffer is 8 floats (32 bytes):
```
[0-3]   time, zoom, panX, panY
[4]     inlineTransitionProgress
[5]     transitionParam1 (zoom amount)
[6]     transitionParam2 (blur strength)
[7]     padding
```

Changing either layout without updating both `Renderer.ts`, `WebGPUCanvas.tsx`, and the WGSL files will break rendering.

### 7. Google Maps Canvas Opacity Requirement
The hidden Street View container must maintain `opacity: 1`. Google Maps stops updating its internal render canvas when opacity is low. Visibility is controlled via `zIndex` and `pointerEvents`, never `opacity`.

---

## Testing Strategy

The project uses Create React App's default testing setup:
- **Framework**: Jest
- **Utilities**: React Testing Library, jest-dom
- **Run**: `npm test` (watch mode) or `npm test -- --watchAll=false` (CI)

### Existing Tests
- `src/utils/navigation.test.ts` — Unit tests for `findBestLink`, angle math (`normalizeAngle`, `signedAngleDiff`, `absoluteAngleDiff`), and `haversineDistance`.
- `src/hooks/__tests__/mobile.test.tsx` — Mobile hook behavior tests (`useTouchControls` gesture state, `useDeviceDetection` quality settings, battery save mode).
- `src/App.test.tsx` — Default CRA smoke test (renders without crashing, welcome modal visible).
- `src/utils/panoramaStability.test.ts` — Shared stability constants (tick/ms derivation) and `getCanvasFingerprint` (size floor, near-black rejection, dark-but-valid frames, change detection).
- `src/utils/panoramaLookAround.test.ts` — Pure math for the hold-pause look-around UV shift (`wrapPanDelta`, `heldLookAroundUvDelta`, zoom scaling).
- `src/utils/streetViewProbe.test.ts` — Hold timeline recording (armed/first-stable/released), warning capping, and the opt-in intra-hold pixel-drift heuristic.
- `src/components/holdRenderLoop.test.ts` — Render-loop policy for when held frames must render regardless of adaptive frame skipping.
- `src/hooks/__tests__/useStreetView.holdLook.test.tsx` — `advance()`/`teleport()` hold-arming, `setPov` suppression during hold, and teleport's no-op-while-transitioning guard.
- `src/renderer/RendererBackend.test.ts`, `src/renderer/createStreetViewRenderer*.test.ts` — Backend preference/debug-flag parsing and the WebGPU→WebGL2→raw fallback chain.

### Manual Testing Requirements
WebGPU rendering and canvas detection cannot be reliably tested in Jest. Any changes to the following require manual browser verification:
- `StreetView.tsx` canvas scraping
- `Renderer.ts` WebGPU pipeline
- `car/` Three.js scene
- Input handlers and UI overlay interactions
- Cruise mode navigation loops
- GPU panorama transitions

### Hold-Pause Manual Checklist
Run this after touching `WebGPUCanvas.tsx`, `Renderer.ts`, `useStreetView.tsx`, `StreetView.tsx`, or `src/utils/panoramaStability.ts` / `streetViewProbe.ts`:

1. Open DevTools console. Enable cruise mode and watch 10+ hops.
   - **Pass**: each hop holds on a frozen frame, then crossfades cleanly into the new panorama — no visible blur, no low-res tile pop-in, no torn/duplicated frame.
   - **Fail signal**: any `[StreetViewProbe] INVARIANT VIOLATION: ...` warning in the console. This means the `holdActive` guard was bypassed and live Google Maps content reached the screen.
   - You should see one `[StreetViewProbe] hold armed at T=...` / `first stable at T+...ms` / `released at T+...ms (hold total)` triple per hop, with the released delta consistent (roughly 400–1900ms: `STABILITY_MIN_DELAY_MS`..`STABILITY_MAX_WAIT_MS` plus the 250ms release crossfade) and no repeated "Stability fallback" log spam.
2. During a hop (while held), click-drag the mouse to look around. The frozen pano should pan with the drag; rain/snow/fog should keep animating. Releasing the mouse should not change which way you're facing once the new pano loads.
3. Click a MiniMap point (or trigger an autopilot waypoint / globe Orbital Drop) far from the current location. Same expectation as cruise hops: hold, then clean crossfade — no blurry pop-in.
4. Optional deeper check: `window.__STREETVIEW_PROBE__.enablePixelWatch()` in DevTools, then repeat step 1. Inspect `window.__STREETVIEW_PROBE__.getWarnings()` afterward — should be empty.
5. Automated version of the above: `npm start` in one terminal, then `npm run probe:hold-pause -- --hops=10` (requires a real Maps key — a placeholder key will load the app but report "no hold was armed" since there are no panorama links to follow). Non-zero exit / `FAIL` in the output means either a probe warning fired or an intra-hold screenshot comparison detected a sudden jump.

### Local Testing with Headless Chrome (GPU)
When running in a headless GPU environment (e.g., Colab with NVIDIA T4):

1. **Serve the build**
   ```bash
   npm run build   # outputs to build/
   cd build && python3 -m http.server 80
   ```

2. **Cesium post-build patches (CRITICAL)**
   Cesium 1.140.0 bundles ESM-only code (`import.meta.url`, `__webpack_module__`) that crashes in CRA's IIFE output. After every `npm run build`, patch `build/static/js/main.*.js`:
   ```bash
   # Replace import.meta (syntax error in non-module scripts)
   sed -i 's/import\.meta/({url:typeof window!=="undefined"?window.location.href:""})/g' build/static/js/main.*.js
   # Replace __webpack_module__ (undefined in IIFE bundles)
   sed -i 's/__webpack_module__/undefined/g' build/static/js/main.*.js
   ```
   Without these patches, the page throws `Cannot use 'import.meta' outside a module` and stays black.

3. **Google Maps API key for local testing**
   The production key has referrer restrictions. For local testing, either:
   - Add your localhost origin to the key's allowlist in Google Cloud Console, **or**
   - Spoof an allowed domain via `/etc/hosts`:
     ```bash
     echo "127.0.0.1 test.1ink.us go.1ink.us" >> /etc/hosts
     # Then serve on port 80 and access http://test.1ink.us
     ```
   - Set the key in `build/config.js` (runtime, no rebuild needed):
     ```js
     window.MAPS_API_KEY = "<your-key>";
     ```

4. **Headless Chrome launch flags for WebGPU**
   ```js
   chromium.launch({
     headless: true,
     args: [
       '--use-gl=egl',
       '--use-angle=gl-egl',
       '--enable-features=Vulkan',
       '--enable-unsafe-webgpu',
       '--ignore-gpu-blocklist',
       '--enable-gpu-rasterization',
       '--enable-zero-copy',
       '--disable-software-rasterizer',
       '--no-sandbox',
       '--disable-setuid-sandbox'
     ]
   });
   ```
   Note: WebGPU adapter availability varies by headless Chrome version and OS. The app falls back to standard Street View rendering if WebGPU is unavailable.

---

## Deployment

```bash
npm run build        # outputs to build/
python deploy.py     # SFTP upload to test.1ink.us/streetview
```

`deploy.py` uses `paramiko` to connect to `ford442@1ink.us` and recursively uploads `build/`. **Security note**: the script currently contains a hardcoded password. In a production environment this should be replaced with environment variables or key-based authentication.

---

## Code Conventions

- **TypeScript strict mode** — no `any` unless absolutely unavoidable.
- **Functional components with hooks** — no class components.
- **PascalCase** for components and types; **camelCase** for functions, variables, and files.
- **State ownership** — prefer providers and custom hooks over prop drilling.
- **useCallback** for handlers passed to children.
- **Cleanup** — always return a cleanup function from `useEffect` if you register timers, observers, or event listeners.
- **Event propagation** — `e.stopPropagation()` on **all** mouse and keyboard events inside UI overlays.
- **No raw strings** for magic numbers in shader uniforms — document layout changes in both TS and WGSL.
- **Barrel exports** — `src/hooks/index.ts`, `src/components/index.ts`, `src/views/index.ts`, etc.

---

## Security Considerations

1. **API Key Exposure**: A Google Maps API key is hardcoded in `src/App.tsx` (`GOOGLE_MAPS_KEY`). The `.env` file supports `REACT_APP_MAPS_API_KEY` but the fallback is visible in source. Never commit additional keys.
2. **Deployment Credentials**: `deploy.py` contains a hardcoded SFTP password (`GoogleBez12!`). This should be moved to environment variables or replaced with SSH key auth immediately.
3. **CORS Audio**: The radio stream uses `crossOrigin = "anonymous"` on the HTMLAudioElement.
4. **Local Storage**: Accessibility settings, bookmarks, and snapshots are stored in `localStorage`. No encryption is applied.
5. **Script Injection**: `StreetView.tsx` dynamically injects a `<script>` tag for the Google Maps API. The URL is constructed with a template literal containing the API key.

---

## Known Limitations

1. **WebGPU Support**: Requires modern Chrome/Edge. Falls back to hidden canvas view if unavailable.
2. **Canvas Scraping Fragility**: Any Google Maps DOM restructure will silently break the canvas feed.
3. **Mobile**: WebGPU on mobile is limited; a touch-friendly `MobileUI.tsx` fallback is active but car mode is desktop-focused.
4. **Accessibility**: Keyboard navigation works globally; screen-reader support is present via `useAnnouncer` and ARIA live regions but can be enhanced.
5. **Offline**: No offline mode. Requires continuous internet for Map tiles and Street View imagery.
6. **API Key Exposure**: Fallback key is visible in `App.tsx` source.
7. **API Rate Limits**: Google Directions API quotas may throttle heavy route planning.
8. **Build Tool Lock-in**: Create React App 5.0.1 is used; ejecting is irreversible.
9. **Cesium ESM in IIFE bundles**: Cesium 1.140.0 ships code that uses `import.meta.url` and `__webpack_module__`, which are invalid in CRA's default IIFE bundle output. The built `main.*.js` must be post-processed before deployment or local testing (see *Local Testing with Headless Chrome* above).
10. **Hidden Google Maps error UI flicker**: When the Maps key is invalid or referrer-blocked, Google injects `.gm-err-*` elements into the hidden Street View scraper div. Because the scraper must stay `opacity:1` for Google to keep rendering, those error elements can flash and produce visible flicker. The fix is to suppress them via CSS scoped to `.streetview-scraper` and/or remove them on `gm_authFailure`.

---

## Resources

- [Google Maps Platform Documentation](https://developers.google.com/maps/documentation)
- [WebGPU Specification](https://www.w3.org/TR/webgpu/)
- [Street View Static API](https://developers.google.com/maps/documentation/streetview)
- [WebGPU Samples](https://webgpu.github.io/webgpu-samples/)

---

## Cursor Cloud specific instructions

Single-product Create React App project; `npm install` is the only dependency step (runs automatically on VM startup). Standard commands live in **Build, Test, and Deploy Commands** above — reuse those rather than inventing new ones.

- **Run the app**: `npm start` (dev server on `http://localhost:3000`; `BROWSER=none` avoids a browser-launch attempt in headless VMs). CRA runs ESLint during `npm start`/`npm run build`; the current tree compiles with lint warnings only (unused vars, exhaustive-deps) — no errors.
- **Type check** (no dedicated npm script): `npx tsc --noEmit`. Passes clean.
- **Tests**: `CI=true npm test -- --watchAll=false`. As of this setup, 123/128 pass. The 5 failures are pre-existing and unrelated to the environment: `src/App.test.tsx` fails to load because Cesium needs a `TextDecoder`/`TextEncoder` polyfill under jsdom, and `src/hooks/__tests__/mobile.test.tsx` tries to `Object.defineProperty(window, 'ontouchstart', ...)` on a non-configurable property. Do not treat these as setup breakage.
- **Google Maps API key is required for the CORE feature (Street View)**. With no key the app still boots and renders its full React UI, but the main canvas stays black and shows a "No Google Maps API key is configured" banner. For local dev, put a key (with `http://localhost:3000/*` in its HTTP-referrer allowlist) in `.env.local` as `REACT_APP_MAPS_API_KEY=...` (gitignored) **or** set `window.MAPS_API_KEY` in `public/config.js`. The committed `.env` value is an intentional placeholder — never commit a real key. CRA bakes `REACT_APP_*` at dev-server start, so **restart `npm start` after editing `.env.local`**.
- **Symptom → cause: stuck at "Connecting to Google Maps... 15%" with a black canvas and NO error banner.** This means the key string is valid enough to load the Maps JS library (`window.__mapsApiLoadState.status === 'ready'`) but Google fires `gm_authFailure` when the Street View panorama actually renders, so no `<canvas>` is ever produced and the loading gate never advances. The usual cause is the key's **HTTP-referrer restriction not allowing the current origin** (e.g. a key scoped to `test.1ink.us`/`go.1ink.us` will fail on `http://localhost:3000`), or disabled billing / Maps JavaScript API. Fix it in Google Cloud Console (add `http://localhost:3000/*` to the key's allowlist); it is not a code or VM bug. Verify quickly with a minimal panorama page + Playwright and watch for a `gm_authFailure` log.
- **Headless/cloud browser GPU limits** (not code bugs): the headless Chrome here reports WebGPU unavailable (`console.warn: WebGPU not supported`), so the renderer falls back to WebGL2 → raw. Cesium Globe mode is interactive (camera responds to drag/zoom) but Earth textures may not load, and Car mode's Three.js interior may fail to initialize due to WebGL context contention. Full GPU rendering (WebGPU dual-pass Street View, Cesium terrain, car interior) needs a real GPU browser — verify those visually on a WebGPU-capable Chrome/Edge, not in the headless VM.
- No committed lockfile (`package-lock.json` is gitignored), so `npm install` resolves fresh each run.

---

*Last Updated: June 25, 2026*
