# Claude Development Guide - WebGPU StreetView

## Project Overview

**WebGPU StreetView** is a React + WebGPU application that captures Google Maps Street View panoramas and renders them with custom shaders. It includes an immersive car interior mode with interactive controls (steering wheel, wipers, gauges) and comprehensive features like bookmarks, history, snapshots, and accessibility support.

### Core Technology Stack
- **Frontend**: React 19 (TypeScript)
- **Rendering Engine**: WebGPU with WGSL shaders
- **3D Graphics**: Three.js (for car interior scenes)
- **Maps Integration**: Google Maps JavaScript API
- **State Management**: React hooks (useState, useRef, useContext)
- **Build Tool**: Create React App

## Project Structure

```
src/
├── App.tsx                    # Main app controller, coordinates all features
├── components/                # React UI components
│   ├── WebGPUCanvas.tsx       # WebGPU renderer wrapper
│   ├── StreetView.tsx         # Google Maps Street View integration
│   ├── InputHandler.tsx       # Keyboard & mouse input handling
│   ├── MiniMap.tsx            # Secondary navigation map
│   ├── VehicleSelector.tsx    # Car selection UI
│   ├── DashboardUI.tsx        # Car interior dashboard (EXPORTS from car/)
│   └── [others]               # Accessibility, bookmarks, history, etc.
├── car/                       # Car interior mode implementation
│   ├── index.ts               # Car mode API exports
│   ├── CarInterior.ts         # Three.js car scene and animations
│   ├── CarAnimator.ts         # Animation loop management
│   ├── SelectivePostProcessing.ts  # Dashboard UI rendering
│   ├── DashboardUI.tsx        # Dashboard UI React wrapper
│   └── shaders/               # WGSL shaders for post-processing
├── renderer/                  # WebGPU rendering system
│   ├── Renderer.ts            # Main WebGPU renderer
│   ├── types.ts               # Shader and render mode types
│   └── shaders/               # WGSL shader files
├── hooks/                     # Custom React hooks
│   ├── useKeyboardShortcuts.tsx     # Keyboard shortcuts & accessibility
│   ├── useBookmarks.tsx             # Bookmark management
│   ├── useLocationHistory.tsx       # Navigation history
│   ├── useSnapshots.tsx             # Screenshot functionality
│   └── usePerformanceMonitor.tsx    # Performance metrics
└── utils/                     # Utility functions
    ├── navigation.ts          # Link finding and route planning
    └── [others]               # Helper utilities
```

## Key Features & Implementation

### 1. **Street View Rendering**
- **Entry Point**: `src/components/WebGPUCanvas.tsx` → `src/renderer/Renderer.ts`
- **How it works**: Captures hidden Google Maps canvas, uploads to GPU texture, renders via `streetview.wgsl`
- **Critical Code**: `Renderer.ts` handles dynamic texture resizing and external image copying

### 2. **Car Interior Mode**
- **Entry Point**: `src/car/index.ts` → `src/car/CarInterior.ts`
- **Features**:
  - Real-time 3D steering wheel animation (A/D or Arrow keys)
  - Functional windshield wipers (animated sweep, toggle control)
  - Live dashboard gauges (speedometer 0-100 km/h, tachometer 0-8000 RPM)
  - Side mirrors (positioned for realistic viewing)
  - Toggleable headlights with spotlight effects
  - Dashboard UI in React (`DashboardUI.tsx`)
- **Control Restrictions**: Only WASD/Arrow keys affect car heading; no mouse steering
- **Integration**: `App.tsx` calls `setCarSteering()`, `setCarWipers()`, `updateCarGauges()`

### 3. **Input Handling**
- **Entry Point**: `src/components/InputHandler.tsx`
- **Modes**:
  - **Free Look**: Mouse + WASD for heading/pitch control
  - **Car Mode**: WASD for steering, mouse for head look only
- **Keyboard Shortcuts**: Managed by `useKeyboardShortcuts.tsx` hook
- **Accessibility**: Full keyboard navigation support

### 4. **Navigation & Route Planning**
- **Best Link Finding**: `src/utils/navigation.ts` maps desired direction to available panorama links
- **Cruise Mode**: Auto-advances through best available links on interval
- **Route Planning**: Uses Google Directions API to calculate walking paths
- **Critical Math**: `findBestLink()` calculates angles; errors here cause backwards walking

