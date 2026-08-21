# WebGPU StreetView — AI Agent Documentation

## Project Overview

**1ink.us Streetview** is a WebGPU-accelerated Google Maps Street View viewer that creates an immersive, interactive navigation experience. The application scrapes the Street View panorama from a hidden Google Maps canvas and renders it using a custom WebGPU shader pipeline, enabling HDR post-processing effects (color grading, rain, snow, fog, volumetric light shafts, lens flare, heat shimmer, chromatic aberration, dust particles, humidity haze) that are impossible through the native Maps API alone. It also layers a fully procedural Three.js car interior on top for a virtual road-trip cockpit.

### Core Purpose
The application acts as a custom renderer wrapper around the Google Maps JavaScript API. By capturing the panoramic view from a hidden Google Maps canvas and rendering it onto a WebGPU canvas, the architecture allows for GPU-accelerated rendering, real-time weather effects, and a dual-pass HDR pipeline.

### Live Deployment
- **URL**: https://test.1ink.us/streetview
- **Deployment Target**: 1ink.us via Contabo bundle API (`deploy.py` + `DEPLOY_TOKEN`)

---

## Technology Stack

| Layer | Technology | Version |
|-------|------------|---------|
| Frontend Framework | React | 19.1.1 |
| Language | TypeScript | 4.9.5 |
| Build Tool | Vite 5 + Vitest | — |
| Rendering API | WebGPU | Native browser API |
| 3D Overlay | Three.js | 0.160.0 |
| Shader Language | WGSL | WebGPU Shading Language |
| Maps Integration | Google Maps JavaScript API | Weekly |
| State Management | React Context + Hooks | Provider pattern |
| Testing | Vitest + React Testing Library | jest-dom |
| Globe Integration | Cesium (CDN-loaded, no npm dep) | 1.140.0 |
| Additional | suncalc, ajv, web-vitals | Various |

### Browser Support
- **Production**: `>0.2%, not dead, not op_mini all`
- **Development**: Last 1 Chrome, Firefox, Safari versions
- **WebGPU Required**: Chrome/Edge 113+, Firefox Nightly (with `dom.webgpu.enabled`)

---

## Build, Test, and Deploy Commands

> **Always `npm ci` in a clean or unfamiliar environment — never `npm install`.**
> A partial install does not fail loudly; it fails as dozens of type errors that
> look like application bugs. Missing `vite`/`vitest` removes the ambient types
> that declare the `*.module.css` wildcard and the jest-dom matchers, so `tsc`
> reports hundreds of errors across unrelated files (verified: deleting `vitest`
> alone takes `npm run typecheck` from 0 errors to ~1370). `npm run check:install`
> diagnoses this in one line, and runs automatically before `typecheck` and `test`.

```bash
# Clean-environment install — exactly the lockfile, stale trees removed.
npm ci

# Local incremental install. CI / deploy always use `npm ci` on Node 20.
# package-lock.json is committed — always include lockfile changes in dependency PRs.
npm install

# Verify node_modules matches package.json (auto-runs before typecheck/test)
npm run check:install

# Start development server (port 3000)
npm start

# Create production build (outputs to build/)
npm run build

# Run unit tests once (Vitest)
npm test

# Watch mode
npm run test:watch

# Typecheck
npm run typecheck

# Playwright E2E (keyless smoke vs full/keyed — see Testing Strategy)
npm run test:e2e:smoke
# REACT_APP_MAPS_API_KEY=... npm run test:e2e:keyed

# C++ WASM algorithms — native host build + golden tests (no emcc, no browser)
npm run test:cpp
npm run test:cpp:asan       # same, with ASan + UBSan
```

### Deployment
```bash
# 1. Build production bundle
npm run build

# 2. Deploy (credentials from environment — never commit)
export DEPLOY_TOKEN='...'
MAPS_API_KEY='AIzaSy...' python deploy.py
# Uploads build/ via Contabo storage manager → test.1ink.us or go.1ink.us
```

Env notes: Vite accepts `REACT_APP_*` (compat) and `VITE_*`. Prefer `REACT_APP_MAPS_API_KEY` in `.env.local` for continuity, or `VITE_MAPS_API_KEY`. Runtime `public/config.js` / `MAPS_API_KEY` deploy bake still win for production.
---

## Project Structure

