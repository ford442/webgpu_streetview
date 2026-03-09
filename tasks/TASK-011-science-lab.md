# TASK-011: Science Lab Vehicle Variant

## Goal

Add a mobile science lab / research vehicle with equipment racks and instrumentation.

## Acceptance Criteria

- [ ] Lab vehicle interior (equipment racks, benches, instruments)
- [ ] Scientific displays showing data (graphs, readouts)
- [ ] Sample storage compartments
- [ ] Different seating arrangement (side-facing bench seats)
- [ ] Lab equipment sounds (beeps, fans, machinery)
- [ ] Special lighting (UV, task lighting)

## Implementation Notes

Add to `webgpu_streetview/src/car/variants/ScienceLabMode.ts`

```typescript
export interface LabState {
  equipmentActive: boolean;
  sampleCount: number;
  dataLogging: boolean;
}

export function initScienceLabMode(): void {
  // Replace passenger seat with equipment rack
  // Add bench seating along sides
  // Add scientific instrument panels
  // Add sample storage drawers
}
```

## Files to Modify

- `src/car/` — add science lab variant
- `src/components/` — lab instrument displays
- `src/audio/` — lab equipment ambient sounds
- `src/effects/` — special lighting effects

## Estimated Effort

5-6 hours
