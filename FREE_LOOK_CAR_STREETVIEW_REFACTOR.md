# Refactoring Free Look / Car / StreetView Exterior Integration

## Problem Statement

You need to cleanly separate and integrate three distinct viewing modes:

1. **Free Look Mode** — Pure Street View navigation with mouse/keyboard control
2. **Car Interior Mode** — 3D cockpit view with steering wheel, gauges, and side mirrors showing Street View
3. **StreetView Exterior** — The panorama visible from the car's windows/mirrors

Currently, these modes may be conflicting in control handling, rendering, or state management.

---

## Architecture Goals

### Clean Separation of Concerns

```
┌─────────────────────────────────────────────────────────┐
│                       App.tsx                            │
│                   (Global State)                         │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  ┌──────────────────┐  ┌──────────────────────────────┐ │
│  │ ViewMode Manager │  │ StreetView Provider          │ │
│  │ (Free/Car)       │  │ (Panorama Data, Canvas)      │ │
│  └──────────────────┘  └──────────────────────────────┘ │
│           │                        │                     │
│           └────────────┬───────────┘                     │
│                        │                                 │
│    ┌───────────────────┴────────────────────┐           │
│    │                                         │            │
│    ▼                                         ▼            │
│ ┌──────────────────┐            ┌────────────────────┐  │
│ │ FreeLookView     │            │ CarInteriorView    │  │
│ │ - Input Handler  │            │ - CarInterior.ts   │  │
│ │ - Mouse/KB ctrl  │            │ - Car Gauges       │  │
│ │- Street View     │            │ - Steering Logic   │  │
│ │  (full screen)   │            │ - Side Mirrors     │  │
│ └──────────────────┘            │ - StreetView       │  │
│                                 │   (windshield)     │  │
│                                 └────────────────────┘  │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │ Shared WebGPU Renderer                            │   │
│  │ (Handles both modes seamlessly)                   │   │
│  └──────────────────────────────────────────────────┘   │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

### Mode Switching Cleanly

```typescript
// Current problematic approach (mixed concerns)
if (isCarMode) {
  // Handle car steering
  // Render car interior
  // Handle car-specific inputs
} else {
  // Handle free look
  // Render street view fullscreen
  // Handle free look inputs
}

// Better approach (separated concerns)
ViewModeManager.setMode('car' | 'freelook');

// Each mode handles its own:
// - Input dispatch
// - Rendering pipeline
// - State updates
```

---

## Implementation Strategy

### Phase 1: Establish View Mode Manager

Create a new singleton-like context/hook:

```typescript
// src/hooks/useViewMode.tsx

type ViewMode = 'freelook' | 'car';

interface ViewModeContextType {
  currentMode: ViewMode;
  setMode: (mode: ViewMode) => void;

  // Mode-specific handlers (optional, delegate to mode)
  handleInputEvent: (event: InputEvent) => void;
  handleRender: (renderer: Renderer, canvas: HTMLCanvasElement) => void;
}

export const ViewModeContext = createContext<ViewModeContextType>(null!);

export function useViewMode() {
  const context = useContext(ViewModeContext);
  if (!context) throw new Error('useViewMode must be within ViewModeProvider');
  return context;
}

export function ViewModeProvider({ children }: { children: React.ReactNode }) {
  const [currentMode, setMode] = useState<ViewMode>('freelook');
  const [prevMode, setPrevMode] = useState<ViewMode | null>(null);

  useEffect(() => {
    if (prevMode !== currentMode) {
      console.log(`Switching mode: ${prevMode} → ${currentMode}`);

      // Cleanup previous mode
      if (prevMode === 'car') {
        cleanupCarMode();
      } else if (prevMode === 'freelook') {
        cleanupFreeLookMode();
      }

      // Initialize new mode
      if (currentMode === 'car') {
        initializeCarMode();
      } else if (currentMode === 'freelook') {
        initializeFreeLookMode();
      }

      setPrevMode(currentMode);
    }
  }, [currentMode, prevMode]);

  return (
    <ViewModeContext.Provider value={{ currentMode, setMode, ... }}>
      {children}
    </ViewModeContext.Provider>
  );
}
```

**Usage in App.tsx**:
```typescript
import { ViewModeProvider, useViewMode } from './hooks/useViewMode';

