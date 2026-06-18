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
   - `teleport(lat, lng, targetHeading?, targetPitch?)` moves the panorama.
   - `isTransitioning` is set to `true` on advance and cleared ~700ms after the `pano_changed` event fires.
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

When the panorama changes (e.g., cruise mode advancing), `Renderer.beginTransition(mode)` snapshots the current `videoTexture` into `prevTexture` via a GPU→GPU `copyTextureToTexture`. Over the next ~350–500ms, `updateTransitionProgress(progress)` drives the transition shader to crossfade between the old and new panoramas. This masks Google Maps tile-tearing during loads.

Supported modes: `fade`, `zoom`, `zoom-blur`, `zoom-chromatic`.

Additionally, an **inline transition** system is used by `useStreetView.tsx`:
- `captureCurrentFrame()` snapshots `videoTexture` into `previousFrameTexture`.
- `setTransitionProgress(0→1)` is animated via `requestAnimationFrame` over 500ms.
- The main `streetview.wgsl` uses `inlineTransitionProgress` to crossfade.

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

### 4. Transition / `isTransitioning` Coordination
`StreetViewProvider` sets `isTransitioning = true` when `advance()` is called and clears it after `pano_changed` + 700ms. `WebGPUCanvas.tsx` reads this flag and forces full fps during transitions. If `isTransitioning` is not properly wired, cruise mode will show torn/stuttering frames on every hop.

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

### Manual Testing Requirements
WebGPU rendering and canvas detection cannot be reliably tested in Jest. Any changes to the following require manual browser verification:
- `StreetView.tsx` canvas scraping
- `Renderer.ts` WebGPU pipeline
- `car/` Three.js scene
- Input handlers and UI overlay interactions
- Cruise mode navigation loops
- GPU panorama transitions

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

*Last Updated: May 27, 2026*
