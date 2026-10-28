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

The committed binaries are the **only** implementation of these kernels — on
the main thread, in the AudioWorklet and in Vitest. There is no JS twin:
the app does not render until the binary has loaded, and a binary that fails to
load fails the boot (§4).

---

## 1. Layout

| File | Role |
|---|---|
| `cpp/src/noise_module.cpp` | **algorithm source of truth** (`sw_*`) — Perlin/fBm tiles + particle seeds |
| `cpp/src/geodesy_module.cpp` | batch haversine, `offset_latlng`, route geometry (`initial_bearing`, `polyline_resample`, `polyline_project`) |
| `cpp/src/audio_module.cpp` | engine PCM, cabin IR |
| `cpp/src/hrtf_module.cpp` | analytic binaural shadow IR pair |
| `cpp/src/luma_module.cpp` | Rec.709 histogram / reduce / box downsample |
| `cpp/src/cabin_dsp_module.cpp` | the cabin audio engine and its UPOLS convolver (AudioWorklet, §3a) |
| `cpp/src/depth_module.cpp` | scene-depth calibration: disparity percentiles, ground-calibrated near depth, normalisation + easing (`docs/SCENE_DEPTH.md`) |
| `cpp/src/graph_module.cpp` | A* (`graph_astar`) and nearest node (`graph_nearest`) over the CSR link graph a trip prefetch saves — see `docs/ROAD_TRIPS.md` |
| `cpp/src/runtime.cpp` | `sv_malloc` / `sv_free` / `sv_stack_base` / `sv_stack_end` and the ABI `static_assert`s |
| `cpp/include/streetview/abi.h` | **the ABI**: every export is one `SV_EXPORT(name)` declaration here, with its contract (§2) |
| `cpp/include/streetview/platform.h` | `SV_EXPORT` (export_name + used under emcc, nothing on the host) and the stack-bounds shim — no `#ifdef __EMSCRIPTEN__` anywhere else |
| `cpp/include/streetview/simd.h`, `fft256.h` | the 4-lane `f4` the convolver is written in (wasm SIMD128 / SIMDe / plain struct) and its radix-4 FFT (§3a) |
| `cpp/include/streetview/geodesy.h`, `audio_kernels.h` | internal helpers shared between TUs (not exports) |
| `cpp/CMakeLists.txt` | host targets (`streetview_cpu`, `streetview_cpu_simd`) **and** the three Emscripten binaries |
| `cpp/emsdk.version` | pinned Emscripten SDK for CI and local rebuilds |
| `cpp/tests/` | doctest golden-vector tests + the generated goldens |
| `cpp/fuzz/` | libFuzzer harnesses over the ABI (§1b) |
| `cpp/third_party/doctest/`, `simde/` | vendored test framework (MIT) and a SIMDe v0.8.2 subset (MIT; see its README) |
| `scripts/gen-wasm-abi.mjs` | abi.h → `src/wasm/abi.generated.ts` (`npm run gen:wasm-abi`) |
| `scripts/check-wasm-abi.mjs` | each binary's wasm **type section** vs abi.h, plus the worklet binary's budget |
| `scripts/gen-wasm-goldens.mjs` | captures the goldens from the shipping binary |
| `src/wasm/abi.generated.ts` | generated: `WASM_ABI` (wasm signature + which binaries export it), the typed raw-export interfaces |
| `src/wasm/bindExports.ts` | binds a binary's exports through `WASM_ABI`, checking presence and arity at load |
| `src/wasm/index.ts` | loader (`loadWasmModule`, `requireWasm`), camelCase API |
| `src/renderer/bootWasm.ts` | boot-time load; failures become `WasmLoadError` → `webgpuProbe` stage `wasm` |
| `src/wasm/marshal.ts` | malloc-backed scratch arena every kernel wrapper copies through |
| `src/wasm/useWasmModule.ts` | React hook (`useWasmModule`) for React-side consumers |
| `public/wasm/streetview-wasm.simd.wasm` | committed main-thread binary (every kernel) |
| `public/wasm/streetview-dsp.simd.wasm` | committed worklet binary (the cabin engine alone, §3a) |

One build path produces the binaries, into `cpp/build-emscripten/out/` (never
the tracked tree):

```bash
npm run build:wasm             # build, then report whether public/wasm/ matches
npm run build:wasm:update      # build and copy the shipped binaries into public/wasm/
npm run check:wasm-abi         # abi.generated.ts current + binaries match abi.h by signature
```

