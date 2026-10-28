/**
 * src/wasm/__tests__/wasmScratchArena.test.ts
 *
 * Drives the loader's real marshalling wrappers (instantiateStreetViewWasm)
 * over the committed binary — the layer where both of these bugs lived:
 *
 *   - Scratch/stack overlap. Kernel buffers used to sit at a fixed 64 KiB
 *     offset while the emcc stack grew down from 70848, so libm's sin/cos
 *     frames (|lat| > 45°) overwrote batch_haversine's input: a 12 km route
 *     at lat 60° measured 13,480 km. The arena now comes from `malloc`, above
 *     the stack, and the loader refuses a layout where it would not be.
 *   - f32 engine time. fill_engine_noise used to take the absolute stream
 *     time as f32; an hour in, most consecutive samples were duplicates.
 *
 * plus the arena's size contract (#341): it returns to the default after an
 * idle second, and a normal frame's kernels never grow it past 1 MiB.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import type { StreetViewWasmAPI } from '../abi';
import { _scratchArenaOf, instantiateStreetViewWasm } from '../index';
import {
  createScratchArena,
  SCRATCH_IDLE_SHRINK_MS,
  SCRATCH_INITIAL_BYTES,
  type ScratchClock,
} from '../marshal';
import { haversineMeters } from '../../utils/navigation';

const WASM_PATH = join(__dirname, '..', '..', '..', 'public', 'wasm', 'streetview-wasm.simd.wasm');

let wasm: StreetViewWasmAPI;
/**
 * A second instance whose arena is grown past every input below before any
 * test runs, so its kernels never relocate: the reference the relocating
 * instance must reproduce exactly.
 */
let settled: StreetViewWasmAPI;

beforeAll(async () => {
  wasm = await instantiateStreetViewWasm(readFileSync(WASM_PATH));
  // Its idle shrink never fires, so it really never relocates.
  settled = await instantiateStreetViewWasm(readFileSync(WASM_PATH), {
    scratchClock: { now: () => 0, setTimeout: () => {} },
  });
  settled.fillNoiseBuffer(new Float32Array(1024 * 1024), 1024, 1024, 1, 0, 0);
});

/** A clock the test advances by hand; due callbacks run on `advance`. */
function manualClock(): ScratchClock & { advance(ms: number): void; pending(): number } {
  let now = 0;
  let timers: { at: number; callback: () => void }[] = [];
  return {
    now: () => now,
    setTimeout: (callback, ms) => {
      timers.push({ at: now + ms, callback });
    },
    advance(ms: number): void {
      now += ms;
      for (;;) {
        const due = timers.filter((t) => t.at <= now);
        if (due.length === 0) return;
        timers = timers.filter((t) => t.at > now);
        for (const t of due) t.callback();
      }
    },
    pending: () => timers.length,
  };
}

const MiB = 1024 * 1024;

function route(points: number, lat: number): Float64Array {
  const p = new Float64Array(points * 2);
  for (let i = 0; i < points; i++) {
    p[i * 2] = lat + i * 1e-4;
    p[i * 2 + 1] = -1 + i * 1e-4;
  }
  return p;
}

