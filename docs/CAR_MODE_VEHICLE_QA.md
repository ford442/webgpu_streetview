# Car Mode — Per-Vehicle Visual QA Checklist

Manual checks after changing `VehicleManager`, gauge layout, camera FOV, or steering wheel placement. Run in **car mode** on a WebGPU-capable browser with a valid Maps key.

## Global (all vehicles)

1. **Hide HUD (U)** — lower DOM bar clears; 3D cluster remains readable without a second DOM dial layer.
2. **Seat slider** — default posture sits slightly back from the dash; increasing seat distance reveals more road without losing gauge legibility.
3. **Zoom (scroll)** — windshield frame stays roughly aligned with the Street View panorama at zoom ≈ 1.
4. **Head look** — mouse drag pans view; steering wheel and cluster do not spin with head yaw.
5. **Night drive** — gauge backlight and needle glow remain visible at high `nightIntensity`.

## Night-preset lighting pass

At a location where the real sun is above the horizon, switch **Day → Night → Day**
on sedan and science-lab. Night must fade the direct sun along with the fill and
IBL, not leave a daytime highlight across the dash. Keep headlights on and compare
dome off/on: the cluster stays readable with dome off; dome on adds warm local
illumination rather than competing with sunlight. Returning to Day restores the
sun's direction, colour and weather attenuation. Repeat at Low quality and with
reduced motion; no extra lights, halos or animation are introduced by this pass.

The direct-sun target is `baseSun × (1 − 0.75 × rain) × (1 − effectiveNight)`;
the existing per-frame easing remains. At full daylight sun strength, clear-sky
Day stays at 1.55, half-night is 0.775, and Night targets 0. Existing emitter,
dome, headlight and material values are unchanged.

Keyless software-WebGPU comparison (start `npm start` first):

```bash
node scripts/capture-cabin-look.mjs /tmp/cabin-night-preset \
  'day=night=0&alt=0.6&pitch=-25&frames=60' \
  'night-dome-off=night=1&alt=0.6&hl=1&pitch=-25&frames=60' \
  'night-dome-on=night=1&alt=0.6&hl=1&dome=1&pitch=-25&frames=60'
```

Keep `alt=0.6` in the night shots: the harness otherwise puts the sun below the
horizon and misses the preset/real-sun mismatch. Add `&vehicle=science-lab` for
the clinical cabin. This harness uses a synthetic road and IBL; it does not replace
the live Maps hold-pause, road-headlight and rear-feed checks in `AGENTS.md`.

## Sedan (`standard` layout)

| Check | Pass criteria |
|-------|----------------|
| Lower FOV | Speed/tacho rings sit below centre-line; ≥60% of lower screen shows road/pano |
| Steering wheel | Rim visible at bottom edge but does not cover cluster or horizon |
| Cluster readout | Needles and numerals readable at default seat offset (0.28 m) |
| Cruise hop | Hold-pause transition; cluster needles animate smoothly |

## Convertible (`minimal` layout)

| Check | Pass criteria |
|-------|----------------|
| Sport wheel | Smaller rim (0.14 m); less obstruction when roof open |
| Cluster | Slightly lower/smaller dials than sedan; still readable |
| Roof toggle | Open roof does not clip repositioned gauges |
| Wind deflector | Visible behind seats; does not overlap cluster |

## Science Lab (`lab` layout)

| Check | Pass criteria |
|-------|----------------|
| No analog cluster | `hasGauges: false` — monitors only, no duplicate dials |
| Steering | Compact wheel; lab monitors visible on dash |
| Camera height | Slightly elevated eye (y ≈ 1.28); equipment not in central FOV |

## Limousine (`luxury` layout)

| Check | Pass criteria |
|-------|----------------|
| Driver posture | Further back (default seat 0.32 m); partition/bar not in windshield |
| Wider cluster | Gauges spaced for long dash; needles track speed/RPM |
| FOV | Narrower base FOV (56°) keeps cabin geometry from dominating road view |

## Regression triggers

Re-run this checklist when editing:

- `src/car/VehicleManager.ts`
- `src/car/vehicleLayout.ts`
- `src/car/interior/CarInteriorGauges.ts`
- `src/car/interior/CarInteriorDashboardBuilder.ts`
- `src/car/interior/CarInteriorBuilder.ts` (steering wheel)
- `src/car/CarInterior.ts` / `CarInteriorRenderer.ts` (camera FOV)