`npm run build` runs `build:wasm` (compare only) before Vite, so a build
leaves git clean. `scripts/verify-build.sh` fails the build when
`public/wasm/streetview-wasm.wasm.sha256` no longer matches the C++ and build
inputs (every `cpp/src/*.cpp`, every `cpp/include/streetview/*.h`,
`CMakeLists.txt`, `cpp/emsdk.version`, `scripts/build-wasm.sh` — the list lives
in `scripts/wasm-source-hash.mjs`) — i.e. when someone edited the algorithms
or the build and forgot `build:wasm:update` — and runs `check-wasm-abi` on the
copies in `build/wasm/`. Locally, if `emcc` is missing but that hash still
matches, the committed binaries are reused. CI (`CI=true`) fails without emcc.

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
`build-host` directly. `npm run lint:cpp` checks `clang-format`
(`cpp/.clang-format`: LLVM base, 4-space indent, 100 columns; `npm run
format:cpp` rewrites) over `src/`, `include/streetview/`, `tests/` and `fuzz/`,
then runs `clang-tidy -p cpp/build-host` over every translation unit listed in
`scripts/lint-cpp.sh` `SOURCES`; CI (`wasm-cpp-host`) **gates** on it:
`cpp/.clang-tidy` sets `WarningsAsErrors` to `bugprone-*`, `clang-analyzer-*`
and `performance-*`. `cppcoreguidelines-pro-bounds-*` (271 findings, nearly
all pointer walks over the extern "C" buffers) and `modernize-*` print but do
not fail, until the kernels take `std::span` end to end. A second tidy pass
runs over `cpp/build-emscripten`'s database (the wasm32 `-msimd128` compile,
which takes the `<wasm_simd128.h>` branches) — but it has to parse emsdk's
libc++, which needs a clang-tidy within one major of emsdk's LLVM (24 for
6.0.6). Set `EM_CLANG_TIDY`; with an older one the pass is skipped with a
note. A deliberate exception takes a `NOLINTNEXTLINE(check)` with the reason
next to it. Do not commit `compile_commands.json`.

**Link flags** (`cpp/CMakeLists.txt`):

| Flag | Why |
|---|---|
| `-sSTRICT=1` | no deprecated settings or implicit defaults sneak in |
| `-sSTACK_SIZE=65536` (main) | explicit; `WASM_STACK_SIZE` in `src/wasm/marshal.ts` must match — the loader checks `sv_stack_base() - sv_stack_end()` against it and rejects the binary otherwise, and `wasmAbiLock.test.ts` diffs the two numbers |
| `-sMAXIMUM_MEMORY=134217728` (128 MiB, main) | caps growth. Sized for the old snapshot path, where `useAppCapture` → `downsample_2d` copied the whole output canvas in (59 MiB at 5K → a 64 MiB arena). Since #341 the picker thumb is canvas-prescaled to ≤ 640×360 (~0.9 MiB) before `downsample_2d` (`renderer/gpuChores/pickerThumb.ts`), so no kernel input is full-resolution |
| `-sINITIAL_MEMORY=1 MiB -sALLOW_MEMORY_GROWTH=0 -sSTACK_SIZE=16384 -sMALLOC=emmalloc` (dsp) | the worklet binary's memory is fixed: `check-wasm-abi` fails it on any `memory.grow` instruction, any import, or ≥ 32 KB |
| `-msimd128 -mbulk-memory -mnontrapping-fptoint -msign-ext -mmutable-globals` | the pinned feature set, on compile **and** link of every shipped binary (so wasm-opt validates against the same set); never `-mrelaxed-simd` |
| `-flto` (Release only) | link-time optimisation; the goldens re-run on every binary proved it bit-identical |
| `-sASSERTIONS=1` (Debug only) | a Debug binary imports `wasi_snapshot_preview1` for its messages, so it never loads in the app — host tests and ASan are the debug path |

**Browser floor.** Shipping only SIMD128 builds sets the floor at the
intersection of those features: Chrome/Edge 91, Firefox 89, Safari 16.4 —
every browser with WebGPU is above it. `fetchWasmBytes` validates a
one-instruction SIMD module first, so an older engine fails the boot with a
readable "lacks WebAssembly SIMD128" instead of a compile error.