function App() {
  const { currentMode, setMode } = useViewMode();

  return (
    <ViewModeProvider>
      {currentMode === 'freelook' && <FreeLookView />}
      {currentMode === 'car' && <CarModeView />}
      <button onClick={() => setMode(currentMode === 'car' ? 'freelook' : 'car')}>
        Toggle Mode (C)
      </button>
    </ViewModeProvider>
  );
}
```

### Phase 2: Extract Free Look into Separate Component

```typescript
// src/views/FreeLookView.tsx

function FreeLookView() {
  const { setMode } = useViewMode();
  const { panorama, canvas, heading, pitch, zoom, setHeading, setPitch, setZoom } = useStreetView();
  const rendererRef = useRef<Renderer | null>(null);

  // Input handling ONLY in this component
  useEffect(() => {
    function handleMouseDown(e: MouseEvent) {
      if (e.target !== canvas) return; // Stop propagation from overlays
      // ... pan logic ...
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'c' || e.key === 'C') {
        setMode('car');
        return;
      }
      // ... other free look controls ...
    }

    window.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [canvas, setMode]);

  return (
    <div className="freelook-view">
      <WebGPUCanvas
        ref={rendererRef}
        streetViewCanvas={canvas}
        heading={heading}
        pitch={pitch}
        zoom={zoom}
      />
      <MiniMap panorama={panorama} heading={heading} pitch={pitch} />
      <Compass heading={heading} />
      {/* Other UI panels */}
    </div>
  );
}
```

### Phase 3: Extract Car Mode into Separate Component

```typescript
// src/views/CarModeView.tsx

function CarModeView() {
  const { setMode } = useViewMode();
  const { panorama, canvas, heading, pitch, zoom, setHeading, setPitch } = useStreetView();
  const { carScene, carAnimator } = useCarMode();
  const rendererRef = useRef<Renderer | null>(null);

  // Car-specific input handling ONLY here
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'c' || e.key === 'C') {
        setMode('freelook');
        return;
      }

      // Car steering: A/D or Arrow keys
      if (e.key === 'a' || e.key === 'A' || e.key === 'ArrowLeft') {
        setCarSteering(-90); // Full left turn
      } else if (e.key === 'd' || e.key === 'D' || e.key === 'ArrowRight') {
        setCarSteering(90); // Full right turn
      }

      // Car movement: W/S
      if (e.key === 'w' || e.key === 'W') {
        advanceStreetView('forward', panorama);
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [panorama, setMode]);

  // Mouse control: independent head look (not steering)
  useEffect(() => {
    function handleMouseMove(e: MouseEvent) {
      // Head look pitch/yaw, but NOT car heading
      const deltaX = e.movementX * 0.5;
      const deltaY = e.movementY * 0.5;

      setHeading(heading + deltaX);
      setPitch(Math.max(-90, Math.min(90, pitch + deltaY)));
    }

    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, [heading, pitch, setHeading, setPitch]);

  return (
    <div className="car-mode-view">
      {/* Split screen or overlay: Car interior + Street view */}
      <div className="car-container">
        {/* CarInterior renders 3D scene with panorama texture on windshield/mirrors */}
        <CarInteriorRenderer carScene={carScene} />
      </div>

      <DashboardUI
        carScene={carScene}
        onToggleMode={() => setMode('freelook')}
      />
    </div>
  );
}
```

### Phase 4: StreetView Panorama Provider

Create a shared context for panorama data:

```typescript
// src/hooks/useStreetView.tsx

interface StreetViewContextType {
  panorama: google.maps.StreetViewPanorama | null;
  canvas: HTMLCanvasElement | null;
  location: google.maps.LatLng | null;
  heading: number;
  pitch: number;
  zoom: number;

