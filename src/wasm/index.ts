/**
 * src/wasm/index.ts
 * TypeScript wrapper for the WebGPU StreetView WASM module.
 *
 * Usage:
 *   import { loadWasmModule, type StreetViewWasmAPI } from './wasm';
 *
 *   const wasm = await loadWasmModule();
 *   wasm.seed(42);
 *   const n = wasm.noise2d(1.2, 3.4); // value in [-1, 1]
 *   const dist = wasm.haversine(40.7128, -74.006, 51.5074, -0.1278);
 *
 * The module is lazy-loaded (not included in the initial JS bundle).
 * A pure-JS fallback is used automatically when the WASM file is unavailable.
 */

// ---------------------------------------------------------------------------
// Public API types
// ---------------------------------------------------------------------------

/** All functions exposed by the streetview-wasm module. */
export interface StreetViewWasmAPI {
  /**
   * Seed the internal permutation table.
   * Call once before using noise functions.  Any non-zero integer works.
   */
  seed(seed: number): void;

  /**
   * 2-D gradient (Perlin-style) noise.
   * @returns Value in [-1, 1].
   */
  noise2d(x: number, y: number): number;

  /**
   * Fill a Float32Array with 2-D noise values.
   * The array must have `width * height` elements.
   *
   * @param out     Pre-allocated Float32Array to fill.
   * @param width   Number of columns.
   * @param height  Number of rows.
   * @param scale   Spatial frequency (larger = lower frequency pattern).
   * @param offsetX World-space X offset.
   * @param offsetY World-space Y offset.
   */
  fillNoiseBuffer(
    out: Float32Array,
    width: number,
    height: number,
    scale: number,
    offsetX: number,
    offsetY: number,
  ): void;

  /**
   * Haversine great-circle distance between two WGS-84 coordinates.
   * @returns Distance in metres.
   */
  haversine(lat1: number, lon1: number, lat2: number, lon2: number): number;

  /** Normalise an angle to [0, 360). */
  normalizeAngle(angle: number): number;

  /** Smallest signed angle difference; result in (-180, 180]. */
  signedAngleDiff(from: number, to: number): number;

  /** True when backed by the compiled WASM binary; false for JS fallback. */
  isWasm: boolean;
}

// ---------------------------------------------------------------------------
// Pure-JavaScript fallback implementation
// ---------------------------------------------------------------------------
// This mirrors the C++/WAT logic exactly so the app works even when the
// .wasm file has not been compiled yet (e.g. during local development without
// the Emscripten toolchain installed).

function _fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function _lerp(a: number, b: number, t: number): number {
  return a + t * (b - a);
}

const GRAD2 = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [0.70710678, 0.70710678], [-0.70710678, 0.70710678],
  [0.70710678, -0.70710678], [-0.70710678, -0.70710678],
];

let _perm = new Uint8Array(512);
// Default identity permutation.
for (let i = 0; i < 256; i++) _perm[i] = _perm[i + 256] = i;

function _jsSeed(s: number): void {
  const tmp = new Uint8Array(256);
  for (let i = 0; i < 256; i++) tmp[i] = i;
  let state = s >>> 0;
  for (let i = 255; i > 0; i--) {
    state = ((state * 1664525) + 1013904223) >>> 0;
    const j = ((state >>> 16) & 0x7fff) % (i + 1);
    // i in [1,255] and j in [0,i], both always valid indices into tmp.
    const t = tmp[i]!; tmp[i] = tmp[j]!; tmp[j] = t;
  }
  _perm = new Uint8Array(512);
  // i in [0,255] is always a valid index into tmp.
  for (let i = 0; i < 256; i++) _perm[i] = _perm[i + 256] = tmp[i]!;
}

function _jsGrad2(h: number, dx: number, dy: number): number {
  // h & 7 is always in [0,7], a valid index into GRAD2.
  const g = GRAD2[h & 7]!;
  // Every GRAD2 entry is a 2-element [x, y] pair.
  return g[0]! * dx + g[1]! * dy;
}

function _jsNoise2d(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const u = _fade(fx);
  const v = _fade(fy);
  const X = ix & 255;
  const Y = iy & 255;
  // X, X + 1 in [0,256] are always valid indices into the 512-entry _perm table.
  const pX = _perm[X]!;
  const pX1 = _perm[X + 1]!;
  const n00 = _jsGrad2(_perm[pX + Y]!, fx, fy);
  const n10 = _jsGrad2(_perm[pX1 + Y]!, fx - 1, fy);
  const n01 = _jsGrad2(_perm[pX + Y + 1]!, fx, fy - 1);
  const n11 = _jsGrad2(_perm[pX1 + Y + 1]!, fx - 1, fy - 1);
  return _lerp(_lerp(n00, n10, u), _lerp(n01, n11, u), v);
}

function _jsFillNoiseBuffer(
  out: Float32Array,
  width: number,
  height: number,
  scale: number,
  offsetX: number,
  offsetY: number,
): void {
  const invScale = 1 / scale;
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      out[row * width + col] = _jsNoise2d(
        (col + offsetX) * invScale,
        (row + offsetY) * invScale,
      );
    }
  }
}

function _jsHaversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function _jsNormalizeAngle(a: number): number {
  return ((a % 360) + 360) % 360;
}

function _jsSignedAngleDiff(from: number, to: number): number {
  const d = to - from;
  return d - 360 * Math.floor((d + 180) / 360);
}

