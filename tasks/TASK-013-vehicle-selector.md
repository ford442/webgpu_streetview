# TASK-013: Vehicle Selection System

> **Status: shipped.** Rewritten against the real tree — the original version of
> this file asked for `VehicleManager.ts` to be *created* and used
> `webgpu_streetview/src/...` paths that never existed (the repo root *is*
> `webgpu_streetview`, so source paths start at `src/`). `VehicleManager.ts`
> has existed for a long time and is the type SSOT. Do not re-create it.

## Goal

Create a unified vehicle selection system to switch between all vehicle variants.

## Acceptance Criteria

- [x] Vehicle selector UI (sedan, convertible, lab, limo) — `src/components/VehicleSelector.tsx`, mounted from `src/components/MobileUI.tsx`
- [x] Persist vehicle choice in settings — `src/hooks/useVehicleSettings.ts` (localStorage key `webgpu_streetview_vehicle`)
- [x] Each vehicle has unique interior layout and features — `VEHICLES` config map in `src/car/VehicleManager.ts` (`hasRoof`, `seatCount`, `cameraFov`, `gaugeLayout`, `steeringWheel`, …)
- [x] Shared systems work across all (Street View, controls, audio) — one cabin scene rebuilt per vehicle via `rebuildCarInteriorForVehicle()` in `src/car/interior/CarInteriorAssembly.ts`
- [ ] **Smooth transition between vehicles** — currently an immediate teardown/rebuild, no crossfade or animation. This is the one criterion still genuinely open.

## Known gaps

- The transition is instant. A crossfade would need to coordinate with the
  hold-pause system (`AGENTS.md` § Hold-Pause Transition) so it doesn't fight
  the panorama's own transition.
- `ScienceLabInterior` and `LimousineMode` still construct their own
  `THREE.WebGLRenderer` instead of switching through `VehicleManager` alone.
  Tracked by the cabin/pano device-unification effort — see
  `src/car/interior/createCabinRenderer.ts`. **Do not add more `WebGLRenderer`
  constructors.**

## Where the code lives

| Concern | File |
|---|---|
| `VehicleType`, `VehicleConfig`, `VEHICLES`, `VEHICLE_LIST`, `vehicleManager` singleton | `src/car/VehicleManager.ts` |
| Per-vehicle layout overrides | `src/car/vehicleLayout.ts` |
| Selector UI | `src/components/VehicleSelector.tsx` |
| Persistence hook | `src/hooks/useVehicleSettings.ts` |
| Runtime switch | `src/car/carModeRuntime.ts` (`setVehicleType`, `toggleVehicleType`, `getCurrentVehicleType`) |
| Cabin rebuild on switch | `src/car/interior/CarInteriorAssembly.ts` |

## Vehicle type rule (SSOT)

```ts
// src/car/VehicleManager.ts — the only place this may be declared.
export type VehicleType = 'sedan' | 'convertible' | 'science-lab' | 'limousine';
```

Variant files import this type; they never declare their own. `ConvertibleMode`
used to carry a private two-value enum, which forced every call site through an
`as any` cast and meant a vehicle could be added here without the variant ever
knowing. That is gone. Pinned by `src/car/__tests__/vehicleTypeSsot.test.ts`.

Future additions noted in `VehicleManager.ts`: `'streetcar' | 'trolley'` — adding
one means adding it to that union and letting the type checker find every switch
that needs a branch.
