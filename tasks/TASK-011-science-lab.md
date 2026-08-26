# TASK-011: Science Lab Vehicle Variant

> **Status: shipped.** Rewritten against the real tree — the original version of
> this file described code that now exists, at `webgpu_streetview/src/...`
> paths that never existed (the repo root *is* `webgpu_streetview`, so source
> paths start at `src/`). Do not re-implement any of the below; extend it.

## Goal

Add a mobile science lab / research vehicle with equipment racks and instrumentation.

## Acceptance Criteria

- [x] Lab vehicle interior (equipment racks, benches, instruments) — `buildLabBenches` / `buildEquipmentRacks` in `src/car/variants/scienceLab/scienceLabGeometry.ts`
- [x] Scientific displays showing data (graphs, readouts) — `src/car/variants/scienceLab/instrumentWidgets.ts`
- [x] Sample storage compartments — `buildSampleStorage()`, `sampleDrawers` in `ScienceLabInterior`
- [x] Different seating arrangement (side-facing bench seats) — `buildBenchSeating()`
- [x] Lab equipment sounds (beeps, fans, machinery) — `src/car/variants/scienceLab/scienceLabAudio.ts`
- [x] Special lighting (UV, task lighting) — `toggleUVLight()` in `src/car/variants/ScienceLabMode.ts`

## Known gaps

- `ScienceLabInterior` still constructs **its own `THREE.WebGLRenderer`**
  (`src/car/variants/scienceLab/ScienceLabInterior.ts`). That is a second GPU
  context on top of the cabin's, and is tracked by the cabin/pano
  device-unification effort (see the `?cabin=webgpu` escape hatch in
  `src/car/interior/createCabinRenderer.ts` and the "Car Mode Rendering Stack"
  section of `AGENTS.md`). **Do not add more `WebGLRenderer` constructors.**
- Lab mode is driven by its own `initScienceLabMode()` entry point rather than
  going through `VehicleManager` / `carModeRuntime.setVehicleType('science-lab')`
  end to end. Unifying that switch is follow-up work.

## Where the code lives

| Concern | File |
|---|---|
| Public mode API (`initScienceLabMode`, `toggleUVLight`, `getLabState`) | `src/car/variants/ScienceLabMode.ts` |
| Interior class + `LabState` | `src/car/variants/scienceLab/ScienceLabInterior.ts` |
| Geometry builders | `src/car/variants/scienceLab/scienceLabGeometry.ts` |
| Materials | `src/car/variants/scienceLab/scienceLabMaterials.ts` |
| Instrument readouts | `src/car/variants/scienceLab/instrumentWidgets.ts` |
| Equipment audio | `src/car/variants/scienceLab/scienceLabAudio.ts` |

## Vehicle type rule

`VehicleType` is defined **once**, in `src/car/VehicleManager.ts` — `'science-lab'`
is one of its members. Never declare a parallel vehicle enum in a variant file.
Pinned by `src/car/__tests__/vehicleTypeSsot.test.ts`.
