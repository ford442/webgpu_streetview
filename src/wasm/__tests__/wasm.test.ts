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
