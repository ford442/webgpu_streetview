# WebAssembly Module — Developer Guide

This document covers the C++/Emscripten WebAssembly module introduced to
WebGPU StreetView for high-performance CPU-side computation.

---

## Quick Start

```bash
# Install dependencies (includes wabt for WAT→WASM compilation)
npm install

# Rebuild the .wasm binary from the WAT source
npm run build:wasm

# Full app build (uses the pre-built .wasm in public/wasm/)
npm run build
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

---

## Directory Structure

```
cpp/
├── CMakeLists.txt              Emscripten CMake build
├── include/
│   └── streetview_wasm.h       C public API
└── src/
    ├── noise_module.cpp        Core implementation (Perlin noise, haversine, …)
    ├── bindings.cpp            Emscripten embind JS bindings
    └── streetview-wasm.wat     Hand-crafted WAT source (no Emscripten needed)

public/wasm/
└── streetview-wasm.wasm        Pre-built binary (commit this; rebuild with npm run build:wasm)

scripts/
└── build-wasm.sh               Build script (auto-detects emcc vs wabt)

src/wasm/
├── index.ts                    TypeScript wrapper + pure-JS fallback
└── useWasmModule.ts            React hooks (useWasmModule, useNoiseFunction)
```

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

### Path A — WAT → WASM (no Emscripten, recommended for development)

Uses the hand-crafted WAT source in `cpp/src/streetview-wasm.wat` and the
[wabt](https://github.com/AssemblyScript/wabt) Node.js package.

```bash
npm run build:wasm          # or: bash scripts/build-wasm.sh --wat-only
```

Output: `public/wasm/streetview-wasm.wasm`

### Path B — C++ → WASM via Emscripten (full production build)

The C++ implementation (`cpp/src/noise_module.cpp`) uses `libm` for exact
haversine and enables link-time optimisation.

```bash
# Install Emscripten SDK
git clone https://github.com/emscripten-core/emsdk.git /opt/emsdk
/opt/emsdk/emsdk install latest
/opt/emsdk/emsdk activate latest
source /opt/emsdk/emsdk_env.sh

# Build
npm run build:wasm
```

Output:
- `public/wasm/streetview-wasm.wasm` — the WASM binary
- `public/wasm/streetview-wasm.js`   — Emscripten JS glue (not committed)

#### Docker alternative

```bash
docker run --rm -v "$(pwd):/src" -w /src \
  emscripten/emsdk bash scripts/build-wasm.sh
```

---

## Integration with the Render Pipeline

The WASM module is designed to run on the **CPU** and feed results into the
**WebGPU GPU pipeline**:

```
WASM fillNoiseBuffer()
  → Float32Array
    → device.queue.writeBuffer(gpuBuffer, ...)
      → WGSL shader reads buffer
```

Example — update weather noise every N frames:

```typescript
// In WebGPUCanvas.tsx render loop
if (frameCount % 30 === 0 && wasmModule) {
  wasmModule.fillNoiseBuffer(noiseBuffer, 64, 64, 200, time, 0);
  device.queue.writeBuffer(noiseGpuBuffer, 0, noiseBuffer);
}
```

---

## JS Fallback

`loadWasmModule()` automatically falls back to a pure-TypeScript
implementation when:

- `WebAssembly` is not available in the browser.
- The `.wasm` file fetch returns a non-OK HTTP status.
- Any other error occurs during instantiation.

The fallback mirrors the WASM algorithm exactly, so behaviour is identical
(minus the performance advantage). The `isWasm` flag lets you distinguish the
two at runtime.

---

## Future Extensions

- **Particle system stepper** — update particle positions/velocities in C++,
  write directly into a GPU storage buffer.
- **Audio DSP** — custom filter/pitch-shift kernels for `WindAudio.ts`.
- **Image processing** — bilateral filter or tone-mapping applied to
  `Uint8Array` tile data before uploading to WebGPU.
- **Offline tile processing** — custom Street View tile decoding/stitching.
- **ONNX Runtime Web** — custom ops implemented in C++ via the WASM backend.

---

## Testing

Unit tests for the WASM wrapper live in `src/wasm/__tests__/wasm.test.ts`.
They run against the pure-JS fallback (no browser/WASM required in Jest):

```bash
npm test -- --testPathPattern=wasm
```

---

*Last updated: 2026-05-26*