**C++ conventions.** Every export is declared once in `abi.h` with
`SV_EXPORT(name)` and defined `extern "C"` in its domain TU — there is no
wrapper file and no `EXPORTED_FUNCTIONS` list. Internal kernels take
`std::span` behind the extern "C" entry points (which own the null/size
checks); value-returning exports are `SW_NODISCARD`; `runtime.cpp`
`static_assert`s the scalar sizes the TS side packs (`float`/`double`/`unsigned`,
`alignof(double) <= 8`, 32-bit pointers on wasm), and `cabin_dsp_module.cpp`
asserts its quantum / partition layout. No kernel allocates or sorts on a
call: depth percentiles and the ground median are exact radix selects
(§2), the convolver's state is one `sv_malloc` at `dsp_create`.

**Adding a translation unit** means adding it in three places: the CMake
`STREETVIEW_SOURCES` list (the host libraries and both main wasm targets build
from it; `STREETVIEW_DSP_SOURCES` too if the worklet needs it), `SOURCES` in
`scripts/lint-cpp.sh`, and `WASM_SOURCE_FILES` in
`scripts/wasm-source-hash.mjs` (with any new `streetview/*.h`).
`src/wasm/__tests__/compileCommandsContract.test.ts` diffs them against
`cpp/src/*.cpp` and fails when one is forgotten.

CMake options:

| Option | Default | Effect |
|---|---|---|
| `STREETVIEW_WERROR` | `ON` | warnings are errors on our sources (never on `third_party/`) |
| `STREETVIEW_SANITIZERS` | `OFF` | ASan + UBSan on the host libraries (and the emcc test build) |
| `STREETVIEW_WASM_TESTS` | `OFF` | under `emcmake`: build the doctest suite as `-msimd128` wasm and run it with node (§1b) |
| `STREETVIEW_FUZZ` | `OFF` | host clang: the libFuzzer harnesses in `cpp/fuzz/` (§1b) |

**Three binaries, one source list.** The emcc build links:

| File | Built from | Who loads it |
|---|---|---|
| `streetview-wasm.simd.wasm` | `STREETVIEW_SOURCES`, SIMD128 | the main-thread loader (`loadWasmModule`) — shipped |
| `streetview-dsp.simd.wasm` | `STREETVIEW_DSP_SOURCES` (`cabin_dsp_module.cpp` + `runtime.cpp`), SIMD128, fixed memory | the cabin AudioWorklet (`CabinAudio`) — shipped, ~20 KB |
| `streetview-wasm.wasm` | `STREETVIEW_SOURCES`, no SIMD | **CI only**: the scalar oracle, never deployed (`verify-build.sh` fails a build that contains it) |

A binary exports exactly the `SV_EXPORT`s of the TUs it links — `export_name`
does that per definition — so the DSP binary carries `dsp_*` and the runtime,
nothing else. SIMD is hand-written only in the convolver (`simd.h`'s `f4`,
§3a); everything else is plain C++ the compiler may autovectorize. No binary
introduces a second algorithm: SIMD128 has no FMA, we never pass
`-ffast-math`, and every reduction order is fixed by the source, so **every
binary reproduces `cpp/tests/goldens.json` bit for bit** — CI's
`build-wasm-emscripten` captures nothing new: it diffs the rebuilt shipped
binaries against the committed ones and runs
`gen-wasm-goldens.mjs --compare --wasm cpp/build-emscripten/out/streetview-wasm.wasm`
on the scalar oracle.

---

## 1a. One contract, one implementation

The algorithms exist once, in C++, and are pinned to a **single set of golden
vectors** captured from the shipping binary:

```
public/wasm/streetview-wasm.simd.wasm   (what ships)
            │
            │  scripts/gen-wasm-goldens.mjs   (npm run gen:wasm-goldens)
            ▼
   cpp/tests/goldens.json  +  cpp/tests/goldens_generated.h
      │            │                 │
      │ Vitest     │ --compare (CI)  │ ctest: g++, clang, x86-64-v3, ASan/UBSan,
      ▼            ▼                 ▼        SIMDe, emcc -msimd128 under node
  main + dsp   scalar oracle     cpp/src/*_module.cpp
```

- `cpp/tests/*_test.cpp` assert the host C++ against the generated header —
  bit-exact on every f32 path, `1e-12` relative on the haversine (host libm vs
  the libm emcc linked). The suite runs twice per host build: `streetview_cpu_tests`
  (plain `f4` struct) and `streetview_simd_tests` (the `<wasm_simd128.h>` path
  through SIMDe, §1b) — both bit-exact.
