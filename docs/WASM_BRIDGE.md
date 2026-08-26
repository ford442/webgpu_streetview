# WASM Bridge — hot CPU math in C++ → WASM

The app keeps a small WebAssembly module for CPU work that is hot, numeric and
batchable. Everything else stays where it belongs: UI/Maps/state in TypeScript,
pixels in WGSL, cabin geometry in Three.js.

| Workload | Lives in |
|---|---|
| UI, Maps, app state | TypeScript |
| Per-pixel effects | WGSL |
| Car interior | Three.js |
| Noise tiles, particle seeds, batch geodesy | **C++ → WASM** |

---

## 1. Layout

| File | Role |
|---|---|
| `cpp/src/noise_module.cpp` | **algorithm source of truth** (`sw_*`), host-tested |
| `cpp/src/bindings.cpp` | raw `extern "C"` wrappers with the canonical export names |
| `cpp/include/streetview_wasm.h` | `sw_*` declarations + per-function contracts |
| `cpp/CMakeLists.txt` | host target (`streetview_cpu`) **and** the Emscripten link flags |
| `cpp/emsdk.version` | pinned Emscripten SDK for CI and local rebuilds |
| `cpp/tests/` | doctest golden-vector tests + the generated goldens |
| `cpp/third_party/doctest/` | vendored single-header test framework (MIT) |
| `scripts/gen-wasm-goldens.mjs` | captures the goldens from the shipping binary |
| `src/wasm/index.ts` | loader, camelCase API, **pure-JS fallback** |
| `src/wasm/scratchOffset.ts` | loader scratch base (past emcc statics) |
| `src/wasm/useWasmModule.ts` | React hook (`useWasmModule`) for React-side consumers |
| `src/wasm/wasmNoiseFeeder.ts` | render-loop tile feeder |
| `src/wasm/wasmParticleFeeder.ts` | render-loop particle-seed feeder (compute weather) |
| `public/wasm/streetview-wasm.wasm` | committed binary (built from C++ with emcc) |

One build path produces the binary:

```bash
npm run build:wasm             # C++ → wasm via emcc (what CI ships)
node scripts/check-wasm-abi.mjs  # the built binary exports the whole ABI
```

`npm run build` runs `build:wasm` before Vite, and `scripts/verify-build.sh`
fails the build when `public/wasm/streetview-wasm.wasm.sha256` no longer matches
the C++ inputs (`noise_module.cpp`, `bindings.cpp`, `streetview_wasm.h`,
`CMakeLists.txt`) — i.e. when someone edited the algorithms and forgot to rebuild.
Locally, if `emcc` is missing but that hash still matches, the committed binary
is reused. CI (`CI=true`) fails without emcc.

The Emscripten SDK version is pinned in `cpp/emsdk.version`.

### Working on the C++

The algorithms build and test with the **system** compiler — no emcc, no
browser, no Node:

```bash
npm run test:cpp        # cmake configure + build + ctest (g++/clang++, -Werror)
npm run test:cpp:asan   # same, with -fsanitize=address,undefined
```

Both compile with `-Wall -Wextra -Wpedantic -Wshadow -Wconversion -Werror`
(`-DSTREETVIEW_WERROR=OFF` relaxes that while iterating). Configuring also
writes `cpp/build-host/compile_commands.json`, so **clangd works in `cpp/`** —
point your editor at it (`ln -s cpp/build-host/compile_commands.json cpp/`, or
set `CompileFlags: CompilationDatabase: build-host` in `cpp/.clangd`).

CMake options:

| Option | Default | Effect |
|---|---|---|
| `STREETVIEW_WERROR` | `ON` | warnings are errors on our sources (never on `third_party/`) |
| `STREETVIEW_SANITIZERS` | `OFF` | ASan + UBSan on the host target |
| `STREETVIEW_WASM_SIMD` | `OFF` | adds `-msimd128` to the emcc build (autovectorization only) |

`STREETVIEW_WASM_SIMD` does **not** introduce a second algorithm: the C++ stays
scalar and the option only lets the compiler vectorize the `fill_*` loops. WASM
SIMD128 has no FMA and we never pass `-ffast-math`, so results stay bit-identical
to the scalar goldens — `cpp/tests` asserts that the tile fills and the scalar
`noise2d` entry point agree exactly, which is the invariant a SIMD path must
preserve.

---

## 1a. One contract, three implementations

The same algorithms exist three times — the shipping `.wasm`, the C++, and the
JS fallback — so they are pinned to a **single set of golden vectors** rather
than to each other:

```
public/wasm/streetview-wasm.wasm   (what ships)
            │
            │  scripts/gen-wasm-goldens.mjs   (npm run gen:wasm-goldens)
            ▼
   cpp/tests/goldens.json  +  cpp/tests/goldens_generated.h
            │                          │
            │ Vitest                   │ ctest (host CI, no emcc)
            ▼                          ▼
   src/wasm/index.ts JS_FALLBACK   cpp/src/noise_module.cpp
```

