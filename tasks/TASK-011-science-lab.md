# TASK-011: Science Lab Vehicle Variant

> **Status: shipped.** Rewritten against the real tree — the original version of
> this file described code that now exists, at `webgpu_streetview/src/...`
> paths that never existed (the repo root *is* `webgpu_streetview`, so source
> paths start at `src/`). Do not re-implement any of the below; extend it.

## Goal

Add a mobile science lab / research vehicle with equipment racks and instrumentation.

## Acceptance Criteria

- [x] Lab vehicle interior (equipment racks, benches, instruments) — `buildEquipmentRack()` in `src/car/variants/scienceLab/scienceLabGeometry.ts`
- [x] Scientific displays showing data (graphs, readouts) — `buildInstrumentDisplays()` plus `src/car/variants/scienceLab/instrumentWidgets.ts`
- [x] Sample storage compartments — `buildSampleStorage()`, `sampleDrawers` in `ScienceLabAtmosphere`
- [x] Different seating arrangement (side-facing bench seats) — the shared `CarInteriorBuilder` builds seating for every vehicle from `seatCount` / `vehicleLayout.ts`; the variant no longer builds its own
- [x] Lab equipment sounds (beeps, fans, machinery) — `src/car/variants/scienceLab/scienceLabAudio.ts`
- [x] Special lighting (UV, task lighting) — `toggleUVLight()` in `src/car/variants/scienceLab/ScienceLabAtmosphere.ts`

## Rendering rule

The lab is a **scene plugin**, not a second cabin. `ScienceLabAtmosphere` adds
its equipment rack to the shared `interior.interiorGroup` and never constructs a
renderer of its own — the orphan `ScienceLabInterior` class that owned a private
`THREE.WebGLRenderer` (which nothing on the live path ever called) was folded
into it and deleted. `src/car/variants/__tests__/atmospherePlugins.test.ts`
greps `src/car/variants/` for `new THREE.WebGLRenderer` and fails if one comes
back. **Do not add one.**

Cabin/pano device unification is separate work — see the `?cabin=webgpu` escape
hatch in `src/car/interior/createCabinRenderer.ts` and the "Car Mode Rendering
Stack" section of `AGENTS.md`.

## Known gaps

- Vehicle switching now runs through `VehicleManager` end to end
  (`setVehicleType('science-lab')` → `ScienceLabAtmosphere.setVehicleType()`),
  but the lab's UV-light and equipment toggles are still only reachable from the
  plugin instance, not from the dashboard UI. Wiring those controls is open.

## Where the code lives

| Concern | File |
|---|---|
| Scene plugin, `LabState`, `toggleUVLight` / `toggleEquipment` / `getState` | `src/car/variants/scienceLab/ScienceLabAtmosphere.ts` |
| Runtime wiring (construct, per-vehicle visibility, update, dispose) | `src/car/runtime/lifecycle.ts`, `src/car/runtime/vehicleSwitch.ts` |
| Geometry builders | `src/car/variants/scienceLab/scienceLabGeometry.ts` |
| Materials | `src/car/variants/scienceLab/scienceLabMaterials.ts` |
| Instrument readouts | `src/car/variants/scienceLab/instrumentWidgets.ts` |
| Equipment audio | `src/car/variants/scienceLab/scienceLabAudio.ts` |

## Vehicle type rule

`VehicleType` is defined **once**, in `src/car/VehicleManager.ts` — `'science-lab'`
is one of its members. Never declare a parallel vehicle enum in a variant file.
Pinned by `src/car/__tests__/vehicleTypeSsot.test.ts`.