- `src/wasm/__tests__/wasmGoldenParity.test.ts` runs every golden on the
  committed main binary through the TS loader, exactly — no tolerances.
  `src/car/audio/cabinWorklet.test.ts` drives the real worklet source on the
  committed DSP binary with the cabin goldens' keyframes and checks their
  checksums.
- Vitest instantiates the committed main binary once in `src/setupTests.ts`
  (`fs.readFileSync` + `instantiateStreetViewWasm` + `_installWasmModule`), so
  every test that reaches a kernel runs the real `.wasm`. There is no mock.
- The goldens record the binary's SHA-256, so a rebuilt binary with stale
  goldens fails rather than silently re-baselining.

Regenerate with `npm run gen:wasm-goldens` **only** as part of a deliberate
algorithm change, and review the resulting diff — it is the record of what
behaviour changed. CI re-runs the generator and fails on any diff, so goldens
cannot drift from the binary or be hand-edited.

## 1b. Sanitizers and fuzzing

- **Host ASan/UBSan** (`npm run test:cpp:asan`, CI `wasm-cpp-host`): both
  host libraries, so the SIMD source path runs instrumented too —
  `streetview_cpu_simd` compiles `simd.h`'s wasm intrinsics through
  [SIMDe](../cpp/third_party/simde/README.md), whose SSE mapping is IEEE-exact
  for every op the convolver uses (that is why the goldens hold natively).
- **wasm ASan/UBSan** (`npm run test:wasm:sanitizers`, CI `wasm-sanitizers`):
  `emcmake … -DSTREETVIEW_WASM_TESTS=ON -DSTREETVIEW_SANITIZERS=ON` builds the
  doctest suite with the shipped feature set and `-fsanitize=address,undefined`
  and runs it under node — the real `wasm_simd128.h`, not SIMDe.
- **libFuzzer** (`npm run fuzz:cpp`, nightly `cpp-fuzz` in
  `nightly-probe.yml`, 60 s per target): `cpp/fuzz/` harnesses for
  `luma_analyze` + `downsample_2d` (+ the histogram/reduce), `polyline_project`,
  the cabin engine (`dsp_set_ir` of any length incl. > 16384 and non-finite
  taps, raw `dsp_set_params`, `dsp_render` of any frame count; every output
  sample must be finite and in [-1, 1]) and `depth_*`. Inputs take floats as
  raw bits, so NaN/inf/denormals reach every kernel; buffers are exactly the
  size abi.h documents, so ASan sees any overrun. Corpora are cached between
  nights, crashes are uploaded and open a `regression` issue.

---

## 2. The ABI

`cpp/include/streetview/abi.h` is the single declaration of the ABI. Each
export is one `SV_EXPORT(name)` declaration there; `scripts/gen-wasm-abi.mjs`
parses those into `src/wasm/abi.generated.ts`:

- `WASM_ABI`: per export, the wasm param/result types (`int`, pointers,
  `size_t` → `i32`; `float` → `f32`; `double` → `f64`) and which binaries
  export it (from the CMake source lists);
- `StreetViewWasmExports` / `StreetViewDspExports`: typed raw-export
  interfaces with the C declaration as each member's doc.

Three checks keep everything on it:

