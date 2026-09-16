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
import { createScratchReserver } from './marshal';
import { WASM_SCRATCH_OFFSET } from './scratchOffset';

export type { StreetViewWasmAPI } from './abi';
export type { LumaReduce } from './abi';
export { WASM_SCRATCH_OFFSET } from './scratchOffset';
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

    // Past Emscripten statics (perm / grad tables live in the first ~8 KiB).
    // 64 KiB is 8-byte aligned so f64 views at the base stay naturally aligned.
    const SCRATCH_OFFSET = WASM_SCRATCH_OFFSET;

    /** Grow linear memory until `bytes` are available past SCRATCH_OFFSET. */
    const reserveScratch = createScratchReserver(wasmMemory, SCRATCH_OFFSET);

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

    const fillCabinIr = (
      out: Float32Array,
      count: number,
      vehicleType: number,
      openness: number,
      sampleRate: number,
    ): void => {
      if (count <= 0) return;
      reserveScratch(count * 4);
      fill_cabin_ir(SCRATCH_OFFSET, count, vehicleType, openness, sampleRate);
      const view = new Float32Array(wasmMemory.buffer, SCRATCH_OFFSET, count);
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
      reserveScratch(bytesPerEar * 2);
      const rightOffset = SCRATCH_OFFSET + bytesPerEar;
      fill_hrtf(SCRATCH_OFFSET, rightOffset, count, azimuthDeg, sampleRate);
      const leftView = new Float32Array(wasmMemory.buffer, SCRATCH_OFFSET, count);
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
      fillCabinIr,
      fillHrtf,
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
  resetJsFallbackState();
}