describe('WASM scratch arena (compiled binary through the loader)', () => {
  test.each([
    [1000, 60],
    [1000, 52],
    [340, 52],
    [5000, -67.5],
  ])('batchHaversine: %i points at lat %f match the per-pair TS haversine within 1e-6 m', (n, lat) => {
    // haversineMeters is f64 TS, so it never touches the arena.
    const pts = route(n, lat);
    const segs = new Float64Array(n - 1);
    const total = wasm.batchHaversine(pts, segs);
    let sum = 0;
    let worst = 0;
    for (let i = 0; i < n - 1; i++) {
      const d = haversineMeters(pts[i * 2]!, pts[i * 2 + 1]!, pts[i * 2 + 2]!, pts[i * 2 + 3]!);
      sum += d;
      worst = Math.max(worst, Math.abs(segs[i]! - d));
    }
    expect(worst).toBeLessThanOrEqual(1e-6);
    expect(Math.abs(total - sum)).toBeLessThanOrEqual(1e-6);
  });

  test('a tile larger than the initial arena grows it and still round-trips', () => {
    // 512² f32 = 1 MiB, well past SCRATCH_INITIAL_BYTES; forces free + malloc.
    expect(512 * 512 * 4).toBeGreaterThan(SCRATCH_INITIAL_BYTES);
    wasm.seed(42);
    const big = new Float32Array(512 * 512);
    wasm.fillNoiseBuffer(big, 512, 512, 37.5, 3, -5);
    // Spot-check against per-sample noise2d through the (now relocated) arena.
    // Coordinates in f32, the way the kernel forms them.
    const inv = Math.fround(1 / 37.5);
    for (const [col, row] of [[0, 0], [511, 0], [0, 511], [511, 511], [257, 130]] as const) {
      const nx = Math.fround(Math.fround(col + 3) * inv);
      const ny = Math.fround(Math.fround(row - 5) * inv);
      expect(big[row * 512 + col]).toBe(wasm.noise2d(nx, ny));
    }
    // And a geodesy call after the move still lands in valid scratch.
    const pts = route(1000, 60);
    const segs = new Float64Array(999);
    expect(wasm.batchHaversine(pts, segs)).toBe(settled.batchHaversine(pts, new Float64Array(999)));
  });

  test.each([
    [1000, 60, 25],
    [5000, -67.5, 10],
    [300, 70, 1],
  ])('polylineResample: %i points at lat %f, step %f m, matches an instance that never relocates', (n, lat, step) => {
    // The sizing call reserves the input alone, the fill call input + output —
    // the second reserve can relocate the arena (5000 pts at 10 m outgrows 64 KiB).
    const pts = route(n, lat);
    const a = wasm.polylineResample(pts, step);
    const b = settled.polylineResample(pts, step);
    expect(a.length).toBeGreaterThan(0);
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  test('graphAstar on a 5000-node grid (arena regrow) matches an instance that never relocates', () => {
    // 100 x 50 grid, every street two-way except each tenth row eastbound only.
    const cols = 100;
    const rows = 50;
    const n = cols * rows;
    const coords = new Float64Array(n * 2);
    const adj: number[][] = Array.from({ length: n }, () => []);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        coords[i * 2] = 60 + r * 0.0003 + ((i * 7919) % 13) * 1e-6;
        coords[i * 2 + 1] = 10 + c * 0.0005;
        if (c + 1 < cols) {
          adj[i]!.push(i + 1);
          if (r % 10 !== 0) adj[i + 1]!.push(i);
        }
        if (r + 1 < rows) {
          adj[i]!.push(i + cols);
          adj[i + cols]!.push(i);
        }
      }
    }
    const offsets = new Int32Array(n + 1);
    const flat: number[] = [];
    adj.forEach((list, i) => {
      flat.push(...list);
      offsets[i + 1] = flat.length;
    });
    const graph = { nodeCount: n, offsets, neighbors: Int32Array.from(flat), coords };
    for (const [from, to] of [[0, n - 1], [n - 1, 0], [cols - 1, (rows - 1) * cols], [1234, 4321]] as const) {
      const a = wasm.graphAstar(graph, from, to);
      const b = settled.graphAstar(graph, from, to);
      expect(a).not.toBeNull();
      expect(Array.from(a!)).toEqual(Array.from(b!));
    }
    expect(wasm.graphNearest(graph, 60.0075, 10.025)).toBe(settled.graphNearest(graph, 60.0075, 10.025));
    expect(wasm.graphAstar({ ...graph, offsets: offsets.subarray(0, 3) }, 0, 1)).toBeNull();
  });

  test('polylineProject on a 5000-point high-latitude route matches an instance that never relocates', () => {
    const pts = route(5000, -67.5);
    for (const [dLat, dLng] of [[0.1, 0.1002], [0.25, 0.2497], [0.4999, 0.4999]] as const) {
      const a = wasm.polylineProject(pts, -67.5 + dLat, -1 + dLng);
      const b = settled.polylineProject(pts, -67.5 + dLat, -1 + dLng);
      expect(a).toEqual(b);
    }
  });

  test('fillEngineNoise: 1024-sample blocks have no repeated samples, at the start and deep into a drive', () => {
    // The old bug needed a large absolute sample clock, not a long run: walk 20 s
    // of consecutive blocks starting at 0, 1 h and 10 h instead of the whole hour.
    const block = new Float32Array(1024);
    const span = 20 * 48000;
    for (const start of [0, 3600 * 48000, 36000 * 48000]) {
      let phase = 0;
      let prev = 2;
      let duplicates = 0;
      for (let at = start; at < start + span; at += block.length) {
        phase = wasm.fillEngineNoise(block, block.length, 2500, 0.6, 0, phase, at, 48000);
        for (let i = 0; i < block.length; i++) {
          if (block[i] === prev) duplicates++;
          prev = block[i]!;
        }
      }
      expect(duplicates).toBe(0);
    }
  });
});

