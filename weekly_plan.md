# Weekly Plan

## Issues to Fix

### 1. Snow Shader - Snowflakes Falling Upside Down
- **Problem**: Snowflakes are falling upside down, moving toward the top of the screen instead of the bottom
- **Priority**: High
- **Status**: **Resolved** (epic #171) — WebGL fallback used the opposite Y sign vs WebGPU in top-origin UV space; both now use negative Y time (`WEATHER_FALL_Y_SIGN = -1` in `src/car/carSpatialModel.ts`). Verify with `?effect=weather` / `?renderer=webgl&effect=weather`.
- **Notes**: Likely a sign issue in the velocity/gravity calculation within the snow shader

### 2. Night Shader / Rendering Too Dark
- **Problem**: Night shader or another setting has caused everything to render totally dark
- **Priority**: High
- **Status**: **Resolved** (epic #171) — `applyNight` floors retuned to ~14% base / ~18% sky (was ~3% / ~2%); headlights + dome boosted; compute WGSL + WebGL fallback matched. Constants in `carSpatialModel.ts`.
- **Notes**: Investigate night shader uniforms, ambient light levels, or tone mapping settings

### 3. Car Chassis Movement During Free-Look in Cabin
- **Problem**: When free-looking around the cabin and out the windows, the car chassis still moves in ways that fight head look
- **Priority**: High
- **Status**: **Resolved** (epic #171) — free-look left-drag pans head only; RMB/Shift no longer call `applySteering`. Chassis steers only via `carSteer` / temp-steer (wheel grab) / explicit steer keys. World model documented in `carSpatialModel.ts` + AGENTS checklist.
- **Notes**: Want free-look around the cabin without chassis coupling; head should pan independently while the body stays put unless actively steering

### 4. Windshield Wipers Fail to Switch On
- **Problem**: Windshield wipers do not turn on when toggled
- **Priority**: High
- **Status**: **Resolved** (epic #171) — low quality no longer skips all blade feedback; active state holds a raised static "on" pose (`wiperLowQualityOnPose`). Medium+ still runs the full sweep. Toggle always mutates animator via `setWipersActive`.
- **Notes**: Check DashboardUI / car API wiring (`setCarWipers`), CarInterior wiper animation, and control mode guards that may block the toggle

### 5. Rearview Mirror Does Not Show Behind
- **Problem**: Rearview mirror does not yet show the view behind the car
- **Priority**: High
- **Status**: **Resolved (honest unavailable)** (epic #171) — removed fake +180° UV crop of the forward perspective canvas. Glass shows an explicit unavailable state until a billing-aware true-rear feed (option A: second Street View / Static API at `heading+180`) is wired via `setRearAvailable(true)`.
- **Notes**: `RearviewMirror.ts` should render a ~180° behind view from the Street View canvas; verify sampling, UV/heading offset, and texture binding

### 6. Cruise Mode Transition Feel (Pause, No Zoom Animation)
- **Problem**: Cruise mode uses a zoom-style animation; prefer no animation and a hold/pause instead of Google Maps’ blurry zoom
- **Priority**: Medium
- **Notes**: Prefer hold-pause frozen frame (no zoom-blur / zoom-chromatic) over built-in Maps blurry zoom; align cruise hops with hold-pause release, not legacy zoom transitions

### 7. Speedometer Obscures Dashboard — Affix Readout to Dash
- **Problem**: Speedometer readout overlays and obscures the dashboard
- **Priority**: Medium
- **Status**: Deferred to gauge SSOT / compact HUD work (#163 / #164); not part of spatial-correctness epic #171 beyond free-look/wiper/mirror foundation.
- **Notes**: Move / affix the speedometer (and related gauges) to the physical dash so it reads as part of the interior instead of floating over UI

### 8. Shader Modes Design Pass (Rain, Night, Sunset, etc.)
- **Problem**: Weather / time-of-day shader modes (rain, night, sunset, etc.) could use more design work
- **Priority**: Medium
- **Status**: **Partial** (epic #171) — night + snow direction parity landed; broader rain/sunset cohesion polish remains open for a dedicated design pass.
- **Notes**: Polish look and feel of rain, night, sunset/sunrise, fog, and related atmosphere presets — tuning uniforms, color grading, and visual cohesion across modes

---

## Residual / open (track as issues)

| Item | Notes |
|------|-------|
| Cruise hold-pause polish (#6 above) | Hold-pause is shipped; tune feel via `panoramaStability.ts` + probe |
| Gauge SSOT / compact HUD (#7) | See foundation split: `CarModeView` hooks under `src/views/car/` |
| Shader design pass (#8) | Rain/sunset cohesion beyond night/snow parity |
| Foundation module splits | `GlobeView` + `MobileUI` contracts — see latest foundation PR |

For architecture and danger zones, read [`AGENTS.md`](./AGENTS.md) first.
