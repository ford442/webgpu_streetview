# TASK-012: Limousine Vehicle Variant

## Goal

Add a limousine with partition glass, rear-facing seats, and luxury amenities.

## Acceptance Criteria

- [x] Limo interior (extended cabin, partition glass, rear-facing seats)
- [x] Privacy partition with up/down toggle
- [x] Luxury amenities (mini bar, entertainment screens, mood lighting)
- [x] Different window layout (smaller, more private)
- [x] Intercom system (visual representation)
- [x] Chauffeur view option (look through partition)

## Implementation

Lives at `src/car/variants/limousine/LimoAtmospherePlugin.ts`.

> **Superseded:** this file originally described a `LimousineMode` class that
> took an `HTMLElement` container, built a whole cabin, and drove its own
> `THREE.WebGLRenderer` + `render()` loop — a second GPU context that nothing on
> the live path ever called. It was folded into `LimoAtmosphere`, a **scene
> plugin** that adds only the limo-specific trim to the shared
> `interior.interiorGroup` and is updated by `src/car/runtime/lifecycle.ts`.
> Driver seat, floor, roof and glass come from the shared `CarInteriorBuilder`
> for every vehicle. `src/car/variants/__tests__/atmospherePlugins.test.ts`
> greps `src/car/variants/` for `new THREE.WebGLRenderer` and fails if one comes
> back. **Do not add one.**

### Features Implemented:

1. **Extended Cabin** - 4-meter long interior with luxury velvet ceiling, deep pile carpet, and wood trim
2. **Privacy Partition** - Smart glass partition with toggleable opacity (transparent/opaque)
3. **Rear-Facing Seats** - Two pairs of opposing seats with leather upholstery, headrests, armrests with controls
4. **Mini Bar** - Wood cabinet with glass top, crystal decanters, champagne bucket, LED accent lighting
5. **Entertainment Screens** - Main partition screen + individual passenger screens with configurable content (nav/entertainment/ambient/none)
6. **Mood Lighting System** - 4 modes (relaxing/business/party/romantic) with colored accent lights and starlight ceiling
7. **Private Windows** - Smaller tinted windows with privacy curtains and chrome frames
8. **Intercom System** - Visual control panel with speaker grill and status indicator
9. **Chauffeur View** - Camera position toggle to look through partition toward driver

### Public API:

```typescript
export interface LimoState {
  partitionOpen: boolean;
  moodLighting: 'relaxing' | 'business' | 'party' | 'romantic';
  entertainmentOn: boolean;
  intercomActive: boolean;
  chauffeurView: boolean;
  barLightOn: boolean;
  screenContent: 'none' | 'nav' | 'entertainment' | 'ambient';
}

export class LimoAtmosphere {
  constructor(
    interiorGroup: THREE.Group,      // the shared cabin group — not a container element
    initialVehicle: VehicleType,
    initialState?: Partial<LimoState>,
  );
  attachToCabin(): void;             // re-parent after rebuildCarInteriorForVehicle()'s clear()
  setVehicleType(type: VehicleType): void;  // visibility follows 'limousine'
  togglePartition(): boolean;
  setMoodLighting(mode: LimoState['moodLighting']): void;
  toggleEntertainment(): boolean;
  toggleBarLight(): boolean;
  toggleIntercom(): boolean;
  setScreenContent(content: LimoState['screenContent']): void;
  getState(): LimoState;
  update(deltaTime: number): void;
  dispose(): void;
}

export const defaultLimoState: LimoState;
```

`chauffeurView` remains in `LimoState` but has no `toggleChauffeurView()` —
camera placement is the shared cabin's job, so that criterion is carried by
`vehicleLayout.ts`, not by this plugin.

## Files

- `src/car/variants/limousine/LimoAtmospherePlugin.ts` — the plugin
- `src/car/variants/limousine/limoAtmosphere.ts` — mood-lighting ramps
- `src/car/variants/index.ts`, `src/car/index.ts` — exports
- `src/car/runtime/lifecycle.ts`, `src/car/runtime/state.ts`, `src/car/runtime/vehicleSwitch.ts` — construction, per-vehicle visibility, update, dispose
- `src/car/variants/__tests__/atmospherePlugins.test.ts` — plugin + no-renderer tests

## Status

**COMPLETED** - March 9, 2026; refolded into a scene plugin (no second renderer).