| Check | Catches |
|---|---|
| `wasmAbiLock.test.ts` + `gen-wasm-abi --check` (in `npm run verify`) | abi.h changed, `abi.generated.ts` not regenerated |
| `check-wasm-abi.mjs` (verify, `verify-build.sh`, CI) | a committed binary's **type section** differs from abi.h — a changed param type, an added/dropped param, a missing or undeclared export; the worklet binary growing memory, importing anything, or reaching 32 KB |
| `bindWasmExports` at load (`src/wasm/bindExports.ts`, and the same table inlined into the worklet) | a binary whose exports are missing or have the wrong arity (an exported wasm function's `length` is its param count), in every browser, before any kernel runs |

`wasmAbiLock.test.ts` also proves the chain end to end: it narrows
`fill_engine_noise`'s `double phase` to `float` in a scratch copy of abi.h and
asserts both the generator diff and the type-section mismatch.

The exports (the cabin engine's `dsp_*` family is in §3a):

| Export | TS wrapper | Notes |
|---|---|---|
| `seed(i32)` | `seed` | seeds the internal permutation table |
| `noise2d(f32, f32) → f32` | `noise2d` | Perlin gradient noise, `[-1, 1]` |
| `fill_noise_buffer(ptr, w, h, scale, ox, oy)` | `fillNoiseBuffer` | single-octave tile |
| `fbm2d(x, y, octaves, lacunarity, gain) → f32` | `fbm2d` | normalised by accumulated amplitude, so `[-1, 1]` for any octave count |
| `fill_fbm_buffer(ptr, w, h, scale, ox, oy, octaves, lacunarity, gain)` | `fillFbmBuffer` | fBm tile |
| `fill_particle_seeds(ptr, count, seed)` | `fillParticleSeeds` | 4 floats/particle: x, y, speed, phase |
| `batch_haversine(ptr, count, out) → f64` | `batchHaversine` | whole polyline in one crossing |
| `offset_latlng(lat, lng, metres, bearing, out2) → void` | `offsetLatLng` | destination point; writes `{lat, lng}` degrees. The only copy of the formula — `historicalImagery.ts` builds its sample ring with it |
| `initial_bearing(f64 ×4) → f64` | `initialBearing` | forward azimuth `[0, 360)`; identical points give 0. `navigation.ts#initialBearing`, cruise and route following dispatch onto it |
| `polyline_resample(in, n, step, out, cap) → i32` | `polylineResample` | evenly spaced points every `step` m along the route (ends kept, longitudes wrapped to `[-180, 180)`); returns the full count like `snprintf` — the loader calls it once to size and once to fill |
| `polyline_project(poly, n, lat, lng, out3) → void` | `polylineProject` | `{segment, along m, signed cross m (+ right)}` of the closest point on the route — "where am I on it, how far off it" |
| `graph_astar(offsets, neighbors, coords, n, edges, from, to, work, out, max) → i32` | `graphAstar` | shortest path over a directed CSR graph (haversine cost + heuristic); `work` is `n × 32` B of arena; returns the path length (`snprintf`-style; -1 unreachable / invalid). Ties break on the lower node index, so paths are bit-stable across every build |
| `graph_nearest(coords, n, lat, lng) → i32` | `graphNearest` | index of the nearest node (ties: lower index), -1 when empty |
| `fill_engine_noise(ptr, count, rpm, load, speed, phase: f64, sampleIndex: f64, sr) → f64` | `fillEngineNoise` | mono f32 engine+road PCM in `[-1, 1]`; returns the next oscillator phase (feed it back, advance `sampleIndex` by `count`) |
| `fill_cabin_ir(ptr, count, vehicle, openness, sr)` | `fillCabinIr` | short cabin impulse response, DC gain normalised to 1 |
| `fill_hrtf(leftPtr, rightPtr, count, azimuthDeg, sr)` | `fillHrtf` | analytic per-ear binaural shadow (ITD + level), not a measured HRTF; identical ears at azimuth 0 |
| `luma_histogram_bt709(rgba, w, h, bins)` | `lumaHistogramBt709` | 256-bin Rec.709 histogram of packed RGBA8 |
| `reduce_luma_bt709(rgba, w, h, out3)` | `reduceLumaBt709` | mean/min/max luma in `[0, 1]` |
| `downsample_2d(src, sw, sh, dst, dw, dh)` | `downsample2d` | integer box-filter downsample, packed RGBA8 |
| `luma_analyze(…)` | `lumaAnalyze` | fused downsample + histogram + exact reduce (gpu-chores CPU path) |
| `depth_percentiles(map, n, lo, hi, out2)` | `depthPercentiles` | exact order statistics of a ≤ 16384-texel strided sample, non-finite texels skipped — an O(n) MSD radix select over the floats' order-preserving bit keys (four 256-bin passes, 1 KiB of stack), so no scratch and no sort; the same values a sort reads (`depth_test.cpp` checks it against `std::sort`) |
| `depth_near_depth(nearness, w, h, horizonY) → f64` | `depthNearDepth` | proxy-scale depth of the nearest disparity, median over the bottom-centre road band (the same radix select over f64 keys, recomputing the band per pass instead of storing it), clamped to `[0.04, 0.3]` (0.1 when the band is not ground) |
| `depth_normalize(map, n, w, h, horizonY, aligned, sameScene, state3, prev, out)` | `depthNormalize` | percentile stretch → nearness → `q / n` depth, eased across same-scene inferences; `state3` is `{lo, hi, q}` and is updated in place |

Plus the runtime (`runtime.cpp`): `sv_malloc` / `sv_free` (every caller-owned
block — the loader's arena, the worklet's I/O, the golden generator's scratch)
and `sv_stack_base` / `sv_stack_end`; and the exported `memory`. emcc adds
`_initialize`, `_emscripten_stack_restore` and `emscripten_stack_get_current`
to every reactor; `check-wasm-abi` allows exactly those.

**Adding an export means** declaring it in `abi.h` with `SV_EXPORT(name)`,
defining it in its TU, `npm run gen:wasm-abi`, a wrapper in `src/wasm/index.ts`
(+ the API type in `src/wasm/abi.ts`), and `npm run build:wasm:update`. Nothing
else lists names; forgetting a step fails `npm run verify`.

Write the algorithm in C++ **first**, in the translation unit for its domain
(noise, geodesy, audio, hrtf, luma, cabin dsp, depth) — never in TypeScript
next to the wrapper, and never in a hand-written `.wat`.

### Determinism and float precision

The emcc binaries and host C++ produce **bit-identical** f32 results for the
noise, fBm, particle-seed, engine-PCM and cabin-engine exports — `cpp/tests`
asserts that with a `memcmp`, not a tolerance. `batch_haversine` agrees to
~1e-12 relative (host libm vs the libm emcc linked).

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

The haversine has no WASM-native transcendentals; the Emscripten STANDALONE_WASM
build links `sin`/`cos`/`atan2` statically. The main binary's only import is
`env.emscripten_notify_memory_growth` (`ALLOW_MEMORY_GROWTH`); the DSP binary
has none. The loader calls the reactor's `_initialize` before anything else —
which is also what sets the stack base the scratch check below reads.

### Memory marshalling

emcc's layout is `.data` (statics such as `perm`), then the shadow stack —
which grows **down** from `__stack_pointer`'s initial value (70848 today) —
then the heap. Every kernel wrapper copies its inputs/outputs through one
scratch arena (`createScratchArena`, `src/wasm/marshal.ts`) that the loader
allocates once with `sv_malloc`, so it always sits in the heap above
both. `reserve(bytes)` returns the 8-byte-aligned base, replacing the block
(`sv_free` + a larger `sv_malloc`) when a call needs more; there is no
allocation per call. A `reserve` can grow — and so detach — `memory.buffer`: create typed-array
views only after it returns. The arena also shrinks (#341): after
`SCRATCH_IDLE_SHRINK_MS` (1 s) with no reservation above the 64 KiB default it
frees the big block and re-allocates the default (`shrinkTo`), driven by one
`setTimeout` armed only while it is large. Wasm memory itself never shrinks —
the region just goes back to the allocator. `capacity` / `highWaterBytes` are
exposed for tests (`_scratchArenaOf(api)`); `wasmScratchArena.test.ts` asserts
the idle shrink and that a normal frame's kernels stay ≤ 1 MiB. At load the loader checks the arena against
`sv_stack_base()` and rejects the binary if it is ever below it. `scripts/gen-wasm-goldens.mjs` uses the same `sv_malloc` path.

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
| cabin AudioWorklet (`cabinWorkletSource.ts`, car mode) | `dsp_create` / `dsp_set_params` / `dsp_set_ir` / `dsp_render` / `dsp_destroy` / `dsp_max_ir_taps` (from `streetview-dsp.simd.wasm`) | the whole car bed + radio, rendered on the audio thread — see §3a |
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
AudioWorklet**, from its own binary: `streetview-dsp.simd.wasm` links only that
TU and `runtime.cpp` (~20 KB), uses emmalloc and a fixed 1 MiB memory with no
`memory.grow` instruction and no imports — the real-time thread can never
grow memory, so the worklet builds its typed-array views once. `CabinAudio`
fetches it once (`loadStreetViewWasmBytes('dsp')`) and posts a copy of the
bytes; the worklet instantiates them, checks every export against abi.h's
arity table (inlined from `abi.generated.ts`), `dsp_create`s one engine (state
`sv_malloc`'d — no globals) and calls `dsp_render` every 128-frame quantum
straight into its output channels.

Targets reach it without a message per frame where they can: on a
cross-origin isolated page (dev and prod both send COOP/COEP) `CabinAudio`
posts a 64-byte `SharedArrayBuffer` once (`car/audio/cabinParamRing.ts`) and
writes every frame's targets into it under a seqlock — sequence odd while
writing, even when settled; the worklet reads it at the top of each quantum,
applies a set only when the sequence is even, new, and unchanged after the
copy (a torn read is retried next quantum). Without isolation it posts
`params` messages, as before. `__CABIN_AUDIO_PROBE__.paramTransport` says
which (`shared-ring` / `message`); `binary` and `memoryBytes` say what the
worklet runs. The main thread also posts an `ir` when the vehicle or roof
changes. There is no PCM queue: the old design
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
head-shadow coefficients (`sv_audio::hrtf_shadow` in `cpp/include/streetview/audio_kernels.h`).
Then one stereo cabin convolution (below), a DC blocker and a clamp.
Convolution and head shadow are both LTI, so placing first and convolving once
is the same room as convolving every source.

**The convolver (#341): uniformly partitioned overlap-save (UPOLS).** Up to
`kMaxIrTaps` = 16384 taps, as 128 partitions of 128 (the render quantum):

- **Partition 0 is direct-form**: a 128-tap FIR over the current quantum, so
  the output has zero added latency. It is the old hand-vectorised FIR
  (`fir_dot4`, four lane accumulators, `(a0 + a1) + (a2 + a3)`).
- **Partitions 1…127 are in the frequency domain**: at every 128-sample
  boundary the last 256 input samples are transformed once (FFT-256) into a
  128-slot frequency-domain delay line; the spectral MAC over every
  partition's precomputed spectrum and one inverse FFT give the next
  quantum's tail (the overlap-save half). Stereo costs one complex FFT, not
  two: the IR is real, so `x_L + i·x_R` convolves both channels at once and
  the real/imaginary parts of the result are L/R. The inverse is the forward
  transform with re/im swapped; the 1/256 is folded into the stored spectra
  (an exact power of two).
- **The FFT is in-house** (`streetview/fft256.h`): a fixed 256-point radix-4
  Stockham on split re/im arrays over `f4`, constexpr twiddles (Taylor series
  in double, rounded once), one canonical complex-multiply order, unit
  twiddles skipped identically on every build, no FMA. Not PFFFT/KissFFT:
  their SIMD and scalar paths sum in different orders, and the goldens are
  compared bit for bit across the scalar oracle, both SIMD binaries, SIMDe and
  the plain host build.
- **An IR swap convolves once.** Each delay-line slot remembers which of two
  IR buffers was current when its input arrived; the tail always uses that
  one, so input already in flight decays through the old room's tail and new
  input enters the new room — no second convolution running in parallel, no
  crossfade of two outputs. Partition 0 cannot do that (it is the present),
  so it glides from the old 128 taps to the new over 1024 frames, re-
  interpolating every 16 (64 steps). `dsp_set_ir` costs one FFT per new
  partition, off the render path; a third swap inside the window retags the
  slots that still point at the buffer being overwritten.
- Chunks end at absolute partition boundaries, so the output is independent
  of how a caller splits its `dsp_render` calls (`cabin_dsp_test.cpp`).
  `convolver_test.cpp` checks the FFT against an f64 DFT, UPOLS against an
  f64 direct convolution (128 … 16384 taps), the swap semantics, a click-free
  swap, and the cap.

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

**Render budget** (`npm run bench:cabin-dsp -- --before <old.wasm>`, a wet
rainy windy cruise with the radio on, per 128-frame quantum at 48 kHz, fastest
of 5 rounds, Node 24 / V8 on the dev VM; the quantum's real-time budget is
2.667 ms). "Before" is the pre-#341 SIMD binary (time-domain partitioned FIR,
4096-tap cap); "conv" is the quantum minus the same binary with the identity
IR, i.e. the convolution alone — the bed synthesis is ~0.013 ms in both:

| IR taps | after: quantum | after: conv | swap quanta | `dsp_set_ir` | before: quantum | before: conv | speed-up: quantum | speed-up: conv |
|---|---|---|---|---|---|---|---|---|
| 128 | 0.0153 ms (0.6 %) | 0.0020 ms | 1.05× steady | 0.006 ms | 0.0155 ms | 0.0020 ms | 1.0× | 1.0× |
| 1024 | 0.0155 ms (0.6 %) | 0.0022 ms | 1.07× | 0.014 ms | 0.0381 ms | 0.0246 ms | 2.5× | 11.2× |
| 2048 | 0.0192 ms (0.7 %) | 0.0059 ms | 1.02× | 0.019 ms | 0.0638 ms | 0.0503 ms | 3.3× | **8.6×** |
| 4096 | 0.0196 ms (0.7 %) | 0.0063 ms | 1.12× | 0.036 ms | 0.1236 ms | 0.1101 ms | 6.3× | 17.4× |
| 8192 | 0.0264 ms (1.0 %) | 0.0132 ms | 0.96× | 0.055 ms | — | — | — | — |
| 16384 | 0.0401 ms (1.5 %) | 0.0268 ms | 0.97× | 0.119 ms | — | — | — | — |

#341's bar was ≥ 8× fewer cycles at 2048 taps: the convolution is 8.6×; the
whole quantum is 3.3× because the bed (engine, road, wind, rain, wipers,
radio placement — untouched here) is now most of it. The 8 quanta after an IR
swap (the direct partition's glide) cost 0.96–1.12× a steady quantum — within
the run-to-run spread, and against the old design's 2× (two FIRs during the
crossfade). The worklet also posts `renderMsAvg` / `renderMsMax` to the probe
where its scope has a clock (Chromium's AudioWorkletGlobalScope has no
`performance.now`, so there they read null).

Fallbacks: no AudioWorklet, no WebAssembly, a binary that fails to fetch,
validate or instantiate (or fails its ABI check), or `?cabinDsp=off` → two
oscillators through a biquad (the old fallback).

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
- The cabin AudioWorklet loads its own binary (`loadStreetViewWasmBytes('dsp')`);
  its oscillator fallback (§3a) covers a missing AudioWorklet, not a missing
  algorithm.
- `loadWasmModule()` binds the exports through `bindWasmExports` (§2): a
  binary that drifted from abi.h fails the boot at stage `wasm` with one
  message listing every mismatch.

Covered by `src/wasm/__tests__/wasm.test.ts` ("the loader": 404 rejects and
retries, HTML is not a module, bytes are cached),
`Renderer.passIsolation.test.ts` (a 404 fails `init` at stage `wasm`),
`e2e/wasm-boot.spec.ts` (smoke lane: overlay + probe) and
`e2e/gpu-foundation.spec.ts` (`?wasm=missing` on a real device).

---

## 5. Editing checklist

- **Changing an algorithm?** Edit the owning `cpp/src/*_module.cpp` first and run
  `npm run test:cpp` — it will fail against the goldens, which is the point.
  Rebuild (`npm run build:wasm:update`),
  regenerate (`npm run gen:wasm-goldens`) and re-run `npm run test:cpp && npm test`.
  The golden diff is the behavioural record. Run `npm run lint:cpp` (format +
  tidy) and, for anything touching buffers, `npm run fuzz:cpp`.
- **New export?** `SV_EXPORT(name)` + contract in `abi.h`, the definition in the
  `cpp/src/*_module.cpp` for its domain (a new TU if it fits none — §1),
  `npm run gen:wasm-abi`, `src/wasm/abi.ts` (API type) + `src/wasm/index.ts`
  (marshalling wrapper), then `npm run build:wasm:update`. Add coverage to
  `cpp/tests/` and vectors to `scripts/gen-wasm-goldens.mjs` in the same
  change; the ABI checks lock the *signature*, not the maths.
- **Rebuilt the wasm?** Commit `public/wasm/streetview-wasm.simd.wasm`,
  `streetview-dsp.simd.wasm` **and** the `.sha256`, or `verify-build.sh`
  fails — and regenerate the goldens, or the binary-hash assertions fail.
- **Touching flags?** Re-run `gen-wasm-goldens.mjs --compare --wasm` on the
  scalar oracle (CI does) and `npm run test:wasm:sanitizers`; a flag that
  changes a single bit is dropped, not re-baselined.
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
4. ✅ **SIMD128 shipped where it pays (#321).** Since #341 every shipped
   binary is SIMD128 (pinned feature set, §1); the scalar build is CI's
   oracle only.
5. ✅ **WASM in the AudioWorklet (#321, deferred §3 of #300).** See §3a.
6. ✅ **Fused, exact luma chore (#321, deferred §5 of #300).** `luma_analyze`.
7. ✅ **JS twin deleted; build hardened.** The binary is the only
   implementation (§4); STRICT, LTO, an explicit stack contract and a 128 MiB
   cap; depth calibration moved to `depth_module.cpp`.
8. ✅ **Round 3 (#341).** One signature-locked ABI (`abi.h` → generated TS,
   type-section checks); no `#ifdef` wall (`platform.h`); the UPOLS convolver
   with an in-house FFT (§3a); the fixed-memory worklet binary and the
   `SharedArrayBuffer` param ring; SIMD-only shipping; SIMDe + wasm sanitizer
   + nightly libFuzzer coverage (§1b); no allocating kernels; trivia back in
   f64 TypeScript; builds out of tree; `.clang-format` and wider tidy gating.
   Not done: a `pano_module.cpp` (the optional slice) — no pano-side kernel
   measured hot enough to justify a TU.
