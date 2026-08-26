/**
 * Byte offset the TypeScript loader uses for WASM linear-memory transfers.
 *
 * The WAT module stored the permutation table at [0, 512). The Emscripten
 * build keeps `perm` as a C++ static (measured at ~4080) plus other .data in
 * the first ~8 KiB. Writing tiles at 512 overwrites those statics and corrupts
 * `noise2d`. 64 KiB sits past that region, stays 8-byte aligned for f64 views,
 * and leaves the 16 MiB INITIAL_MEMORY headroom for the largest tiles.
 *
 * Must stay in sync with scripts/gen-wasm-goldens.mjs (`SCRATCH`).
 */
export const WASM_SCRATCH_OFFSET = 65536;
