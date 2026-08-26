# WebAssembly Module — Developer Guide

This document covers the C++/Emscripten WebAssembly module introduced to
WebGPU StreetView for high-performance CPU-side computation.

---

## Quick Start

```bash
# Install dependencies
npm ci

# Rebuild the .wasm binary from C++ via emcc (always run BEFORE vite build)
npm run build:wasm

# Full app build — correct order: WASM first, then Vite copies it into build/
npm run build

# Build and test the C++ algorithms natively (no emcc, no browser, no Node)
npm run test:cpp
npm run test:cpp:asan       # same, with ASan + UBSan
```

### Calling the module from TypeScript

```typescript
import { loadWasmModule } from './wasm';

const wasm = await loadWasmModule();
wasm.seed(42);
const noiseValue = wasm.noise2d(1.2, 3.4); // [-1, 1]
const dist = wasm.haversine(40.7128, -74.006, 51.5074, -0.1278); // metres
```

### React hook

```typescript
import { useWasmModule, useNoiseFunction } from './wasm/useWasmModule';

function WeatherComponent() {
  const { wasm, loading } = useWasmModule();
  const noise = useNoiseFunction(); // stable function ref

  useEffect(() => {
    if (!wasm) return;
    wasm.seed(Date.now());
  }, [wasm]);

  // Drive rain intensity variation from noise:
  const variation = noise(time * 0.1, longitude * 0.01);
}
```

> **Note**: `useWasmModule` and `useNoiseFunction` currently have no active app
> consumers. The live integration path is `WasmNoiseFeeder` (called imperatively
> from `WebGPUCanvas.tsx`). These hooks are retained for future React-based
> consumers (WeatherPanel, WindAudio, particle DSP etc.).

---

## Directory Structure

```
cpp/
├── CMakeLists.txt              Host CMake build + Emscripten build (raw-export / STANDALONE_WASM)
├── include/
│   └── streetview_wasm.h       C public API (sw_* internal names)
├── src/
│   ├── noise_module.cpp        Algorithm source of truth (Perlin noise, haversine, …)
│   └── bindings.cpp            Canonical raw-export wrappers (seed, noise2d, …)
├── tests/
│   ├── CMakeLists.txt          Host-only test target (streetview_cpu_tests)
│   ├── noise_module_test.cpp   doctest golden-vector tests
│   ├── goldens_generated.h     GENERATED goldens for C++ (npm run gen:wasm-goldens)
│   └── goldens.json            The same goldens for the Vitest JS-fallback parity test
└── third_party/
    └── doctest/                Vendored single-header test framework (MIT, v2.4.11)

public/wasm/
├── streetview-wasm.wasm        Pre-built binary (commit this; rebuild with npm run build:wasm)
└── streetview-wasm.wasm.sha256 SHA-256 of the C++ inputs at the last emcc build

scripts/
├── build-wasm.sh               C++ → wasm via emcc
├── wasm-source-hash.mjs        C++ input hash for the staleness guard
├── check-wasm-abi.mjs          Compiled binary exports the whole ABI
└── gen-wasm-goldens.mjs        Capture goldens from the shipping binary

src/wasm/
├── index.ts                    TypeScript wrapper + pure-JS fallback
├── useWasmModule.ts            React hooks (useWasmModule, useNoiseFunction)
├── wasmNoiseFeeder.ts          Imperative render-loop noise-tile bridge
└── wasmParticleFeeder.ts       Imperative render-loop particle-seed bridge
```

---

## Single ABI — Canonical Export Names

The Emscripten STANDALONE_WASM binary uses these export names so
`src/wasm/index.ts` can instantiate it without a loader branch:

| Export name | Emscripten (via bindings.cpp) |
|---|---|
| `seed` | `EMSCRIPTEN_KEEPALIVE void seed(…)` |
| `noise2d` | `EMSCRIPTEN_KEEPALIVE float noise2d(…)` |
| `fill_noise_buffer` | `EMSCRIPTEN_KEEPALIVE void fill_noise_buffer(…)` |
| `haversine` | `EMSCRIPTEN_KEEPALIVE double haversine(…)` |
| `normalize_angle` | `EMSCRIPTEN_KEEPALIVE float normalize_angle(…)` |
| `signed_angle_diff` | `EMSCRIPTEN_KEEPALIVE float signed_angle_diff(…)` |
| `memory` | exported |