const JS_FALLBACK: StreetViewWasmAPI = {
  seed: _jsSeed,
  noise2d: _jsNoise2d,
  fillNoiseBuffer: _jsFillNoiseBuffer,
  haversine: _jsHaversine,
  normalizeAngle: _jsNormalizeAngle,
  signedAngleDiff: _jsSignedAngleDiff,
  isWasm: false,
};

// ---------------------------------------------------------------------------
// WASM loader
// ---------------------------------------------------------------------------

let _cachedModule: StreetViewWasmAPI | null = null;

/**
 * Lazy-load the WASM module.
 * Returns the cached instance on subsequent calls.
 * Falls back to a pure-JS implementation if the WASM file cannot be fetched
 * or if `WebAssembly` is unavailable.
 */
export async function loadWasmModule(): Promise<StreetViewWasmAPI> {
  if (_cachedModule) return _cachedModule;

  if (typeof WebAssembly === 'undefined') {
    _cachedModule = JS_FALLBACK;
    return _cachedModule;
  }

  try {
    // Resolve the WASM URL relative to the public base (Vite serves
    // public/ at the root, so the file is at ./wasm/streetview-wasm.wasm).
    const wasmUrl = `${process.env.PUBLIC_URL || ''}/wasm/streetview-wasm.wasm`;
    const response = await fetch(wasmUrl);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const bytes = await response.arrayBuffer();
    // The WAT module has no built-in transcendental functions, so haversine()
    // imports sin/cos/atan2 from the host — this gives it the same
    // double-precision result as the JS fallback formula.
    //
    // Both the WAT and the Emscripten STANDALONE_WASM builds are supported
    // with the same importObject:
    //
    //  • WAT build (canonical, built via wabt): imports env.sin/cos/atan2
    //    for haversine — exactly what we supply below.
    //
    //  • Emscripten STANDALONE_WASM build (--no-entry, no MODULARIZE):
    //    links math statically, so it does NOT import env.sin/cos/atan2.
    //    Extra keys in the importObject are silently ignored by the runtime.
    //    It may import wasi_snapshot_preview1 functions (memory/fd helpers);
    //    these are stubbed out below so the binary instantiates cleanly.
    //
    // If the binary imports something not covered here it will throw and we
    // fall back to the JS implementation.
    const noopI32 = (): number => 0;
    const importObject = {
      env: { sin: Math.sin, cos: Math.cos, atan2: Math.atan2 },
      // WASI stubs — Emscripten STANDALONE_WASM may import these even for
      // pure-compute modules compiled with --no-entry.
      wasi_snapshot_preview1: {
        proc_exit: (_code: number): never => { throw new Error('proc_exit'); },
        fd_write: noopI32,
        fd_seek: noopI32,
        fd_close: noopI32,
        fd_read: noopI32,
        environ_get: noopI32,
        environ_sizes_get: noopI32,
        args_get: noopI32,
        args_sizes_get: noopI32,
      },
    };
    const { instance } = await WebAssembly.instantiate(bytes, importObject);
    const exp = instance.exports as Record<string, WebAssembly.ExportValue>;

    const wasmMemory = exp['memory'] as WebAssembly.Memory;
    const seed = exp['seed'] as (s: number) => void;
    const noise2d = exp['noise2d'] as (x: number, y: number) => number;
    const fill_noise_buffer = exp['fill_noise_buffer'] as (
      ptr: number, w: number, h: number,
      scale: number, ox: number, oy: number
    ) => void;
    const normalize_angle = exp['normalize_angle'] as (a: number) => number;
    const signed_angle_diff = exp['signed_angle_diff'] as (f: number, t: number) => number;
    const haversine_wasm = exp['haversine'] as (
      lat1: number, lon1: number, lat2: number, lon2: number
    ) => number;

    // WASM memory starts at byte 512 (after the permutation table).
    // We use a fixed scratch region for fillNoiseBuffer transfers.
    const SCRATCH_OFFSET = 512;

    const fillNoiseBuffer = (
      out: Float32Array,
      width: number,
      height: number,
      scale: number,
      offsetX: number,
      offsetY: number,
    ): void => {
      const needed = width * height * 4; // bytes
      // Grow memory if the scratch area is too small.
      const available = wasmMemory.buffer.byteLength - SCRATCH_OFFSET;
      if (available < needed) {
        const extraPages = Math.ceil((needed - available) / 65536);
        wasmMemory.grow(extraPages);
      }
      fill_noise_buffer(SCRATCH_OFFSET, width, height, scale, offsetX, offsetY);
      const view = new Float32Array(wasmMemory.buffer, SCRATCH_OFFSET, width * height);
      out.set(view);
    };

    _cachedModule = {
      seed,
      noise2d,
      fillNoiseBuffer,
      haversine: haversine_wasm,
      normalizeAngle: normalize_angle,
      signedAngleDiff: signed_angle_diff,
      isWasm: true,
    };
  } catch {
    _cachedModule = JS_FALLBACK;
  }

  return _cachedModule;
}

/**
 * Synchronous access to the module.
 * Returns null until `loadWasmModule()` has resolved at least once.
 * Prefer the async version whenever possible.
 */
export function getWasmModule(): StreetViewWasmAPI | null {
  return _cachedModule;
}

/**
 * Reset the cached module (useful for testing).
 * @internal
 */
export function _resetWasmModule(): void {
  _cachedModule = null;
  // Reset the JS fallback permutation table too.
  _jsSeed(0);
  for (let i = 0; i < 256; i++) _perm[i] = _perm[i + 256] = i;
}
