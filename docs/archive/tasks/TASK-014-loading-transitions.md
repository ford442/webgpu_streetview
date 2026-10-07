# TASK-014: Loading States & Transitions

## Goal

Add smooth loading states and transitions when switching vehicles or Street View locations.

## Acceptance Criteria

- [ ] Loading spinner/indicator when fetching new Street View imagery
- [ ] Fade transition between vehicle types
- [ ] Smooth camera transitions when recentering
- [ ] Progress indicator for model loading
- [ ] Graceful error handling with retry option

## Implementation

```typescript
// src/components/LoadingOverlay.tsx
export function LoadingOverlay({ message, progress }: { message: string; progress?: number }) {
  return (
    <div className="loading-overlay">
      <div className="spinner" />
      <p>{message}</p>
      {progress && <progress value={progress} max={100} />}
    </div>
  );
}
```

## Files

- `src/components/LoadingOverlay.tsx` — new
- `src/hooks/useTransition.ts` — transition hook
- `src/store/loadingState.ts` — loading state management

## Estimated Effort

2-3 hours
