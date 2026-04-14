# WebGPU StreetView - AI Agent Documentation

## Project Overview

**1ink.us Streetview** is a WebGPU-accelerated Google Maps Street View viewer that creates an immersive, interactive navigation experience. The application scrapes the Street View panorama from a hidden Google Maps canvas and renders it using custom WebGPU shaders, enabling potential post-processing effects and custom visual enhancements.

### Core Purpose
The application acts as a custom renderer wrapper around the Google Maps JavaScript API. By capturing the panoramic view from a hidden Google Maps canvas and rendering it onto a WebGPU canvas, the architecture allows for GPU-accelerated rendering and future visual effect pipelines.

### Live Deployment
- **URL**: https://test.1ink.us/streetview
- **Deployment Target**: 1ink.us server via SFTP

---

## Technology Stack

| Layer | Technology | Version |
|-------|------------|---------|
| Frontend Framework | React | 19.1.1 |
| Language | TypeScript | 4.9.5 |
| Build Tool | Create React App (react-scripts) | 5.0.1 |
| Rendering API | WebGPU | Native browser API |
| Shader Language | WGSL | WebGPU Shading Language |
| Maps Integration | Google Maps JavaScript API | Weekly |
| State Management | React Hooks | useState/useEffect |
| Testing | Jest + React Testing Library | - |

### Browser Support
- **Production**: >0.2%, not dead, not op_mini all
- **Development**: Last 1 Chrome, Firefox, Safari versions
- **WebGPU Required**: Chrome/Edge 113+, Firefox Nightly (with flag)

---

## Project Structure

```
webgpu_streetview/
├── public/                     # Static assets
│   ├── index.html             # HTML entry point
│   ├── images/                # Static images (music-gui.webp)
│   └── shaders/               # WGSL shader files
│       ├── streetview.wgsl    # Main panoramic viewer shader
│       └── texture.wgsl       # Simple texture sampler shader
├── src/                        # Source code
│   ├── components/            # React components
│   │   ├── App.tsx           # Main application controller
│   │   ├── WebGPUCanvas.tsx  # WebGPU canvas wrapper
│   │   ├── StreetView.tsx    # Google Maps integration (canvas scraper)
│   │   ├── InputHandler.tsx  # Global input event handling
│   │   ├── MiniMap.tsx       # Secondary location map
│   │   ├── Controls.tsx      # Legacy UI controls
│   │   └── WelcomeModal.tsx  # Startup welcome modal
│   ├── renderer/              # WebGPU rendering logic
│   │   ├── Renderer.ts       # Main WebGPU orchestrator
│   │   └── types.ts          # Render type definitions
│   ├── utils/                 # Utility functions
│   │   └── navigation.ts     # Link finding algorithms
│   ├── audio/                 # Audio processing
│   │   └── AudioAnalyzer.ts  # Radio stream analyzer
│   ├── index.tsx             # React entry point
│   └── style.css             # Global styles
├── build/                     # Production build output
├── deploy.py                  # SFTP deployment script
├── package.json              # Dependencies and scripts
├── tsconfig.json             # TypeScript configuration
├── webpack.config.js         # Alternative webpack config (unused)
├── plan.md                   # Development roadmap
├── DEVELOPER_CONTEXT.md      # Detailed technical notes
└── feature_expansion_plan.md # Feature roadmap
```

---

## Build and Development Commands

```bash
# Install dependencies
npm install

# Start development server (port 3000)
npm start

# Create production build (outputs to build/)
npm run build

# Run tests
npm test

# Eject from react-scripts (irreversible)
npm run eject
```

### Deployment
```bash
# 1. Build production bundle
npm run build

# 2. Deploy to server (requires Python + paramiko)
python deploy.py
# - Prompts for server password
# - Uploads build/ to test.1ink.us/streetview
```

---

## Code Organization and Architecture

### Design Patterns

1. **Canvas Scraping Proxy**: The `StreetView` component renders a hidden Google Maps panorama, uses `MutationObserver` to detect the active canvas, and passes it to the `Renderer`.

2. **Render Loop**: The `Renderer` class maintains a continuous render cycle via `requestAnimationFrame` to upload the hidden canvas as a texture each frame.

3. **Central Controller**: `App.tsx` acts as the mediator, coordinating input, map services, and the renderer via React state and refs.

4. **Singleton Services**: `DirectionsService`, `Renderer`, and `Geocoder` are instantiated once and persisted via `useRef`.

### Component Hierarchy