```
webgpu_streetview/
├── public/                          # Static assets (not bundled by Vite)
│   ├── index.html                   # HTML entry point (root index.html is the Vite entry)
│   ├── images/                      # Static images
│   └── shaders/                     # WGSL shader files loaded at runtime via fetch()
│       ├── streetview.wgsl          # Pass 1: panorama → HDR intermediate
│       ├── weather-post.wgsl        # Pass 2: HDR + weather/color grading → screen
│       ├── weather-post-compute.wgsl # Compute pipeline variant of weather post-process
│       ├── carview.wgsl             # Car windshield post-process
│       ├── texture.wgsl             # Debug passthrough
│       └── transition-*.wgsl        # GPU panorama transitions (fade, zoom, zoom-blur, zoom-chromatic)
├── src/
│   ├── App.tsx                      # Thin root: AppProviders + AppShell (<200 LOC)
│   ├── app/                         # App composition layer (extracted from App.tsx)
│   │   ├── AppProviders.tsx         # StreetView + ViewMode + Environment provider stack
│   │   ├── AppShell.tsx             # Layout + mount composition only (≤~350 LOC)
│   │   ├── shell/                   # Colocated chrome / stage UI modules
│   │   │   ├── ConnectedChrome.tsx  # Toolbar + feature panels + globe (when connected)
│   │   │   ├── MapsAuthModal.tsx    # Hard Maps auth-failure alertdialog
│   │   │   ├── OfflineStatusToast.tsx
│   │   │   └── StreetViewStage.tsx  # Scraper + WebGPU + MainView + loading overlay
│   │   ├── useAppPanels.ts          # Panel open/close state
│   │   ├── useAppTelemetry.ts       # Performance overlay + memory profiler sampling
│   │   ├── useMapsBootstrap.ts      # Maps key resolution, auth recovery, gm-err suppressor
│   │   ├── useSharedSessionSync.ts  # Host 10Hz broadcast + guest teleport/POV apply
│   │   ├── useRadioAudio.ts         # Free-look radio Audio + Web Audio graph
│   │   ├── useHistoricalExperience.ts # Timeline + comparison wiring
│   │   ├── useTourBindings.ts       # getCurrentPOV + TourPanel prop bag
│   │   ├── useAppAccessibility.ts   # A11y settings + body class toggles
│   │   ├── useAppConnection.ts      # Welcome/connected + canvas/WebGPU readiness
│   │   ├── sharedSessionSync.ts     # Pure host snapshot / guest-apply helpers
│   │   ├── historicalExperience.ts  # Pure historical after-label helper
│   │   ├── mapsKeyUtils.ts          # Pure Maps key normalization / resolution helpers
│   │   ├── mapsLoadingOverlay.ts    # Pure LoadingOverlay state derivation
│   │   └── index.ts                 # Barrel exports
│   ├── offline/                     # PWA shell + IndexedDB metadata (Phase 1–3 offline mode)
│   │   ├── serviceWorkerRegistration.ts
│   │   ├── swPolicy.ts              # Cache rules (never cache Google imagery)
│   │   ├── offlineStore.ts          # IndexedDB stores
│   │   ├── offlinePersistence.ts    # localStorage ↔ IndexedDB mirror
│   │   ├── storageEstimate.ts       # navigator.storage.estimate helpers
│   │   ├── routePrefetch.ts         # Phase 3 route graph scaffold
│   │   └── index.ts
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
│   │   ├── RearviewMirror.ts        # Rear-view glass (true Static feed, else honest unavailable)
│   │   ├── rearViewFeed.ts          # Throttled/budgeted Street View Static rear imagery (billable)
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
│       ├── routeStats.ts            # Route length stats via WASM batch_haversine
│       ├── geoTimeUtils.ts          # Sun/moon position, time-of-day colors
│       ├── cesiumImagery.ts         # Globe imagery/terrain resolution (Ion token → CartoCDN fallback)
│       ├── performance.ts           # Performance helpers
│       ├── memoryProfiler.ts        # Heap usage tracking
│       └── index.ts
├── build/                           # Production build output
├── deploy.py                        # Contabo bundle deploy (reads DEPLOY_TOKEN from env)
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

State is no longer owned solely by `App.tsx`. Three React Context providers wrap the app via `src/app/AppProviders.tsx`:

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
├── AppProviders (src/app/AppProviders.tsx)
│   ├── StreetViewProvider
│   ├── ViewModeProvider
│   └── EnvironmentSettingsProvider
└── AppShell (src/app/AppShell.tsx)
    └── MainView
        ├── FreeLookView (when viewMode === 'freelook')
        └── CarModeView (when viewMode === 'car')
```

`MainView.tsx` simply reads `useViewMode().viewMode` and renders the appropriate view.

