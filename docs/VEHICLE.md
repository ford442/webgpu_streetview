# Vehicle model

The car's physics: a fixed-step longitudinal + ride model in C++
(`cpp/src/vehicle_module.cpp`, the `veh_*` exports of
`streetview-wasm.simd.wasm`) and the car loop's handle on it
(`src/car/vehicle/`). It replaced `VehicleDynamics.ts`, which guessed a speed
from hop distance and took rpm from a table of shift points.

The model is the **only** implementation (the WASM rule — no JS twin;
`vehicleModel.scan.test.ts` fails if the old tables or a second caller of
`veh_step` reappear).

## Who owns what

| | owner |
| --- | --- |
| target speed (from hops, thrust, the shifter; coast-down after 2.4 s) | `car/vehicle/vehicleSim.ts` — the hop/cruise side of the contract |
| the 120 Hz accumulator (≤ 0.25 s of frame per update) | `vehicleSim.ts` |
| params / state / inputs blocks (Float64Arrays, copied through the scratch arena per call) | `vehicleSim.ts` → `src/wasm/index.ts` |
| throttle and brake (a driver: P on the speed error, feed-forward, acceleration trim) | C++ |
| engine, converter, gearbox, brakes, resistances, body springs, road profile | C++ |
| telemetry for every reader | `vehicleTelemetryStore` (external store, written once per display frame) |
| hop cadence (`gearChainedHopIntervalMs`) | `car/vehicle/hopCadence.ts` — cruise/route code; the sim never asks for a panorama |

The sim makes no Maps calls: hop cadence stays owned by cruise/route code and
`services/maps/callBudget.ts`.

## The model (one fixed step, `h` = 1/120 s)

1. **Pedals** — mode 1 takes throttle/brake from the caller (pads and wheels,
   later); mode 0 runs the built-in driver: it asks for
   `kp · (target − v)` clamped to the variant's comfort limits, feeds forward
   drag + rolling + grade over the acceleration full pedal is taken to give,
   and integrates the error between the asked and the measured acceleration
   into a trim (adapts to gear and converter; no steady-state error; frozen
   while a shift runs). Effort above 0 is throttle, below a 0.4 m/s² coast
   band it is brake. It holds the brake at rest, brakes to a stop before
   changing direction, and the brake is full in P.
2. **Lags** — throttle and brake follow the pedals with first-order lags
   (`throttle_tau`, `brake_tau`): the engine loads up before the speed moves.
3. **Gearbox** — a throttle-dependent shift map on turbine rpm (light/full
   pedal up- and downshift lines, hysteresis so a wavering pedal does not
   hunt), a minimum interval between shifts, straight back to 1st below
   1 m/s, and kickdown as an *event* (armed when the pedal crosses the
   threshold, fired once — at full pedal near top speed it would hunt). A
   shift cuts drive torque to `shift_torque_factor` for `shift_time`.
4. **Converter** — pump torque `C0 (ωe|ωe| − ωt|ωt|)` with `C0` set so the
   pump absorbs the peak torque at the stall speed; torque multiplication
   from the stall ratio down to 1 at the coupling point; negative on the
   overrun (engine braking through the fluid). The lockup clutch closes from
   `lockup_gear` above `lockup_speed` (never while shifting or under kickdown
   pedal) and then the engine is rigidly on the wheels.
5. **Engine** — full-load torque table (8 bins), friction rising with rpm,
   an idle governor (feed-forward + P), a fuel cut above the redline.
   *Load* is the throttle the engine runs (idle governor included, 0 on the
   fuel cut) — the cabin engine's `load` target.
6. **Longitudinal** — drive force, aero `½ρ CdA v|v|`, rolling (smoothed
   through 0), grade; the brake is friction: it can stop the car and hold
   it, never push it backwards. The park pawl holds below 0.3 m/s.
