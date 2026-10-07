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
 * A pure-JS fallback (jsFallback.ts) is used automatically when the WASM
 * file is unavailable. The ABI contract itself lives in abi.ts; this file is
 * just the loader — instantiate the binary, marshal buffers across the linear
 * memory boundary, cache the result.
 */
import type { LumaReduce, StreetViewWasmAPI } from './abi';
import { JS_FALLBACK, resetJsFallbackState } from './jsFallback';
import { createScratchArena } from './marshal';

export type { StreetViewWasmAPI } from './abi';
export type { LumaReduce } from './abi';
export { CABIN_IR_PROFILE_COUNT } from './jsFallback';

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
    _cachedModule = await instantiateStreetViewWasm(await response.arrayBuffer());
  } catch {
    _cachedModule = JS_FALLBACK;
  }

  return _cachedModule;
}

/**
 * Instantiate the compiled binary and wrap its exports in the
 * {@link StreetViewWasmAPI} marshalling layer. Throws (rather than falling
 * back) on any ABI or memory-layout mismatch; {@link loadWasmModule} turns
 * that into the JS twin. Exported so tests can drive the real wrappers with
 * the committed binary (fetch is unavailable under jsdom).
 */
export async function instantiateStreetViewWasm(
  bytes: BufferSource,
): Promise<StreetViewWasmAPI> {
  // Emscripten STANDALONE_WASM links libm statically; the binary's only
  // import is the ALLOW_MEMORY_GROWTH notification. Anything else it imports
  // makes instantiate throw, which loadWasmModule turns into the JS twin.
  const importObject = {
    env: {
      emscripten_notify_memory_growth: (): void => {},
    },
  };
  const { instance } = await WebAssembly.instantiate(bytes, importObject);
  const exp = instance.exports as Record<string, WebAssembly.ExportValue>;

  // A reactor (--no-entry) module runs its static constructors here. None
  // exist today, so this is a no-op — until someone adds a non-trivial
  // static, at which point skipping it would be a silent wrong-answer bug.
  const initialize = exp['_initialize'];
  if (typeof initialize === 'function') (initialize as () => void)();

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
  const offset_latlng = exp['offset_latlng'] as (
    lat: number, lng: number, distanceMeters: number,
    bearingDeg: number, out2: number,
  ) => void;
  const initial_bearing = exp['initial_bearing'] as (
    lat1: number, lng1: number, lat2: number, lng2: number,
  ) => number;
  const polyline_resample = exp['polyline_resample'] as (
    inPtr: number, n: number, stepMeters: number, outPtr: number, cap: number,
  ) => number;
  const polyline_project = exp['polyline_project'] as (
    ptr: number, n: number, lat: number, lng: number, out3: number,
  ) => void;
  if (typeof initial_bearing !== 'function'
    || typeof polyline_resample !== 'function'
    || typeof polyline_project !== 'function') {
    throw new Error('WASM ABI missing route-geometry exports');
  }
  const fill_engine_noise = exp['fill_engine_noise'] as (
    ptr: number, count: number,
    rpm: number, load: number, speed: number,
    phase: number, sampleIndex: number, sampleRate: number,
  ) => number;
  const fill_cabin_ir = exp['fill_cabin_ir'] as (
    ptr: number, count: number,
    vehicleType: number, openness: number, sampleRate: number,
  ) => void;
  const fill_hrtf = exp['fill_hrtf'] as (
    leftPtr: number, rightPtr: number, count: number,
    azimuthDeg: number, sampleRate: number,
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

  const malloc = exp['malloc'];
  const free = exp['free'];
  if (typeof malloc !== 'function' || typeof free !== 'function') {
    throw new Error('WASM ABI missing malloc/free (scratch arena)');
  }
  const stackBaseFn = exp['emscripten_stack_get_base'];
  const stackBase = typeof stackBaseFn === 'function'
    ? (stackBaseFn as () => number)()
    : undefined;
  /**
   * Every kernel's inputs/outputs live in one malloc'd block above the
   * stack. `reserve` may grow memory: create views after it, never before.
   */
  const scratch = createScratchArena(
    malloc as (bytes: number) => number,
    free as (ptr: number) => void,
    stackBase,
  );

  const fillNoiseBuffer = (
    out: Float32Array,
    width: number,
    height: number,
    scale: number,
    offsetX: number,
    offsetY: number,
  ): void => {
    const ptr = scratch.reserve(width * height * 4);
    fill_noise_buffer(ptr, width, height, scale, offsetX, offsetY);
    const view = new Float32Array(wasmMemory.buffer, ptr, width * height);
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
    const ptr = scratch.reserve(width * height * 4);
    fill_fbm_buffer(
      ptr, width, height, scale, offsetX, offsetY,
      octaves, lacunarity, gain,
    );
    const view = new Float32Array(wasmMemory.buffer, ptr, width * height);
    out.set(view);
  };

  const fillParticleSeeds = (out: Float32Array, count: number, seedValue: number): void => {
    if (count <= 0) return;
    const ptr = scratch.reserve(count * 16);
    fill_particle_seeds(ptr, count, seedValue);
    const view = new Float32Array(wasmMemory.buffer, ptr, count * 4);
    out.set(view.subarray(0, Math.min(out.length, count * 4)));
  };

  const batchHaversine = (points: Float64Array, segmentsOut: Float64Array): number => {
    const count = Math.floor(points.length / 2);
    if (count < 2) return 0;
    const inBytes = count * 16;
    const outBytes = (count - 1) * 8;
    const ptr = scratch.reserve(inBytes + outBytes);
    const outOffset = ptr + inBytes; // count*16 keeps this 8-aligned
    new Float64Array(wasmMemory.buffer, ptr, count * 2).set(
      points.subarray(0, count * 2),
    );
    const total = batch_haversine(ptr, count, outOffset);
    const view = new Float64Array(wasmMemory.buffer, outOffset, count - 1);
    segmentsOut.set(view.subarray(0, Math.min(segmentsOut.length, count - 1)));
    return total;
  };

  const offsetLatLng = (
    lat: number,
    lng: number,
    distanceMeters: number,
    bearingDeg: number,
  ): { lat: number; lng: number } => {
    const ptr = scratch.reserve(16); // two f64s; the arena is 8-byte aligned
    offset_latlng(lat, lng, distanceMeters, bearingDeg, ptr);
    const view = new Float64Array(wasmMemory.buffer, ptr, 2);
    return { lat: view[0]!, lng: view[1]! };
  };

  const polylineResample = (points: Float64Array, stepMeters: number): Float64Array => {
    const n = Math.floor(points.length / 2);
    if (n <= 0) return new Float64Array(0);
    const inBytes = n * 16;
    // First call sizes the output (snprintf-style), second call fills it.
    let ptr = scratch.reserve(inBytes);
    new Float64Array(wasmMemory.buffer, ptr, n * 2).set(points.subarray(0, n * 2));
    const count = polyline_resample(ptr, n, stepMeters, 0, 0);
    ptr = scratch.reserve(inBytes + count * 16);
    // reserve() may have moved the arena; copy the input in again.
    new Float64Array(wasmMemory.buffer, ptr, n * 2).set(points.subarray(0, n * 2));
    const outOffset = ptr + inBytes;
    polyline_resample(ptr, n, stepMeters, outOffset, count);
    return new Float64Array(wasmMemory.buffer.slice(outOffset, outOffset + count * 16));
  };

  const polylineProject = (
    points: Float64Array,
    lat: number,
    lng: number,
  ): { segment: number; alongMeters: number; crossMeters: number } => {
    const n = Math.floor(points.length / 2);
    const inBytes = n * 16;
    const ptr = scratch.reserve(inBytes + 24);
    if (n > 0) new Float64Array(wasmMemory.buffer, ptr, n * 2).set(points.subarray(0, n * 2));
    const outOffset = ptr + inBytes;
    polyline_project(ptr, n, lat, lng, outOffset);
    const view = new Float64Array(wasmMemory.buffer, outOffset, 3);
    return { segment: view[0]!, alongMeters: view[1]!, crossMeters: view[2]! };
  };

  const fillEngineNoise = (
    out: Float32Array,
    count: number,
    rpm: number,
    load: number,
    speedKmh: number,
    phase: number,
    sampleIndex: number,
    sampleRate: number,
  ): number => {
    // count <= 0 still goes through the kernel so the returned phase is
    // wrapped exactly like the C++ (and the JS twin) wraps it.
    const n = Math.max(0, count);
    const ptr = scratch.reserve(n * 4);
    const next = fill_engine_noise(
      ptr, n, rpm, load, speedKmh, phase, sampleIndex, sampleRate,
    );
    if (n > 0) {
      const view = new Float32Array(wasmMemory.buffer, ptr, n);
      out.set(view.subarray(0, Math.min(out.length, n)));
    }
    return next;
  };

  const fillCabinIr = (
    out: Float32Array,
    count: number,
    vehicleType: number,
    openness: number,
    sampleRate: number,
  ): void => {
    if (count <= 0) return;
    const ptr = scratch.reserve(count * 4);
    fill_cabin_ir(ptr, count, vehicleType, openness, sampleRate);
    const view = new Float32Array(wasmMemory.buffer, ptr, count);
    out.set(view.subarray(0, Math.min(out.length, count)));
  };

  const fillHrtf = (
    left: Float32Array,
    right: Float32Array,
    count: number,
    azimuthDeg: number,
    sampleRate: number,
  ): void => {
    if (count <= 0) return;
    const bytesPerEar = count * 4;
    const ptr = scratch.reserve(bytesPerEar * 2);
    const rightOffset = ptr + bytesPerEar;
    fill_hrtf(ptr, rightOffset, count, azimuthDeg, sampleRate);
    const leftView = new Float32Array(wasmMemory.buffer, ptr, count);
    const rightView = new Float32Array(wasmMemory.buffer, rightOffset, count);
    left.set(leftView.subarray(0, Math.min(left.length, count)));
    right.set(rightView.subarray(0, Math.min(right.length, count)));
  };

  const lumaHistogramBt709 = (
    rgba: Uint8Array | Uint8ClampedArray,
    width: number,
    height: number,
  ): Uint32Array => {
    if (width <= 0 || height <= 0) return new Uint32Array(256);
    const pix = width * height * 4;
    const binsRel = (pix + 3) & ~3;
    const ptr = scratch.reserve(binsRel + 256 * 4);
    const binsOff = ptr + binsRel;
    new Uint8Array(wasmMemory.buffer, ptr, pix).set(rgba.subarray(0, pix));
    luma_histogram_bt709(ptr, width, height, binsOff);
    return new Uint32Array(wasmMemory.buffer.slice(binsOff, binsOff + 256 * 4));
  };

  const reduceLumaBt709 = (
    rgba: Uint8Array | Uint8ClampedArray,
    width: number,
    height: number,
  ): LumaReduce => {
    if (width <= 0 || height <= 0) return { mean: 0, min: 0, max: 0, count: 0 };
    const pix = width * height * 4;
    const outRel = (pix + 3) & ~3;
    const ptr = scratch.reserve(outRel + 12);
    const outOff = ptr + outRel;
    new Uint8Array(wasmMemory.buffer, ptr, pix).set(rgba.subarray(0, pix));
    reduce_luma_bt709(ptr, width, height, outOff);
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
    const dstRel = (srcBytes + 3) & ~3;
    const ptr = scratch.reserve(dstRel + dstBytes);
    const dstOff = ptr + dstRel;
    new Uint8Array(wasmMemory.buffer, ptr, srcBytes).set(src.subarray(0, srcBytes));
    downsample_2d(ptr, srcW, srcH, dstOff, dstW, dstH);
    return new Uint8Array(wasmMemory.buffer.slice(dstOff, dstOff + dstBytes));
  };

  return {
    seed,
    noise2d,
    fillNoiseBuffer,
    fbm2d: fbm2d_wasm,
    fillFbmBuffer,
    fillParticleSeeds,
    haversine: haversine_wasm,
    batchHaversine,
    offsetLatLng,
    normalizeAngle: normalize_angle,
    signedAngleDiff: signed_angle_diff,
    initialBearing: initial_bearing,
    polylineResample,
    polylineProject,
    fillEngineNoise,
    fillCabinIr,
    fillHrtf,
    lumaHistogramBt709,
    reduceLumaBt709,
    downsample2d,
    isWasm: true,
  };
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
  resetJsFallbackState();
}