The internal C++ functions (`sw_seed`, `sw_noise2d`, …) are NOT exported — only
the thin canonical wrappers in `bindings.cpp` are. The
`EXPORTED_FUNCTIONS` list in `CMakeLists.txt` uses `_seed`, `_noise2d` etc.
(Emscripten's underscore convention maps `_seed` → export name `seed`).

Emscripten STANDALONE_WASM links math statically using musl. `ALLOW_MEMORY_GROWTH`
imports `env.emscripten_notify_memory_growth`. Host `haversine` tests allow
~1e-12 relative vs platform libm.

---

## Exported API

| Function | Signature | Description |
|---|---|---|
| `seed` | `(seed: number) → void` | Seed the permutation table (call once). |
| `noise2d` | `(x: number, y: number) → number` | 2-D Perlin gradient noise, result in \[-1, 1\]. |
| `fillNoiseBuffer` | `(out: Float32Array, w, h, scale, ox, oy) → void` | Fill a buffer with noise values (row-major). |
| `haversine` | `(lat1, lon1, lat2, lon2) → number` | Great-circle distance in metres. |
| `normalizeAngle` | `(angle: number) → number` | Maps angle → \[0, 360). |
| `signedAngleDiff` | `(from, to: number) → number` | Smallest signed delta in (-180, 180\]. |

`isWasm: boolean` — `true` when running the compiled binary, `false` for the
JS fallback.

---

## Build Paths

### Path A — C++ → WASM via Emscripten (what ships)

The C++ implementation (`cpp/src/noise_module.cpp` + `bindings.cpp`) is compiled
with a **pinned** Emscripten SDK (`cpp/emsdk.version`).

**Emscripten flags used (see `CMakeLists.txt`):**
```
-O3 -g0                # release; DWARF stripped
-s STANDALONE_WASM=1   # link math statically; no JS glue file required
--no-entry             # suppress WASI _start; pure compute module
-s INITIAL_MEMORY=16777216   # explicit, so the first tile never triggers a grow
-s ALLOW_MEMORY_GROWTH=1
-s ASSERTIONS=0
-s EXPORTED_FUNCTIONS=[ABI names, plus '_malloc','_free']
-s EXPORTED_RUNTIME_METHODS=[]
```

Compile flags: `-Wall -Wextra -Wpedantic -Wshadow -Wconversion -Werror`
(shared with the host build) plus `-fno-exceptions -fno-rtti`. Passing
`-DSTREETVIEW_WASM_SIMD=ON` adds `-msimd128`; CI checks goldens stay bit-identical.
Do **not** ship a SIMD-built binary until that job is the production default.

**No `MODULARIZE`, no `EXPORT_ES6`, no `--bind`** — these flags would produce a
JS-module wrapper incompatible with the TS loader's direct `WebAssembly.instantiate()`.

```bash
# Install the pinned Emscripten SDK (see cpp/emsdk.version)
git clone https://github.com/emscripten-core/emsdk.git /opt/emsdk
PIN=$(tr -d '[:space:]' < cpp/emsdk.version)
/opt/emsdk/emsdk install "$PIN"
/opt/emsdk/emsdk activate "$PIN"
source /opt/emsdk/emsdk_env.sh

npm run build:wasm
```

Output:
- `public/wasm/streetview-wasm.wasm` — standalone WASM (no `.js` glue)
- `public/wasm/streetview-wasm.wasm.sha256` — SHA-256 of the C++ inputs

#### Docker alternative

```bash
docker run --rm -v "$(pwd):/src" -w /src \
  emscripten/emsdk bash scripts/build-wasm.sh
```

### Path B — native host build (algorithms only, no WASM)

`cpp/src/noise_module.cpp` builds with the system compiler so the algorithms can
be tested anywhere `cmake` exists:

```bash
npm run test:cpp        # configure + build + ctest with g++/clang++, -Werror
npm run test:cpp:asan   # same, with -fsanitize=address,undefined

# or by hand
cmake -S cpp -B cpp/build-host -DCMAKE_BUILD_TYPE=RelWithDebInfo
cmake --build cpp/build-host
ctest --test-dir cpp/build-host --output-on-failure
```

This produces no `.wasm`. It builds the `streetview_cpu` static library and
`streetview_cpu_tests`, which asserts every `sw_*` function against golden
vectors captured from the shipping binary — bit-exact on the f32 paths, `1e-12`
relative on `haversine`.

Configuring also writes `cpp/build-host/compile_commands.json`
(`CMAKE_EXPORT_COMPILE_COMMANDS=ON`), so clangd/clang-tidy work in `cpp/`.

Regenerate the goldens only when an algorithm deliberately changes:

```bash
npm run gen:wasm-goldens   # rewrites cpp/tests/goldens.json + goldens_generated.h
```

CI re-runs the generator and fails on any diff, so the goldens cannot drift from
the committed binary or be hand-edited.

#### Emscripten SDK version pinning

Pin the Emscripten SDK version in `cpp/emsdk.version` (CI reads the same file).
Do not use `latest` — goldens and the committed `.wasm` would churn.

---

## Build Order (Critical)

```
npm run build:wasm   →   public/wasm/streetview-wasm.wasm  (emcc STANDALONE_WASM)
vite build           →   build/ (copies public/ into it, including the fresh .wasm)
./scripts/verify-build.sh   →   asserts build/wasm/streetview-wasm.wasm exists + size > 0
```

The `"build"` script in `package.json` enforces this order:
```json
"build": "npm run build:wasm && vite build && ./scripts/verify-build.sh"
```

**Previously broken**: the order was `vite build && npm run build:wasm`, so Vite
copied the *old* binary before the WASM rebuild, silently shipping stale code.

---

## Integration with the Render Pipeline

The WASM module runs on the **CPU** and feeds results into the **WebGPU GPU
pipeline** to drive the ambient dust-mote effect in `weather-post.wgsl`:

```
WasmNoiseFeeder.sampleTile()      (src/wasm/wasmNoiseFeeder.ts)
  → loadWasmModule().fillNoiseBuffer()   [every 30 frames, 64x64 tile]
    → renderer.updateNoiseBuffer(tile)
      → WeatherPostProcessor: device.queue.writeBuffer(noiseBuffer, ...)
        → weather-post.wgsl: sampleWasmNoiseTile() (binding 3, storage buffer)
          → applyDustParticles() cloud-density modulation
```

`WebGPUCanvas.tsx` owns a `WasmNoiseFeeder` instance and calls
`sampleTile(frameCount, time)` once per frame; it returns a fresh tile only on
the update cadence (otherwise `null`, so no GPU upload happens that frame).
The tile refreshing only every ~30 frames — instead of every frame — is
deliberate: it reads as slow, organic turbulence distinct from the per-pixel
GPU hash noise used everywhere else in the shader, and it keeps the CPU cost
negligible.

On the compute weather path the same canvas also owns a `WasmParticleFeeder`.
`fillParticleSeeds` runs on the CPU **once** (and on grid-size change); per-frame
advection is `weather-particles.wgsl`, not the JS thread. `?wasmParticles=off`
leaves the procedural rain/snow as the only precipitation layer.

**Dev toggle**: append `?wasmNoise=off` to the URL (or `?wasmNoise=on` to
force it back on over a stored preference) to compare the WASM-driven dust
effect against it being fully disabled — see `getWasmNoisePreference()` in
`src/wasm/wasmNoiseFeeder.ts`. When disabled, dust intensity is driven to 0
and the noise tile is never uploaded.

### haversine (libm, linked statically)

The emcc STANDALONE_WASM build links `sin`/`cos`/`atan2` into the module.
`ALLOW_MEMORY_GROWTH` imports `env.emscripten_notify_memory_growth`; the loader
stubs it. Extra keys (legacy `env.sin` / WASI) are ignored:

```typescript
const importObject = {
  env: {
    sin: Math.sin, cos: Math.cos, atan2: Math.atan2,
    emscripten_notify_memory_growth: () => {},
  },
  wasi_snapshot_preview1: { /* stubs */ },
};
const { instance } = await WebAssembly.instantiate(bytes, importObject);
```

---

## JS Fallback

`loadWasmModule()` automatically falls back to a pure-TypeScript
implementation when:

- `WebAssembly` is not available in the browser.
- The `.wasm` file fetch returns a non-OK HTTP status.
- Any other error occurs during instantiation (including missing imports).

The fallback mirrors the WASM algorithm exactly, so behaviour is identical
(minus the performance advantage). The `isWasm` flag lets you distinguish the
two at runtime.

---

## Staleness Guard (`verify-build.sh`)

`scripts/verify-build.sh` (called at the end of `npm run build`) checks:

1. `build/wasm/streetview-wasm.wasm` **exists** and **size > 0**.
2. **Source hash**: the SHA-256 of the C++ inputs recorded at the last
   `npm run build:wasm` must match `scripts/wasm-source-hash.mjs`. A mismatch
   means the algorithms were edited without a WASM rebuild.
3. No `build/wasm/streetview-wasm.js` glue file.

The hash file lives at `public/wasm/streetview-wasm.wasm.sha256` and is
committed alongside the binary so CI can verify it without rebuilding.

---

## Future Extensions

- **Particle system stepper** — update particle positions/velocities in C++,
  write directly into a GPU storage buffer.
- **Audio DSP** — custom filter/pitch-shift kernels for `WindAudio.ts`.
- **Image processing** — bilateral filter or tone-mapping applied to
  `Uint8Array` tile data before uploading to WebGPU.
- **Offline tile processing** — custom Street View tile decoding/stitching.
- **ONNX Runtime Web** — custom ops implemented in C++ via the WASM backend.
- **SharedArrayBuffer worker** — run `fillNoiseBuffer` off the main thread so
  it never touches frame budget.

---

## Testing

```bash
# JS fallback + compiled WASM binary (wasmCompiled.test.ts loads public/wasm/*.wasm directly)
npm test -- --reporter=verbose
```

- `src/wasm/__tests__/wasm.test.ts` — JS fallback parity (no WASM required).
- `src/wasm/__tests__/wasmCompiled.test.ts` — compiled binary ABI, memory layout,
  haversine host-import wiring. Loads the file directly via `fs.readFileSync`.
- `src/wasm/__tests__/wasmNoiseFeeder.test.ts` — `WasmNoiseFeeder` cadence and buffer reuse.
- `src/wasm/__tests__/wasmParticleFeeder.test.ts` — `fillParticleSeeds` ranges, buffer reuse, dry→wet reseed.

---

*Last updated: 2026-07-31*
