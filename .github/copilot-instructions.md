# Copilot Instructions — WebGPU StreetView

## Build, Test, Deploy

```bash
npm install                        # install dependencies
npm start                          # dev server → http://localhost:3000
CI=false npm run build             # production build → build/  (CI=true fails on pre-existing ESLint warnings)
npm test -- --watchAll=false       # run all tests once (CI mode)
npm test -- --testPathPattern=navigation   # run a single test file
python deploy.py                   # SFTP upload build/ to test.1ink.us/streetview
```

## Architecture

The app is a custom renderer wrapper around the Google Maps JS API. It captures the hidden Google Maps `<canvas>` via `MutationObserver` and re-renders it through a WebGPU dual-pass pipeline with HDR post-processing, with a Three.js car interior composited on top.

### Provider-Based State

Three React Context providers wrap the entire app. Components must be inside these providers to use the hooks:

| Provider (file) | Owns |
|---|---|
| `StreetViewProvider` (`hooks/useStreetView.tsx`) | panorama ref, canvas ref, heading/pitch/zoom, `advance()`, `teleport()`, `isTransitioning` |
| `ViewModeProvider` (`hooks/useViewMode.tsx`) | `viewMode` (`freelook`/`car`), `controlMode`, `carHeading`, Three.js car init |
| `EnvironmentSettingsProvider` (`hooks/useEnvironmentSettings.tsx`) | all weather + color-grading uniforms forwarded to the GPU every frame |

### Render Pipeline (Renderer.ts)

**Pass 1** — `public/shaders/streetview.wgsl`
- Input: Google Maps canvas → `copyExternalImageToTexture` → GPU texture
- Output: `rgba16float` intermediate HDR texture
- During panorama transitions, blends `prevTexture` (snapshot) with live feed using `transitionProgress` uniform

**Pass 2** — `public/shaders/weather-post.wgsl`
- Input: HDR intermediate texture
- Output: swap-chain surface (screen)
- Applies color grading chain + procedural rain/snow/fog/atmospheric effects

**WGSL shaders in `public/shaders/` are served as static files and loaded at runtime via `fetch()`. They are NOT bundled by webpack.**

### View Routing

```
App.tsx (providers + InnerApp)
└── MainView → FreeLookView (viewMode='freelook') | CarModeView (viewMode='car')
```

### Car Mode Stack (top to bottom on screen)

1. React `DashboardUI.tsx` (DOM)
2. Three.js `CarInterior.ts` (WebGL canvas)
3. WebGPU Pass 2 weather output
4. WebGPU Pass 1 panorama output
5. Hidden Google Maps canvas (DOM)

Car mode entry point is `src/car/index.ts`. Vehicle configs (`sedan | convertible | science-lab | limousine`) live in `VehicleManager.ts`. All geometry is procedural — no GLTF/OBJ files.

## Critical Conventions

### Input Event Propagation
All UI overlays (panels, modals, dashboard buttons, text inputs) **must** call `e.stopPropagation()` on every mouse and keyboard event. Input handlers are attached to `window`, so missing `stopPropagation` causes the panorama to spin when the user types or clicks.

### Shader Uniform Buffer Layout
`weather-post.wgsl` expects exactly **40 floats (160 bytes)**. If you change the layout, update both `Renderer.ts` (the `weatherParams` Float32Array comment block at lines ~37-49) and the WGSL struct. The current layout:
```
[0-5]   vibrance, saturation, contrast, exposure, temperature, tint
[6-10]  time, rainIntensity, snowIntensity, wind, speed
[11-15] nightIntensity, headlightsOn, highBeam, headlightHeading, headlightPitch
[16-17] domeLightOn, domeLightIntensity
[18-21] sunAzimuth, sunAltitude, moonAzimuth, moonAltitude
[22-31] fogIntensity, fogDensity, fogHeight, fogColorIndex, lightShaftsIntensity,
        heatShimmerIntensity, lensFlareIntensity, chromaticAberration, dustIntensity, humidityHaze
[32]    shaderEffectsEnabled
[33-34] cameraHeading, cameraPitch
[35]    padding
[36]    sunrise
[37-39] padding
```

`streetview.wgsl` Pass 1 uniform buffer is **8 floats (32 bytes)**:
```
[0] time  [1] zoom  [2] panX  [3] panY
[4] transitionProgress  [5] movementHeading  [6] capturePanX  [7] capturePanY
```
`panX = heading/360`, `panY = (pitch+90)/180`. `movementHeading` and `capturePanX/Y` are set by `Renderer.capturePanorama()` and drive the world-space look-around in the transition shader.

### WebGPU Texture Rules
- Do **not** cache `GPUTextureView` across frames — the underlying texture may be recreated when canvas dimensions change.
- `ensureIntermediateTexture()` in `Renderer.ts` lazily creates/resizes the HDR texture; always go through this method.

### Canvas Scraping (`StreetView.tsx`)
Canvas detection uses `MutationObserver` to find the largest `<canvas>` ≥ 256×256px. Do not add assumptions about canvas IDs, class names, or DOM tree depth. If detection breaks, `onCanvasReady` silently never fires and the WebGPU output stays black.

### Adding New UI Panels
1. Create component in `src/components/`
2. Add open/close state in `App.tsx`
3. Register keyboard shortcut in `useKeyboardShortcuts.tsx`
4. Add `e.stopPropagation()` on **all** mouse and keyboard events inside the panel

### Adding New Shaders
1. Put `.wgsl` in `public/shaders/`
2. Add pipeline creation in `Renderer.ts`
3. Insert pass into `renderStreetView()` in correct order
4. Add quality gate in `config/visualPresets.ts` for expensive effects

### Known Pre-existing Test Failures
The 5 tests in `src/hooks/__tests__/mobile.test.tsx` always fail — jsdom does not support WebGL/WebGPU. These are environment limitations, not bugs.

## Ghost Code Warning
`RenderMode` only supports `'streetview'`. Older docs reference a "Fluid Simulation" with velocity/advection shaders — this code does not exist and was never implemented.