7. **Ride** — pitch (driven by longitudinal acceleration, + nose up), heave
   and roll (lateral acceleration = speed × yaw rate, + right side down) as
   damped springs, semi-implicit Euler. The road profile is a function of
   *distance*: knots every `road_length` metres from a xorshift32 in the
   state, smoothstepped between — a still car has a still body. Body-driving
   accelerations are clamped to ±1.5 g. Nothing consumes the body motion
   yet (slice 3 of the issue: head-offset stores + the horizon uniform).

**Determinism.** IEEE add/sub/mul/div, `sqrt` and comparisons only — no libm
transcendental — under `-ffp-contract=off`. The goldens
(`scripts/gen-wasm-goldens.mjs`, `vehicle` section: every variant's params,
seven scripted drives — standing start, brake stop, kickdown, slalom,
cruise/reverse/park, grade + neutral, hostile inputs) are bit-exact on emcc
SIMD and scalar, g++, clang and clang `-march=x86-64-v3`
(`cpp/tests/vehicle_test.cpp`, `src/wasm/__tests__/wasmGoldenParity.test.ts`).
`n` steps in one call equal `n` calls of one step (≤ 240 per call).

## Blocks

All three are flat doubles; `cpp/include/streetview/abi.h` documents every
index. `sw_veh_params(variant)` fills **params** (64) from the sheets below;
`sw_veh_reset(params, state, speed, selector, seed)` writes a fresh **state**
(32, opaque — persist verbatim); **inputs** (8) are
`[mode, target m/s, throttle, brake, selector (0 P, 1 R, 2 N, 3 D), yaw rad/s (+ left), roughness 0–1, grade]`;
`sw_veh_telemetry` reads **telemetry** (24): speed, rpm, gear, selector,
throttle, brake, load, accelerations, pitch/heave/roll, shifting, the shift
counter, lockup, converter slip, torques, distance, time, turbine rpm,
redline. `car/vehicle/vehicleTelemetry.ts` decodes it.

## Parameter sheets

Held by `src/car/vehicle/vehicleSim.wasm.test.ts` (through the committed
binary) to within 5 %:

| variant | vehicles | mass | engine | gearbox | 0–100 km/h | 100–0 km/h |
| --- | --- | --- | --- | --- | --- | --- |
| 0 sedan | sedan | 1500 kg | 265 N m, 6500 rpm | 6-speed | 8.5 s | 3.1 s |
| 1 sports | convertible, cortianics | 1420 kg | 400 N m, 7200 rpm | 6-speed, close | 4.7 s | 2.8 s |
| 2 limousine | limousine | 2700 kg | 430 N m, 6000 rpm, soft under-damped springs | 6-speed | 10.2 s | 3.5 s |
| 3 van | science-lab | 3200 kg | 400 N m diesel, 4500 rpm | 5-speed | 17.5 s | 3.9 s |

Changing a sheet is an algorithm change: rebuild (`npm run
build:wasm:update`), regenerate the goldens (`npm run gen:wasm-goldens`) and
update this table and the test together.

## Readers

- `useCarDashboardBridge` steps the sim once per display frame (through
  `xr/frameClock.ts`), feeds it the shifter, the car heading (→ yaw rate,
  clamped and eased so a pano hop's snap is not a skid) and the vehicle
  picker, and writes `vehicleTelemetryStore`.
- The 3D cluster (`applyVehicleTelemetry`), `publishCameraSpeed` and the
  cabin engine (`cabinDspParams`: rpm, the model's load, speed) read the
  frame's telemetry directly; the DOM HUD subscribes rate-limited
  (`useVehicleTelemetry(150)`).
- Probe: `window.__VEHICLE__` (also `__SV__.vehicle`) — the latest
  `VehicleTelemetry` (speedKmh, rpm, gear, load, gearIndex, throttle, brake,
  accelMps2, latAccelMps2, pitchRad, heaveM, rollRad, shifting, shiftCount,
  lockup, redlineRpm).

## Not yet

Body motion in the cabin (`?body_motion`), engine synthesis in the worklet,
and gamepad/wheel input with haptics are the later slices of the issue. No
collision, no free steering off the pano graph, no tyre slip model: the car
is still on rails between panoramas.
