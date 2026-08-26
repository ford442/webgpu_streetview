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
import {
  downsample2d as jsDownsample2d,
  lumaHistogramBt709 as jsLumaHistogramBt709,
  reduceLumaBt709 as jsReduceLumaBt709,
  type LumaReduce,
} from '../renderer/gpuChores/lumaMath';
import { WASM_SCRATCH_OFFSET } from './scratchOffset';

export type { LumaReduce };
export { WASM_SCRATCH_OFFSET } from './scratchOffset';

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
   * Fractal Brownian motion over {@link noise2d}.
   *
   * @param octaves    Octaves to sum (<= 0 returns 0).
   * @param lacunarity Frequency multiplier per octave (2 is the usual value).
   * @param gain       Amplitude multiplier per octave (0.5 is the usual value).
   * @returns Value in [-1, 1] — normalised by the accumulated amplitude so the
   *          range does not depend on the octave count.
   */
  fbm2d(x: number, y: number, octaves: number, lacunarity: number, gain: number): number;

  /**
   * Fill a Float32Array with fBm samples. Same tile layout as
   * {@link fillNoiseBuffer}; each sample is an fBm stack instead of one octave.
   */
  fillFbmBuffer(
    out: Float32Array,
    width: number,
    height: number,
    scale: number,
    offsetX: number,
    offsetY: number,
    octaves: number,
    lacunarity: number,
    gain: number,
  ): void;

  /**
   * Fill a Float32Array with deterministic particle spawn seeds — 4 floats per
   * particle: x [0,1), y [0,1), speed [0.5,1.5), phase [0, 2π).
   * The array must have `count * 4` elements.
   */
  fillParticleSeeds(out: Float32Array, count: number, seed: number): void;

  /**
   * Haversine great-circle distance between two WGS-84 coordinates.
   * @returns Distance in metres.
   */
  haversine(lat1: number, lon1: number, lat2: number, lon2: number): number;

  /**
   * Haversine distance for a whole polyline in one call — one WASM boundary
   * crossing instead of one per segment.
   *
   * @param points       `count * 2` doubles: lat, lon, lat, lon, …
   * @param segmentsOut  Receives the `count - 1` per-segment distances in
   *                     metres. Must have at least `count - 1` elements;
   *                     untouched when fewer than two points are supplied.
   * @returns Total distance in metres (0 for fewer than two points).
   */
  batchHaversine(points: Float64Array, segmentsOut: Float64Array): number;

  /** Normalise an angle to [0, 360). */
  normalizeAngle(angle: number): number;

  /** Smallest signed angle difference; result in `[-180, 180)` — exactly-opposite inputs give -180. */
  signedAngleDiff(from: number, to: number): number;

  /**
   * Fill a Float32Array with mono engine+road PCM in [-1, 1].
   * `out` must have at least `count` elements.
   */
  fillEngineNoise(
    out: Float32Array,
    count: number,
    rpm: number,
    load: number,
    speedKmh: number,
    timeSec: number,
    sampleRate: number,
  ): void;

  /**
   * 256-bin Rec.709 luma histogram of packed RGBA8.
   * `rgba` must contain at least `width * height * 4` bytes.
   */
  lumaHistogramBt709(
    rgba: Uint8Array | Uint8ClampedArray,
    width: number,
    height: number,
  ): Uint32Array;

  /** Rec.709 luma reduce: mean / min / max in [0, 1]. */
  reduceLumaBt709(
    rgba: Uint8Array | Uint8ClampedArray,
    width: number,
    height: number,
  ): LumaReduce;

  /** Integer box-filter downsample of packed RGBA8. */
  downsample2d(
    src: Uint8Array | Uint8ClampedArray,
    srcW: number,
    srcH: number,
    dstW: number,
    dstH: number,
  ): Uint8Array;

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

function _jsFbm2d(
  x: number,
  y: number,
  octaves: number,
  lacunarity: number,
  gain: number,
): number {
  let sum = 0;
  let norm = 0;
  let amp = 1;
  let freq = 1;
  for (let o = 0; o < octaves; o++) {
    sum += amp * _jsNoise2d(x * freq, y * freq);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return norm > 0 ? sum / norm : 0;
}

function _jsFillFbmBuffer(
  out: Float32Array,
  width: number,
  height: number,
  scale: number,
  offsetX: number,
  offsetY: number,
  octaves: number,
  lacunarity: number,
  gain: number,
): void {
  const invScale = 1 / scale;
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      out[row * width + col] = _jsFbm2d(
        (col + offsetX) * invScale,
        (row + offsetY) * invScale,
        octaves,
        lacunarity,
        gain,
      );
    }
  }
}

