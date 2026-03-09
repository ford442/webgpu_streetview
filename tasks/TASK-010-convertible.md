# TASK-010: Convertible Vehicle Variant

## Goal

Add a convertible vehicle option with no roof, different sightlines, and wind effects.

## Acceptance Criteria

- [ ] Convertible vehicle shell (no roof, different windshield frame)
- [ ] Toggle between sedan and convertible modes
- [ ] Wind effects when "driving" (hair movement, open air feeling)
- [ ] Sky visible directly above
- [ ] Different interior styling (sport seats, different dashboard)
- [ ] Wind noise in spatial audio when moving

## Implementation Notes

Add to `webgpu_streetview/src/car/variants/ConvertibleMode.ts`

```typescript
export interface ConvertibleState {
  isOpen: boolean;
  windSpeed: number;
  turbulence: number;
}

export function initConvertibleMode(): void {
  // Remove roof geometry
  // Add wind deflector option
  // Change seat style to sport buckets
}
```

## Files to Modify

- `src/car/` — add convertible variant
- `src/car/DashboardUI.tsx` — add vehicle selector
- `src/audio/` — add wind noise layer
- `src/effects/` — add wind particle effects

## Estimated Effort

4-5 hours
