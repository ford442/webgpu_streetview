# TASK-015: Mobile Responsiveness

## Goal

Ensure the car interior viewer works well on mobile devices (touch controls, performance).

## Acceptance Criteria

- [ ] Touch controls for looking around (gyroscope optional)
- [ ] Optimized render quality for mobile GPUs
- [ ] UI scales appropriately for small screens
- [ ] Vehicle selector works with touch
- [ ] Battery-efficient rendering mode

## Implementation

```typescript
// src/hooks/useTouchControls.ts
export function useTouchControls() {
  // Handle touch events for camera rotation
  // Pinch to zoom
  // Double-tap to interact
}

// src/hooks/useDeviceDetection.ts
export function useDeviceDetection() {
  // Detect mobile vs desktop
  // Adjust quality settings accordingly
}
```

## Files

- `src/hooks/useTouchControls.ts` — new
- `src/hooks/useDeviceDetection.ts` — new
- `src/components/MobileUI.tsx` — mobile-optimized UI

## Estimated Effort

3-4 hours
