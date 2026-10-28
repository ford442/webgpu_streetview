# WebAssembly

The WASM numeric layer is documented in [`docs/WASM_BRIDGE.md`](./docs/WASM_BRIDGE.md):
the ABI (`cpp/include/streetview/abi.h` → `src/wasm/abi.generated.ts`, checked
against each binary's type section), the two shipped SIMD128 binaries (main
thread + the fixed-memory cabin worklet engine) and the CI-only scalar oracle,
the cabin engine's UPOLS convolver and its benchmark (§3a), the pinned
Emscripten SDK (`cpp/emsdk.version`), the staleness guard, sanitizers, fuzzing
and testing.

```bash
npm run build:wasm:update  # rebuild public/wasm/*.wasm with the pinned emcc
npm run check:wasm-abi     # abi.generated.ts current; binaries match abi.h by signature
npm run test:cpp           # native golden tests, no emcc needed
npm run lint:cpp           # clang-format check + clang-tidy
```
