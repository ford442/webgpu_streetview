/**
 * src/wasm/__tests__/wasm.test.ts
 * Unit tests for the StreetView WASM wrapper and its JS fallback.
 *
 * These tests run against the pure-JS fallback only — no real WASM binary is
 * required in the Jest/Node environment.  The fallback mirrors the compiled
 * WASM algorithm exactly, so this validates the logic for both paths.
 */

import { loadWasmModule, getWasmModule, _resetWasmModule } from '../index';

// ---- Setup: reset cached module before each test -------------------------
beforeEach(() => {
  _resetWasmModule();
});

// ---- Helpers ----------------------------------------------------------------
async function getFallback() {
  // Fetch will fail in Jest (no browser / no HTTP server), so loadWasmModule
  // always returns the JS fallback in this environment.
  return loadWasmModule();
}

// ---- seed + noise2d ---------------------------------------------------------
describe('noise2d', () => {
  test('returns a value in [-1, 1]', async () => {
    const wasm = await getFallback();
    wasm.seed(42);
    const testCoords = [
      [0, 0], [0.5, 0.5], [1.5, 2.5], [-3.7, 8.1], [100, 200],
    ];
    for (const [x, y] of testCoords) {
      const n = wasm.noise2d(x!, y!);
      expect(n).toBeGreaterThanOrEqual(-1);
      expect(n).toBeLessThanOrEqual(1);
    }
  });

  test('is deterministic for the same seed', async () => {
    const wasm = await getFallback();
    wasm.seed(12345);
    const a = wasm.noise2d(3.14, 2.71);
    wasm.seed(12345);
    const b = wasm.noise2d(3.14, 2.71);
    expect(a).toBe(b);
  });

  test('produces different values for different seeds', async () => {
    const wasm = await getFallback();
    wasm.seed(1);
    const a = wasm.noise2d(0.5, 0.5);
    wasm.seed(2);
    const b = wasm.noise2d(0.5, 0.5);
    expect(a).not.toBe(b);
  });

  test('noise value changes smoothly (adjacent samples differ by < 1)', async () => {
    const wasm = await getFallback();
    wasm.seed(99);
    const n0 = wasm.noise2d(0, 0);
    const n1 = wasm.noise2d(0.01, 0);
    expect(Math.abs(n1 - n0)).toBeLessThan(0.1);
  });
});

// ---- fillNoiseBuffer --------------------------------------------------------
describe('fillNoiseBuffer', () => {
  test('fills buffer with values in [-1, 1]', async () => {
    const wasm = await getFallback();
    wasm.seed(7);
    const buf = new Float32Array(8 * 8);
    wasm.fillNoiseBuffer(buf, 8, 8, 50, 0, 0);
    for (let i = 0; i < buf.length; i++) {
      expect(buf[i]).toBeGreaterThanOrEqual(-1);
      expect(buf[i]).toBeLessThanOrEqual(1);
    }
  });

  test('produces row-major layout matching noise2d calls', async () => {
    const wasm = await getFallback();
    wasm.seed(3);
    const w = 4;
    const h = 4;
    const scale = 30;
    const buf = new Float32Array(w * h);
    wasm.fillNoiseBuffer(buf, w, h, scale, 0, 0);
    for (let row = 0; row < h; row++) {
      for (let col = 0; col < w; col++) {
        const expected = wasm.noise2d(col / scale, row / scale);
        expect(buf[row * w + col]).toBeCloseTo(expected, 5);
      }
    }
  });
});

