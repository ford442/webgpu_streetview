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
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import type { StreetViewWasmAPI } from '../abi';
import { instantiateStreetViewWasm } from '../index';
import { JS_FALLBACK } from '../jsFallback';
import { createScratchArena, SCRATCH_INITIAL_BYTES } from '../marshal';

const WASM_PATH = join(__dirname, '..', '..', '..', 'public', 'wasm', 'streetview-wasm.wasm');

let wasm: StreetViewWasmAPI;

beforeAll(async () => {
  wasm = await instantiateStreetViewWasm(readFileSync(WASM_PATH));
});

function route(points: number, lat: number): Float64Array {
  const p = new Float64Array(points * 2);
  for (let i = 0; i < points; i++) {
    p[i * 2] = lat + i * 1e-4;
    p[i * 2 + 1] = -1 + i * 1e-4;
  }
  return p;
}

describe('WASM scratch arena (compiled binary through the loader)', () => {
  test('instantiates the committed binary as the WASM backend', () => {
    expect(wasm.isWasm).toBe(true);
  });

  test.each([
    [1000, 60],
    [1000, 52],
    [340, 52],
    [5000, -67.5],
  ])('batchHaversine: %i points at lat %f match the JS fallback within 1e-6 m', (n, lat) => {
    const pts = route(n, lat);
    const segsWasm = new Float64Array(n - 1);
    const segsJs = new Float64Array(n - 1);
    const totalWasm = wasm.batchHaversine(pts, segsWasm);
    const totalJs = JS_FALLBACK.batchHaversine(pts, segsJs);
    expect(Math.abs(totalWasm - totalJs)).toBeLessThanOrEqual(1e-6);
    let worst = 0;
    for (let i = 0; i < n - 1; i++) worst = Math.max(worst, Math.abs(segsWasm[i]! - segsJs[i]!));
    expect(worst).toBeLessThanOrEqual(1e-6);
  });

  test('a tile larger than the initial arena grows it and still round-trips', () => {
    // 512² f32 = 1 MiB, well past SCRATCH_INITIAL_BYTES; forces free + malloc.
    expect(512 * 512 * 4).toBeGreaterThan(SCRATCH_INITIAL_BYTES);
    wasm.seed(42);
    JS_FALLBACK.seed(42);
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
    expect(Math.abs(wasm.batchHaversine(pts, segs) - JS_FALLBACK.batchHaversine(pts, new Float64Array(999))))
      .toBeLessThanOrEqual(1e-6);
  });

  test('fillEngineNoise: an hour of 1024-sample blocks has no repeated samples', () => {
    const block = new Float32Array(1024);
    const hour = 3600 * 48000;
    let phase = 0;
    let prev = 2;
    let duplicates = 0;
    for (let at = 0; at < hour; at += block.length) {
      phase = wasm.fillEngineNoise(block, block.length, 2500, 0.6, 0, phase, at, 48000);
      for (let i = 0; i < block.length; i++) {
        if (block[i] === prev) duplicates++;
        prev = block[i]!;
      }
    }
    expect(duplicates).toBe(0);
  });

  test('fillEngineNoise: the JS twin agrees bit-for-bit an hour into the drive', () => {
    const a = new Float32Array(1024);
    const b = new Float32Array(1024);
    const at = 3600 * 48000;
    const pa = wasm.fillEngineNoise(a, 1024, 2500, 0.6, 90, 0.123456789, at, 48000);
    const pb = JS_FALLBACK.fillEngineNoise(b, 1024, 2500, 0.6, 90, 0.123456789, at, 48000);
    expect(pa).toBe(pb);
    expect(Array.from(a)).toEqual(Array.from(b));
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
});
