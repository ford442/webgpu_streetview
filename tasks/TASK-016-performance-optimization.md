# TASK-016: Performance Optimization

## Goal

Optimize rendering performance for 60fps on mid-range devices.

## Acceptance Criteria

- [ ] LOD (Level of Detail) for vehicle interiors
- [ ] Texture compression (KTX2/Basis)
- [ ] Occlusion culling for hidden parts
- [ ] Frustum culling for Street View skybox
- [ ] Memory usage profiling and optimization
- [ ] Target: 60fps on GTX 1060 / M1 Mac

## Implementation

```typescript
// src/utils/performance.ts
export function setupLOD(model: THREE.Group): void {
  // Set up LOD levels based on distance
}

export function optimizeTextures(renderer: THREE.WebGLRenderer): void {
  // Enable texture compression
  // Use compressed texture formats
}
```

## Files

- `src/utils/performance.ts` — new
- `src/utils/memoryProfiler.ts` — memory tracking
- `src/hooks/usePerformanceMonitor.ts` — FPS monitoring

## Estimated Effort

4-5 hours
