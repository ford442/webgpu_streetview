<!-- From: /root/webgpu_streetview/AGENTS.md -->
# WebGPU StreetView — AI Agent Documentation

## Project Overview

**1ink.us Streetview** is a WebGPU-accelerated Google Maps Street View viewer that creates an immersive, interactive navigation experience. The application scrapes the Street View panorama from a hidden Google Maps canvas and renders it using a custom WebGPU shader pipeline, enabling HDR post-processing effects (color grading, rain, snow, transitions) that are impossible through the native Maps API alone. It also layers a fully procedural Three.js car interior on top for a virtual road-trip cockpit.

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
│   └── shaders/                     # WGSL shader files loaded at runtime via fetch()
│       ├── streetview.wgsl          # Pass 1: panorama → HDR intermediate
│       ├── weather-post.wgsl        # Pass 2: HDR + weather/color grading → screen
│       ├── carview.wgsl             # Car windshield post-process
│       ├── texture.wgsl             # Debug passthrough
│       └── transition-*.wgsl        # (deprecated) kept for reference; transitions now inline in streetview.wgsl
├── src/
│   ├── App.tsx                      # Central controller. Renders providers + InnerApp.
│   ├── index.tsx                    # React entry point
│   ├── style.css                    # Global styles
│   ├── views/                       # Top-level view routing
│   │   ├── MainView.tsx             # Switches FreeLookView ↔ CarModeView
│   │   ├── FreeLookView.tsx         # Free-look street view mode
│   │   └── CarModeView.tsx          # Car interior mode
│   ├── components/                  # React components
│   │   ├── StreetView.tsx           # Google Maps loader + MutationObserver canvas scraper
│   │   ├── WebGPUCanvas.tsx         # Mounts renderer, drives render loop
│   │   ├── FreeLookInputHandler.tsx # Window-level mouse/keyboard for free look
│   │   ├── CarInputHandler.tsx      # Window-level input for car mode
│   │   ├── MiniMap.tsx              # Secondary map with heading, route, teleport
│   │   ├── Compass.tsx              # Cardinal direction overlay
│   │   ├── Controls.tsx             # Legacy overlay controls
│   │   ├── WelcomeModal.tsx         # Startup welcome modal
│   │   ├── LoadingOverlay.tsx       # Granular loading states UI
│   │   ├── BookmarkPanel.tsx        # Saved locations panel
│   │   ├── HistoryPanel.tsx         # Breadcrumb location history
│   │   ├── SnapshotGallery.tsx      # Canvas capture gallery
│   │   ├── ColorGradingPanel.tsx    # HDR uniform sliders
│   │   ├── WeatherPanel.tsx         # Rain/snow/wind controls
│   │   ├── VehicleSelector.tsx      # Car type chooser
│   │   ├── AccessibilityPanel.tsx   # A11y settings panel
│   │   ├── PerformanceStatsOverlay.tsx # Live FPS / GPU stats
│   │   ├── GlobeView.tsx            # Cesium globe integration
│   │   ├── ScoutCard.tsx            # Location scout UI
│   │   └── MobileUI.tsx             # Touch-friendly fallback
│   ├── renderer/
│   │   ├── Renderer.ts              # WebGPU orchestrator: device, dual-pass pipeline, inline transitions
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
│   │   └── variants/                # Vehicle-specific implementations
│   │       ├── ConvertibleMode.ts
│   │       ├── LimousineMode.ts
│   │       └── ScienceLabMode.ts
│   ├── hooks/                       # Custom React hooks + providers
│   │   ├── index.ts                 # Barrel export
│   │   ├── useStreetView.tsx        # StreetViewProvider: panorama, heading, pitch, zoom, advance, isTransitioning
│   │   ├── useViewMode.tsx          # ViewModeProvider: viewMode (freelook/car), carHeading, controlMode
│   │   ├── useEnvironmentSettings.tsx # EnvironmentSettingsProvider: weather, color grading, time of day
│   │   ├── useKeyboardShortcuts.tsx # Global shortcuts + accessibility helpers
│   │   ├── useBookmarks.ts          # localStorage + cloud bookmark sync
│   │   ├── useLocationHistory.ts    # Visited panorama trail
│   │   ├── useSnapshots.ts          # Canvas snapshot management
│   │   ├── useVehicleSettings.ts    # Vehicle preference persistence
│   │   ├── usePerformanceMonitor.ts # FPS / frame time tracking
│   │   ├── useLoadingState.ts       # Granular loading state machine
│   │   ├── useLoadingIntegrations.ts # Loading orchestration helpers
│   │   ├── useTransition.ts         # Animation / easing utilities
│   │   ├── useTouchControls.ts      # Touch gesture handling
│   │   ├── useDeviceDetection.ts    # Mobile / capability detection
│   │   ├── useGlobeMode.ts          # Cesium globe state
│   │   ├── useAutoNight.ts          # Automatic night mode
│   │   └── __tests__/               # Hook tests
│   ├── effects/
│   │   ├── PostProcessing.ts
│   │   ├── LightingEffects.ts
│   │   └── WindAudio.ts             # Procedural wind audio
│   ├── animation/
│   │   └── PhysicsAnimations.ts     # Spring physics for UI / camera
│   ├── audio/
│   │   └── AudioAnalyzer.ts         # Radio stream Web Audio analysis
│   ├── materials/
│   │   └── PBRMaterials.ts          # Three.js PBR presets
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
│   │   └── loadingState.ts          # Loading state store
│   ├── services/
│   │   ├── radioBrowserService.ts   # Radio station lookup
│   │   └── storageApi.ts            # Cloud storage API client
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
   - `advance(direction)` calls `findBestLink` and triggers `pano.setPano()`.
   - `teleport(lat, lng)` moves the panorama.
   - `isTransitioning` is set to `true` on advance and cleared ~700ms after the `pano_changed` event fires.

