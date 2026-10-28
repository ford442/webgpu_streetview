# WASM Bridge — hot CPU math in C++ → WASM

The app keeps a small WebAssembly module for CPU work that is hot, numeric and
batchable. Everything else stays where it belongs: UI/Maps/state in TypeScript,
pixels in WGSL, cabin geometry in Three.js.

| Workload | Lives in |
|---|---|
| UI, Maps, app state | TypeScript |
| Per-pixel effects | WGSL |
| Car interior | Three.js |
| Batch geodesy, cabin DSP, luma, depth calibration | **C++ → WASM** |
| One-line maths: angles, a single haversine, the 64² dust-noise tile, particle seeds (#341) | TypeScript (`utils/navigation.ts`, `renderer/weatherNoiseTile.ts`, `renderer/weatherParticleSeeds.ts`) |

The committed binary is the **only** implementation of these kernels — on the
main thread, in the AudioWorklet and in Vitest. There is no JS twin:
the app does not render until the binary has loaded, and a binary that fails to
load fails the boot (§4).

---

## 1. Layout

| File | Role |
|---|---|
| `cpp/src/noise_module.cpp` | **algorithm source of truth** (`sw_*`) — Perlin/fBm tiles + particle seeds |
| `cpp/src/geodesy_module.cpp` | haversine, batch haversine, `offset_latlng`, angle helpers, route geometry (`initial_bearing`, `polyline_resample`, `polyline_project`) |
| `cpp/src/audio_module.cpp` | engine PCM, cabin IR |
| `cpp/src/hrtf_module.cpp` | analytic binaural shadow IR pair |
| `cpp/src/luma_module.cpp` | Rec.709 histogram / reduce / box downsample |
| `cpp/src/cabin_dsp_module.cpp` | the cabin audio engine (AudioWorklet, §3a) |
| `cpp/src/depth_module.cpp` | scene-depth calibration: disparity percentiles, ground-calibrated near depth, normalisation + easing (`docs/SCENE_DEPTH.md`) |
| `cpp/src/graph_module.cpp` | A* (`graph_astar`) and nearest node (`graph_nearest`) over the CSR link graph a trip prefetch saves — see `docs/ROAD_TRIPS.md` |
| `cpp/src/bindings.cpp` | raw `extern "C"` wrappers with the canonical export names |
| `cpp/include/streetview_wasm.h` | `sw_*` declarations + per-function contracts |
| `cpp/CMakeLists.txt` | host target (`streetview_cpu`) **and** the Emscripten link flags |
| `cpp/emsdk.version` | pinned Emscripten SDK for CI and local rebuilds |
| `cpp/tests/` | doctest golden-vector tests + the generated goldens |
| `cpp/third_party/doctest/` | vendored single-header test framework (MIT) |
| `scripts/gen-wasm-goldens.mjs` | captures the goldens from the shipping binary |
| `src/wasm/index.ts` | loader (`loadWasmModule`, `requireWasm`), camelCase API |
| `src/renderer/bootWasm.ts` | boot-time load; failures become `WasmLoadError` → `webgpuProbe` stage `wasm` |
| `src/wasm/marshal.ts` | malloc-backed scratch arena every kernel wrapper copies through |
| `src/wasm/useWasmModule.ts` | React hook (`useWasmModule`) for React-side consumers |
| `public/wasm/streetview-wasm.wasm` | committed binary (built from C++ with emcc) |

One build path produces the binary:

```bash
npm run build:wasm             # C++ → wasm via emcc (what CI ships)
node scripts/check-wasm-abi.mjs  # the built binary exports the whole ABI
```

`npm run build` runs `build:wasm` before Vite, and `scripts/verify-build.sh`
fails the build when `public/wasm/streetview-wasm.wasm.sha256` no longer matches
the C++ and build inputs (every `cpp/src/*.cpp`, `streetview_wasm.h`,
`CMakeLists.txt`, `cpp/emsdk.version`, `scripts/build-wasm.sh` — the list lives
in `scripts/wasm-source-hash.mjs`) — i.e. when someone edited the algorithms
or the build and forgot to rebuild.
Locally, if `emcc` is missing but that hash still matches, the committed binary
is reused. CI (`CI=true`) fails without emcc.

The Emscripten SDK version is pinned in `cpp/emsdk.version`, and
`build-wasm.sh` refuses to build with any other `emcc` (different releases
emit different bytes, and CI diffs the committed binary against a rebuild).
`STREETVIEW_ALLOW_EMCC_MISMATCH=1` overrides that for local experiments only.

Installing the pinned SDK (also what `mymindstorm/setup-emsdk` does in CI):

```bash
git clone https://github.com/emscripten-core/emsdk.git /opt/emsdk
PIN=$(tr -d '[:space:]' < cpp/emsdk.version)
/opt/emsdk/emsdk install "$PIN" && /opt/emsdk/emsdk activate "$PIN"
source /opt/emsdk/emsdk_env.sh
npm run build:wasm
# or, without a local SDK:
docker run --rm -v "$(pwd):/src" -w /src emscripten/emsdk bash scripts/build-wasm.sh
```

### Working on the C++

The algorithms build and test with the **system** compiler — no emcc, no
browser, no Node:

```bash
npm run test:cpp        # cmake configure + build + ctest (g++/clang++, -Werror)
npm run test:cpp:asan   # same, with -fsanitize=address,undefined
```

Both compile with `-Wall -Wextra -Wpedantic -Wshadow -Wconversion
-Wdouble-promotion -Werror` (`-DSTREETVIEW_WERROR=OFF` relaxes that while
iterating; `-Wdouble-promotion` is host-only — it flags an f32 value
silently widened into an f64 expression, useful here since the algorithms
mix f32 noise/audio with f64 haversine). C++20. Configuring writes
`cpp/build-host/compile_commands.json`. Only that non-sanitizer `build-host`
tree copies the database to `cpp/compile_commands.json` (a file copy, not a
symlink). `npm run test:cpp:asan` writes `cpp/build-asan/compile_commands.json`
and must not clobber the host copy — otherwise `clang-tidy -p cpp` picks up
`-fsanitize=address,undefined`. The committed `cpp/.clangd` points clangd at
`build-host` directly. `npm run lint:cpp` runs `clang-tidy -p cpp/build-host`
over every translation unit listed in `scripts/lint-cpp.sh` `SOURCES`; CI
(`wasm-cpp-host`) **gates** on it: `cpp/.clang-tidy` sets
`WarningsAsErrors: 'bugprone-*'`; the `modernize-*`/`performance-*`/
`readability-*` checks stay advisory. A deliberate exception takes a
`NOLINTNEXTLINE(check)` with the reason next to it. Do not
commit `compile_commands.json`.

**Link flags** (`cpp/CMakeLists.txt`, both wasm targets):

| Flag | Why |
|---|---|
| `-s STRICT=1` | no deprecated settings or implicit defaults sneak in |
| `-s STACK_SIZE=65536` | explicit; `WASM_STACK_SIZE` in `src/wasm/marshal.ts` must match — the loader checks `emscripten_stack_get_base() - emscripten_stack_get_end()` against it and rejects the binary otherwise, and `wasmAbiLock.test.ts` diffs the two numbers |
| `-s MAXIMUM_MEMORY=134217728` (128 MiB) | caps growth. Sized for the old snapshot path, where `useAppCapture` → `downsample_2d` copied the whole output canvas in (59 MiB at 5K → a 64 MiB arena). Since #341 the picker thumb is canvas-prescaled to ≤ 640×360 (~0.9 MiB) before `downsample_2d` (`renderer/gpuChores/pickerThumb.ts`), so no kernel input is full-resolution |
| `-flto` (Release only) | link-time optimisation; the goldens re-run on both binaries proved it bit-identical |
| `-s ASSERTIONS=1` (Debug only) | a Debug binary imports `wasi_snapshot_preview1` for its messages, so it never loads in the app — host tests and ASan are the debug path |
| `-msimd128` at link (SIMD target) | wasm-opt runs with `--enable-simd` explicitly |

**C++ conventions.** Internal kernels take `std::span` behind the extern "C"
shims (the shims build the spans from pointer + count, and own the null/size
checks); value-returning exports are `SW_NODISCARD`; `bindings.cpp`
`static_assert`s the scalar sizes the TS side packs (`float`/`double`/`unsigned`,
`alignof(double) <= 8`, 32-bit pointers under emscripten), and
`cabin_dsp_module.cpp` asserts its quantum / IR partition layout.

**Adding a translation unit** means adding it in four places: the emcc
`STREETVIEW_WASM_SOURCES` list (both wasm targets build from it), the host
`add_library(streetview_cpu …)`, `SOURCES` in
`scripts/lint-cpp.sh`, and `WASM_SOURCE_FILES` in
`scripts/wasm-source-hash.mjs`. `src/wasm/__tests__/compileCommandsContract.test.ts`
diffs all four against `cpp/src/*.cpp` and fails when one is forgotten.

CMake options:

| Option | Default | Effect |
|---|---|---|
| `STREETVIEW_WERROR` | `ON` | warnings are errors on our sources (never on `third_party/`) |
| `STREETVIEW_SANITIZERS` | `OFF` | ASan + UBSan on the host target |

**Two binaries, one source list.** The emcc build always links two targets
from `STREETVIEW_WASM_SOURCES` with identical flags except `-msimd128`:

| File | Who loads it |
|---|---|
| `public/wasm/streetview-wasm.wasm` (scalar) | the main-thread loader (`loadWasmModule`), and the cabin AudioWorklet when SIMD does not validate or `?cabinDsp=scalar` |
| `public/wasm/streetview-wasm.simd.wasm` | the cabin AudioWorklet (`CabinAudio`), selected with `WebAssembly.validate` on a one-instruction SIMD probe module (`wasmSimdSupported()` in `src/wasm/index.ts`) |

SIMD ships only where it pays: `cabin_dsp_module.cpp`'s FIR is hand-vectorised
with `<wasm_simd128.h>` under `__wasm_simd128__`; everything else is plain C++
the compiler may autovectorize. The main thread stays scalar — #300 measured
~0 % from SIMD on the cold kernels. Neither binary introduces a second
algorithm: WASM SIMD128 has no FMA, we never pass `-ffast-math`, and the FIR's
summation order is canonical (four lane accumulators over `j mod 4`, then
`(a0 + a1) + (a2 + a3)`), so **both binaries reproduce `cpp/tests/goldens.json`
bit for bit** — CI's `build-wasm-emscripten` asserts it with
`gen-wasm-goldens.mjs --compare --wasm public/wasm/streetview-wasm.simd.wasm`,
and `wasmGoldenParity.test.ts` runs every golden on both committed binaries.

---

## 1a. One contract, one implementation

The algorithms exist once, in C++, and are pinned to a **single set of golden
vectors** captured from the shipping binary:

```
public/wasm/streetview-wasm.wasm   (what ships)
            │
            │  scripts/gen-wasm-goldens.mjs   (npm run gen:wasm-goldens)
            ▼
   cpp/tests/goldens.json  +  cpp/tests/goldens_generated.h
            │                          │
            │ Vitest (both binaries)   │ ctest (host CI, no emcc)
            ▼                          ▼
   public/wasm/*.wasm              cpp/src/*_module.cpp
```

- `cpp/tests/*_test.cpp` assert the host C++ against the generated header —
  bit-exact on every f32 path, `1e-12` relative on `haversine` (host libm vs
  the libm emcc linked).
- `src/wasm/__tests__/wasmGoldenParity.test.ts` runs every golden on **both**
  committed binaries (scalar and SIMD) through the TS loader, exactly — no
  tolerances. `src/car/audio/cabinWorklet.test.ts` drives the real worklet
  source with the cabin goldens' keyframes and checks their checksums.
- Vitest instantiates the committed scalar binary once in `src/setupTests.ts`
  (`fs.readFileSync` + `instantiateStreetViewWasm` + `_installWasmModule`), so
  every test that reaches a kernel runs the real `.wasm`. There is no mock.
- The goldens record the binary's SHA-256, so a rebuilt binary with stale
  goldens fails rather than silently re-baselining.

Regenerate with `npm run gen:wasm-goldens` **only** as part of a deliberate
algorithm change, and review the resulting diff — it is the record of what
behaviour changed. CI re-runs the generator and fails on any diff, so goldens
cannot drift from the binary or be hand-edited.

---

## 2. The ABI

The exports are identical in `bindings.cpp`, the CMake export list and the
TypeScript loader (`node scripts/check-wasm-abi.mjs` lists them; the cabin
engine's `dsp_*` family is in §3a):

| Export | TS wrapper | Notes |
|---|---|---|
| `seed(i32)` | `seed` | seeds the internal permutation table |
| `noise2d(f32, f32) → f32` | `noise2d` | Perlin gradient noise, `[-1, 1]` |
| `fill_noise_buffer(ptr, w, h, scale, ox, oy)` | `fillNoiseBuffer` | single-octave tile |
| `fbm2d(x, y, octaves, lacunarity, gain) → f32` | `fbm2d` | normalised by accumulated amplitude, so `[-1, 1]` for any octave count |
| `fill_fbm_buffer(ptr, w, h, scale, ox, oy, octaves, lacunarity, gain)` | `fillFbmBuffer` | fBm tile |
| `fill_particle_seeds(ptr, count, seed)` | `fillParticleSeeds` | 4 floats/particle: x, y, speed, phase |
| `normalize_angle(f32) → f32` | — | no TS caller (#341): `normalizeAngle` is f64 TS in `utils/navigation.ts`; export pending removal |
| `signed_angle_diff(f32, f32) → f32` | — | no TS caller (#341): `signedAngleDiff` is f64 TS in `utils/navigation.ts` (the f32 export rounded headings); export pending removal |
| `haversine(f64 ×4) → f64` | — | no TS caller (#341): one pair is `haversineMeters` (f64 TS, same formula, `utils/navigation.ts`); export pending removal |
| `batch_haversine(ptr, count, out) → f64` | `batchHaversine` | whole polyline in one crossing |
| `offset_latlng(lat, lng, metres, bearing, out2) → void` | `offsetLatLng` | destination point; writes `{lat, lng}` degrees. The only copy of the formula — `historicalImagery.ts` builds its sample ring with it |
| `initial_bearing(f64 ×4) → f64` | `initialBearing` | forward azimuth `[0, 360)`; identical points give 0. `navigation.ts#initialBearing`, cruise and route following dispatch onto it |
| `polyline_resample(in, n, step, out, cap) → i32` | `polylineResample` | evenly spaced points every `step` m along the route (ends kept, longitudes wrapped to `[-180, 180)`); returns the full count like `snprintf` — the loader calls it once to size and once to fill |
| `polyline_project(poly, n, lat, lng, out3) → void` | `polylineProject` | `{segment, along m, signed cross m (+ right)}` of the closest point on the route — "where am I on it, how far off it" |
| `graph_astar(offsets, neighbors, coords, n, edges, from, to, work, out, max) → i32` | `graphAstar` | shortest path over a directed CSR graph (haversine cost + heuristic); `work` is `n × 32` B of arena; returns the path length (`snprintf`-style; -1 unreachable / invalid). Ties break on the lower node index, so paths are bit-stable across scalar, SIMD and the JS twin |
| `graph_nearest(coords, n, lat, lng) → i32` | `graphNearest` | index of the nearest node (ties: lower index), -1 when empty |
| `fill_engine_noise(ptr, count, rpm, load, speed, phase: f64, sampleIndex: f64, sr) → f64` | `fillEngineNoise` | mono f32 engine+road PCM in `[-1, 1]`; returns the next oscillator phase (feed it back, advance `sampleIndex` by `count`) |
| `fill_cabin_ir(ptr, count, vehicle, openness, sr)` | `fillCabinIr` | short cabin impulse response, DC gain normalised to 1 |
| `fill_hrtf(leftPtr, rightPtr, count, azimuthDeg, sr)` | `fillHrtf` | analytic per-ear binaural shadow (ITD + level), not a measured HRTF; identical ears at azimuth 0 |
| `luma_histogram_bt709(rgba, w, h, bins)` | `lumaHistogramBt709` | 256-bin Rec.709 histogram of packed RGBA8 |
| `reduce_luma_bt709(rgba, w, h, out3)` | `reduceLumaBt709` | mean/min/max luma in `[0, 1]` |
| `downsample_2d(src, sw, sh, dst, dw, dh)` | `downsample2d` | integer box-filter downsample, packed RGBA8 |
| `luma_analyze(…)` | `lumaAnalyze` | fused downsample + histogram + exact reduce (gpu-chores CPU path) |
| `depth_percentiles(map, n, lo, hi, scratch, out2)` | `depthPercentiles` | exact order statistics of a ≤ 16384-texel strided sample, non-finite texels skipped |
| `depth_near_depth(nearness, w, h, horizonY) → f64` | `depthNearDepth` | proxy-scale depth of the nearest disparity, median over the bottom-centre road band, clamped to `[0.04, 0.3]` (0.1 when the band is not ground) |
| `depth_normalize(map, n, w, h, horizonY, aligned, sameScene, state3, prev, out)` | `depthNormalize` | percentile stretch → nearness → `q / n` depth, eased across same-scene inferences; `state3` is `{lo, hi, q}` and is updated in place |

Plus the exported `memory`, which the loader needs to marshal buffers.

**Adding an export means touching** the right `cpp/src/*_module.cpp` /
`streetview_wasm.h`,
`bindings.cpp`, `CMakeLists.txt` `EXPORTED_FUNCTIONS`, and the TS loader.
`src/wasm/__tests__/wasmAbiLock.test.ts` fails if any of them drifts, and
`scripts/check-wasm-abi.mjs` fails if the compiled binary is missing a name
`bindings.cpp` declares — otherwise a missing wrapper would only show up as a
`TypeError` at the first call.

Write the algorithm in C++ **first**, in the translation unit for its domain
(noise, geodesy, audio, hrtf, luma, cabin dsp, depth) — never in TypeScript
next to the wrapper, and never in a hand-written `.wat`.

### Determinism and float precision

The emcc binary and host C++ produce **bit-identical** f32 results for the noise,
fBm, particle-seed, angle and engine-PCM exports — `cpp/tests` asserts that with
a `memcmp`, not a tolerance. `haversine`/`batch_haversine` agree to ~1e-12
relative (host libm vs the libm emcc linked).

That only holds if `a*b + c` rounds twice on every compiler. clang fuses it into
one FMA wherever the target has one (aarch64 / Apple Silicon, `-march=x86-64-v3`,
`-march=native`), so `cpp/CMakeLists.txt` passes `-ffp-contract=off` to the emcc
target, the host library and (PUBLIC) the tests. CI's clang `-march=x86-64-v3`
host job exists to keep that flag from silently going away.

**Engine phase.** `fill_engine_noise` carries its oscillator phase in f64,
wrapped to `[0, 1)` every sample, and returns it; the caller feeds it back.
The road noise is a hash of the absolute sample index, so a stream renders the
same bits whatever its block size. The ABI it replaced took the absolute stream
time as an f32: by 10 minutes 84/127 consecutive samples were duplicates
(a staircase waveform), 118/127 by an hour. `cpp/tests` and
`wasmScratchArena.test.ts` render a full simulated hour and require zero.

`haversine` has no WASM-native transcendentals; the Emscripten STANDALONE_WASM
build links `sin`/`cos`/`atan2` statically. The binary's only import is
`env.emscripten_notify_memory_growth` (`ALLOW_MEMORY_GROWTH`), and the loader
calls the reactor's `_initialize` before anything else — which is also what
sets the stack base the scratch check below reads.

### Memory marshalling

emcc's layout is `.data` (statics such as `perm`), then the shadow stack —
which grows **down** from `__stack_pointer`'s initial value (70848 today) —
then the heap. Every kernel wrapper copies its inputs/outputs through one
scratch arena (`createScratchArena`, `src/wasm/marshal.ts`) that the loader
allocates once with the exported `malloc`, so it always sits in the heap above
both. `reserve(bytes)` returns the 8-byte-aligned base, replacing the block
(`free` + a larger `malloc`) when a call needs more; there is no `malloc` per
call. A `reserve` can grow — and so detach — `memory.buffer`: create typed-array
views only after it returns. At load the loader checks the arena against
`emscripten_stack_get_base()` and rejects the binary if it is ever below it. `scripts/gen-wasm-goldens.mjs` uses the same `malloc` path.

Never pass a kernel a fixed offset. Scratch used to live at 64 KiB, inside the
top ~5 KiB of the stack: libm's `sin`/`cos` spill a frame for arguments > π/4,
so `batch_haversine` over more than ~230 points at |lat| > 45° corrupted its own
input (a 12 km route at lat 60° measured 13,480 km).
`wasmScratchArena.test.ts` drives the loader's wrappers over the committed
binary to pin this.

---

## 3. Production consumers

| Consumer | Export | What it does |
|---|---|---|
| `TourPanel` via `src/utils/routeStats.ts` | `batch_haversine` | per-tour route length + longest-hop labels |
| cabin AudioWorklet (`cabinWorkletSource.ts`, car mode) | `dsp_create` / `dsp_set_params` / `dsp_set_ir` / `dsp_render` / `dsp_destroy` / `dsp_max_ir_taps` | the whole car bed + radio, rendered on the audio thread — see §3a |
| `CabinAudio` → `cabinIr.ts` (car mode) | `fill_cabin_ir` | per-vehicle cabin IR (1024–2048 taps) posted to the worklet; roof openness raises its high-frequency transfer and lets the late tail escape |
| `DepthController` (`renderer/depth/depthMath.ts`, `?depth`) | `depth_normalize` / `depth_percentiles` / `depth_near_depth` | turns each network inference into the `r16float` depth texture — see `docs/SCENE_DEPTH.md` |
| `WindAudio` (car mode, oscillator fallback only) | `fill_hrtf` | per-ear IR pair convolved with the wind bed via two `ConvolverNode`s; it stays off while the cabin engine runs (the engine renders the wind) |
| gpu-chores (`GpuChores`, #216) | `luma_analyze` (CPU path), `downsample_2d` (picker thumbs) | fused downsample + histogram + exact reduce for the luma gauge — one copy-in instead of three. WebGPU compute first; WASM when `?no_gpu_compute` or the boot probe failed |

`fill_engine_noise`, `luma_histogram_bt709` and `reduce_luma_bt709` keep their
exports and goldens (the engine voice and the bin rule are shared with
`dsp_render` / `luma_analyze` op for op) but have no production caller left.

Neither do `seed` / `noise2d` / `fbm2d` / `fill_noise_buffer` /
`fill_fbm_buffer` / `fill_particle_seeds` since #341: the 64² dust tile and the
particle seeds are TypeScript (`renderer/weatherNoiseTile.ts`,
`renderer/weatherParticleSeeds.ts`) — a tile every 30 frames and a few thousand
LCG steps are not kernels, and the frame loop no longer waits on the binary to
draw dust. Both reproduce these exports **bit for bit** (the tile rounds every
op to f32 with `Math.fround`; the seeds are exact in f64), which
`weatherNoiseTile.test.ts` / `weatherParticleSeeds.test.ts` assert against the
committed binary, so the look did not move.

### 3a. The cabin engine (#321)

`cpp/src/cabin_dsp_module.cpp` renders the car at audio rate **inside the
AudioWorklet**. `CabinAudio` fetches the chosen binary once
(`loadStreetViewWasmBytes`) and posts a copy of the bytes; the worklet
instantiates them, `dsp_create`s one engine (state `malloc`'d from the module
heap — no globals) and calls `dsp_render` every 128-frame quantum straight into
its output channels. The main thread posts only `params` (every frame) and an
`ir` (when the vehicle or roof changes). There is no PCM queue: the old design
filled 1024-sample blocks on the main thread with ~93 ms queued, so any stall
longer than that was a dropout; now a stall cannot reach the audio thread
(`e2e/cabin-audio.spec.ts` stalls the main thread for 300 ms and asserts zero
underruns on `window.__CABIN_AUDIO_PROBE__`).

> **Do not post a `WebAssembly.Module` to the worklet.** It is structured-
> cloneable on paper, but Chromium will not deserialize one in
> `AudioWorkletGlobalScope`: the port gets `messageerror` and the message
> silently never arrives. Post the bytes (transferred copy). The worklet
> reports `messageerror` as an `error`, and `CabinAudio` falls back.

Per sample: engine (the `fill_engine_noise` voice, f64 phase), road rumble +
hiss + wet-arch spray, a wind band that rises with airspeed (speed + ambient
wind, gusting), granular rain on the roof (drums sealed, splatters open),
wiper thumps (a Taylor-cosine resonator), and the stereo radio from input 0.
Outside sources pass a body-occlusion one-pole set by openness; the wind, and
the radio from the dash speakers (±30°), are placed with the `fill_hrtf`
head-shadow coefficients (`sv_audio::hrtf_shadow` in `cpp/include/audio_kernels.h`).
Then one stereo cabin FIR — uniformly partitioned into 128-tap partitions (the
render quantum), up to 4096 taps, crossfading 256 samples on an IR swap — a
DC blocker and a clamp. Convolution and head shadow are both LTI, so placing
first and convolving once is the same room as convolving every source.

Every parameter has a per-sample one-pole (~40 ms): post at any cadence,
no zipper noise (`cabin_dsp_test.cpp` steps the radio gain and bounds the
per-sample change). Inputs come from `car/audio/cabinParams.ts`: telemetry
(rpm, load, speed — floored at the routed trip's cruise pace), roof and
vehicle, the weather panel (rain → rain on the roof and a wet road, wind) and
live conditions (precipitation keeps the road wet, live wind).

**The radio goes through the cabin.** `audio/carAudioGraph.ts` owns the car's
one AudioContext; the car radio (`AudioAnalyzer({ carCabin: true })` in
`useCabinRadioBinding`) feeds its radio bus, which runs into the worklet's
input while the engine is up (and straight out otherwise). The dash
visualiser taps the post-cabin mix. User volume and the trip-aware retune
crossfade stay on the station's own gain node. The free-look toolbar radio
(`app/useRadioAudio.ts`) has no cabin and stays direct.

**Render budget** (`node scripts/bench-cabin-dsp.mjs`, a wet rainy windy
cruise with the radio on, per 128-frame quantum at 48 kHz, Node 24 / V8 on the
dev VM; the quantum's real-time budget is 2.667 ms):

| IR taps | scalar | SIMD128 | speed-up |
|---|---|---|---|
| 128 | 0.036 ms (1.4 %) | 0.020 ms (0.8 %) | 1.8× |
| 1024 | 0.150 ms (5.6 %) | 0.046 ms (1.7 %) | 3.3× |
| 2048 | 0.281 ms (10.5 %) | 0.074 ms (2.8 %) | 3.8× |
| 4096 | 0.629 ms (23.6 %) | 0.142 ms (5.3 %) | 4.4× |

The acceptance bar was ≥ 1024 taps in ≤ 25 % of the quantum on the scalar
binary. The worklet also posts `renderMsAvg` / `renderMsMax` to the probe
where its scope has a clock (Chromium's AudioWorkletGlobalScope has no
`performance.now`, so there they read null). kissfft was not needed: at these
lengths the partitioned time-domain FIR is well inside budget.

Fallbacks: no AudioWorklet, no WebAssembly, a binary that fails to fetch,
validate or instantiate, or `?cabinDsp=off` → two oscillators through a biquad
(the old fallback). `?cabinDsp=scalar` forces the scalar binary.

Heading-relative **binaural convolution** (`WindAudio`, oscillator fallback only) is `fill_hrtf`, alongside `fill_cabin_ir`
(`cpp/src/hrtf_module.cpp`; `fill_cabin_ir` and the engine bed live in
`cpp/src/audio_module.cpp`). It is an analytic ITD/ILD shadow
model, not a measured HRTF (no `cpp/data/` table). `WindAudio` fans its gain
node into two `ConvolverNode`s (one per ear) recombined via a
`ChannelMergerNode`, rebuilding both `AudioBuffer`s only when
`signedAngleDiff(head, car)` has moved enough to matter. `StereoPannerNode`
remains as the fallback if building the convolver graph throws.

The dust-noise tile and particle seeds that used to live here are TypeScript
since #341 — see `docs/GRAPHICS.md` (§ noise tile detail, GPU precipitation).

---

## 4. Boot and failure

The binary loads in the boot sequence, before the first frame:

- `src/index.tsx` awaits `loadBootWasm()` (`src/renderer/bootWasm.ts`) before
  rendering `<App />` — React code calls kernels from its first effects, so the
  app cannot render without them. On failure it renders `WasmBootFailure`
  instead: `webgpuProbe = { ok: false, stage: 'wasm', reason }` and the same
  blocking `LoadingOverlay` (with Retry) as a failed shader fetch.
- `Renderer.init` starts the same (cached) load in parallel with `bootDevice`
  and the pass/shader inits, and settles them together; a rejection is a
  `WasmLoadError` and publishes the boot failure at stage `wasm`.
- `loadWasmModule()` **rejects** on a missing `WebAssembly`, a failed fetch, an
  invalid module, an unexpected import or a stack-contract mismatch, and
  forgets the rejected promise so Retry (or a later call) fetches again.
- Kernel call sites use `requireWasm()`, which **throws** if the module is not
  loaded yet — a call before boot is a bug, not a degrade path. Code that may
  run pre-boot awaits `loadWasmModule()` instead.
- The cabin AudioWorklet loads its own copy (`loadStreetViewWasmBytes`, SIMD or
  scalar); its oscillator fallback (§3a) covers a missing AudioWorklet, not a
  missing algorithm.

Covered by `src/wasm/__tests__/wasm.test.ts` ("the loader": 404 rejects and
retries, HTML is not a module, bytes are cached),
`Renderer.passIsolation.test.ts` (a 404 fails `init` at stage `wasm`),
`e2e/wasm-boot.spec.ts` (smoke lane: overlay + probe) and
`e2e/gpu-foundation.spec.ts` (`?wasm=missing` on a real device).

---

## 5. Editing checklist

- **Changing an algorithm?** Edit the owning `cpp/src/*_module.cpp` first and run
  `npm run test:cpp` — it will fail against the goldens, which is the point.
  Rebuild (`npm run build:wasm`),
  regenerate (`npm run gen:wasm-goldens`) and re-run `npm run test:cpp && npm test`.
  The golden diff is the behavioural record.
- **New export?** The `cpp/src/*_module.cpp` for its domain (a new one if it
  fits none) + `streetview_wasm.h` + `bindings.cpp` + `CMakeLists.txt`
  + `src/wasm/abi.ts` (API type) + `src/wasm/index.ts` (marshalling wrapper)
  + `wasmAbiLock.test.ts` `EXPECTED_EXPORTS` — then `npm run build:wasm`.
  Add coverage to `cpp/tests/` and vectors to
  `scripts/gen-wasm-goldens.mjs` in the same change; the ABI lock only checks
  that the *name* exists everywhere, not that the maths agrees.
- **Rebuilt the wasm?** Commit `public/wasm/streetview-wasm.wasm` **and** its
  `.sha256`, or `verify-build.sh` fails — and regenerate the goldens, or the
  binary-hash assertions fail.
- **Touching flags?** Re-run `gen-wasm-goldens.mjs --compare` on both binaries
  (CI does); a flag that changes a single bit is dropped, not re-baselined.
- **No new hand-written `.wat` algorithms**, no new `src/**/*.js` application
  code, and no TS re-implementation of a kernel "for tests" — Vitest runs the
  binary.

---

## 6. Compile path (done)

One algorithm source, split one translation unit per domain under `cpp/src/`,
shipped as emcc STANDALONE_WASM.

1. ✅ **Host build + goldens.** `cpp/src/*.cpp` compile and test with the
   system compiler under `-Werror` and sanitizers, against vectors captured
   from the shipping binary.
2. ✅ **Ship path is emcc.** `npm run build:wasm` / `npm run build` compile C++.
   `verify-build.sh` hashes the C++ inputs. SDK pin: `cpp/emsdk.version`.
3. ✅ **WAT retired.** There is no `streetview-wasm.wat`. Do not add one.
4. ✅ **SIMD128 shipped where it pays (#321).** `streetview-wasm.simd.wasm`
   is built from the same sources with `-msimd128` and runs the cabin engine's
   hand-vectorised FIR in the AudioWorklet; CI asserts it reproduces every
   golden bit for bit. The main thread stays on the scalar binary.
5. ✅ **WASM in the AudioWorklet (#321, deferred §3 of #300).** See §3a.
6. ✅ **Fused, exact luma chore (#321, deferred §5 of #300).** `luma_analyze`.
7. ✅ **JS twin deleted; build hardened.** The binary is the only
   implementation (§4); STRICT, LTO, an explicit stack contract and a 128 MiB
   cap; clang-tidy gates on `bugprone-*`; depth calibration moved to
   `depth_module.cpp`.
