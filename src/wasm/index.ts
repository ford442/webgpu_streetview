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
 * The binary is the only implementation of every kernel — there is no JS
 * twin. The app loads it before the first React render (src/index.tsx) and
 * the renderer awaits the same promise during boot; a failed fetch is
 * reported on `webgpuProbe` (stage `wasm`) with the same hard-fail overlay as
 * a failed required shader. Synchronous callers use {@link requireWasm}. The ABI
 * contract itself lives in abi.ts; this file is just the loader — instantiate
 * the binary, marshal buffers across the linear memory boundary, cache the
 * result.
 */
import type {
  CabinDsp,
  CabinDspParams,
  CsrGraph,
  DepthNormalizeOptions,
  DepthNormalizeState,
  LumaAnalysis,
  LumaReduce,
  StreetViewWasmAPI,
} from './abi';
import { PUBLIC_URL } from '../config/publicUrl';
import { bindWasmExports } from './bindExports';
import { createScratchArena, WASM_STACK_SIZE } from './marshal';

export type { StreetViewWasmAPI } from './abi';
export type {
  CabinDspParams,
  DepthNormalizeOptions,
  DepthNormalizeState,
} from './abi';

// ---------------------------------------------------------------------------
// WASM loader
// ---------------------------------------------------------------------------

let _cachedModule: StreetViewWasmAPI | null = null;
let _pendingModule: Promise<StreetViewWasmAPI> | null = null;

/**
 * The two shipped binaries (cpp/CMakeLists.txt): every main-thread kernel, and
 * the cabin engine alone for the AudioWorklet. Both are SIMD128 builds; the
 * scalar build of the same sources is CI's golden reference and never ships.
 */
export type WasmBinary = 'main' | 'dsp';

const WASM_BINARY_FILES: Record<WasmBinary, string> = {
  main: 'streetview-wasm.simd.wasm',
  dsp: 'streetview-dsp.simd.wasm',
};

/**
 * A one-instruction SIMD128 module (`i32.const 0; i8x16.splat` in a
 * `() -> v128` function). `WebAssembly.validate` accepts it exactly when the
 * engine implements SIMD128.
 */
const SIMD_PROBE_MODULE = new Uint8Array([
  0, 97, 115, 109, 1, 0, 0, 0, // magic, version
  1, 5, 1, 96, 0, 1, 123, // type: () -> v128
  3, 2, 1, 0, // func 0 : type 0
  10, 8, 1, 6, 0, 65, 0, 253, 15, 11, // code: i32.const 0; i8x16.splat; end
]);

/**
 * True when this engine can run the binaries. Every WebGPU-capable browser
 * has SIMD128 (the floor is Chrome 91 / Firefox 89 / Safari 16.4), so this
 * only turns a load failure on an old engine into a readable message.
 */
export function wasmSimdSupported(): boolean {
  try {
    return typeof WebAssembly !== 'undefined' && WebAssembly.validate(SIMD_PROBE_MODULE);
  } catch {
    return false;
  }
}

/** Vite serves public/ at the root, so the binaries are at ./wasm/. */
function wasmBinaryUrl(binary: WasmBinary): string {
  return `${PUBLIC_URL}/wasm/${WASM_BINARY_FILES[binary]}`;
}

async function fetchWasmBytes(binary: WasmBinary): Promise<ArrayBuffer> {
  if (!wasmSimdSupported()) {
    throw new Error('this browser lacks WebAssembly SIMD128, which streetview-wasm requires');
  }
  const response = await fetch(wasmBinaryUrl(binary));
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.arrayBuffer();
}

const _binaries = new Map<WasmBinary, Promise<ArrayBuffer>>();

/**
 * Fetch one of the binaries once and check it is really WASM (a dev-server
 * SPA fallback answers a wrong path with HTML). Resolves to the cached bytes —
 * callers that transfer them must post a copy. This is how the cabin engine
 * gets into its AudioWorklet: Chromium refuses a structured-cloned
 * `WebAssembly.Module` there (the port gets `messageerror`), so `CabinAudio`
 * posts the `dsp` bytes and the worklet instantiates them itself. Rejects (and
 * forgets the attempt) on a fetch error or invalid bytes.
 */
export function loadStreetViewWasmBytes(binary: WasmBinary): Promise<ArrayBuffer> {
  let pending = _binaries.get(binary);
  if (!pending) {
    pending = fetchWasmBytes(binary).then((bytes) => {
      if (!WebAssembly.validate(bytes)) throw new Error(`${wasmBinaryUrl(binary)} is not a valid module`);
      return bytes;
    });
    pending.catch(() => _binaries.delete(binary));
    _binaries.set(binary, pending);
  }
  return pending;
}

