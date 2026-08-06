# WASM Bridge — hot CPU math in C++/WAT

The app keeps a small WebAssembly module for CPU work that is hot, numeric and
batchable. Everything else stays where it belongs: UI/Maps/state in TypeScript,
pixels in WGSL, cabin geometry in Three.js.

| Workload | Lives in |
|---|---|
| UI, Maps, app state | TypeScript |
| Per-pixel effects | WGSL |
| Car interior | Three.js |
| Noise tiles, particle seeds, batch geodesy | **C++/WAT → WASM** |

---

## 1. Layout

| File | Role |
|---|---|
| `cpp/src/streetview-wasm.wat` | **canonical ABI source** — what actually ships |
| `cpp/src/noise_module.cpp` | C++ implementation of the same algorithms (`sw_*`) |
| `cpp/src/bindings.cpp` | raw `extern "C"` wrappers with the canonical export names |
| `cpp/CMakeLists.txt` | Emscripten link flags + `EXPORTED_FUNCTIONS` |
| `src/wasm/index.ts` | loader, camelCase API, **pure-JS fallback** |
| `src/wasm/useWasmModule.ts` | React hook (`useWasmModule`) for React-side consumers |
| `src/wasm/wasmNoiseFeeder.ts` | render-loop tile feeder |
| `public/wasm/streetview-wasm.wasm` | committed binary (built from the WAT source) |

Two build paths produce the binary, and only one runs on a given machine:

```bash
npm run build:wasm             # WAT → wasm via wabt (no toolchain needed; what CI ships)
npm run build:wasm:emscripten  # C++ → wasm via emcc (parity job in CI)
node scripts/check-wasm-abi.mjs  # the built binary exports the whole ABI
```

`npm run build` runs `build:wasm` before Vite, and `scripts/verify-build.sh`
fails the build when `public/wasm/streetview-wasm.wasm.sha256` no longer matches
the WAT source — i.e. when someone edited the WAT and forgot to rebuild.

---

## 2. The ABI

Ten exports, identical in the WAT source, the C++ bindings, the CMake export
list and the TypeScript loader:

| Export | TS wrapper | Notes |
|---|---|---|
| `seed(i32)` | `seed` | seeds the 512-byte permutation table |
| `noise2d(f32, f32) → f32` | `noise2d` | Perlin gradient noise, `[-1, 1]` |
| `fill_noise_buffer(ptr, w, h, scale, ox, oy)` | `fillNoiseBuffer` | single-octave tile |
| `fbm2d(x, y, octaves, lacunarity, gain) → f32` | `fbm2d` | normalised by accumulated amplitude, so `[-1, 1]` for any octave count |
| `fill_fbm_buffer(ptr, w, h, scale, ox, oy, octaves, lacunarity, gain)` | `fillFbmBuffer` | fBm tile |
| `fill_particle_seeds(ptr, count, seed)` | `fillParticleSeeds` | 4 floats/particle: x, y, speed, phase |
| `normalize_angle(f32) → f32` | `normalizeAngle` | `[0, 360)` |
| `signed_angle_diff(f32, f32) → f32` | `signedAngleDiff` | `(-180, 180]` |
| `haversine(f64 ×4) → f64` | `haversine` | metres |
| `batch_haversine(ptr, count, out) → f64` | `batchHaversine` | whole polyline in one crossing |

Plus the exported `memory`, which the loader needs to marshal buffers.

**Adding an export means touching four files.** `src/wasm/__tests__/wasmAbiLock.test.ts`
fails if any of them drifts, and `scripts/check-wasm-abi.mjs` (run in the
Emscripten CI job) fails if the compiled binary is missing a name the WAT
source declares — otherwise a missing `bindings.cpp` wrapper would only show up
as a silent JS-fallback at runtime.

### Determinism and float precision

The WAT module and C++ produce **bit-identical** f32 results for the noise, fBm
and particle-seed exports; `batch_haversine` agrees to ~1e-10 m (host `Math.*`
imports vs `libm`). The JS fallback mirrors the same algorithms — where a value
would otherwise round twice through a double intermediate, the fallback applies
`Math.fround` explicitly (see `_TWO_PI_F32` in `src/wasm/index.ts`).

`haversine` has no WASM-native transcendentals, so the WAT module imports
`env.sin`/`env.cos`/`env.atan2` from the host; the Emscripten build links them
statically instead and ignores those imports.

### Memory marshalling

Byte 0–511 is the permutation table; everything past `SCRATCH_OFFSET = 512` is
scratch. The loader grows linear memory on demand (`reserveScratch`) and copies
in/out — no allocator, no `malloc` on the hot path. 512 is 8-byte aligned, so
`batch_haversine`'s f64 views are naturally aligned; its output region sits at
`512 + count * 16`, which stays aligned for any count.

---

## 3. Production consumers

| Consumer | Export | What it does |
|---|---|---|
| `WasmNoiseFeeder` → `WeatherPostProcessor` (binding 3) | `fill_noise_buffer` | drifting dust turbulence on the fragment path |
| `WasmNoiseFeeder` → `ComputeWeatherPostProcessor` (binding 12) | `fill_fbm_buffer` | same tile with fBm detail under `?weather=compute` |
| `TourPanel` via `src/utils/routeStats.ts` | `batch_haversine` | per-tour route length + longest-hop labels |

`WasmNoiseFeeder` has two detail modes. `'classic'` (single octave) is the
default and is what the fragment path gets, so the default look is unchanged;
`WebGPUCanvas` switches the feeder to `'fbm'` only when the renderer reports the
compute weather path. `?wasmNoise=off` (or `localStorage streetview.wasmNoise=off`)
disables the tile entirely for A/B comparison — the shader then falls back to
uniform dust density.

`fill_particle_seeds` has no production consumer yet: it exists for the GPU
particle work that will use compute-path storage bindings 7/8 (see
`docs/GRAPHICS.md` §5). It is fully implemented, ABI-locked and tested on all
three backends.

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

- New export? WAT + `bindings.cpp` + `CMakeLists.txt` + `src/wasm/index.ts`
  (API type, JS fallback, WASM wrapper) — then `npm run build:wasm`.
- Rebuilt the WAT? Commit `public/wasm/streetview-wasm.wasm` **and** its
  `.sha256`, or `verify-build.sh` fails.
- Touching float math? Check `wasmCompiled.test.ts` still matches the fallback
  before assuming a tolerance bump is fine — a real double-rounding difference
  means the two paths have diverged.
