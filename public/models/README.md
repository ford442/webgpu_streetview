# Cabin models

Assets here load **only** on the opt-in hero-cabin path (`?gltfInterior=1` or
the Ultra toggle, never on Low quality). The procedural `CarInteriorBuilder`
cabin stays the default everywhere else and is the fallback when a GLB is
missing, fails to load, or lacks a socket.

## `sedan-cabin.glb`

| | |
|---|---|
| Source | `scripts/author-sedan-cabin.mjs` (`npm run gen:hero-cabin`) — parametric three.js geometry (extruded dash/door/console profiles, lathed shifter boot, torus wheel rim and bezels, bevelled seat slabs with stitch seams), written as plain GLB 2.0 |
| License | **CC0 1.0** — original work authored for this repository. No manufacturer CAD, scans, photogrammetry or third-party meshes. |
| Size | ~600 KB raw / ~240 KB gzip, ~19k vertices, 27 nodes, untextured PBR factors |
| Compression | None. Draco / meshopt decoders are not worth their WASM + chunk cost at this size; revisit if a DCC export pushes the file past ~1.5 MB. |
| Frame | Cabin-local metres (`src/car/vehicleLayout.ts`): +X right, +Y up, −Z forward, driver on the left |

Socket nodes (must match `src/car/gltfSockets.ts`; the authoring script and
`src/car/__tests__/gltfInteriorKit.test.ts` both enforce this):

| Socket | Shape | Driven by |
|---|---|---|
| `SteeringWheel` | multi-primitive → `THREE.Group`, tilt baked in node rotation | animator spins `rotation.z` about the column axis |
| `WiperL` / `WiperR` | multi-primitive → `THREE.Group`, rotated into the glass plane | animator sweeps `rotation.z` (park ∓π/6) |
| `SpeedoNeedle` / `TachoNeedle` | single mesh, pivot at dial centre, points +Y at 0 | mirrored from the gauge rig each frame |
| `RearviewGlass`, `SideMirrorL` / `SideMirrorR` | single UV'd quad | `RearviewMirror` (unavailable glass unless the billed rear feed is on) |
| `Windshield` | single UV'd curved quad, direct child of identity `CabinRoot` | `WindowWeatherOverlay` copies its transform; glass is alpha-blended tint only |

Do **not** enable `KHR_materials_transmission` (or any physical transmission)
on the windshield until the compositor samples the HDR intermediate (#273) —
it renders black over the two-canvas stack.

To replace this with a DCC (e.g. Blender) export: keep the socket names and
shapes above, keep the license note here, and point `gen:hero-cabin` at a
validator for the exported file instead of the parametric author.
