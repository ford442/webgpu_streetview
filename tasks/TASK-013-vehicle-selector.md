# TASK-013: Vehicle Selection System

## Goal

Create a unified vehicle selection system to switch between all vehicle variants.

## Acceptance Criteria

- [ ] Vehicle selector UI (sedan, convertible, lab, limo)
- [ ] Smooth transition between vehicles
- [ ] Persist vehicle choice in settings
- [ ] Each vehicle has unique interior layout and features
- [ ] Shared systems work across all (Street View, controls, audio)

## Implementation Notes

Create `webgpu_streetview/src/car/VehicleManager.ts`

```typescript
export type VehicleType = 'sedan' | 'convertible' | 'science-lab' | 'limousine';

export interface VehicleConfig {
  type: VehicleType;
  name: string;
  description: string;
  features: string[];
  interiorModel: string;
  hasRoof: boolean;
  seatCount: number;
}

export const VEHICLES: Record<VehicleType, VehicleConfig> = {
  sedan: { ... },
  convertible: { ... },
  'science-lab': { ... },
  limousine: { ... },
};
```

## Files to Modify

- `src/car/VehicleManager.ts` — new
- `src/car/index.ts` — export vehicle system
- `src/components/` — vehicle selector UI
- `src/store/` — persist vehicle preference

## Estimated Effort

3-4 hours
