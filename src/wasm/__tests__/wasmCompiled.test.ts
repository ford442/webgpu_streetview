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
  fbm2d: (x: number, y: number, octaves: number, lacunarity: number, gain: number) => number;
  fill_fbm_buffer: (
    ptr: number, w: number, h: number,
    scale: number, ox: number, oy: number,
    octaves: number, lacunarity: number, gain: number
  ) => void;
  fill_particle_seeds: (ptr: number, count: number, seed: number) => void;
  normalize_angle: (a: number) => number;
  signed_angle_diff: (from: number, to: number) => number;
  haversine: (lat1: number, lon1: number, lat2: number, lon2: number) => number;
  batch_haversine: (ptr: number, count: number, out: number) => number;
  fill_engine_noise: (
    ptr: number, count: number,
    rpm: number, load: number, speed: number,
    time: number, sampleRate: number,
  ) => void;
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
    expect(typeof exp.fbm2d).toBe('function');
    expect(typeof exp.fill_fbm_buffer).toBe('function');
    expect(typeof exp.fill_particle_seeds).toBe('function');
    expect(typeof exp.normalize_angle).toBe('function');
    expect(typeof exp.signed_angle_diff).toBe('function');
    expect(typeof exp.haversine).toBe('function');
    expect(typeof exp.batch_haversine).toBe('function');
    expect(typeof exp.fill_engine_noise).toBe('function');
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

  test('fbm2d with one octave equals noise2d', () => {
    exp.seed(11);
    expect(exp.fbm2d(1.25, -3.5, 1, 2.0, 0.5)).toBeCloseTo(exp.noise2d(1.25, -3.5), 6);
  });

  test('fbm2d matches the explicit octave sum and stays in [-1, 1]', () => {
    exp.seed(23);
    const [x, y, lacunarity, gain] = [0.7, 1.3, 2.0, 0.5];
    let sum = 0;
    let norm = 0;
    let amp = 1;
    let freq = 1;
    for (let o = 0; o < 4; o++) {
      sum += amp * exp.noise2d(x * freq, y * freq);
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    const value = exp.fbm2d(x, y, 4, lacunarity, gain);
    expect(value).toBeCloseTo(sum / norm, 5);
    expect(value).toBeGreaterThanOrEqual(-1);
    expect(value).toBeLessThanOrEqual(1);
  });

  test('fbm2d returns 0 for a non-positive octave count', () => {
    exp.seed(3);
    expect(exp.fbm2d(1, 1, 0, 2.0, 0.5)).toBe(0);
    expect(exp.fbm2d(1, 1, -3, 2.0, 0.5)).toBe(0);
  });

  test('fill_fbm_buffer writes a row-major tile matching fbm2d', () => {
    exp.seed(31);
    const w = 8;
    const h = 8;
    const scale = 12;
    const ptr = 512;
    exp.fill_fbm_buffer(ptr, w, h, scale, 0, 0, 4, 2.0, 0.5);
    const view = new Float32Array(exp.memory.buffer, ptr, w * h);
    for (let row = 0; row < h; row++) {
      for (let col = 0; col < w; col++) {
        const expected = exp.fbm2d(col / scale, row / scale, 4, 2.0, 0.5);
        expect(view[row * w + col]).toBeCloseTo(expected, 5);
      }
    }
  });

  test('fill_fbm_buffer fills a full 64x64 tile inside [-1, 1]', () => {
    exp.seed(1);
    const ptr = 512;
    exp.fill_fbm_buffer(ptr, 64, 64, 12, 3.5, -1.2, 4, 2.0, 0.5);
    const view = new Float32Array(exp.memory.buffer, ptr, 64 * 64);
    for (let i = 0; i < view.length; i++) {
      expect(view[i]).toBeGreaterThanOrEqual(-1);
      expect(view[i]).toBeLessThanOrEqual(1);
    }
  });

  test('fill_particle_seeds writes 4 floats per particle in range and is deterministic', () => {
    const count = 64;
    const ptr = 512;
    exp.fill_particle_seeds(ptr, count, 2024);
    const first = Float32Array.from(new Float32Array(exp.memory.buffer, ptr, count * 4));
    for (let i = 0; i < count; i++) {
      expect(first[i * 4]!).toBeGreaterThanOrEqual(0);
      expect(first[i * 4]!).toBeLessThan(1);
      expect(first[i * 4 + 1]!).toBeGreaterThanOrEqual(0);
      expect(first[i * 4 + 1]!).toBeLessThan(1);
      expect(first[i * 4 + 2]!).toBeGreaterThanOrEqual(0.5);
      expect(first[i * 4 + 2]!).toBeLessThan(1.5);
      expect(first[i * 4 + 3]!).toBeGreaterThanOrEqual(0);
      expect(first[i * 4 + 3]!).toBeLessThan(6.2831854);
    }

    exp.fill_particle_seeds(ptr, count, 2024);
    const again = new Float32Array(exp.memory.buffer, ptr, count * 4);
    expect(Array.from(again)).toEqual(Array.from(first));
  });

  test('fill_particle_seeds matches the JS fallback bit-for-bit', async () => {
    const { loadWasmModule, _resetWasmModule } = await import('../index');
    _resetWasmModule();
    // fetch() is unavailable here, so this resolves to the pure-JS fallback.
    const fallback = await loadWasmModule();
    expect(fallback.isWasm).toBe(false);

    const count = 32;
    const ptr = 512;
    exp.fill_particle_seeds(ptr, count, 777);
    const fromWasm = Array.from(new Float32Array(exp.memory.buffer, ptr, count * 4));

    const jsBuf = new Float32Array(count * 4);
    fallback.fillParticleSeeds(jsBuf, count, 777);
    expect(Array.from(jsBuf)).toEqual(fromWasm);
    _resetWasmModule();
  });

  test('fill_engine_noise matches the JS fallback', async () => {
    const { loadWasmModule, _resetWasmModule } = await import('../index');
    _resetWasmModule();
    const fallback = await loadWasmModule();
    expect(fallback.isWasm).toBe(false);

    const count = 48;
    const ptr = 512;
    const args = [2200, 0.55, 48, 0.75, 44100] as const;
    exp.fill_engine_noise(ptr, count, ...args);
    const fromWasm = Array.from(new Float32Array(exp.memory.buffer, ptr, count));

    const jsBuf = new Float32Array(count);
    fallback.fillEngineNoise(jsBuf, count, ...args);
    expect(fromWasm.length).toBe(count);
    for (let i = 0; i < count; i++) {
      expect(jsBuf[i]).toBeCloseTo(fromWasm[i]!, 4);
    }
    _resetWasmModule();
  });

  test('batch_haversine writes per-segment distances and returns their sum', () => {
    const points = [
      [40.7128, -74.006],
      [51.5074, -0.1278],
      [48.8566, 2.3522],
      [41.9028, 12.4964],
    ];
    const ptr = 512;
    const outPtr = ptr + points.length * 16;
    new Float64Array(exp.memory.buffer, ptr, points.length * 2).set(points.flat());

    const total = exp.batch_haversine(ptr, points.length, outPtr);
    const segments = new Float64Array(exp.memory.buffer, outPtr, points.length - 1);

    let expectedTotal = 0;
    for (let i = 0; i < points.length - 1; i++) {
      const expected = jsHaversine(
        points[i]![0]!, points[i]![1]!,
        points[i + 1]![0]!, points[i + 1]![1]!,
      );
      expect(segments[i]).toBeCloseTo(expected, 6);
      expectedTotal += expected;
    }
    expect(total).toBeCloseTo(expectedTotal, 6);
  });

  test('batch_haversine returns 0 and writes nothing for fewer than two points', () => {
    const ptr = 512;
    const outPtr = ptr + 64;
    const guard = new Float64Array(exp.memory.buffer, outPtr, 2);
    guard.set([-1, -1]);
    new Float64Array(exp.memory.buffer, ptr, 2).set([10, 20]);

    expect(exp.batch_haversine(ptr, 1, outPtr)).toBe(0);
    expect(exp.batch_haversine(ptr, 0, outPtr)).toBe(0);
    expect(Array.from(new Float64Array(exp.memory.buffer, outPtr, 2))).toEqual([-1, -1]);
  });
});
