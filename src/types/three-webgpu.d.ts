// `three`'s package.json exports `./webgpu` as a conditional subpath
// (`build/three.webgpu.js`), which Vite/esbuild resolve fine at build time.
// `tsconfig.json`'s `moduleResolution: "node"` (classic) predates
// package.json `exports` support, so `tsc` can't see that subpath's types.
// Re-declare the module here, backed by the real declaration file at its
// stable `src/` path (already resolvable under classic resolution) — remove
// this shim if `moduleResolution` ever moves to `"bundler"`/`"node16"`.
declare module 'three/webgpu' {
    export * from 'three/src/Three.WebGPU.js';
}