### 5. **Dashboard Features**
- **Bookmarks**: Save/load location markers with custom notes
- **History**: Track visited locations with breadcrumb trail
- **Snapshots**: Capture WebGPU canvas as PNG with metadata
- **Color Grading**: Apply tone-mapping and color adjustments
- **Performance Stats**: Real-time FPS, memory, and rendering metrics

### 6. **Accessibility**
- **Keyboard Shortcuts**: Full control without mouse
- **Screen Reader Support**: ARIA labels and announcements
- **Skip Links**: Jump to main content
- **Settings**: User-configurable keyboard bindings, UI zoom levels

## Critical Hotspots & Gotchas

### 🔴 Canvas Scraping (StreetView.tsx)
**Why fragile**: Google Maps doesn't expose canvas officially. Code uses `MutationObserver` to find largest `<canvas>` element.

**Risks**:
- If Google changes DOM structure, code breaks
- Canvas may not be available immediately
- Multiple canvases exist; size sorting heuristic could fail

**Best Practice**: Add defensive checks before accessing `canvasElement.getContext('webgl2')`

### 🔴 Coordinate System Complexity (App.tsx, navigation.ts)
**Why complex**:
- Heading/pitch state sync'd back to Google Panorama
- Link finding algorithm calculates 3D angles
- Zoom is inverted then re-mapped

**Best Practice**: Test `findBestLink()` thoroughly when modifying; tiny math errors cause navigation failure

### 🔴 WebGPU Texture Management (Renderer.ts)
**Why complex**: Must handle dynamic resize, transient source failures, external image copying

**Best Practice**: Always wrap `device.queue.copyExternalImageToTexture()` in try-catch; validate source dimensions before upload

### 🔴 Ghost Documentation in AGENTS.md
**Known Issue**: Documents non-existent "Fluid Simulation" feature. RenderMode only supports `'streetview'`.

**Action**: Ignore "Fluid Simulation" sections unless explicitly tasked to re-implement.

### 🔴 Input Event Hijacking
**Issue**: `InputHandler` attaches to `window` globally, so UI overlays hijack events unless `e.stopPropagation()` is called.

**Best Practice**: Any new UI overlay must block mouse/keyboard event propagation.

### 🔴 Google Maps API Key Restrictions & Deployment (Issue #72) + recovery follow-ups
**The persistent "This page can't load Google Maps correctly" error** on https://test.1ink.us/streetview is almost always caused by the key's **HTTP referrer (website) restrictions** in Google Cloud Console not including the exact production origin.

- The key that works at `go.1ink.us/streetview` will fail at `test.1ink.us/streetview` (and vice versa) unless both patterns are explicitly whitelisted.
- `public/config.js` + `deploy.py` (with `MAPS_API_KEY=...`) is the supported production path. It lets you change the key on the server without a rebuild.
- `REACT_APP_MAPS_API_KEY` is only a fallback baked at build time.
- `.env` (plain) is now gitignored; only `.env.local` should ever hold real dev keys.

After the key bug/vulnerability cleanup, residual state (sticky `mapsAuthFailed`, hard full-screen modal in App.tsx, one-shot gm-err removal) could still make Street View *appear* blocked or flicker even with a now-valid key. See the June 2026 recovery series filed under epic #90:

- #97 (sticky auth state / render recovery)
- #98 (robust gm-err flicker suppression)
- #99 (seamless late-key recovery, no reload)
- #100 (tests + deploy recovery checklist)
- #101 (deprecate the hard modal)

