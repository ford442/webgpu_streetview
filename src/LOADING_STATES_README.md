# Loading States & Transitions

This module provides smooth loading states and transitions for the webgpu_streetview application.

## Files Created

### Core Files

1. **`src/store/loadingState.ts`** - Centralized loading state management
   - Singleton manager for all loading states
   - Supports multiple loading types: `streetview`, `vehicle`, `camera`, `model`, `route`, `search`
   - Error handling with retry capability
   - Progress tracking

2. **`src/hooks/useTransition.ts`** - Animation and transition hooks
   - `useTransition()` - General value interpolation with easing
   - `useFadeTransition()` - Fade in/out animations
   - `useVehicleTransition()` - Smooth vehicle switching
   - `useCameraTransition()` - Camera recentering animation
   - `usePanoramaLoading()` - Street View loading simulation
   - Built-in easing functions: `linear`, `easeIn`, `easeOut`, `easeInOut`, `easeInCubic`, `easeOutCubic`, `easeInOutCubic`, `easeInBack`, `easeOutBack`, `easeOutElastic`

3. **`src/components/LoadingOverlay.tsx`** - Loading overlay component
   - Multiple spinner variants: `spinner`, `dots`, `pulse`, `bars`
   - Progress bar with percentage
   - Error display with retry button
   - Auto-connect to loading state manager
   - Size variants: `small`, `medium`, `large`, `fullscreen`

4. **`src/hooks/useLoadingState.ts`** - React hook for loading state
   - `useLoadingState(type)` - Subscribe to specific loading type
   - `useGlobalLoadingState()` - Check if any loading is active

5. **`src/hooks/useLoadingIntegrations.ts`** - Integration helpers
   - `useStreetViewLoading()` - Track Street View loading
   - `useVehicleLoading()` - Track vehicle switching
   - `useCameraLoading()` - Track camera recentering
   - `useModelLoading()` - Track 3D model loading
   - `useRouteLoading()` - Track route planning
   - `useSearchLoading()` - Track search operations
   - `useAllLoadingStates()` - Combine all loading states

## Usage Examples

### Basic Loading Overlay

```tsx
import { LoadingOverlay } from './components/LoadingOverlay';

function App() {
  return (
    <>
      <LoadingOverlay
        message="Loading Street View..."
        progress={75}
        isVisible={true}
        variant="spinner"
        size="fullscreen"
      />
    </>
  );
}
```

### Connected Loading Overlay (Auto-updates from state)

```tsx
import { LoadingOverlay } from './components/LoadingOverlay';

function App() {
  return (
    <>
      {/* Automatically shows/hides based on loading state */}
      <LoadingOverlay type="streetview" autoConnect />
      <LoadingOverlay type="vehicle" autoConnect />
    </>
  );
}
```

### Using Loading State Hooks

```tsx
import { useLoadingState } from './hooks/useLoadingState';

function MyComponent() {
  const { 
    isLoading, 
    message, 
    progress, 
    startLoading, 
    stopLoading,
    setError,
    retry 
  } = useLoadingState('streetview');

  const loadData = async () => {
    startLoading('Fetching Street View...', 0);
    
    try {
      // Simulate progress
      for (let i = 0; i <= 100; i += 10) {
        await new Promise(r => setTimeout(r, 100));
        startLoading('Fetching Street View...', i);
      }
      
      stopLoading();
    } catch (err) {
      setError('Failed to load Street View', true, loadData);
    }
  };

  return (
    <button onClick={loadData} disabled={isLoading}>
      {isLoading ? `Loading ${progress}%` : 'Load'}
    </button>
  );
}
```

### Vehicle Switching with Transition

```tsx
import { useVehicleTransition } from './hooks/useTransition';

function VehicleSelector() {
  const { isSwitching, opacity, switchVehicle } = useVehicleTransition(400);

  const handleVehicleChange = async (newVehicle: VehicleType) => {
    await switchVehicle(() => {
      // Perform actual vehicle change
      setVehicle(newVehicle);
    });
  };

  return (
    <div style={{ opacity, transition: 'opacity 0.2s' }}>
      {/* Vehicle selector UI */}
    </div>
  );
}
```

### Camera Recentering

```tsx
import { useCameraTransition } from './hooks/useTransition';

function CameraControls() {
  const { isRecentering, recenter } = useCameraTransition(500);

  const handleRecenter = () => {
    recenter(
      currentHeading,
      currentPitch,
      0, // target heading
      0, // target pitch
      (h, p) => {
        setHeading(h);
        setPitch(p);
      }
    );
  };

  return (
    <button onClick={handleRecenter} disabled={isRecentering}>
      {isRecentering ? 'Recentering...' : 'Recenter'}
    </button>
  );
}
```

### Using Integration Helpers

```tsx
import { useStreetViewLoading, useVehicleLoading } from './hooks/useLoadingIntegrations';

function StreetViewComponent() {
  const { startLoading, updateProgress, stopLoading, setError } = useStreetViewLoading();
  const vehicleLoading = useVehicleLoading();

  useEffect(() => {
    startLoading('Initializing Street View...');
    
    // Update progress as tiles load
    const interval = setInterval(() => {
      updateProgress(50, 'Loading panorama tiles...');
    }, 500);

    return () => {
      clearInterval(interval);
      stopLoading();
    };
  }, []);

  return null;
}
```

### Direct State Manager Access

```tsx
import { loadingStateManager } from './store/loadingState';

// Start loading
loadingStateManager.startLoading('model', 'Loading 3D Models...', 0);

// Update progress
loadingStateManager.updateProgress('model', 50);

// Set error with retry
loadingStateManager.setError('model', 'Failed to load', true, () => {
  // Retry callback
  retryLoadModels();
});

// Stop loading
loadingStateManager.stopLoading('model');

// Subscribe to changes
const unsubscribe = loadingStateManager.subscribe((states) => {
  console.log('Street View loading:', states.streetview.isLoading);
});

// Retry failed operation
loadingStateManager.retry('model');
```

## Loading Types

| Type | Description |
|------|-------------|
| `streetview` | Street View image fetching |
| `vehicle` | Vehicle switching transitions |
| `camera` | Camera recentering |
| `model` | 3D model loading |
| `route` | Route planning/calculation |
| `search` | Location search |

## CSS Classes

The following CSS classes are available in `style.css`:

- `.loading-overlay` - Base overlay styles
- `.loading-spinner` - Spinner animation
- `.loading-dots` - Dots animation container
- `.loading-pulse` - Pulse animation
- `.loading-bars` - Bars animation container
- `.progress-bar-container` - Progress bar background
- `.progress-bar-fill` - Progress bar fill
- `.loading-error` - Error display animation
- `.fade-transition` - Fade transition helper
- `.vehicle-transition-enter/exit` - Vehicle transition classes
- `.camera-recenter-indicator` - Camera recenter spinner

## Easing Functions

Available easing functions in `useTransition.ts`:

```typescript
easings.linear(t)        // Linear interpolation
easings.easeIn(t)        // Quadratic ease in
easings.easeOut(t)       // Quadratic ease out
easings.easeInOut(t)     // Quadratic ease in-out
easings.easeInCubic(t)   // Cubic ease in
easings.easeOutCubic(t)  // Cubic ease out
easings.easeInOutCubic(t)// Cubic ease in-out
easings.easeInBack(t)    // Back ease in (overshoot)
easings.easeOutBack(t)   // Back ease out (overshoot)
easings.easeOutElastic(t)// Elastic bounce
```