```
App (Main Controller)
├── WelcomeModal (Initial overlay)
├── InputHandler (Global event capture)
├── StreetView (Hidden Google Maps container)
│   └── Google Maps Panorama (DOM canvas)
├── WebGPUCanvas (Visible output)
│   └── Renderer (WebGPU orchestration)
└── UI Overlay
    ├── MiniMap (Location map with route)
    ├── Controls (Navigation buttons)
    └── Route Planning Panel
```

### Data Flow

1. **Render Cycle**:
   - Google Maps API loads in `StreetView.tsx`
   - `MutationObserver` detects `<canvas>` in DOM
   - Canvas reference flows: `StreetView` → `App` → `WebGPUCanvas` → `Renderer`
   - `Renderer` creates `GPUTexture` from canvas
   - `streetview.wgsl` renders texture to screen

2. **Navigation Flow**:
   - User drags mouse → `InputHandler` fires `onPan`
   - `App` updates `heading` state
   - `useEffect` calls `panorama.setPov({ heading })`
   - Google Maps rotates hidden view
   - Hidden canvas updates pixels
   - `Renderer` uploads new pixels in next frame

---

## Key Modules

### Renderer (`src/renderer/Renderer.ts`)
The main WebGPU orchestrator that manages:
- GPU device initialization and feature detection
- Texture management (static and video/canvas textures)
- Pipeline creation and shader loading
- Uniform buffer updates (time, zoom, panX, panY)
- Frame rendering with `copyExternalImageToTexture`

### StreetView (`src/components/StreetView.tsx`)
Handles Google Maps integration:
- Dynamically loads Google Maps API script
- Creates hidden `StreetViewPanorama` instance
- Uses `MutationObserver` to detect canvas elements
- Sorts canvases by area to find the main view
- Notifies parent when canvas is ready

### InputHandlers (FreeLookInputHandler & CarInputHandler)
Captures global input events:
- **Mouse**: Drag to pan, scroll to zoom, click to move forward
- **Keyboard**: WASD and Arrow keys for directional movement
- **Right-click**: Move forward
- Attaches listeners to `window` (requires event blocking for UI overlays)

### MiniMap (`src/components/MiniMap.tsx`)
Secondary map showing:
- Current position with heading indicator (rotating triangle marker)
- Breadcrumb trail of visited locations
- Route path visualization (red polyline)
- Click/drag to teleport functionality
- Dark theme styling matching the main UI

### Navigation Utils (`src/utils/navigation.ts`)
`findBestLink()` algorithm:
- Maps desired direction (forward/backward/left/right) to target heading
- Calculates angle differences to available panorama links
- Returns best matching link within 45-degree threshold
- Prevents moving in completely wrong directions

---

## Shader System

### Current Shaders

**streetview.wgsl** - Main panoramic viewer:
- Vertex shader generates fullscreen triangle strip
- Fragment shader samples texture with zoom and pan transformations
- Uniforms: `[time, zoom, panX, panY]`
- UV wrapping for horizontal panning, clamping for vertical

**texture.wgsl** - Simple texture sampler:
- Basic vertex/fragment shader pair
- Direct texture sampling without transformations
- Available for future use cases

### Shader Loading
Shaders are loaded at runtime via `fetch()` from `/shaders/*.wgsl`. The build process copies files from `public/shaders/` to `build/shaders/`.

---

## Critical Implementation Details

### Canvas Scraping (Fragile)
Google Maps does not officially support canvas extraction. The implementation:
- Uses `MutationObserver` to watch for DOM changes
- Sorts found `<canvas>` elements by area (largest = main view)
- Filters out canvases smaller than 100x100 pixels
- Only notifies when canvas element reference changes

**⚠️ Warning**: This is extremely fragile. If Google changes DOM structure or rendering, this will break.

### Input Event Hijacking
`InputHandler` attaches listeners to `window`. This means:
- UI overlays must call `e.stopPropagation()` on mouse/keyboard events
- Without propagation blocking, the 3D view reacts to button clicks and text input
- All interactive elements in the slide-out map need event handlers

### WebGPU Feature Detection
The renderer requests optional WebGPU features:
- `float32-filterable`
- `float32-blendable`
- `clip-distances`
- `depth32float-stencil8`
- `dual-source-blending`
- `subgroups`
- `texture-component-swizzle`
- `shader-f16`

Features are enabled if available but not required for basic rendering.

### API Key Management
The Google Maps API key is hardcoded in `App.tsx`. In production, this should be:
- Moved to environment variables
- Restricted by HTTP referrer
- Rotated regularly

### Context-to-Renderer Integration (DO NOT BREAK)
Two architectural splits are especially fragile and have broken before:

