# WebAssembly

The WASM numeric layer is documented in [`docs/WASM_BRIDGE.md`](./docs/WASM_BRIDGE.md):
build paths, the pinned Emscripten SDK (`cpp/emsdk.version`), the single ABI
(the committed binary is the only implementation), the staleness guard and testing.

```bash
npm run build:wasm   # rebuild public/wasm/*.wasm with the pinned emcc (before vite build)
npm run test:cpp     # native golden tests, no emcc needed
```
