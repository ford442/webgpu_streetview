# DEVELOPER_CONTEXT.md

## 1. High-Level Architecture & Intent

### Core Purpose
This application is a WebGPU-accelerated Street View viewer. It acts as a wrapper around the Google Maps JavaScript API, scraping the panoramic view from a hidden Google Maps canvas and rendering it onto a WebGPU canvas. This architecture allows for potential post-processing effects (shaders), though currently, it primarily acts as a custom renderer for Street View imagery. It also provides an "auto-cruise" mode for automated navigation along routes or in a straight line.

### Tech Stack
*   **Frontend Framework:** React 19 (TypeScript)
*   **Rendering:** WebGPU (via `navigator.gpu`) with WGSL shaders.
*   **Maps Integration:** Google Maps JavaScript API (Street View Service, Directions Service).
*   **Build Tooling:** Create React App (`react-scripts`).
*   **State Management:** React `useState`/`useEffect` (Local component state).

### Design Patterns
*   **Canvas Scraping Proxy:** The `StreetView` component renders a hidden Google Maps panorama, detects the active canvas, and passes it to the `Renderer`.
*   **Render Loop:** The `Renderer` class maintains a `renderStreetView` method called via `requestAnimationFrame` (implicitly, driven by React updates or specific triggers) to upload the hidden canvas as a texture.
*   **Composition:** `App.tsx` acts as the central controller (Mediator), coordinating input, the map service, and the renderer.
*   **Singleton-ish Services:** `DirectionsService` and `Renderer` are instantiated once and persisted via `useRef`.

## 2. Feature Map (The "General Points")

*   **Street View Rendering:**
    *   **Entry Point:** `src/components/WebGPUCanvas.tsx` -> `src/renderer/Renderer.ts`.
    *   **Description:** Captures the hidden DOM canvas from Google Maps and renders it using `streetview.wgsl`.
*   **Navigation & Input:**
    *   **Entry Point:** `src/components/InputHandler.tsx`.
    *   **Description:** Global event listeners (Window-level) capture mouse drag/scroll and keyboard (WASD) to drive `App.tsx` state (`heading`, `pitch`, `zoom`).
*   **Cruise Mode:**
    *   **Entry Point:** `src/App.tsx` (`useEffect` on `isCruiseMode`).
    *   **Description:** An interval-based system that automatically advances to the next best Panorama link every few seconds.
*   **Route Planning:**
    *   **Entry Point:** `src/App.tsx` (`plotRoute` function).
    *   **Description:** Uses Google Directions API to calculate a walking path, which "Cruise Mode" then follows waypoint-by-waypoint.
*   **Mini Map:**
    *   **Entry Point:** `src/components/MiniMap.tsx`.
    *   **Description:** A secondary Google Map showing the current location and heading.
*   **Snapshot:**
    *   **Entry Point:** `src/App.tsx` (`takeSnapshot`).
    *   **Description:** Downloads the current WebGPU canvas context as a PNG and generates a metadata text file.

## 3. Complexity Hotspots (The "Complex Parts")

### The Canvas Scraper (`StreetView.tsx`)
*   **Why it's complex:** Google Maps API does not officially support extracting its canvas. The code uses a `MutationObserver` to watch the DOM, sorts found `<canvas>` elements by size (area), and heuristically determines which one is the "active" Street View panorama.
*   **Agent Note:** This is **extremely fragile**. If Google changes their DOM structure or how they render canvases, this will break. Do not assume the canvas is always present or static.

### Coordinate Systems & Navigation Logic (`App.tsx` & `navigation.ts`)
*   **Why it's complex:**
    *   **Heading/Pitch:** Custom input handling modifies `heading` and `pitch` state, which is then synchronized *back* to the Google Maps Panorama instance.
    *   **Link Finding:** The `findBestLink` algorithm attempts to map a desired cardinal direction ('forward', 'left', etc.) to the available links provided by the Street View Panorama data, calculating angles to find the "best" match.
    *   **Zoom:** The zoom logic is inverted in the handler to match scroll direction expectations, then re-mapped to Google Maps zoom levels.
*   **Agent Note:** Be careful when modifying `findBestLink`. Small math errors here result in the user walking backwards or getting stuck in loops.