/**
 * Load the main binary once; later calls return the same promise. Rejects
 * when the fetch fails or the bytes do not instantiate against the ABI — there
 * is nothing to fall back to, so the page reports it and hard-fails. A
 * rejection is forgotten, so a later call fetches again.
 */
export function loadWasmModule(): Promise<StreetViewWasmAPI> {
  if (_cachedModule) return Promise.resolve(_cachedModule);
  if (!_pendingModule) {
    const pending = loadStreetViewWasmBytes('main')
      .then((bytes) => instantiateStreetViewWasm(bytes))
      .then((mod) => {
        if (_pendingModule === pending) _cachedModule = mod;
        return mod;
      });
    pending.catch(() => {
      if (_pendingModule === pending) _pendingModule = null;
    });
    _pendingModule = pending;
  }
  return _pendingModule;
}

/**
 * Instantiate the compiled binary and wrap its exports in the
 * {@link StreetViewWasmAPI} marshalling layer. Throws on any ABI or
 * memory-layout mismatch. Exported so tests can drive the real wrappers with
 * the committed binaries (src/setupTests.ts installs the scalar one).
 */
export async function instantiateStreetViewWasm(
  bytes: BufferSource,
): Promise<StreetViewWasmAPI> {
  // Emscripten STANDALONE_WASM links libm statically; the binary's only
  // import is the ALLOW_MEMORY_GROWTH notification. Anything else it imports
  // makes instantiate throw, and loadWasmModule rejects with it.
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

  // Every export, checked against the generated ABI table (abi.h): a missing
  // export or a changed arity throws here, and loadWasmModule rejects with it.
  const { fns, memory: wasmMemory } = bindWasmExports(exp, 'main');
  const {
    seed, noise2d, fill_noise_buffer, fbm2d, fill_fbm_buffer, fill_particle_seeds,
    batch_haversine, offset_latlng, initial_bearing, polyline_resample, polyline_project,
    graph_astar, graph_nearest, fill_engine_noise, fill_cabin_ir, fill_hrtf,
    luma_histogram_bt709, reduce_luma_bt709, downsample_2d, luma_analyze,
    dsp_create, dsp_destroy, dsp_set_params, dsp_set_ir, dsp_render, dsp_max_ir_taps,
    depth_percentiles, depth_near_depth, depth_normalize,
    sv_malloc: malloc, sv_free: free,
  } = fns;
  const stackBase = fns.sv_stack_base();
  const stackSize = stackBase - fns.sv_stack_end();
  if (stackSize !== WASM_STACK_SIZE) {
    throw new Error(`WASM stack is ${stackSize} B; the loader expects -sSTACK_SIZE=${WASM_STACK_SIZE}`);
  }
  /**
   * Every kernel's inputs/outputs live in one malloc'd block above the
   * stack. `reserve` may grow memory: create views after it, never before.
   */
  const scratch = createScratchArena(malloc, free, stackBase);

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

  /** Copy a graph into scratch: offsets, neighbors, coords (8-aligned), then `extraBytes`. */
  const placeGraph = (graph: CsrGraph, extraBytes: number) => {
    const n = graph.nodeCount;
    const edges = graph.neighbors.length;
    const neighborsAt = (n + 1) * 4;
    const coordsAt = (neighborsAt + edges * 4 + 7) & ~7;
    const extraAt = coordsAt + n * 16;
    const ptr = scratch.reserve(extraAt + extraBytes);
    new Int32Array(wasmMemory.buffer, ptr, n + 1).set(graph.offsets.subarray(0, n + 1));
    if (edges > 0) new Int32Array(wasmMemory.buffer, ptr + neighborsAt, edges).set(graph.neighbors);
    new Float64Array(wasmMemory.buffer, ptr + coordsAt, n * 2).set(graph.coords.subarray(0, n * 2));
    return { offsets: ptr, neighbors: ptr + neighborsAt, coords: ptr + coordsAt, extra: ptr + extraAt };
  };

  const graphAstar = (graph: CsrGraph, from: number, to: number): Int32Array | null => {
    const n = graph.nodeCount;
    if (n <= 0 || graph.offsets.length < n + 1 || graph.coords.length < n * 2) return null;
    // Work (32 B/node, SW_GRAPH_ASTAR_WORK_BYTES_PER_NODE), then the path (≤ n nodes).
    const at = placeGraph(graph, n * 32 + n * 4);
    const pathAt = at.extra + n * 32;
    const length = graph_astar(
      at.offsets, at.neighbors, at.coords, n, graph.neighbors.length, from, to, at.extra, pathAt, n,
    );
    if (length <= 0) return null;
    return new Int32Array(wasmMemory.buffer.slice(pathAt, pathAt + length * 4));
  };

  const graphNearest = (graph: CsrGraph, lat: number, lng: number): number => {
    const n = graph.nodeCount;
    if (n <= 0 || graph.coords.length < n * 2) return -1;
    const ptr = scratch.reserve(n * 16);
    new Float64Array(wasmMemory.buffer, ptr, n * 2).set(graph.coords.subarray(0, n * 2));
    return graph_nearest(ptr, n, lat, lng);
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
    // wrapped exactly like the C++ wraps it.
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

  const lumaAnalyze = (
    rgba: Uint8Array | Uint8ClampedArray,
    width: number,
    height: number,
    dstW: number,
    dstH: number,
  ): LumaAnalysis => {
    if (width <= 0 || height <= 0 || dstW <= 0 || dstH <= 0) {
      return { bins: new Uint32Array(256), mean: 0, min: 0, max: 0, count: 0 };
    }
    const pix = width * height * 4;
    const binsRel = (pix + 3) & ~3;
    const ptr = scratch.reserve(binsRel + 256 * 4 + 12);
    const binsOff = ptr + binsRel;
    const statsOff = binsOff + 256 * 4;
    new Uint8Array(wasmMemory.buffer, ptr, pix).set(rgba.subarray(0, pix));
    luma_analyze(ptr, width, height, dstW, dstH, binsOff, statsOff);
    const stats = new Float32Array(wasmMemory.buffer, statsOff, 3);
    return {
      bins: new Uint32Array(wasmMemory.buffer.slice(binsOff, binsOff + 256 * 4)),
      mean: stats[0]!,
      min: stats[1]!,
      max: stats[2]!,
      count: dstW * dstH,
    };
  };

  const depthPercentiles = (
    disparity: Float32Array,
    lowPct: number,
    highPct: number,
  ): [number, number] => {
    const n = disparity.length;
    if (n === 0) return [0, 0];
    // [disparity n f32][scratch n f32][pad][out 2 f64]
    const outRel = (n * 8 + 7) & ~7;
    const ptr = scratch.reserve(outRel + 16);
    new Float32Array(wasmMemory.buffer, ptr, n).set(disparity);
    depth_percentiles(ptr, n, lowPct, highPct, ptr + n * 4, ptr + outRel);
    const out = new Float64Array(wasmMemory.buffer, ptr + outRel, 2);
    return [out[0]!, out[1]!];
  };

  const depthNearDepth = (
    nearness: Float32Array,
    width: number,
    height: number,
    horizonY: number,
  ): number => {
    const n = Math.max(0, width) * Math.max(0, height);
    if (n === 0 || nearness.length < n) return depth_near_depth(0, 0, 0, horizonY);
    const ptr = scratch.reserve(n * 4);
    new Float32Array(wasmMemory.buffer, ptr, n).set(nearness.subarray(0, n));
    return depth_near_depth(ptr, width, height, horizonY);
  };

  const depthNormalize = (
    disparity: Float32Array,
    state: DepthNormalizeState,
    options: DepthNormalizeOptions,
    out: Float32Array,
  ): Float32Array => {
    const n = disparity.length;
    if (n === 0) {
      state.previous = out;
      return out;
    }
    const prev = options.aligned && state.previous?.length === n ? state.previous : null;
    // [state 3 f64][disparity n f32][previous n f32][out n f32] — separate
    // regions, so `out` may be the caller's previous map.
    const dispOff = 24;
    const prevOff = dispOff + n * 4;
    const outOff = prevOff + n * 4;
    const ptr = scratch.reserve(outOff + n * 4);
    new Float64Array(wasmMemory.buffer, ptr, 3).set([state.lo, state.hi, state.nearDepth]);
    new Float32Array(wasmMemory.buffer, ptr + dispOff, n).set(disparity);
    if (prev) new Float32Array(wasmMemory.buffer, ptr + prevOff, n).set(prev);
    depth_normalize(
      ptr + dispOff, n, options.width, options.height, options.horizonY,
      options.aligned ? 1 : 0, options.sameScene ? 1 : 0,
      ptr, prev ? ptr + prevOff : 0, ptr + outOff,
    );
    const st = new Float64Array(wasmMemory.buffer, ptr, 3);
    state.lo = st[0]!;
    state.hi = st[1]!;
    state.nearDepth = st[2]!;
    out.set(new Float32Array(wasmMemory.buffer, ptr + outOff, Math.min(n, out.length)));
    state.previous = out;
    return out;
  };

  const maxIrTaps = dsp_max_ir_taps();
  /**
   * The engine keeps its own malloc'd state; the wrapper owns one more block
   * for its I/O (4 x 128 floats + the longest IR) so render/setIr never touch
   * the shared scratch arena.
   */
  const createCabinDsp = (sampleRate: number): CabinDsp | null => {
    const QUANTUM = 128;
    const state = dsp_create(sampleRate);
    if (!state) return null;
    const io = malloc((QUANTUM * 4 + maxIrTaps) * 4);
    if (!io) {
      dsp_destroy(state);
      return null;
    }
    const inL = io;
    const inR = inL + QUANTUM * 4;
    const outL = inR + QUANTUM * 4;
    const outR = outL + QUANTUM * 4;
    const irOff = outR + QUANTUM * 4;
    let alive = true;
    return {
      setParams(p: CabinDspParams): void {
        if (!alive) return;
        dsp_set_params(
          state, p.rpm, p.load, p.speedMps, p.openness, p.vehicle, p.wetRoad, p.rain,
          p.windMps, p.radioGain, Number(p.wipers) | 0,
        );
      },
      setIr(taps: Float32Array | null, count: number = taps ? taps.length : 0): void {
        if (!alive) return;
        if (!taps || count <= 0) {
          dsp_set_ir(state, 0, 0);
          return;
        }
        const n = Math.min(count, taps.length, maxIrTaps);
        new Float32Array(wasmMemory.buffer, irOff, n).set(taps.subarray(0, n));
        dsp_set_ir(state, irOff, n);
      },
      render(radioL, radioR, oL, oR, frames): void {
        if (!alive) return;
        for (let done = 0; done < frames; done += QUANTUM) {
          const n = Math.min(QUANTUM, frames - done);
          if (radioL) new Float32Array(wasmMemory.buffer, inL, n).set(radioL.subarray(done, done + n));
          if (radioR) new Float32Array(wasmMemory.buffer, inR, n).set(radioR.subarray(done, done + n));
          dsp_render(state, radioL ? inL : 0, radioR ? inR : 0, outL, outR, n);
          if (oL) oL.set(new Float32Array(wasmMemory.buffer, outL, n), done);
          if (oR) oR.set(new Float32Array(wasmMemory.buffer, outR, n), done);
        }
      },
      destroy(): void {
        if (!alive) return;
        alive = false;
        dsp_destroy(state);
        free(io);
      },
    };
  };

  return {
    seed,
    noise2d,
    fillNoiseBuffer,
    fbm2d,
    fillFbmBuffer,
    fillParticleSeeds,
    batchHaversine,
    offsetLatLng,
    initialBearing: initial_bearing,
    polylineResample,
    polylineProject,
    fillEngineNoise,
    fillCabinIr,
    fillHrtf,
    lumaHistogramBt709,
    reduceLumaBt709,
    downsample2d,
    lumaAnalyze,
    createCabinDsp,
    depthPercentiles,
    depthNearDepth,
    depthNormalize,
    graphAstar,
    graphNearest,
  };
}

/**
 * Synchronous access to the loaded module. Throws until
 * {@link loadWasmModule} has resolved — the app awaits it before the first
 * React render, so a throw here means a caller ran at import time or on a
 * path that must `await loadWasmModule()` first.
 */
export function requireWasm(): StreetViewWasmAPI {
  if (!_cachedModule) {
    throw new Error('streetview-wasm is not loaded yet: await loadWasmModule() before calling a kernel');
  }
  return _cachedModule;
}

/**
 * Install an already-instantiated module (src/setupTests.ts, which reads the
 * committed main binary from disk — Node has no server for public/wasm/).
 * @internal
 */
export function _installWasmModule(mod: StreetViewWasmAPI): void {
  _cachedModule = mod;
  _pendingModule = null;
}

/**
 * Forget the cached module and fetched bytes (tests only).
 * @internal
 */
export function _resetWasmModule(): void {
  _cachedModule = null;
  _pendingModule = null;
  _binaries.clear();
}