2. **`ViewModeProvider`** (`src/hooks/useViewMode.tsx`)
   - Owns `viewMode: 'freelook' | 'car'`.
   - Manages car body `carHeading` (independent of head-look heading).
   - Tracks `controlMode`: `freeLook` | `uiMouse` | `carSteer`.
   - Initializes / toggles the Three.js car mode via `initCarMode()` from `src/car/index.ts`.

3. **`EnvironmentSettingsProvider`** (`src/hooks/useEnvironmentSettings.tsx`)
   - Owns all weather and color-grading uniforms: `rainIntensity`, `snowIntensity`, `wind`, `vibrance`, `saturation`, `contrast`, `exposure`, `temperature`, `tint`, `timeOfDay`, `fogDensity`, etc.
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

1. **Google Maps API** loads in `StreetView.tsx`.
2. `MutationObserver` watches the panorama container, collects all `<canvas>` elements, sorts by pixel area, and selects the largest one ≥256×256 pixels.
3. The canvas ref flows: `StreetView.tsx` → `StreetViewProvider` (via `setCanvas`) → `App.tsx` → `WebGPUCanvas.tsx` → `Renderer.ts`.
4. `Renderer.ts` uploads the canvas every frame with `device.queue.copyExternalImageToTexture`.
5. The dual-pass pipeline renders to screen.

### WebGPU Dual-Pass Pipeline (`src/renderer/Renderer.ts`)

**Pass 1** — `streetview.wgsl`
- Source: Google Maps canvas → `copyExternalImageToTexture` → `rgba8unorm-srgb` GPU texture (stored in `videoTexture`).
- Vertex shader: fullscreen triangle-strip (no geometry buffer).
- Fragment shader: samples texture with zoom + pan uniforms `[time, zoom, panX, panY]`.
- Output target: `rgba16float` intermediate HDR texture (`intermediateTexture`).
- During panorama transitions, `streetview.wgsl` blends `prevTexture` (snapshot of the departing panorama) with `videoTexture` (live incoming panorama) inline using a `transitionProgress` uniform. No separate transition pipeline is swapped.

