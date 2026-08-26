# TASK-010: Convertible Vehicle Variant

> **Status: shipped.** Rewritten against the real tree — the original version of
> this file described code that now exists, at `webgpu_streetview/src/...`
> paths that never existed (the repo root *is* `webgpu_streetview`, so source
> paths start at `src/`). Do not re-implement any of the below; extend it.

## Goal

Add a convertible vehicle option with no roof, different sightlines, and wind effects.

## Acceptance Criteria

- [x] Convertible vehicle shell (no roof, different windshield frame) — `VEHICLES.convertible.hasRoof = false` in `src/car/VehicleManager.ts`; `ConvertibleMode` hides `roofGroup`
- [x] Toggle between sedan and convertible modes — `setVehicleType()` / `toggleVehicleType()` in `src/car/carModeRuntime.ts`, routed through `VehicleManager`
- [x] Wind effects when "driving" — `src/car/variants/convertible/WindParticleSystem.ts`
- [x] Sky visible directly above — roof group hidden in `ConvertibleMode.applyVehicleType()`
- [x] Different interior styling (sport seats, different dashboard) — `SportSeats` / `SportDashboard` in `src/car/variants/ConvertibleMode.ts`
- [x] Wind noise when moving — `src/effects/WindAudio.ts`, driven from `CarInteriorAnimator.syncWindAudio()` and gated on `convertibleOpen || windNorm > 0.25`

## Known gaps

- Wind audio is a **procedural stereo bed**, not HRTF-spatialised. True spatial
  audio is deliberately deferred (it needs the emcc ship path for a convolution
  kernel — see `docs/WASM_BRIDGE.md`).
- Roof animation is a simple position lerp in `CarInteriorAnimator`, not a
  multi-stage folding mechanism.

## Where the code lives

| Concern | File |
|---|---|
| Mode class, sport interior, roof state | `src/car/variants/ConvertibleMode.ts` |
| Wind particles | `src/car/variants/convertible/WindParticleSystem.ts` |
| Wind audio | `src/effects/WindAudio.ts` |
| Vehicle config / type | `src/car/VehicleManager.ts` |
| Runtime switching | `src/car/carModeRuntime.ts` |

## Vehicle type rule

`VehicleType` is defined **once**, in `src/car/VehicleManager.ts`. `ConvertibleMode`
previously declared a private two-value enum, which forced callers through
`as any`; that is gone and must not come back. Only `'convertible'` is treated
as open-air — every other type is a roofed vehicle. Pinned by
`src/car/__tests__/vehicleTypeSsot.test.ts`.