**Local mitigations applied** (remove blocking):
- Auto-clear `mapsAuthFailed` + banners on `api-ready` / `canvas-ready` / good status and on any new effective key.
- Key poller now clears failed unconditionally for a fresh key.
- "Dismiss block" escape + loading overlay now participates for auth errors.
- Persistent removal of error chrome is still needed (see #98).

**Action**:
- Before any prod deploy: confirm the target host(s) are in the key's referrer allowlist.
- Run deploys with `MAPS_API_KEY=... python deploy.py` so the runtime config wins.
- After deploy, immediately verify `https://test.1ink.us/streetview/config.js` returns the correct key.
- See the new "Production Deployment & Google Maps API Key Setup" section in README.md and the updated `docs/GOOGLE_CLOUD_API_SETUP_GUIDE.md`.
- After key rotation incident: watch for the new recovery behaviors (late key log, auto modal clear, canvas promotion) rather than forcing reload.

## Common Tasks & Workflows

### Adding a New Feature to Car Interior
1. Add 3D geometry to `CarInterior.ts` constructor
2. Export control function from `src/car/index.ts`
3. Call from `App.tsx` in render loop or event handler
4. Wire UI button in `DashboardUI.tsx`

Example:
```typescript
// 1. In CarInterior.ts
private sunroof: THREE.Group;
public setSunroofPosition(angle: number) {
  this.sunroof.rotation.x = THREE.MathUtils.degToRad(angle);
}

// 2. In car/index.ts
export function setSunroofAngle(angle: number) {
  if (carScene?.carInterior) carScene.carInterior.setSunroofPosition(angle);
}

// 3. In DashboardUI.tsx
<button onClick={() => setSunroofAngle(45)}>Open Sunroof</button>
```

### Debugging Navigation Issues
1. Check `console.log()` in `findBestLink()` to see calculated angles
2. Verify `panorama.getLinks()` returns expected data
3. Test with specific coordinates to isolate problem

### Profiling Performance
- Use `PerformanceStatsOverlay` component (already in App.tsx)
- Check WebGPU queue timing and texture upload size
- Monitor steering/wiper animation frames in browser DevTools

## State Management Patterns

### Global App State (App.tsx)
```typescript
const [heading, setHeading] = useState(0);        // Camera rotation
const [pitch, setPitch] = useState(0);            // Camera tilt
const [zoom, setZoom] = useState(1);              // Zoom level
const [isCarMode, setIsCarMode] = useState(false);// Car mode toggle
```

### Persistent Refs (useRef)
```typescript
const rendererRef = useRef<Renderer | null>(null);   // Persists across renders
const panoramaRef = useRef<google.maps.StreetViewPanorama>(null);
const carAnimatorRef = useRef<CarAnimator | null>(null);
```

### Custom Hooks Pattern
```typescript
const { bookmarks, addBookmark } = useBookmarks();
const { history, navigateTo } = useLocationHistory();
const { snapshots, takeSnapshot } = useSnapshots();
```

## Testing & Validation

### Unit Tests
```bash
npm test
```

### Build & Run Locally
```bash
npm install
npm start  # Starts dev server at http://localhost:3000
```

### Common Issues
| Issue | Solution |
|-------|----------|
| Black canvas | Check if Google Maps canvas detected, verify GPU support |
| Jerky steering | Lower animation frame rate, check for RAF conflicts |
| Missing textures | Verify shader URLs in `public/` directory |
| API errors | Check API key limits, enable Maps/Directions APIs |

## Deployment

### Production Build
```bash
npm run build  # Creates optimized bundle in build/
```

### Environment Variables
Create `.env` file (not committed):
```
REACT_APP_MAPS_API_KEY=<your-key>
```

### Web Server
Requires HTTPS for `navigator.gpu` WebGPU access.

## Code Quality Standards

- **TypeScript Strict Mode**: Enforced by `tsconfig.json`
- **No Console Spam**: Remove debug logs before commit
- **Comments**: Only for non-obvious logic; code should self-document
- **Imports**: Organize by external deps, internal modules, types
- **Naming**: camelCase for variables/functions, PascalCase for classes/components

## Resources

- **WebGPU Spec**: https://gpuweb.github.io/gpuweb/
- **WGSL Reference**: https://www.w3.org/TR/WGSL/
- **Three.js Docs**: https://threejs.org/docs/
- **React 19 Docs**: https://react.dev/
- **Google Maps API**: https://developers.google.com/maps

## Git Workflow

**Branch Convention**: `claude/<feature-description>-<session-id>`

1. **Make changes** on feature branch
2. **Commit early and often**: `git commit -m "Clear message"`
3. **Push to origin**: `git push -u origin <branch-name>`
4. **Create PR** for code review

**Commit Message Format**:
```
Short, imperative summary (50 chars max)

Optional detailed explanation. Reference issues/PRs:
Closes #123
Related to CAR_MODE_ENHANCEMENTS.md
```

## Getting Help

- Read `DEVELOPER_CONTEXT.md` for architecture deep-dive
- Check `CAR_MODE_ENHANCEMENTS.md` for car feature documentation
- Review `feature_expansion_plan.md` for planned work
- Inspect `tasks/` directory for issue tracking

---

**Last Updated**: March 11, 2026
**Maintainer**: Claude Code