- `cpp/tests/noise_module_test.cpp` asserts the C++ against the generated
  header — bit-exact on every f32 path, `1e-12` relative on `haversine`
  (host libm vs the module's host-math imports).
- `src/wasm/__tests__/wasmGoldenParity.test.ts` asserts the JS fallback against
  the same numbers, exactly where the paths are exact (particle seeds, angle
  helpers) and within a few f32 ULP where the JS twin accumulates in double and
  rounds once.
- Both files also check the committed binary's SHA-256 against the one recorded
  in the goldens, so a rebuilt binary with stale goldens fails rather than
  silently re-baselining.

Regenerate with `npm run gen:wasm-goldens` **only** as part of a deliberate
algorithm change, and review the resulting diff — it is the record of what
behaviour changed. CI re-runs the generator and fails on any diff, so goldens
cannot drift from the binary or be hand-edited.

---

## 2. The ABI

Fourteen exports, identical in `bindings.cpp`, the CMake export list and the
TypeScript loader:

| Export | TS wrapper | Notes |
|---|---|---|
| `seed(i32)` | `seed` | seeds the internal permutation table |
| `noise2d(f32, f32) → f32` | `noise2d` | Perlin gradient noise, `[-1, 1]` |
| `fill_noise_buffer(ptr, w, h, scale, ox, oy)` | `fillNoiseBuffer` | single-octave tile |
| `fbm2d(x, y, octaves, lacunarity, gain) → f32` | `fbm2d` | normalised by accumulated amplitude, so `[-1, 1]` for any octave count |
| `fill_fbm_buffer(ptr, w, h, scale, ox, oy, octaves, lacunarity, gain)` | `fillFbmBuffer` | fBm tile |
| `fill_particle_seeds(ptr, count, seed)` | `fillParticleSeeds` | 4 floats/particle: x, y, speed, phase |
| `normalize_angle(f32) → f32` | `normalizeAngle` | `[0, 360)` |
| `signed_angle_diff(f32, f32) → f32` | `signedAngleDiff` | `[-180, 180)` — exactly-opposite inputs give -180 |
| `haversine(f64 ×4) → f64` | `haversine` | metres |
| `batch_haversine(ptr, count, out) → f64` | `batchHaversine` | whole polyline in one crossing |
| `fill_engine_noise(ptr, count, rpm, load, speed, time, sr)` | `fillEngineNoise` | mono f32 engine+road PCM in `[-1, 1]` |
| `luma_histogram_bt709(rgba, w, h, bins)` | `lumaHistogramBt709` | 256-bin Rec.709 histogram of packed RGBA8 |
| `reduce_luma_bt709(rgba, w, h, out3)` | `reduceLumaBt709` | mean/min/max luma in `[0, 1]` |
| `downsample_2d(src, sw, sh, dst, dw, dh)` | `downsample2d` | integer box-filter downsample, packed RGBA8 |

Plus the exported `memory`, which the loader needs to marshal buffers.

**Adding an export means touching** `noise_module.cpp` / `streetview_wasm.h`,
`bindings.cpp`, `CMakeLists.txt` `EXPORTED_FUNCTIONS`, and the TS loader.
`src/wasm/__tests__/wasmAbiLock.test.ts` fails if any of them drifts, and
`scripts/check-wasm-abi.mjs` fails if the compiled binary is missing a name
`bindings.cpp` declares — otherwise a missing wrapper would only show up as a
silent JS-fallback at runtime.

Write the algorithm in `noise_module.cpp` **first**. Do not add a hand-written
`.wat`.

### Determinism and float precision

The emcc binary and host C++ produce **bit-identical** f32 results for the noise,
fBm, particle-seed, angle and engine-PCM exports — `cpp/tests` asserts that with
a `memcmp`, not a tolerance. `haversine`/`batch_haversine` agree to ~1e-12
relative (host libm vs the libm emcc linked).

The JS fallback mirrors the same algorithms — where a value would otherwise
round twice through a double intermediate, the fallback applies `Math.fround`
explicitly (see `_TWO_PI_F32` in `src/wasm/index.ts`). It is exact on the
integer-LCG paths (particle seeds) and the angle helpers, and within ~2.2e-7 on
the noise/fBm/PCM buffers, because it accumulates in double and rounds once at
the `Float32Array` store while the module rounds after every operation. Measured
worst cases are recorded in `TOLERANCES` in `wasmGoldenParity.test.ts`; treat a
tolerance bump there as a bug report, not a fix.

`haversine` has no WASM-native transcendentals; the Emscripten STANDALONE_WASM
build links `sin`/`cos`/`atan2` statically. The loader still supplies optional
`env` stubs (and `emscripten_notify_memory_growth` for `ALLOW_MEMORY_GROWTH`).

### Memory marshalling

C++ keeps `perm` as a static (linker-placed, ~byte 4080 on the current emcc).
The loader copies tiles at `WASM_SCRATCH_OFFSET = 65536` (`src/wasm/scratchOffset.ts`)
so fills cannot overlap `.data`. The loader grows linear memory on demand
(`reserveScratch`) and copies in/out — no allocator, no `malloc` on the hot
path. 65536 is 8-byte aligned, so `batch_haversine`'s f64 views are naturally
aligned; its output region sits at `65536 + count * 16`.

---

## 3. Production consumers

| Consumer | Export | What it does |
|---|---|---|
| `WasmNoiseFeeder` → `WeatherPostProcessor` (binding 3) | `fill_noise_buffer` | drifting dust turbulence on the fragment path |
| `WasmNoiseFeeder` → `ComputeWeatherPostProcessor` (binding 12) | `fill_fbm_buffer` | same tile with fBm detail under `?weather=compute` |
| `WasmParticleFeeder` → `ComputeWeatherPostProcessor` (bindings 7/8) | `fill_particle_seeds` | GPU rain/snow field under compute weather (High/Ultra) |
| `TourPanel` via `src/utils/routeStats.ts` | `batch_haversine` | per-tour route length + longest-hop labels |
| `CabinAudio` (car mode) | `fill_engine_noise` | engine/road bed mixed in the Web Audio graph; JS fill + oscillators if WASM is missing |
| gpu-chores (`GpuChores`, #216) | `luma_histogram_bt709` / `reduce_luma_bt709` / `downsample_2d` | panorama hist + reduce for the luma gauge; picker thumbs. WebGPU compute first; WASM/JS when `?no_gpu_compute` or the boot probe failed |

`WasmNoiseFeeder` has two detail modes. `'classic'` (single octave) is the
default and is what the fragment path gets, so the default look is unchanged;
`WebGPUCanvas` switches the feeder to `'fbm'` only when the renderer reports the
compute weather path. `?wasmNoise=off` (or `localStorage streetview.wasmNoise=off`)
disables the tile entirely for A/B comparison — the shader then falls back to
uniform dust density.

`fill_particle_seeds` is consumed by `WasmParticleFeeder` on the compute
weather path: seeds are uploaded once (and on grid-size change or a dry→wet
restart), then `weather-particles.wgsl` integrates and splats into storage
textures 7/8. The JS fallback of `fillParticleSeeds` is what Vitest exercises
when `fetch` cannot load `public/wasm/`. `?wasmParticles=off` (or stored
`streetview.wasmParticles=off`) leaves 7/8 as 1×1 dummies so the procedural
compute rain/snow is easy to A/B. The fragment path never calls the feeder.

---

## 4. Fallback guarantee

`loadWasmModule()` returns the pure-JS fallback whenever `WebAssembly` is
missing, the fetch fails, or the binary imports something the loader does not
supply. **Every export has a fallback**, so no caller needs to branch on
`isWasm` — `WasmNoiseFeeder.isWasm` and `StreetViewWasmAPI.isWasm` exist for
diagnostics only. `src/wasm/__tests__/wasm.test.ts` covers the fallback (Node has
no `fetch` for `public/`, so it is what the suite exercises by default) and
`wasmCompiled.test.ts` instantiates the real binary to check the two agree.

---

## 5. Editing checklist

- **Changing an algorithm?** Edit `cpp/src/noise_module.cpp` first and run
  `npm run test:cpp` — it will fail against the goldens, which is the point.
  Mirror the change in the JS fallback, rebuild (`npm run build:wasm`),
  regenerate (`npm run gen:wasm-goldens`) and re-run `npm run test:cpp && npm test`.
  The golden diff is the behavioural record.
- **New export?** `noise_module.cpp` + `streetview_wasm.h` + `bindings.cpp` +
  `CMakeLists.txt` + `src/wasm/index.ts` (API type, JS fallback, WASM wrapper)
  — then `npm run build:wasm`. Add coverage to `cpp/tests/noise_module_test.cpp`
  and vectors to `scripts/gen-wasm-goldens.mjs` in the same change; the ABI lock
  only checks that the *name* exists everywhere, not that the maths agrees.
- **Rebuilt the wasm?** Commit `public/wasm/streetview-wasm.wasm` **and** its
  `.sha256`, or `verify-build.sh` fails — and regenerate the goldens, or the
  binary-hash assertions fail.
- **Touching float math?** Check `wasmCompiled.test.ts` and
  `wasmGoldenParity.test.ts` still match before assuming a tolerance bump is
  fine — a real double-rounding difference means the paths have diverged.
- **No new hand-written `.wat` algorithms**, and no new `src/**/*.js`
  application code. The JS fallback is a test/degrade twin, not a third place to
  invent behaviour.

---

## 6. Compile path (done)

One algorithm source: `noise_module.cpp`, shipped as emcc STANDALONE_WASM.

1. ✅ **Host build + goldens.** `noise_module.cpp` compiles and tests with the
   system compiler under `-Werror` and sanitizers, against vectors captured
   from the shipping binary.
2. ✅ **Ship path is emcc.** `npm run build:wasm` / `npm run build` compile C++.
   `verify-build.sh` hashes the C++ inputs. SDK pin: `cpp/emsdk.version`.
3. ✅ **WAT retired.** There is no `streetview-wasm.wat`. Do not add one.
4. ✅ **SIMD128 CI (not shipped).** `STREETVIEW_WASM_SIMD=ON` is a CI row that
   must keep goldens bit-identical. Production CMake default stays `OFF`.