**Pass 2** — `weather-post.wgsl`
- Source: HDR intermediate texture.
- Fragment shader: color grading chain (vibrance → saturation → contrast → temperature/tint → exposure), then procedural rain + snow composited additively.
- Output target: swap-chain surface (screen).

The intermediate HDR texture is lazily created and resized in `ensureIntermediateTexture()` when canvas dimensions change. Do not cache `GPUTextureView` across frames.

### GPU Transition System

When the panorama changes (e.g., cruise mode advancing), `useStreetView.tsx` calls `renderer.captureCurrentFrame()` to snapshot the current `videoTexture` into `prevTexture` via a GPU→GPU `copyTextureToTexture`. It then runs a 500ms `requestAnimationFrame` loop that calls `renderer.setTransitionProgress(progress)` (0.0 → 1.0). The main `streetview.wgsl` shader reads `transitionProgress` and mixes the zoomed/blurred previous frame with the live incoming frame. This masks Google Maps tile-tearing during loads.

Supported modes: `fade`, `zoom`, `zoom-blur`, `zoom-chromatic`.

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
- **Vehicles**: `sedan` | `convertible` | `science-lab` | `limousine`. Configs live in `VehicleManager.ts`.

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
`StreetViewProvider` sets `isTransitioning = true` when `advance()` is called and clears it after `pano_changed` + 700ms. The provider itself now owns the GPU transition RAF loop (calling `captureCurrentFrame()` and `setTransitionProgress()`). `WebGPUCanvas.tsx` renders every frame normally; the shader handles the visual blend. If `isTransitioning` is not properly wired, cruise mode will show torn/stuttering frames on every hop.

### 5. API Key Management
The Google Maps API key has a fallback hardcoded in `src/App.tsx` (`GOOGLE_MAPS_KEY`), but the preferred source is `.env` (`REACT_APP_MAPS_API_KEY`). Cesium also uses `REACT_APP_CESIUM_ION_TOKEN` from `.env`. Do not commit new keys.

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
[37-39] padding
```
Changing this layout without updating both `Renderer.ts` and the WGSL file will break rendering.

---

## Testing Strategy

The project uses Create React App's default testing setup:
- **Framework**: Jest
- **Utilities**: React Testing Library, jest-dom
- **Run**: `npm test` (watch mode) or `npm test -- --watchAll=false` (CI)

### Existing Tests
- `src/utils/navigation.test.ts` — Unit tests for `findBestLink`, angle math, and `haversineDistance`.
- `src/hooks/__tests__/mobile.test.tsx` — Mobile hook behavior tests.
- `src/App.test.tsx` — Default CRA smoke test.

### Manual Testing Requirements
WebGPU rendering and canvas detection cannot be reliably tested in Jest. Any changes to the following require manual browser verification:
- `StreetView.tsx` canvas scraping
- `Renderer.ts` WebGPU pipeline
- `car/` Three.js scene
- Input handlers and UI overlay interactions
- Cruise mode navigation loops

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

---

## Known Limitations

1. **WebGPU Support**: Requires modern Chrome/Edge. Falls back to hidden canvas view if unavailable.
2. **Canvas Scraping Fragility**: Any Google Maps DOM restructure will silently break the canvas feed.
3. **Mobile**: WebGPU on mobile is limited; a touch-friendly `MobileUI.tsx` fallback is active but car mode is desktop-focused.
4. **Accessibility**: Keyboard navigation works globally; screen-reader support is present via `useAnnouncer` and ARIA live regions but can be enhanced.
5. **Offline**: No offline mode. Requires continuous internet for Map tiles and Street View imagery.
6. **API Key Exposure**: Fallback key is visible in `App.tsx` source.
7. **API Rate Limits**: Google Directions API quotas may throttle heavy route planning.

---

## Resources

- [Google Maps Platform Documentation](https://developers.google.com/maps/documentation)
- [WebGPU Specification](https://www.w3.org/TR/webgpu/)
- [Street View Static API](https://developers.google.com/maps/documentation/streetview)
- [WebGPU Samples](https://webgpu.github.io/webgpu-samples/)

---

*Last Updated: April 16, 2026*