describe('WASM scratch arena size (compiled binary through the loader)', () => {
  test('a big input grows the arena; an idle second returns it to the default and kernels still agree', async () => {
    const clock = manualClock();
    const api = await instantiateStreetViewWasm(readFileSync(WASM_PATH), { scratchClock: clock });
    const arena = _scratchArenaOf(api)!;
    expect(arena.capacity).toBe(SCRATCH_INITIAL_BYTES);

    api.seed(42);
    api.fillNoiseBuffer(new Float32Array(512 * 512), 512, 512, 37.5, 3, -5);
    expect(arena.capacity).toBe(MiB);
    expect(arena.highWaterBytes).toBe(MiB);

    // Small kernels keep running inside the second: no shrink yet.
    const pts = route(1000, 60);
    clock.advance(SCRATCH_IDLE_SHRINK_MS - 1);
    expect(api.batchHaversine(pts, new Float64Array(999))).toBe(settled.batchHaversine(pts, new Float64Array(999)));
    expect(arena.capacity).toBe(MiB);

    clock.advance(1);
    expect(arena.capacity).toBe(SCRATCH_INITIAL_BYTES);
    expect(clock.pending()).toBe(0);
    expect(arena.highWaterBytes).toBe(MiB);

    // After the shrink, small and large kernels both still land in valid scratch.
    expect(api.batchHaversine(pts, new Float64Array(999))).toBe(settled.batchHaversine(pts, new Float64Array(999)));
    const big = route(5000, -67.5);
    expect(Array.from(api.polylineResample(big, 10))).toEqual(Array.from(settled.polylineResample(big, 10)));
    expect(arena.capacity).toBeGreaterThan(SCRATCH_INITIAL_BYTES);
    clock.advance(SCRATCH_IDLE_SHRINK_MS);
    expect(arena.capacity).toBe(SCRATCH_INITIAL_BYTES);
  });

  test("a normal frame's kernels never grow the arena past 1 MiB", async () => {
    const clock = manualClock();
    const api = await instantiateStreetViewWasm(readFileSync(WASM_PATH), { scratchClock: clock });
    const arena = _scratchArenaOf(api)!;

    // Route following on a long route (5000 vertices), and a resample of it.
    const pts = route(5000, 52);
    api.polylineProject(pts, 52.25, -0.75);
    api.batchHaversine(pts, new Float64Array(4999));
    api.offsetLatLng(52, -1, 10, 45);
    // Engine / IR / HRTF blocks.
    api.fillEngineNoise(new Float32Array(1024), 1024, 2500, 0.6, 30, 0, 0, 48000);
    api.fillCabinIr(new Float32Array(2048), 2048, 1, 0.2, 48000);
    api.fillHrtf(new Float32Array(256), new Float32Array(256), 256, 30, 48000);
    // Scene depth at its ≈252² input.
    const n = 252 * 252;
    const disparity = Float32Array.from({ length: n }, (_, i) => (i % 997) / 997);
    const [lo, hi] = api.depthPercentiles(disparity, 2, 98);
    api.depthNearDepth(disparity, 252, 252, 0.5);
    api.depthNormalize(
      disparity,
      { lo, hi, nearDepth: 0.1, previous: null },
      { width: 252, height: 252, horizonY: 0.5, aligned: true, sameScene: true },
      new Float32Array(n),
    );
    // gpu-chores CPU gauge at quarter-res of a 1080p canvas, and the snapshot
    // picker thumb's prescaled 640×360 intermediate.
    api.lumaAnalyze(new Uint8Array(480 * 270 * 4), 480, 270, 480, 270);
    api.downsample2d(new Uint8Array(640 * 360 * 4), 640, 360, 160, 90);

    expect(arena.highWaterBytes).toBeLessThanOrEqual(MiB);
    expect(arena.capacity).toBeLessThanOrEqual(MiB);
    clock.advance(SCRATCH_IDLE_SHRINK_MS);
    expect(arena.capacity).toBe(SCRATCH_INITIAL_BYTES);
  });
});