### WebGPU Texture Management (`Renderer.ts`)
*   **Why it's complex:** The renderer handles dynamic inputs. It must handle `HTMLCanvasElement`, `HTMLVideoElement`, or `ImageBitmap`. It conditionally resizes the GPU texture on the fly if the source dimension changes (which happens when the hidden Street View canvas loads a higher-res tile).
*   **Agent Note:** Ensure `device.queue.copyExternalImageToTexture` calls are wrapped in try-catch blocks to handle transient resize errors or invalid source states.

## 4. Inherent Limitations & "Here be Dragons"

### Ghost Code / Documentation Mismatch
*   **Known Issue:** `AGENTS.md` describes a "Fluid Simulation" system with "Velocity" and "Advection" shaders. **This code does not exist in the active codebase.** The `RenderMode` type only supports `'streetview'`, and `Renderer.ts` only loads `streetview.wgsl`.
*   **Dragon:** Do not attempt to fix or interface with the "Fluid Simulation" unless you are explicitly tasked to re-implement it from scratch. The documentation is ahead of (or divergent from) the implementation.

### Input Event Hijacking
*   **Technical Debt:** `InputHandler` attaches listeners to `window`. This means UI elements overlaying the canvas (like the "Map" sidebar) often need `e.stopPropagation()` on every event to prevent the camera from spinning while typing or clicking buttons.
*   **Constraint:** If adding new UI overlays, you *must* block propagation of mouse and keyboard events, or the 3D view will react to them.

### Google Maps API Key
*   **Constraint:** The API key is hardcoded in `App.tsx`. In a production environment, this should be an environment variable. Do not commit new keys to the repo.

## 5. Dependency Graph & Key Flows

### Critical Flow: Render Cycle
1.  **Google Maps API** loads in `StreetView.tsx`.
2.  `MutationObserver` detects a `<canvas>` in the DOM.
3.  `StreetView` passes this canvas reference to `App` -> `WebGPUCanvas`.
4.  `WebGPUCanvas` passes it to `Renderer.ts`.
5.  `Renderer.ts` creates a `GPUTexture` from the canvas.
6.  `Renderer.ts` runs the pipeline using `streetview.wgsl` to draw the texture to the screen.

### Critical Flow: Navigation
1.  User drags mouse -> `InputHandler` fires `onPan`.
2.  `App` updates `heading` state.
3.  `useEffect` in `App` calls `panorama.setPov({ heading })`.
4.  Google Maps rotates the hidden view.
5.  The hidden canvas updates its pixels.

## 6. Chunk Strategy (Bundle Size)

The FreeLook route (the app's default first paint) must never download the CesiumJS
globe stack. Two rules keep it that way:

*   **Never statically `import` the `cesium` npm package.** `GlobeView.tsx` and
    `MiniMap.tsx`'s globe view both talk to a global `Cesium` object
    (`declare const Cesium: any;`) that's injected at runtime by
    `loadCesiumSDK()` in `src/hooks/useGlobeMode.ts` — a `<script>`/`<link>` tag
    pointed at the jsDelivr CDN build of Cesium, loaded on first entry into
    Globe View (or the mini-map's globe toggle), never before. Re-introducing
    `import * as Cesium from 'cesium'` anywhere puts the whole globe stack back
    into `main.js` for every user, because webpack has no `"sideEffects": false`
    hint to safely tree-shake an unused-but-imported module.
*   **`GlobeView` is deliberately not re-exported from `src/components/index.ts`.**
    `App.tsx` imports it as `const GlobeView = lazy(() => import('./components/GlobeView'));`
    and renders it inside `<Suspense fallback={null}>`, so it ships as its own
    chunk (`729.*.chunk.js` at last measurement, a few KB gzipped since it has
    no bundled Cesium code) instead of inline in `main.js`. Re-exporting it from
    the barrel would defeat the code-split — anything importing the barrel
    would pull `GlobeView` back into its own chunk eagerly.
*   **`@xenova/transformers` was removed** (was listed in `package.json` with
    zero imports anywhere in `src/` — pure dead weight on every `npm install`).
    Re-add it only alongside the feature that actually uses it, pinned to a
    real version (never `"latest"`).
*   **Checking for regressions:** run `npm run build`, then either grep the
    output for stack-specific tokens (`grep -c Cesium build/static/js/main.*.js`
    should be ~0-1, just the CDN URL string) or run
    `npx source-map-explorer 'build/static/js/*.js'` for a visual breakdown.
    `npm run analyze` wraps the latter.
6.  `Renderer.ts` uploads the new pixels in the next render pass.