### Render Cycle: Canvas Scraping → WebGPU

1. **Google Maps API** loads in `StreetView.tsx` via dynamically injected `<script>` tag with `callback=initGoogleMaps`.
2. `MutationObserver` watches the panorama container, collects all `<canvas>` elements, sorts by pixel area, and selects the largest one ≥256×256 pixels.
3. The canvas ref flows: `StreetView.tsx` → `StreetViewProvider` (via `setCanvas`) → `AppShell.tsx` → `WebGPUCanvas.tsx` → `Renderer.ts`.
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

**Pass 2b (opt-in)** — `weather-post-compute.wgsl` via `ComputeWeatherPostProcessor.ts`, selected with `?weather=compute` or the `ultra` visual quality preset. Same effects as Pass 2, but as a `@workgroup_size(16,16,1)` compute shader writing an `rgba32float` storage texture, followed by a `textureLoad` blit render pass to the swap-chain surface. Uses an `extraBuffer` storage array (index 0–39) mapped to the same `WeatherParamIndex` layout as Pass 2, and exposes additional `image_video_effects`-compatible bindings for depth textures, data textures, and a `plasmaBuffer` storage array. Live resources: `writeDepthTexture` / `readDepthTexture` (bindings 6/4), `plasmaBuffer` (binding 12, WASM fBm tile), and GPU precipitation on bindings 7/8 (`weather-particles.wgsl`, seeded by `fill_particle_seeds`) at High/Ultra. `dataTextureC` stays a 1x1 dummy. `src/renderer/weatherShaderParity.test.ts` is the WGSL parity guard for `applyNight`, `snow(...)` and the shared helper bodies (including the noise-tile sampler) between fragment and compute — the particle layer is compute-only. See "Weather Post-Process: Fragment vs Compute" in `docs/RENDERER_FALLBACK.md`.

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

`Renderer.beginTransition(mode)` (legacy path, `prevTexture` via GPU→GPU `copyTextureToTexture`) supports the named crossfade modes below, but the **active** mechanism for `advance()`/`teleport()` is the **hold-pause** system described next. Legacy transition shaders are now opt-in and load only with `?legacyTransitions=1`.

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
- **`RearviewMirror.ts`** renders the cabin rear-view glass. It never samples the forward Street View canvas (a forward *perspective* capture cannot be UV-shifted into a rear view). With a true rear sample bound via `setRearSample()` it shows that imagery, mirror-flipped and UV-registered against the car heading; with none it shows the honest "unavailable" glass.
- **`rearViewFeed.ts`** is the only source of true rear imagery: a Street View **Static API** sample at `carHeading + 180`. The Static API is **billable per request**, so the feed is opt-in, throttled, deduped, session-budgeted, and killable — see `BILLING_SAFETY_CHECKLIST.md` § "Billable In-App Features" before changing any default. Driven by `useRearViewFeed`; toggled from the car dashboard's **Rear** button.
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

**Health model** (`src/utils/scraperHealth.ts`): StreetView emits a structured `ScraperHealth` snapshot (`locating` | `promoting` | `stable` | `lost` | `auth-blocked` | `timeout`) with canvas count, selected area, fingerprint age, and last error reason. AppShell / `buildMapsLoadingOverlay` surface **distinct** copy for scrape loss vs Maps auth failure vs WebGPU fallback. DevTools: `window.__STREETVIEW_PROBE__.getScraperHealth()`.

**Recovery**: The scraper does **not** stop after the first promote. MutationObserver + `pano_changed` + visibility/focus listeners + a steady 2s self-check re-query canvases if Google replaces the node mid-session. Never treat a single canvas element reference as permanent.

**Invariant**: Scraper container must keep `opacity: 1` (see `SCRAPER_CONTAINER_INVARIANTS`). Visibility is via `zIndex` / `pointerEvents` only — lowering opacity stops Google from painting.

### 2. Input Event Hijacking (`FreeLookInputHandler.tsx` / `CarInputHandler.tsx`)
Listeners are attached to `window`. Every UI overlay (panels, modals, inputs, dashboard buttons) **must** call `e.stopPropagation()` on mouse and keyboard events, or the panorama will spin when users type or click buttons.