describe('createScratchArena', () => {
  function fakeHeap(start: number): {
    malloc: (n: number) => number;
    free: (p: number) => void;
    live: Set<number>;
  } {
    let next = start;
    const live = new Set<number>();
    return {
      malloc: (n: number): number => {
        const p = next;
        next += (n + 7) & ~7;
        live.add(p);
        return p;
      },
      free: (p: number): void => {
        live.delete(p);
      },
      live,
    };
  }

  test('refuses an arena below the stack base', () => {
    const heap = fakeHeap(65536);
    expect(() => createScratchArena(heap.malloc, heap.free, 70848)).toThrow(/below the stack base/);
    expect(heap.live.size).toBe(0);
  });

  test('grows by reallocating and frees the old block', () => {
    const heap = fakeHeap(80000);
    const arena = createScratchArena(heap.malloc, heap.free, 70848);
    const first = arena.reserve(16);
    expect(arena.reserve(SCRATCH_INITIAL_BYTES)).toBe(first);
    const moved = arena.reserve(SCRATCH_INITIAL_BYTES + 1);
    expect(moved).not.toBe(first);
    expect(moved % 8).toBe(0);
    expect(heap.live).toEqual(new Set([moved]));
  });

  test('rejects a failed or misaligned malloc', () => {
    expect(() => createScratchArena(() => 0, () => {})).toThrow(/malloc/);
    expect(() => createScratchArena(() => 80004, () => {})).toThrow(/unaligned/);
  });

  test('shrinks back to the default after an idle second, not before, and re-arms while large', () => {
    const heap = fakeHeap(80000);
    const clock = manualClock();
    const arena = createScratchArena(heap.malloc, heap.free, 70848, clock);
    expect(clock.pending()).toBe(0);

    arena.reserve(SCRATCH_INITIAL_BYTES * 3);
    expect(arena.capacity).toBe(SCRATCH_INITIAL_BYTES * 4);
    expect(clock.pending()).toBe(1);

    // Another large reservation half-way through restarts the idle second.
    clock.advance(SCRATCH_IDLE_SHRINK_MS / 2);
    arena.reserve(SCRATCH_INITIAL_BYTES * 2);
    expect(clock.pending()).toBe(1);
    clock.advance(SCRATCH_IDLE_SHRINK_MS / 2);
    expect(arena.capacity).toBe(SCRATCH_INITIAL_BYTES * 4);
    expect(clock.pending()).toBe(1);

    // Default-sized work does not keep it large.
    arena.reserve(16);
    clock.advance(SCRATCH_IDLE_SHRINK_MS / 2);
    expect(arena.capacity).toBe(SCRATCH_INITIAL_BYTES);
    expect(clock.pending()).toBe(0);
    expect(heap.live.size).toBe(1);
    expect(arena.highWaterBytes).toBe(SCRATCH_INITIAL_BYTES * 3);
  });

  test('never arms a timer while the arena stays at the default', () => {
    const heap = fakeHeap(80000);
    const clock = manualClock();
    const arena = createScratchArena(heap.malloc, heap.free, 70848, clock);
    for (let i = 0; i < 100; i++) arena.reserve(SCRATCH_INITIAL_BYTES);
    expect(clock.pending()).toBe(0);
    expect(arena.capacity).toBe(SCRATCH_INITIAL_BYTES);
  });

  test('shrinkTo frees the big block, keeps a smaller one, and recovers from a failed malloc', () => {
    const heap = fakeHeap(80000);
    const clock = manualClock();
    let failNext = false;
    const malloc = (n: number): number => (failNext ? 0 : heap.malloc(n));
    const arena = createScratchArena(malloc, heap.free, 70848, clock);
    arena.shrinkTo(SCRATCH_INITIAL_BYTES * 8);
    expect(arena.capacity).toBe(SCRATCH_INITIAL_BYTES);

    arena.reserve(SCRATCH_INITIAL_BYTES * 8);
    failNext = true;
    arena.shrinkTo(SCRATCH_INITIAL_BYTES);
    expect(arena.capacity).toBe(0);
    expect(heap.live.size).toBe(0);
    failNext = false;
    const ptr = arena.reserve(8);
    expect(ptr).not.toBe(0);
    expect(arena.capacity).toBe(SCRATCH_INITIAL_BYTES);
    expect(heap.live).toEqual(new Set([ptr]));
  });
});