1. **Weather / Shader Effects Panel → WebGPU Renderer**
   - `App.tsx` renders `<WeatherPanel />` globally for free-look mode.
   - The panel's `onRainIntensity`, `onSnowIntensity`, and `onWind` handlers **must** be wired to the actual setters from `useEnvironmentSettings()` (not no-ops).
   - `WebGPUCanvas.tsx` reads `useEnvironmentSettings()` and forwards the full param array to `Renderer.updateWeatherParams()` via a dedicated `useEffect`.
   - If either side of this chain is disconnected, the UI sliders will animate but the shaders will not react.

2. **Cruise Mode / Node Advance → Rendering Pause**
   - `useStreetView.tsx` maintains an `isTransitioning` flag that is set to `true` when `advance()` is called and cleared after the panorama loads.
   - `WebGPUCanvas.tsx` consumes `useStreetView().isTransitioning` and applies an `opacity: 0` CSS transition on the `<canvas>` during transitions.
   - This brief fade hides Google Maps tile-tearing while the new panorama loads.
   - If `WebGPUCanvas.tsx` stops reading this flag, cruise mode will show torn/stuttering frames on every hop.

---

## Current Features (Implemented)

- ✅ Interactive 360° panoramic Street View navigation
- ✅ WebGPU-based rendering with custom shaders
- ✅ Mouse drag to pan, scroll to zoom
- ✅ Keyboard WASD controls for movement
- ✅ Cruise mode (automatic navigation)
- ✅ Route planning via Google Directions API
- ✅ Mini-map with location, heading, and route visualization
- ✅ Radio integration (streaming audio)
- ✅ Snapshot/screenshot with metadata download
- ✅ Search/teleport to addresses or coordinates
- ✅ Shareable links with position parameters
- ✅ Welcome modal on startup

---

## Development Conventions

### Code Style
- TypeScript with strict mode enabled
- React functional components with hooks
- PascalCase for components, camelCase for functions/variables
- CSS-in-JS for dynamic styles, style.css for global styles

### State Management
- Local component state via `useState`
- Persistent refs via `useRef` (for services, intervals)
- Callback memoization via `useCallback`
- Effect cleanup in `useEffect` return functions

### Error Handling
- WebGPU initialization failures fallback gracefully
- Try-catch around `copyExternalImageToTexture` for transient errors
- Google Maps API errors logged to console
- User alerts for search failures and route errors

### Performance Considerations
- `useEffect` dependency arrays carefully managed
- `requestAnimationFrame` for render loop
- Canvas texture recreation only on dimension changes
- Route waypoint tracking to avoid recalculation

---

## Testing Strategy

The project uses Create React App's default testing setup:
- **Framework**: Jest
- **Utilities**: React Testing Library, jest-dom
- **Run**: `npm test`

**Current State**: No comprehensive test suite exists. The project relies on manual testing.

### Areas Needing Tests
- `findBestLink` navigation algorithm
- `Renderer` WebGPU initialization
- Canvas scraping logic
- Route planning integration
- Input handler event processing

---

## Security Considerations

1. **API Keys**: Google Maps API key is hardcoded in source. Should use environment variables.

2. **Canvas Scraping**: Relies on undocumented Google Maps internals. Subject to breaking changes.

3. **CORS**: Audio streams require `crossOrigin = "anonymous"` for Web Audio API access.

4. **Content Security Policy**: Consider adding CSP headers for production deployment.

5. **Deployment Script**: `deploy.py` contains server credentials in plaintext (password line 45).

---

## Known Limitations

1. **WebGPU Support**: Requires modern Chrome/Edge. Falls back to hidden canvas view if unavailable.

2. **Fluid Simulation**: Documentation references velocity/advection shaders, but only `streetview` mode is implemented.

3. **Mobile**: Touch gestures not fully implemented. Desktop-focused experience.

4. **Accessibility**: Limited screen reader support. Keyboard navigation works but could be enhanced.

5. **Offline**: No offline mode. Requires continuous internet connection.

---

## Future Roadmap

See `feature_expansion_plan.md` for detailed roadmap. Key planned features:

- EXIF metadata embedding for snapshots
- Historical imagery time travel
- Enhanced POI overlays
- Measurement tools
- Offline cache management
- Advanced rendering effects (weather, time of day)

---

## Resources

- [Google Maps Platform Documentation](https://developers.google.com/maps/documentation)
- [WebGPU Specification](https://www.w3.org/TR/webgpu/)
- [Street View Static API](https://developers.google.com/maps/documentation/streetview)
- [WebGPU Samples](https://webgpu.github.io/webgpu-samples/)

---

*Last Updated: February 6, 2026*