/** 2π as an f32, matching the literal in the WAT/C++ particle-seed code. */
const _TWO_PI_F32 = Math.fround(6.2831853);

function _jsFillParticleSeeds(out: Float32Array, count: number, seed: number): void {
  // Same LCG and bit slice as the WAT/C++ implementations so a given seed
  // produces the same particle set on every backend.
  let state = seed >>> 0;
  const nextUnit = (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return ((state >>> 8) & 0xffffff) / 16777216;
  };
  for (let i = 0; i < count; i++) {
    const base = i * 4;
    out[base] = nextUnit();
    out[base + 1] = nextUnit();
    out[base + 2] = 0.5 + nextUnit();
    // Single-precision multiply (fround of both operand and product) so the
    // phase matches the WAT/C++ f32 arithmetic exactly rather than rounding
    // twice through a double intermediate.
    out[base + 3] = Math.fround(nextUnit() * _TWO_PI_F32);
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

function _jsBatchHaversine(points: Float64Array, segmentsOut: Float64Array): number {
  let total = 0;
  const count = Math.floor(points.length / 2);
  for (let i = 0; i < count - 1; i++) {
    const d = _jsHaversine(
      points[i * 2]!,
      points[i * 2 + 1]!,
      points[i * 2 + 2]!,
      points[i * 2 + 3]!,
    );
    segmentsOut[i] = d;
    total += d;
  }
  return total;
}

function _jsNormalizeAngle(a: number): number {
  return ((a % 360) + 360) % 360;
}

function _jsSignedAngleDiff(from: number, to: number): number {
  const d = to - from;
  return d - 360 * Math.floor((d + 180) / 360);
}

function _jsFillEngineNoise(
  out: Float32Array,
  count: number,
  rpm: number,
  load: number,
  speedKmh: number,
  timeSec: number,
  sampleRate: number,
): void {
  if (count <= 0) return;
  let sr = Math.fround(sampleRate);
  if (!(sr > 1)) sr = 44100;
  rpm = Math.fround(Math.max(0, rpm));
  load = Math.fround(Math.max(0, Math.min(1, load)));
  speedKmh = Math.fround(Math.max(0, speedKmh));
  timeSec = Math.fround(Math.max(0, timeSec));
  const invSr = Math.fround(1 / sr);
  const fund = Math.fround(rpm / 60);
  let state = Math.floor(Math.fround(timeSec * sr)) >>> 0;
  if (state === 0) state = 1;
  let spd = Math.fround(speedKmh / 140);
  if (spd > 1) spd = 1;
  const nMax = Math.min(count, out.length);
  for (let i = 0; i < nMax; i++) {
    const t = Math.fround(timeSec + Math.fround(i * invSr));
    const cycles = Math.fround(t * fund);
    const frac = Math.fround(cycles - Math.fround(Math.floor(cycles)));
    const saw = Math.fround(Math.fround(frac * 2) - 1);
    const cycles2 = Math.fround(t * Math.fround(fund * 2));
    const frac2 = Math.fround(cycles2 - Math.fround(Math.floor(cycles2)));
    const saw2 = Math.fround(Math.fround(frac2 * 2) - 1);
    const eng = Math.fround(
      Math.fround(Math.fround(saw * 0.28) + Math.fround(saw2 * 0.11)) *
        Math.fround(0.22 + Math.fround(0.78 * load)),
    );
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    let n = Math.fround(((state >>> 8) & 0xffffff) / 16777216);
    n = Math.fround(Math.fround(n * 2) - 1);
    let s = Math.fround(eng + Math.fround(Math.fround(n * spd) * 0.18));
    if (s > 1) s = 1;
    else if (s < -1) s = -1;
    out[i] = s;
  }
}

const JS_FALLBACK: StreetViewWasmAPI = {
  seed: _jsSeed,
  noise2d: _jsNoise2d,
  fillNoiseBuffer: _jsFillNoiseBuffer,
  fbm2d: _jsFbm2d,
  fillFbmBuffer: _jsFillFbmBuffer,
  fillParticleSeeds: _jsFillParticleSeeds,
  haversine: _jsHaversine,
  batchHaversine: _jsBatchHaversine,
  normalizeAngle: _jsNormalizeAngle,
  signedAngleDiff: _jsSignedAngleDiff,
  fillEngineNoise: _jsFillEngineNoise,
  lumaHistogramBt709: jsLumaHistogramBt709,
  reduceLumaBt709: jsReduceLumaBt709,
  downsample2d: jsDownsample2d,
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
    // Emscripten STANDALONE_WASM links libm statically. ALLOW_MEMORY_GROWTH
    // imports env.emscripten_notify_memory_growth; extra keys (legacy env.sin
    // / WASI stubs) are ignored. If the binary imports something not covered
    // here it will throw and we fall back to the JS implementation.
    const noopI32 = (): number => 0;
    const importObject = {
      env: {
        sin: Math.sin,
        cos: Math.cos,
        atan2: Math.atan2,
        emscripten_notify_memory_growth: (): void => {},
      },
      // WASI stubs — older STANDALONE_WASM builds may import these even for
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
    const fill_fbm_buffer = exp['fill_fbm_buffer'] as (
      ptr: number, w: number, h: number,
      scale: number, ox: number, oy: number,
      octaves: number, lacunarity: number, gain: number
    ) => void;
    const fill_particle_seeds = exp['fill_particle_seeds'] as (
      ptr: number, count: number, seed: number
    ) => void;
    const normalize_angle = exp['normalize_angle'] as (a: number) => number;
    const signed_angle_diff = exp['signed_angle_diff'] as (f: number, t: number) => number;
    const haversine_wasm = exp['haversine'] as (
      lat1: number, lon1: number, lat2: number, lon2: number
    ) => number;
    const fbm2d_wasm = exp['fbm2d'] as (
      x: number, y: number, octaves: number, lacunarity: number, gain: number
    ) => number;
    const batch_haversine = exp['batch_haversine'] as (
      ptr: number, count: number, out: number
    ) => number;
    const fill_engine_noise = exp['fill_engine_noise'] as (
      ptr: number, count: number,
      rpm: number, load: number, speed: number,
      time: number, sampleRate: number,
    ) => void;
    const luma_histogram_bt709 = exp['luma_histogram_bt709'] as (
      rgba: number, w: number, h: number, bins: number,
    ) => void;
    const reduce_luma_bt709 = exp['reduce_luma_bt709'] as (
      rgba: number, w: number, h: number, out: number,
    ) => void;
    const downsample_2d = exp['downsample_2d'] as (
      src: number, sw: number, sh: number, dst: number, dw: number, dh: number,
    ) => void;
    if (typeof luma_histogram_bt709 !== 'function'
      || typeof reduce_luma_bt709 !== 'function'
      || typeof downsample_2d !== 'function') {
      throw new Error('WASM ABI missing gpu-chores exports');
    }

    // Past Emscripten statics (perm / grad tables live in the first ~8 KiB).
    // 64 KiB is 8-byte aligned so f64 views at the base stay naturally aligned.
    const SCRATCH_OFFSET = WASM_SCRATCH_OFFSET;

    /** Grow linear memory until `bytes` are available past SCRATCH_OFFSET. */
    const reserveScratch = (bytes: number): void => {
      const available = wasmMemory.buffer.byteLength - SCRATCH_OFFSET;
      if (available < bytes) {
        wasmMemory.grow(Math.ceil((bytes - available) / 65536));
      }
    };

    const fillNoiseBuffer = (
      out: Float32Array,
      width: number,
      height: number,
      scale: number,
      offsetX: number,
      offsetY: number,
    ): void => {
      reserveScratch(width * height * 4);
      fill_noise_buffer(SCRATCH_OFFSET, width, height, scale, offsetX, offsetY);
      const view = new Float32Array(wasmMemory.buffer, SCRATCH_OFFSET, width * height);
      out.set(view);
    };

    const fillFbmBuffer = (
      out: Float32Array,
      width: number,
      height: number,
      scale: number,
      offsetX: number,
      offsetY: number,
      octaves: number,
      lacunarity: number,
      gain: number,
    ): void => {
      reserveScratch(width * height * 4);
      fill_fbm_buffer(
        SCRATCH_OFFSET, width, height, scale, offsetX, offsetY,
        octaves, lacunarity, gain,
      );
      const view = new Float32Array(wasmMemory.buffer, SCRATCH_OFFSET, width * height);
      out.set(view);
    };

    const fillParticleSeeds = (out: Float32Array, count: number, seedValue: number): void => {
      if (count <= 0) return;
      reserveScratch(count * 16);
      fill_particle_seeds(SCRATCH_OFFSET, count, seedValue);
      const view = new Float32Array(wasmMemory.buffer, SCRATCH_OFFSET, count * 4);
      out.set(view.subarray(0, Math.min(out.length, count * 4)));
    };

    const batchHaversine = (points: Float64Array, segmentsOut: Float64Array): number => {
      const count = Math.floor(points.length / 2);
      if (count < 2) return 0;
      const inBytes = count * 16;
      const outBytes = (count - 1) * 8;
      reserveScratch(inBytes + outBytes);
      const outOffset = SCRATCH_OFFSET + inBytes; // count*16 keeps this 8-aligned
      new Float64Array(wasmMemory.buffer, SCRATCH_OFFSET, count * 2).set(
        points.subarray(0, count * 2),
      );
      const total = batch_haversine(SCRATCH_OFFSET, count, outOffset);
      const view = new Float64Array(wasmMemory.buffer, outOffset, count - 1);
      segmentsOut.set(view.subarray(0, Math.min(segmentsOut.length, count - 1)));
      return total;
    };

    const fillEngineNoise = (
      out: Float32Array,
      count: number,
      rpm: number,
      load: number,
      speedKmh: number,
      timeSec: number,
      sampleRate: number,
    ): void => {
      if (count <= 0) return;
      reserveScratch(count * 4);
      fill_engine_noise(SCRATCH_OFFSET, count, rpm, load, speedKmh, timeSec, sampleRate);
      const view = new Float32Array(wasmMemory.buffer, SCRATCH_OFFSET, count);
      out.set(view.subarray(0, Math.min(out.length, count)));
    };

    const lumaHistogramBt709 = (
      rgba: Uint8Array | Uint8ClampedArray,
      width: number,
      height: number,
    ): Uint32Array => {
      if (width <= 0 || height <= 0) return new Uint32Array(256);
      const pix = width * height * 4;
      const binsOff = SCRATCH_OFFSET + ((pix + 3) & ~3);
      reserveScratch(binsOff - SCRATCH_OFFSET + 256 * 4);
      new Uint8Array(wasmMemory.buffer, SCRATCH_OFFSET, pix).set(rgba.subarray(0, pix));
      luma_histogram_bt709(SCRATCH_OFFSET, width, height, binsOff);
      return new Uint32Array(wasmMemory.buffer.slice(binsOff, binsOff + 256 * 4));
    };

    const reduceLumaBt709 = (
      rgba: Uint8Array | Uint8ClampedArray,
      width: number,
      height: number,
    ): LumaReduce => {
      if (width <= 0 || height <= 0) return { mean: 0, min: 0, max: 0, count: 0 };
      const pix = width * height * 4;
      const outOff = SCRATCH_OFFSET + ((pix + 3) & ~3);
      reserveScratch(outOff - SCRATCH_OFFSET + 12);
      new Uint8Array(wasmMemory.buffer, SCRATCH_OFFSET, pix).set(rgba.subarray(0, pix));
      reduce_luma_bt709(SCRATCH_OFFSET, width, height, outOff);
      const v = new Float32Array(wasmMemory.buffer, outOff, 3);
      return { mean: v[0]!, min: v[1]!, max: v[2]!, count: width * height };
    };

    const downsample2d = (
      src: Uint8Array | Uint8ClampedArray,
      srcW: number,
      srcH: number,
      dstW: number,
      dstH: number,
    ): Uint8Array => {
      if (srcW <= 0 || srcH <= 0 || dstW <= 0 || dstH <= 0) {
        return new Uint8Array(Math.max(0, dstW) * Math.max(0, dstH) * 4);
      }
      const srcBytes = srcW * srcH * 4;
      const dstBytes = dstW * dstH * 4;
      const dstOff = SCRATCH_OFFSET + ((srcBytes + 3) & ~3);
      reserveScratch(dstOff - SCRATCH_OFFSET + dstBytes);
      new Uint8Array(wasmMemory.buffer, SCRATCH_OFFSET, srcBytes).set(src.subarray(0, srcBytes));
      downsample_2d(SCRATCH_OFFSET, srcW, srcH, dstOff, dstW, dstH);
      return new Uint8Array(wasmMemory.buffer.slice(dstOff, dstOff + dstBytes));
    };

    _cachedModule = {
      seed,
      noise2d,
      fillNoiseBuffer,
      fbm2d: fbm2d_wasm,
      fillFbmBuffer,
      fillParticleSeeds,
      haversine: haversine_wasm,
      batchHaversine,
      normalizeAngle: normalize_angle,
      signedAngleDiff: signed_angle_diff,
      fillEngineNoise,
      lumaHistogramBt709,
      reduceLumaBt709,
      downsample2d,
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