  setHeading: (heading: number) => void;
  setPitch: (pitch: number) => void;
  setZoom: (zoom: number) => void;
  setLocation: (location: google.maps.LatLng) => void;

  // Advance to next panorama
  advance: (direction: 'forward' | 'left' | 'right' | 'backward') => void;
}

export function useStreetView() {
  const context = useContext(StreetViewContext);
  if (!context) throw new Error('useStreetView must be within StreetViewProvider');
  return context;
}

export function StreetViewProvider({ children }: { children: React.ReactNode }) {
  const [panorama, setPanorama] = useState<google.maps.StreetViewPanorama | null>(null);
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const [heading, setHeading] = useState(0);
  const [pitch, setPitch] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [location, setLocation] = useState<google.maps.LatLng | null>(null);

  // Sync heading/pitch back to Google Maps
  useEffect(() => {
    if (panorama) {
      panorama.setPov({ heading, pitch });
    }
  }, [panorama, heading, pitch]);

  return (
    <StreetViewContext.Provider value={{ panorama, canvas, heading, pitch, zoom, ... }}>
      {children}
    </StreetViewContext.Provider>
  );
}
```

### Phase 5: Integration in App.tsx

```typescript
// src/App.tsx

function App() {
  return (
    <StreetViewProvider>
      <ViewModeProvider>
        <div className="app">
          <MainView />
        </div>
      </ViewModeProvider>
    </StreetViewProvider>
  );
}

function MainView() {
  const { currentMode } = useViewMode();

  return (
    <>
      {currentMode === 'freelook' && <FreeLookView />}
      {currentMode === 'car' && <CarModeView />}
    </>
  );
}
```

---

## Key Design Decisions

### 1. Single Source of Truth (Panorama)
- **One panorama instance** per session
- **Both modes share** the same panorama reference
- **No duplication** of Street View data

### 2. Texture Sharing
- Free Look: Full-screen Street View texture
- Car Mode: Same texture → mapped onto windshield/mirrors
- **No re-upload**: Texture reused between modes

### 3. Input Isolation
- **Free Look**: Global listeners attached only when in freelook mode
- **Car Mode**: Global listeners attached only when in car mode
- **Event cleanup**: Listeners detached during mode switch

### 4. Rendering Pipeline
```
Both modes → StreetView Canvas → WebGPU Texture ↓
     ├─→ Free Look: Fullscreen render
     └─→ Car Mode: Composite (Three.js + texture overlay)
