/**
 * src/wasm/__tests__/wasmCompiled.test.ts
 *
 * Loads the actual compiled public/wasm/streetview-wasm.wasm binary directly
 * (bypassing fetch, which loadWasmModule() uses and which always fails in
 * jsdom/Node — see wasm.test.ts) so the real WASM path gets exercised too,
 * not just the pure-JS fallback. This is the only place the noise buffer's
 * memory layout and the haversine host-math-import wiring are verified end
 * to end.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

interface CompiledExports {
  memory: WebAssembly.Memory;
  seed: (s: number) => void;
  noise2d: (x: number, y: number) => number;
  fill_noise_buffer: (ptr: number, w: number, h: number, scale: number, ox: number, oy: number) => void;
  normalize_angle: (a: number) => number;
  signed_angle_diff: (from: number, to: number) => number;
  haversine: (lat1: number, lon1: number, lat2: number, lon2: number) => number;
}

function jsHaversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

let exp: CompiledExports;

beforeAll(async () => {
  const wasmPath = join(__dirname, '..', '..', '..', 'public', 'wasm', 'streetview-wasm.wasm');
  const bytes = readFileSync(wasmPath);
  // Mirrors the import object loadWasmModule() supplies in src/wasm/index.ts —
  // haversine has no built-in transcendental functions in WASM, so it calls
  // back into the host's Math.sin/cos/atan2.
  const importObject = { env: { sin: Math.sin, cos: Math.cos, atan2: Math.atan2 } };
  const { instance } = await WebAssembly.instantiate(bytes, importObject);
  exp = instance.exports as unknown as CompiledExports;
});

describe('compiled streetview-wasm.wasm binary', () => {
  test('exports every function the TypeScript wrapper expects', () => {
    expect(typeof exp.seed).toBe('function');
    expect(typeof exp.noise2d).toBe('function');
    expect(typeof exp.fill_noise_buffer).toBe('function');
    expect(typeof exp.normalize_angle).toBe('function');
    expect(typeof exp.signed_angle_diff).toBe('function');
    expect(typeof exp.haversine).toBe('function');
  });

  test('haversine matches the JS reference formula via the host math imports', () => {
    const cases: [number, number, number, number][] = [
      [40.7128, -74.006, 51.5074, -0.1278],
      [48.8566, 2.3522, 48.8566, 2.3522],
      [0, 0, 0, 179.999],
      [89.9, 0, -89.9, 180],
      [-33.8688, 151.2093, 35.6762, 139.6503],
    ];
    for (const [lat1, lon1, lat2, lon2] of cases) {
      expect(exp.haversine(lat1, lon1, lat2, lon2)).toBeCloseTo(
        jsHaversine(lat1, lon1, lat2, lon2),
        6
      );
    }
  });

  test('haversine returns exactly 0 for identical points', () => {
    expect(exp.haversine(48.8566, 2.3522, 48.8566, 2.3522)).toBe(0);
  });

  test('haversine is symmetric', () => {
    const a = exp.haversine(40.7, -74.0, 51.5, -0.1);
    const b = exp.haversine(51.5, -0.1, 40.7, -74.0);
    expect(a).toBe(b);
  });

  test('fill_noise_buffer writes a row-major tile into WASM linear memory matching noise2d', () => {
    exp.seed(7);
    const w = 8;
    const h = 8;
    const scale = 20;
    const ptr = 512; // scratch region used past the 512-byte permutation table
    exp.fill_noise_buffer(ptr, w, h, scale, 0, 0);
    const view = new Float32Array(exp.memory.buffer, ptr, w * h);
    for (let row = 0; row < h; row++) {
      for (let col = 0; col < w; col++) {
        const expected = exp.noise2d(col / scale, row / scale);
        expect(view[row * w + col]).toBeCloseTo(expected, 5);
      }
    }
  });

  test('fill_noise_buffer values stay in [-1, 1]', () => {
    exp.seed(99);
    const w = 64;
    const h = 64;
    const ptr = 512;
    exp.fill_noise_buffer(ptr, w, h, 12, 3.5, -1.2);
    const view = new Float32Array(exp.memory.buffer, ptr, w * h);
    for (let i = 0; i < view.length; i++) {
      expect(view[i]).toBeGreaterThanOrEqual(-1);
      expect(view[i]).toBeLessThanOrEqual(1);
    }
  });
});