### 3. WebGPU Texture Lifecycle (`Renderer.ts`)
- Adapter requests use an explicit power policy (`?gpu=low|high`, then battery heuristic, then high-performance default).
- `GPUCanvasContext.configure(...)` is explicit: `alphaMode: 'opaque'`, `colorSpace: 'srgb'`, `usage: RENDER_ATTACHMENT | COPY_SRC`.
- `ensureIntermediateTexture()` lazily creates/resizes the HDR texture.
- `videoTexture` is recreated when the scraped canvas changes dimensions.
- `copyExternalImageToTexture` is wrapped in try-catch to survive transient resize errors.
- Do not cache `GPUTextureView` across frames — the underlying texture may be recreated.
- Device loss teardown must unconfigure the canvas context before reinit (`WebGPUCanvas` handles fresh renderer creation via `reinitCounter`).

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
`weather-post.wgsl` (fragment pass, active by default) and `weather-post-compute.wgsl` (compute pass, opt-in via `?weather=compute` — see `docs/RENDERER_FALLBACK.md`) both expect the same 40-float (160-byte) parameter layout. The single source of truth is `src/renderer/weatherUniformLayout.ts` (`WeatherParamIndex`) — both `WeatherPostProcessor.ts` and `ComputeWeatherPostProcessor.ts` import it instead of hardcoding indices:
```
[0-5]   vibrance, saturation, contrast, exposure, temperature, tint
[6-10]  time, rainIntensity, snowIntensity, wind, speed
[11-15] nightIntensity, headlightsOn, highBeam, headlightHeading, headlightPitch
[16-17] domeLightOn, domeLightIntensity
[18-21] sunAzimuth, sunAltitude, moonAzimuth, moonAltitude
[22-31] fogIntensity, fogDensity, fogHeight, fogColorIndex, lightShaftsIntensity, heatShimmerIntensity, lensFlareIntensity, chromaticAberration, dustIntensity, humidityHaze
[32]    shaderEffectsEnabled
[33-34] cameraHeading, cameraPitch
[35]    wasmNoiseEnabled
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

Changing either layout without updating `weatherUniformLayout.ts`, `Renderer.ts`, `WebGPUCanvas.tsx`, and both weather WGSL files will break rendering.

### 7. Google Maps Canvas Opacity Requirement
The hidden Street View container must maintain `opacity: 1`. Google Maps stops updating its internal render canvas when opacity is low. Visibility is controlled via `zIndex` and `pointerEvents`, never `opacity`.

---

## Testing Strategy

The project uses Vitest + React Testing Library plus a side-by-side Playwright E2E suite:

- **Framework (unit)**: Vitest + React Testing Library + jest-dom (`jest` is aliased to `vi` in `setupTests.ts` for CRA-era suites; prefer `vi.mock` for new mocks)
- **Run unit**: `npm test` (CI) or `npm run test:watch`
- **Setup file**: `src/setupTests.ts` — imports `@testing-library/jest-dom/vitest` and polyfills `TextDecoder`/`TextEncoder` from Node's `util` module onto `globalThis`. jsdom does not implement either; the polyfill protects suites whose transitive deps expect them at module-load time.
- **Framework (E2E)**: Playwright (`@playwright/test`, aligned with the `playwright` driver used by `scripts/hold-pause-probe.mjs`)
- **Config**: `playwright.config.ts` + specs under `e2e/`
- **Run E2E**:
  - `npm run test:e2e:smoke` — keyless UI shell (PR CI); skips `@keyed` tests
  - `npm run test:e2e:keyed` / `npm run test:e2e` — full suite; Maps-dependent cases need `REACT_APP_MAPS_API_KEY`
  - Optional: start `npm start` yourself and set `E2E_SKIP_WEBSERVER=1`
- **Artifacts**: traces / screenshots / video under `test-results/` and `playwright-report/` (gitignored); CI uploads them on failure

### Unit tests (Vitest/jsdom) vs. browser E2E (Playwright)
- **Vitest covers**: pure logic and math (`navigation.ts`, `panoramaStability.ts`, `panoramaLookAround.ts`, `scraperHealth.ts`, `app/mapsKeyUtils.ts`, `app/mapsLoadingOverlay.ts`, `app/sharedSessionSync.ts`, `app/historicalExperience.ts`), hook state machines (`useDeviceDetection`, `useTouchControls`, `useStreetView` hold-arming), backend/fallback-chain selection logic (`RendererBackend.test.ts`, `createStreetViewRenderer*.test.ts`), and component smoke tests with `StreetView`/`WebGPUCanvas` mocked out (`App.test.tsx`). These run in jsdom with no real GPU — `navigator.gpu` is undefined, so `createStreetViewRenderer.test.ts` deliberately exercises the "WebGPU not supported, fall through to WebGL2, then raw" path rather than a real WebGPU device; the `console.warn`/`console.error` noise this produces (`WebGPU not supported...`, jsdom's `Not implemented: HTMLCanvasElement.prototype.getContext`) is expected test output, not a failure.
- **Playwright E2E covers**: real Chromium against `npm start` (or a static `build/` server): welcome boot, missing-key banner, bookmark panel input isolation, car-mode toolbar toggle, offline `service-worker.js` registration, `?renderer=webgl` → `window.rendererType` (when a Maps canvas exists), and keyed hold-pause hops via `window.__STREETVIEW_PROBE__`. Specs live in `e2e/*.spec.ts`.
- **Legacy probe**: `npm run probe:hold-pause` remains for deeper intra-hold pixel checks; nightly runs both the keyed Playwright suite and this probe.

### WASM numeric layer (`cpp/` + `src/wasm/`)

The hot CPU math (noise tiles, fBm, particle seeds, batch geodesy, engine PCM)
exists as three implementations — the shipping `public/wasm/streetview-wasm.wasm`,
the C++ in `cpp/src/noise_module.cpp`, and the pure-JS fallback in
`src/wasm/index.ts`. They are pinned to **one set of golden vectors** captured
from the shipping binary by `scripts/gen-wasm-goldens.mjs`:

- **`npm run test:cpp`** — CMake host target + doctest goldens, built with
  `-Wall -Wextra -Wpedantic -Wshadow -Wconversion -Werror` under both g++ and
  clang++. Needs only `cmake` and a C++17 compiler. `npm run test:cpp:asan`
  adds ASan + UBSan. Configuring writes `cpp/build-host/compile_commands.json`
  for clangd.
- **`src/wasm/__tests__/wasmGoldenParity.test.ts`** — the same vectors against
  the JS fallback (runs with `npm test`).
- **`src/wasm/__tests__/wasmAbiLock.test.ts`** — export-name drift across the
  WAT, `bindings.cpp`, `CMakeLists.txt`, the TS loader and the committed binary.
- **CI**: `wasm-cpp-host` (host builds + sanitizers + golden reproducibility)
  and `build-wasm-emscripten` (full C++ → wasm via emcc + ABI check). Both are
  required.

**Language rule**: hot numeric / batch CPU work goes in **C++ → WASM only**. Do
not hand-write new `.wat` algorithms and do not add new `src/**/*.js`
application code — the JS fallback is a degrade/test twin, not a third place to
invent behaviour. Full detail and the plan for retiring the hand-written WAT:
`docs/WASM_BRIDGE.md`.
- **Rule of thumb**: if a behavior can be expressed as pure functions or mocked-component state transitions, write a Vitest unit test. If it requires a real browser, Maps canvas, or visual crossfade timing, put it in `e2e/` (or the hold-pause probe) — don't try to fake a GPU in jsdom.

### Existing Tests
- `src/utils/navigation.test.ts` — Unit tests for `findBestLink`, angle math (`normalizeAngle`, `signedAngleDiff`, `absoluteAngleDiff`), and `haversineDistance`.
- `src/hooks/__tests__/mobile.test.tsx` — Mobile hook behavior tests (`useTouchControls` gesture state, `useDeviceDetection` quality settings, battery save mode).
- `src/App.test.tsx` — CRA-era smoke test, retained (renders without crashing, welcome modal visible).
- `src/utils/panoramaStability.test.ts` — Shared stability constants (tick/ms derivation) and `getCanvasFingerprint` (size floor, near-black rejection, dark-but-valid frames, change detection).
- `src/utils/scraperHealth.test.ts` — Pure scraper health reducer transitions (`locating`→`promoting`→`stable`→`lost`, auth-blocked, timeout) and `SCRAPER_CONTAINER_INVARIANTS` opacity contract.
- `src/utils/panoramaLookAround.test.ts` — Pure math for the hold-pause look-around UV shift (`wrapPanDelta`, `heldLookAroundUvDelta`, zoom scaling).
- `src/utils/streetViewProbe.test.ts` — Hold timeline recording (armed/first-stable/released), warning capping, opt-in intra-hold pixel-drift heuristic, and `getScraperHealth()` probe surface.
- `src/components/holdRenderLoop.test.ts` — Render-loop policy for when held frames must render regardless of adaptive frame skipping.
- `src/hooks/__tests__/useStreetView.holdLook.test.tsx` — `advance()`/`teleport()` hold-arming, `setPov` suppression during hold, and teleport's no-op-while-transitioning guard.
- `src/renderer/RendererBackend.test.ts`, `src/renderer/createStreetViewRenderer*.test.ts` — Backend preference/debug-flag parsing and the WebGPU→WebGL2→raw fallback chain.
- `src/app/sharedSessionSync.test.ts` — Pure host broadcast payload builder + guest teleport dedupe policy.
- `src/app/historicalExperience.test.ts` — Historical comparison after-label derivation.
- `src/car/__tests__/rearViewFeed.test.ts` — Static-API URL/cache-key builders and the cost-control policy: throttle, dedupe, blockers, session budget, failure circuit breaker, kill switch.
- `src/car/__tests__/RearviewMirror.test.ts` — Honest-unavailable fallback plus the true-rear path (bind/clear, UV pan registration, coverage fade, head-pitch independence).
- `e2e/*.spec.ts` — Playwright smoke + keyed critical paths (see above).

### Manual Testing Requirements
WebGPU rendering and canvas detection cannot be reliably tested in Vitest/jsdom. Prefer Playwright E2E / the hold-pause probe when automating; otherwise verify manually:
- `StreetView.tsx` canvas scraping
- `Renderer.ts` WebGPU pipeline
- `car/` Three.js scene (WebGPU-only asserts may skip in headless without GPU)
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
5. Automated: `npm run test:e2e:keyed` (with `REACT_APP_MAPS_API_KEY`) covers hold-pause probe warnings over N hops; `npm run probe:hold-pause -- --hops=10` adds intra-hold pixel consistency. Non-zero exit / `FAIL` means a probe warning or sudden brightness jump.

### Car Spatial Correctness Manual Checklist
Run this after touching `RearviewMirror.ts`, `rearViewFeed.ts`, `useRearViewFeed.ts`, `CarInputHandler.tsx`, `CarInteriorAnimator.ts`, `carSpatialModel.ts`, `weather-post.wgsl`, `weather-post-compute.wgsl`, or `WebGLFallbackRenderer.ts` (epic #171):

**World model** (`src/car/carSpatialModel.ts`): car body yaw = `carHeading`; head look = Street View `heading`/`pitch`. Free-look pans the head only. Chassis steers only in `carSteer`, temp-steer (steering-wheel grab), or explicit steer keys.

1. **Free-look vs chassis**
   - Enter car mode (default control mode is free-look). Left-drag to look around the cabin and out the side windows.
   - **Pass**: dashboard / A-pillars / steering wheel stay fixed; only the outside panorama and head camera move. `carHeading` must not change.
   - **Fail**: chassis yaws while looking around; feeling of "fighting" the car body.
   - Grab the steering wheel and drag — chassis may yaw (temp-steer). Release — back to head-only look.
   - Press `H` into `carSteer`, drag — chassis yaws with mouse X. RMB/Shift in free-look must **not** steer.

2. **Rearview mirror — feed OFF (default)**
   - Look up at the interior rearview glass with the dashboard **Rear** button unlit.
   - **Pass**: dark glass with a dim center band (unavailable state). It must **not** show a UV-shifted crop of the forward Street View canvas.
   - **Billing gate**: open DevTools → Network, filter `maps/api/streetview`, and drive/cruise 10+ hops. **Zero** requests must appear while the toggle is off. Any request here is a release blocker.

3. **Rearview mirror — feed ON** (`rearViewFeed.ts`, **billable** — read `BILLING_SAFETY_CHECKLIST.md` first)
   - Click **Rear** on the dashboard. The billing note under the light row should switch to `On — N requests this session`.
   - **Pass**: the glass shows real imagery of the road *behind* the car, left/right reversed like a real mirror. Driving forward should push scenery away from you in the glass, not toward you.
   - Steer left/right without hopping: the imagery should pan to stay world-locked, then fade back to the unavailable glass once you have turned roughly a full 90° FOV away — it must not smear clamped edge texels.
   - Free-look around the cabin: the mirror must **not** move with your head (car-body space).
   - **Throttle**: watch the Network panel while cruising. Requests must be spaced ≥3s apart and must stop entirely when parked.
   - **Dedupe**: hop forward a few panoramas then back. Returning to a visited pose must be served from memory with no new request.
   - **Blockers**: toggle DevTools offline → the note reads `Paused — offline` and requests stop. Restore the network and they resume. Reload with `?quality=low` → the note reads `Unavailable at Low quality` and the glass stays in the unavailable state.
   - **Kill switch**: run `window.__REARVIEW_FEED__.kill()` in the console. Requests must stop permanently; re-clicking **Rear** must not resurrect the feed until reload.
   - **No persistence**: Application → Cache Storage must contain no `maps.googleapis.com` entries (`swPolicy` forces `network-only` for Google hosts).

4. **Night exposure**
   - Apply the Night time-of-day preset (or max night slider). Toggle headlights and dome light.
   - **Pass**: scene reads as night but road + cabin UI remain readable; headlights clearly lift the forward road; not crushed near-black.
   - Repeat with `?renderer=webgl&effect=night` and (WebGPU) default + `?weather=compute` — all three backends should stay in the same ballpark.

5. **Snow / rain fall direction (`?effect=weather`)**
   - Set snow (and rain) above 0. WebGPU default: confirm flakes fall **downward**.
   - `?renderer=webgl&effect=weather`: same downward fall (top-origin UV; negative Y time term).
   - Optional: `?weather=compute` on WebGPU — same direction as fragment pass.

6. **Wipers / quality gate**
   - Medium or High quality: toggle wipers from the HUD (or stalk). Blades must sweep; HUD active state matches animator (`getWiperState().enabled`).
   - Low quality: toggle still flips HUD state and blades jump to a raised static "on" pose (no full sweep animation — documented tradeoff). Off returns to park.

### Local Testing with Headless Chrome (GPU)
When running in a headless GPU environment (e.g., Colab with NVIDIA T4):

1. **Serve the build**
   ```bash
   npm run build   # outputs to build/
   cd build && python3 -m http.server 80
   ```
   For Playwright against that server: `E2E_SKIP_WEBSERVER=1 E2E_BASE_URL=http://127.0.0.1:80 npx playwright test`.

2. **Cesium is CDN-loaded** for GlobeView — no post-build `import.meta` sed patch is required (Vite emits native ES modules). `loadCesiumSDK()` in `src/hooks/useGlobeMode.ts` injects the jsDelivr `cesium@1.140.0` build on first globe entry; imagery/terrain is resolved by `src/utils/cesiumImagery.ts` (Ion token → CartoCDN fallback). The no-static-`import 'cesium'` rule and bundle budgets are documented in `docs/DEVELOPER_CONTEXT.md` § "Chunk Strategy".
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
   Note: WebGPU adapter availability varies by headless Chrome version and OS. The app falls back to standard Street View rendering if WebGPU is unavailable. Playwright's `playwright.config.ts` enables a lighter SwiftShader-oriented flag set suitable for CI smoke; use the stronger GPU flags above (or the hold-pause probe) when verifying WebGPU dual-pass rendering on a real GPU host.

---

## Deployment

```bash
npm run build        # outputs to build/
export DEPLOY_TOKEN='...'
MAPS_API_KEY='...' python deploy.py
```

`deploy.py` POSTs a zip of `build/` to the Contabo storage manager API. **Never commit `DEPLOY_TOKEN` or SFTP passwords** — use environment variables or GitHub Actions secrets (see `.env.deploy.example` and `.github/workflows/deploy.yml`).

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

1. **API Key Exposure**: Maps API key resolution lives in `src/app/mapsKeyUtils.ts` and `src/app/useMapsBootstrap.ts`. The `.env` file supports `REACT_APP_MAPS_API_KEY` but production keys should be injected at deploy time. Never commit additional keys.
2. **Deployment Credentials**: `DEPLOY_TOKEN` must be supplied via environment variable or GitHub Actions secret. Legacy `deploy_old.py` (hardcoded SFTP password) has been removed.
3. **CORS Audio**: The radio stream uses `crossOrigin = "anonymous"` on the HTMLAudioElement.
4. **Local Storage**: Accessibility settings, bookmarks, and snapshots are stored in `localStorage`. No encryption is applied.
5. **Script Injection**: `StreetView.tsx` dynamically injects a `<script>` tag for the Google Maps API. The URL is constructed with a template literal containing the API key.

---

## Known Limitations

1. **WebGPU Support**: Requires modern Chrome/Edge. Falls back to hidden canvas view if unavailable.
2. **Canvas Scraping Fragility**: Any Google Maps DOM restructure will silently break the canvas feed.
3. **Mobile**: WebGPU on mobile is limited; a touch-friendly `MobileUI.tsx` fallback is active but car mode is desktop-focused.
4. **Accessibility**: Keyboard navigation works globally; screen-reader support is present via `useAnnouncer` and ARIA live regions but can be enhanced.
5. **Offline**: Limited offline mode — app shell + saved snapshots/metadata via service worker and IndexedDB. Google Street View tiles are **not** cached (Maps ToS). See README § Offline Mode.
6. **API Key Exposure**: Fallback key may be visible in build-time env; prefer runtime `config.js` for production.
7. **API Rate Limits**: Google Directions API quotas may throttle heavy route planning.
8. **Build tool**: Vite 5 (CRA removed). Relative `base: './'` preserves Contabo `/streetview` deploys; `build/static/js/main.[hash].js` layout keeps `deploy.py` key baking.
9. **Hidden Google Maps error UI flicker**: When the Maps key is invalid or referrer-blocked, Google injects `.gm-err-*` elements into the hidden Street View scraper div. Because the scraper must stay `opacity:1` for Google to keep rendering, those error elements can flash and produce visible flicker. The fix is to suppress them via CSS scoped to `.streetview-scraper` and/or remove them on `gm_authFailure`.

---

## Resources

- [Google Maps Platform Documentation](https://developers.google.com/maps/documentation)
- [WebGPU Specification](https://www.w3.org/TR/webgpu/)
- [Street View Static API](https://developers.google.com/maps/documentation/streetview)
- [WebGPU Samples](https://webgpu.github.io/webgpu-samples/)

---

## Cursor Cloud specific instructions

Single-product Vite + React project; `npm install` / `npm ci` is the only dependency step (runs automatically on VM startup). Standard commands live in **Build, Test, and Deploy Commands** above — reuse those rather than inventing new ones.

- **Run the app**: `npm start` (Vite on `http://localhost:3000`). Use `npm run lint` before pushing; CI runs lint then `npm run build`. Bundle gzip / Cesium-in-main budgets are enforced by `scripts/check-bundle-budget.sh` via `verify-build.sh`.
- **Type check**: `npm run typecheck` (`tsc --noEmit`).
- **Tests**: `npm test` (Vitest). `src/setupTests.ts` polyfills `TextDecoder`/`TextEncoder`, which jsdom does not implement (some transitive deps expect them at module-load time).
- **Google Maps API key is required for the CORE feature (Street View)**. With no key the app still boots and renders its full React UI, but the main canvas stays black and shows a "No Google Maps API key is configured" banner. For local dev, put a key (with `http://localhost:3000/*` in its HTTP-referrer allowlist) in `.env.local` as `REACT_APP_MAPS_API_KEY=...` or `VITE_MAPS_API_KEY=...` (gitignored) **or** set `window.MAPS_API_KEY` in `public/config.js`. The committed `.env` value is an intentional placeholder — never commit a real key. Vite loads env at server start, so **restart `npm start` after editing `.env.local`**.
- **Symptom → cause: stuck at "Connecting to Google Maps... 15%" with a black canvas and NO error banner.** This means the key string is valid enough to load the Maps JS library (`window.__mapsApiLoadState.status === 'ready'`) but Google fires `gm_authFailure` when the Street View panorama actually renders, so no `<canvas>` is ever produced and the loading gate never advances. The usual cause is the key's **HTTP-referrer restriction not allowing the current origin** (e.g. a key scoped to `test.1ink.us`/`go.1ink.us` will fail on `http://localhost:3000`), or disabled billing / Maps JavaScript API. Fix it in Google Cloud Console (add `http://localhost:3000/*` to the key's allowlist); it is not a code or VM bug. Note the dev server is plain **http**, so the allowlist entry must be `http://localhost:3000/*` — an `https://localhost:3000/*` entry will NOT match and still fails. To see the exact reason, capture full browser console output while loading a minimal panorama page: Google logs the precise error (`RefererNotAllowedMapError`, `ApiNotActivatedMapError`, `BillingNotEnabledMapError`, or `InvalidKeyMapError`) plus the exact "site URL to be authorized". Referrer changes can take several minutes to propagate.
- **Headless/cloud browser GPU limits** (not code bugs): the headless Chrome here reports WebGPU unavailable (`console.warn: WebGPU not supported`), so the renderer falls back to WebGL2 → raw. Cesium Globe mode is interactive (camera responds to drag/zoom) but Earth textures may not load, and Car mode's Three.js interior may fail to initialize due to WebGL context contention. Full GPU rendering (WebGPU dual-pass Street View, Cesium terrain, car interior) needs a real GPU browser — verify those visually on a WebGPU-capable Chrome/Edge, not in the headless VM.
- `package-lock.json` is tracked. Prefer `npm ci` in automation (CI already does); always commit lockfile updates with dependency changes.

---

*Last Updated: July 22, 2026*