```

---

## Testing Checklist

### Free Look Mode
- [ ] Mouse drag rotates view correctly
- [ ] WASD keys advance/turn correctly
- [ ] Scroll zooms in/out
- [ ] C key switches to car mode
- [ ] Panorama data updates correctly
- [ ] No jitter or lag

### Car Mode
- [ ] A/D keys steer wheel correctly (±90°)
- [ ] Steering wheel animation smooth
- [ ] W key advances to next panorama
- [ ] Mouse moves head independently
- [ ] Gauges update (speedometer, tachometer)
- [ ] Wipers toggle and animate
- [ ] C key switches back to free look
- [ ] Street View visible on windshield/mirrors

### Mode Switching
- [ ] Switching free look → car: car initializes, inputs switch
- [ ] Switching car → free look: car cleaned up, fullscreen rendering resumes
- [ ] No state leakage between modes
- [ ] Camera position preserved when switching
- [ ] No memory leaks or dangling listeners

### Performance
- [ ] FPS consistent in both modes (60 desktop, 30 mobile)
- [ ] Memory stable during mode switches
- [ ] No jank during panorama transitions
- [ ] GPU utilization reasonable

---

## Common Pitfalls to Avoid

### ❌ Don't: Mix input handlers
```typescript
// BAD: Single handler for both modes
function handleInput(e) {
  if (isCarMode) { ... }
  else { ... }
}
```

### ✅ Do: Separate by component
```typescript
// GOOD: Each view manages its own inputs
// FreeLookView.tsx: handleMouseDown, handleKeyDown (freelook logic)
// CarModeView.tsx: handleMouseMove (head look), handleKeyDown (steering)
```

### ❌ Don't: Duplicate panorama instances
```typescript
// BAD: Create new panorama per mode
if (isCarMode) panorama = new google.maps.StreetViewPanorama(...);
```

### ✅ Do: Share single panorama
```typescript
// GOOD: One panorama, used by both modes
const { panorama } = useStreetView();
```

### ❌ Don't: Upload texture twice
```typescript
// BAD: Re-upload for each mode
renderer.uploadTexture(streetViewCanvas); // In both FreeLookView and CarModeView
```

### ✅ Do: Cache texture
```typescript
// GOOD: Upload once per frame, regardless of mode
textureRef.current = uploadStreetViewTexture(canvas);
```

### ❌ Don't: Leave listeners dangling
```typescript
// BAD: Attached in useEffect, never cleaned up
window.addEventListener('keydown', handleKeyDown); // No cleanup!
```

### ✅ Do: Always cleanup
```typescript
// GOOD: Remove listeners on unmount
useEffect(() => {
  window.addEventListener('keydown', handleKeyDown);
  return () => window.removeEventListener('keydown', handleKeyDown);
}, []);
```

---

## File Structure After Refactor

```
src/
├── App.tsx                              # Top-level router
├── components/
│   ├── WebGPUCanvas.tsx                # Shared renderer wrapper
│   ├── StreetView.tsx                  # Google Maps integration
│   ├── [other panels/overlays]
├── views/                              # NEW: Mode-specific views
│   ├── FreeLookView.tsx                # Free look mode
│   └── CarModeView.tsx                 # Car interior mode
├── hooks/
│   ├── useViewMode.tsx                 # NEW: Mode management
│   ├── useStreetView.tsx               # NEW: Panorama sharing
│   ├── useCarMode.tsx                  # Car interior logic
│   └── [other hooks]
├── car/
│   ├── CarInterior.ts                  # (unchanged)
│   ├── CarAnimator.ts                  # (unchanged)
│   └── [other car files]
└── renderer/
    ├── Renderer.ts                     # (unchanged, shared)
    └── [other renderer files]
```

---

## Migration Path (Do This Incrementally)

1. **Create `useViewMode` hook** (no changes to App.tsx yet)
2. **Create `useStreetView` hook** (move panorama state here)
3. **Extract `FreeLookView.tsx`** (copy current App.tsx logic)
4. **Extract `CarModeView.tsx`** (copy existing car mode logic)
5. **Update App.tsx** to use new views + providers
6. **Test thoroughly** before cleanup
7. **Remove old code** (input mixing, duplicate state, etc.)

---

## Validation Questions

Before implementing, ask:

1. **Are input handlers scoped to their view component?**
   - Free Look: Has its own mouse drag, keyboard handler
   - Car Mode: Has steering input, head look separately

2. **Is panorama data shared, not duplicated?**
   - Both views call `useStreetView()` to access same panorama instance

3. **Are textures reused between modes?**
   - Single texture uploaded per frame, rendered differently per mode

4. **Are cleanup handlers in place?**
   - useEffect cleanup functions remove all listeners

5. **Is state switching clean?**
   - No stale state leaks between mode switches
   - Previous mode fully cleaned before new mode initializes

---

## References

- **Previous Example**: CAR_MODE_ENHANCEMENTS.md (shows car implementation)
- **React Patterns**: https://react.dev/learn/extracting-state-logic-into-a-custom-hook
- **Context API**: https://react.dev/reference/react/useContext
- **Cleanup**: https://react.dev/learn/you-might-not-need-an-effect#removing-unnecessary-dependencies

---

**This approach ensures**:
✅ Clean separation of concerns
✅ No state duplication
✅ Efficient resource sharing
✅ Easy to test and debug
✅ Scalable for future view modes

---

*Generated: March 11, 2026*
*For: WebGPU StreetView Project*