// ---- fbm2d ------------------------------------------------------------------
describe('fbm2d', () => {
  test('stays in [-1, 1] for a range of octave counts', async () => {
    const wasm = await getFallback();
    wasm.seed(5);
    for (const octaves of [1, 2, 4, 6]) {
      for (const [x, y] of [[0, 0], [0.3, 1.7], [-4.2, 9.9], [50, 50]]) {
        const v = wasm.fbm2d(x!, y!, octaves, 2.0, 0.5);
        expect(v).toBeGreaterThanOrEqual(-1);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  test('one octave is exactly noise2d', async () => {
    const wasm = await getFallback();
    wasm.seed(11);
    expect(wasm.fbm2d(1.25, -3.5, 1, 2.0, 0.5)).toBeCloseTo(wasm.noise2d(1.25, -3.5), 6);
  });

  test('matches the explicit octave sum', async () => {
    const wasm = await getFallback();
    wasm.seed(23);
    const [x, y, lacunarity, gain] = [0.7, 1.3, 2.0, 0.5];
    let sum = 0;
    let norm = 0;
    let amp = 1;
    let freq = 1;
    for (let o = 0; o < 4; o++) {
      sum += amp * wasm.noise2d(x * freq, y * freq);
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    expect(wasm.fbm2d(x, y, 4, lacunarity, gain)).toBeCloseTo(sum / norm, 6);
  });

  test('returns 0 for a non-positive octave count', async () => {
    const wasm = await getFallback();
    wasm.seed(3);
    expect(wasm.fbm2d(1, 1, 0, 2.0, 0.5)).toBe(0);
    expect(wasm.fbm2d(1, 1, -3, 2.0, 0.5)).toBe(0);
  });

  test('adds detail relative to a single octave', async () => {
    const wasm = await getFallback();
    wasm.seed(17);
    // Neighbouring samples of a 5-octave stack vary more than the base octave
    // because the high-frequency octaves contribute at short distances.
    const step = 0.05;
    let baseDelta = 0;
    let fbmDelta = 0;
    for (let i = 0; i < 40; i++) {
      const x = i * step;
      baseDelta += Math.abs(wasm.noise2d(x + step, 0.5) - wasm.noise2d(x, 0.5));
      fbmDelta += Math.abs(
        wasm.fbm2d(x + step, 0.5, 5, 2.0, 0.5) - wasm.fbm2d(x, 0.5, 5, 2.0, 0.5),
      );
    }
    expect(fbmDelta).toBeGreaterThan(baseDelta);
  });
});

// ---- fillFbmBuffer ---------------------------------------------------------
describe('fillFbmBuffer', () => {
  test('produces row-major layout matching fbm2d calls', async () => {
    const wasm = await getFallback();
    wasm.seed(31);
    const w = 5;
    const h = 4;
    const scale = 12;
    const buf = new Float32Array(w * h);
    wasm.fillFbmBuffer(buf, w, h, scale, 0, 0, 4, 2.0, 0.5);
    for (let row = 0; row < h; row++) {
      for (let col = 0; col < w; col++) {
        const expected = wasm.fbm2d(col / scale, row / scale, 4, 2.0, 0.5);
        expect(buf[row * w + col]).toBeCloseTo(expected, 5);
      }
    }
  });

  test('honours the offsets', async () => {
    const wasm = await getFallback();
    wasm.seed(32);
    const scale = 8;
    const a = new Float32Array(4);
    const b = new Float32Array(4);
    wasm.fillFbmBuffer(a, 2, 2, scale, 0, 0, 3, 2.0, 0.5);
    wasm.fillFbmBuffer(b, 2, 2, scale, 1, 0, 3, 2.0, 0.5);
    // Shifting X by one column makes b[0] equal a[1].
    expect(b[0]).toBeCloseTo(a[1]!, 5);
  });

  test('fills the whole 64x64 tile inside [-1, 1]', async () => {
    const wasm = await getFallback();
    wasm.seed(1);
    const buf = new Float32Array(64 * 64);
    wasm.fillFbmBuffer(buf, 64, 64, 12, 3.5, -1.2, 4, 2.0, 0.5);
    for (let i = 0; i < buf.length; i++) {
      expect(buf[i]).toBeGreaterThanOrEqual(-1);
      expect(buf[i]).toBeLessThanOrEqual(1);
    }
  });
});

// ---- fillParticleSeeds -----------------------------------------------------
describe('fillParticleSeeds', () => {
  test('writes 4 floats per particle in their documented ranges', async () => {
    const wasm = await getFallback();
    const count = 128;
    const buf = new Float32Array(count * 4);
    wasm.fillParticleSeeds(buf, count, 2024);
    for (let i = 0; i < count; i++) {
      const [x, y, speed, phase] = [buf[i * 4]!, buf[i * 4 + 1]!, buf[i * 4 + 2]!, buf[i * 4 + 3]!];
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThan(1);
      expect(speed).toBeGreaterThanOrEqual(0.5);
      expect(speed).toBeLessThan(1.5);
      expect(phase).toBeGreaterThanOrEqual(0);
      expect(phase).toBeLessThan(6.2831854);
    }
  });

  test('is deterministic per seed and differs across seeds', async () => {
    const wasm = await getFallback();
    const a = new Float32Array(16);
    const b = new Float32Array(16);
    const c = new Float32Array(16);
    wasm.fillParticleSeeds(a, 4, 99);
    wasm.fillParticleSeeds(b, 4, 99);
    wasm.fillParticleSeeds(c, 4, 100);
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(Array.from(a)).not.toEqual(Array.from(c));
  });

  test('a prefix of a longer run is identical (stream ordering is stable)', async () => {
    const wasm = await getFallback();
    const short = new Float32Array(8);
    const long = new Float32Array(40);
    wasm.fillParticleSeeds(short, 2, 7);
    wasm.fillParticleSeeds(long, 10, 7);
    expect(Array.from(long.subarray(0, 8))).toEqual(Array.from(short));
  });

  test('is a no-op for a zero count', async () => {
    const wasm = await getFallback();
    const buf = new Float32Array(4);
    wasm.fillParticleSeeds(buf, 0, 5);
    expect(Array.from(buf)).toEqual([0, 0, 0, 0]);
  });

  test('spreads positions across the unit square', async () => {
    const wasm = await getFallback();
    const count = 512;
    const buf = new Float32Array(count * 4);
    wasm.fillParticleSeeds(buf, count, 4242);
    let meanX = 0;
    let meanY = 0;
    for (let i = 0; i < count; i++) {
      meanX += buf[i * 4]!;
      meanY += buf[i * 4 + 1]!;
    }
    expect(meanX / count).toBeCloseTo(0.5, 1);
    expect(meanY / count).toBeCloseTo(0.5, 1);
  });
});

// ---- haversine --------------------------------------------------------------
describe('haversine', () => {
  test('New York → London ≈ 5570 km', async () => {
    const wasm = await getFallback();
    const dist = wasm.haversine(40.7128, -74.006, 51.5074, -0.1278);
    // Approximately 5,570 km ± 50 km.
    expect(dist / 1000).toBeCloseTo(5570, -2);
  });

  test('returns 0 for same point', async () => {
    const wasm = await getFallback();
    expect(wasm.haversine(48.8566, 2.3522, 48.8566, 2.3522)).toBe(0);
  });

  test('is symmetric', async () => {
    const wasm = await getFallback();
    const a = wasm.haversine(40.7, -74.0, 51.5, -0.1);
    const b = wasm.haversine(51.5, -0.1, 40.7, -74.0);
    expect(a).toBeCloseTo(b, 1);
  });
});

// ---- batchHaversine ---------------------------------------------------------
describe('batchHaversine', () => {
  test('segment distances match per-pair haversine calls and sum to the total', async () => {
    const wasm = await getFallback();
    const points = [
      [40.7128, -74.006],   // New York
      [51.5074, -0.1278],   // London
      [48.8566, 2.3522],    // Paris
      [41.9028, 12.4964],   // Rome
    ];
    const flat = new Float64Array(points.flat());
    const segments = new Float64Array(points.length - 1);
    const total = wasm.batchHaversine(flat, segments);

    let expectedTotal = 0;
    for (let i = 0; i < points.length - 1; i++) {
      const expected = wasm.haversine(
        points[i]![0]!, points[i]![1]!,
        points[i + 1]![0]!, points[i + 1]![1]!,
      );
      expect(segments[i]).toBeCloseTo(expected, 6);
      expectedTotal += expected;
    }
    expect(total).toBeCloseTo(expectedTotal, 6);
  });

  test('returns 0 and writes nothing for fewer than two points', async () => {
    const wasm = await getFallback();
    const segments = new Float64Array(2).fill(-1);
    expect(wasm.batchHaversine(new Float64Array([]), segments)).toBe(0);
    expect(wasm.batchHaversine(new Float64Array([1, 2]), segments)).toBe(0);
    expect(Array.from(segments)).toEqual([-1, -1]);
  });

  test('repeated points contribute zero-length segments', async () => {
    const wasm = await getFallback();
    const segments = new Float64Array(2);
    const total = wasm.batchHaversine(
      new Float64Array([10, 20, 10, 20, 10, 20]),
      segments,
    );
    expect(total).toBe(0);
    expect(Array.from(segments)).toEqual([0, 0]);
  });
});

// ---- normalizeAngle ---------------------------------------------------------
describe('normalizeAngle', () => {
  const cases: [number, number][] = [
    [0, 0],
    [360, 0],
    [450, 90],
    [-90, 270],
    [-360, 0],
    [720, 0],
    [181, 181],
  ];

  test.each(cases)('normalizeAngle(%f) = %f', async (input, expected) => {
    const wasm = await getFallback();
    expect(wasm.normalizeAngle(input)).toBeCloseTo(expected, 5);
  });
});

// ---- signedAngleDiff --------------------------------------------------------
describe('signedAngleDiff', () => {
  const cases: [number, number, number][] = [
    [0,   90,  90],
    [0,  -90, -90],
    [350,  10,  20],
    [10,  350, -20],
    [0,  180, -180],   // exactly opposite → -180 (convention matches navigation.ts)
    [180,   0, -180],  // exactly opposite → -180
    [45,  225, -180],  // exactly opposite → -180
  ];

  test.each(cases)('signedAngleDiff(%f, %f) = %f', async (from, to, expected) => {
    const wasm = await getFallback();
    expect(wasm.signedAngleDiff(from, to)).toBeCloseTo(expected, 4);
  });
});

// ---- isWasm flag ------------------------------------------------------------
describe('isWasm flag', () => {
  test('JS fallback has isWasm = false', async () => {
    const wasm = await getFallback();
    expect(wasm.isWasm).toBe(false);
  });
});

// ---- getWasmModule ----------------------------------------------------------
describe('getWasmModule', () => {
  test('returns null before loadWasmModule is called', () => {
    expect(getWasmModule()).toBeNull();
  });

  test('returns the module after loading', async () => {
    await loadWasmModule();
    expect(getWasmModule()).not.toBeNull();
  });
});

// ---- loadWasmModule caching -------------------------------------------------
describe('loadWasmModule caching', () => {
  test('returns the same instance on repeated calls', async () => {
    const a = await loadWasmModule();
    const b = await loadWasmModule();
    expect(a).toBe(b);
  });
});
