/**
 * src/wasm/__tests__/wasm.test.ts
 * Behavioural tests for the StreetView WASM wrapper, run against the committed
 * binary (src/setupTests.ts installs public/wasm/streetview-wasm.wasm). The
 * exact numbers are pinned by wasmGoldenParity.test.ts; these check the
 * documented properties (ranges, symmetry, layout) through the marshalling
 * wrappers, plus the loader's contract.
 */

import { vi } from 'vitest';
import {
  loadWasmModule,
  requireWasm,
  _installWasmModule,
  _resetWasmModule,
  type StreetViewWasmAPI,
} from '../index';
import { haversineMeters } from '../../utils/navigation';

const installed = requireWasm();

// ---- Helpers ----------------------------------------------------------------
async function getModule(): Promise<StreetViewWasmAPI> {
  return loadWasmModule();
}

// ---- seed + noise2d ---------------------------------------------------------
describe('noise2d', () => {
  test('returns a value in [-1, 1]', async () => {
    const wasm = await getModule();
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
    const wasm = await getModule();
    wasm.seed(12345);
    const a = wasm.noise2d(3.14, 2.71);
    wasm.seed(12345);
    const b = wasm.noise2d(3.14, 2.71);
    expect(a).toBe(b);
  });

  test('produces different values for different seeds', async () => {
    const wasm = await getModule();
    wasm.seed(1);
    const a = wasm.noise2d(0.5, 0.5);
    wasm.seed(2);
    const b = wasm.noise2d(0.5, 0.5);
    expect(a).not.toBe(b);
  });

  test('noise value changes smoothly (adjacent samples differ by < 1)', async () => {
    const wasm = await getModule();
    wasm.seed(99);
    const n0 = wasm.noise2d(0, 0);
    const n1 = wasm.noise2d(0.01, 0);
    expect(Math.abs(n1 - n0)).toBeLessThan(0.1);
  });
});

// ---- fillNoiseBuffer --------------------------------------------------------
describe('fillNoiseBuffer', () => {
  test('fills buffer with values in [-1, 1]', async () => {
    const wasm = await getModule();
    wasm.seed(7);
    const buf = new Float32Array(8 * 8);
    wasm.fillNoiseBuffer(buf, 8, 8, 50, 0, 0);
    for (let i = 0; i < buf.length; i++) {
      expect(buf[i]).toBeGreaterThanOrEqual(-1);
      expect(buf[i]).toBeLessThanOrEqual(1);
    }
  });

  test('produces row-major layout matching noise2d calls', async () => {
    const wasm = await getModule();
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
    const wasm = await getModule();
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
    const wasm = await getModule();
    wasm.seed(11);
    expect(wasm.fbm2d(1.25, -3.5, 1, 2.0, 0.5)).toBeCloseTo(wasm.noise2d(1.25, -3.5), 6);
  });

  test('matches the explicit octave sum', async () => {
    const wasm = await getModule();
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
    const wasm = await getModule();
    wasm.seed(3);
    expect(wasm.fbm2d(1, 1, 0, 2.0, 0.5)).toBe(0);
    expect(wasm.fbm2d(1, 1, -3, 2.0, 0.5)).toBe(0);
  });

  test('adds detail relative to a single octave', async () => {
    const wasm = await getModule();
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
    const wasm = await getModule();
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
    const wasm = await getModule();
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
    const wasm = await getModule();
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
    const wasm = await getModule();
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
    const wasm = await getModule();
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
    const wasm = await getModule();
    const short = new Float32Array(8);
    const long = new Float32Array(40);
    wasm.fillParticleSeeds(short, 2, 7);
    wasm.fillParticleSeeds(long, 10, 7);
    expect(Array.from(long.subarray(0, 8))).toEqual(Array.from(short));
  });

  test('is a no-op for a zero count', async () => {
    const wasm = await getModule();
    const buf = new Float32Array(4);
    wasm.fillParticleSeeds(buf, 0, 5);
    expect(Array.from(buf)).toEqual([0, 0, 0, 0]);
  });

  test('spreads positions across the unit square', async () => {
    const wasm = await getModule();
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

// ---- batchHaversine ---------------------------------------------------------
describe('batchHaversine', () => {
  test('segment distances match the per-pair TS haversine and sum to the total', async () => {
    const wasm = await getModule();
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
      const expected = haversineMeters(
        points[i]![0]!, points[i]![1]!,
        points[i + 1]![0]!, points[i + 1]![1]!,
      );
      expect(segments[i]).toBeCloseTo(expected, 6);
      expectedTotal += expected;
    }
    expect(total).toBeCloseTo(expectedTotal, 6);
  });

  test('returns 0 and writes nothing for fewer than two points', async () => {
    const wasm = await getModule();
    const segments = new Float64Array(2).fill(-1);
    expect(wasm.batchHaversine(new Float64Array([]), segments)).toBe(0);
    expect(wasm.batchHaversine(new Float64Array([1, 2]), segments)).toBe(0);
    expect(Array.from(segments)).toEqual([-1, -1]);
  });

  test('repeated points contribute zero-length segments', async () => {
    const wasm = await getModule();
    const segments = new Float64Array(2);
    const total = wasm.batchHaversine(
      new Float64Array([10, 20, 10, 20, 10, 20]),
      segments,
    );
    expect(total).toBe(0);
    expect(Array.from(segments)).toEqual([0, 0]);
  });
});

// ---- offsetLatLng -----------------------------------------------------------
describe('offsetLatLng', () => {
  test('lands exactly the requested distance away', async () => {
    const wasm = await getModule();
    for (let bearing = 0; bearing < 360; bearing += 45) {
      const out = wasm.offsetLatLng(40.7128, -74.006, 10, bearing);
      expect(haversineMeters(40.7128, -74.006, out.lat, out.lng)).toBeCloseTo(10, 6);
    }
  });

  test('a zero-metre step returns the start point', async () => {
    const wasm = await getModule();
    const out = wasm.offsetLatLng(51.5074, -0.1278, 0, 137);
    expect(out.lat).toBeCloseTo(51.5074, 12);
    expect(out.lng).toBeCloseTo(-0.1278, 12);
  });

  test('north/south move the latitude and leave the meridian alone', async () => {
    const wasm = await getModule();
    const north = wasm.offsetLatLng(40.7128, -74.006, 100, 0);
    const south = wasm.offsetLatLng(40.7128, -74.006, 100, 180);
    expect(north.lat).toBeGreaterThan(40.7128);
    expect(south.lat).toBeLessThan(40.7128);
    expect(north.lng).toBeCloseTo(-74.006, 12);
    expect(south.lng).toBeCloseTo(-74.006, 12);
  });

  test('east/west move the longitude in opposite directions', async () => {
    const wasm = await getModule();
    const east = wasm.offsetLatLng(40.7128, -74.006, 100, 90);
    const west = wasm.offsetLatLng(40.7128, -74.006, 100, 270);
    expect(east.lng).toBeGreaterThan(-74.006);
    expect(west.lng).toBeLessThan(-74.006);
  });
});

// ---- fillEngineNoise --------------------------------------------------------
describe('fillEngineNoise', () => {
  test('writes samples in [-1, 1]', async () => {
    const wasm = await getModule();
    const buf = new Float32Array(256);
    wasm.fillEngineNoise(buf, 256, 2200, 0.6, 40, 0.5, 22050, 44100);
    for (let i = 0; i < buf.length; i++) {
      expect(buf[i]).toBeGreaterThanOrEqual(-1);
      expect(buf[i]).toBeLessThanOrEqual(1);
    }
  });

  test('is deterministic for the same inputs', async () => {
    const wasm = await getModule();
    const a = new Float32Array(64);
    const b = new Float32Array(64);
    const pa = wasm.fillEngineNoise(a, 64, 1800, 0.4, 30, 0.25, 60000, 48000);
    const pb = wasm.fillEngineNoise(b, 64, 1800, 0.4, 30, 0.25, 60000, 48000);
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(pa).toBe(pb);
  });

  test('returns the next phase, wrapped into [0, 1)', async () => {
    const wasm = await getModule();
    const buf = new Float32Array(480);
    // 6000 rpm = 100 Hz; 480 samples at 48 kHz is exactly one cycle.
    const next = wasm.fillEngineNoise(buf, 480, 6000, 0.5, 0, 0.25, 0, 48000);
    expect(next).toBeGreaterThanOrEqual(0);
    expect(next).toBeLessThan(1);
    expect(next).toBeCloseTo(0.25, 9);
  });

  test('is a no-op for a zero count', async () => {
    const wasm = await getModule();
    const buf = new Float32Array(4);
    expect(wasm.fillEngineNoise(buf, 0, 900, 0.2, 10, 1.75, 0, 44100)).toBe(0.75);
    expect(Array.from(buf)).toEqual([0, 0, 0, 0]);
  });
});

// ---- fillCabinIr ------------------------------------------------------------
describe('fillCabinIr', () => {
  const hfTransfer = (ir: Float32Array): number => {
    let dc = 0;
    let nyquist = 0;
    for (let i = 0; i < ir.length; i++) {
      dc += ir[i]!;
      nyquist += i % 2 === 0 ? ir[i]! : -ir[i]!;
    }
    return Math.abs(nyquist) / Math.abs(dc);
  };

  const ir = async (vehicleType: number, openness: number): Promise<Float32Array> => {
    const wasm = await getModule();
    const out = new Float32Array(128);
    wasm.fillCabinIr(out, out.length, vehicleType, openness, 44100);
    return out;
  };

  test('starts with the direct path and normalises the DC gain to 1', async () => {
    const out = await ir(0, 0);
    expect(out[0]).toBeGreaterThan(0);
    const dc = out.reduce((sum, v) => sum + v, 0);
    expect(dc).toBeCloseTo(1, 4);
  });

  test('an open roof passes more high frequency than a sealed cabin', async () => {
    for (let vehicleType = 0; vehicleType < 5; vehicleType++) {
      const open = hfTransfer(await ir(vehicleType, 1));
      const closed = hfTransfer(await ir(vehicleType, 0));
      expect(open).toBeGreaterThan(closed * 2);
    }
  });

  test('clamps an out-of-range vehicle index and openness', async () => {
    expect(Array.from(await ir(99, 0))).toEqual(Array.from(await ir(4, 0)));
    expect(Array.from(await ir(-1, 0))).toEqual(Array.from(await ir(0, 0)));
    expect(Array.from(await ir(0, 4))).toEqual(Array.from(await ir(0, 1)));
  });

  test('is deterministic and a no-op for a zero count', async () => {
    expect(Array.from(await ir(2, 0.5))).toEqual(Array.from(await ir(2, 0.5)));
    const wasm = await getModule();
    const buf = new Float32Array(4);
    wasm.fillCabinIr(buf, 0, 0, 0, 44100);
    expect(Array.from(buf)).toEqual([0, 0, 0, 0]);
  });
});

// ---- requireWasm / loadWasmModule -----------------------------------------
describe('the loader', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    _installWasmModule(installed);
  });

  test('requireWasm throws until the binary has loaded', () => {
    _resetWasmModule();
    expect(() => requireWasm()).toThrow(/not loaded yet/);
  });

  test('a failed fetch rejects — there is no JS fallback — and is retried next call', async () => {
    _resetWasmModule();
    const fetchMock = vi.fn(async () => new Response('not found', { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(loadWasmModule()).rejects.toThrow(/HTTP 404/);
    expect(() => requireWasm()).toThrow();
    await expect(loadWasmModule()).rejects.toThrow(/HTTP 404/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test('an HTML answer (SPA fallback) is rejected, not instantiated', async () => {
    _resetWasmModule();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<!DOCTYPE html>', { status: 200 })));
    await expect(loadWasmModule()).rejects.toThrow(/not a valid module/);
  });

  test('loads the fetched binary once and caches it', async () => {
    _resetWasmModule();
    const { readFileSync } = await import('fs');
    const { join } = await import('path');
    const bytes = readFileSync(join(process.cwd(), 'public', 'wasm', 'streetview-wasm.wasm'));
    const fetchMock = vi.fn(async () => new Response(bytes));
    vi.stubGlobal('fetch', fetchMock);
    const [a, b] = await Promise.all([loadWasmModule(), loadWasmModule()]);
    expect(a).toBe(b);
    expect(await loadWasmModule()).toBe(a);
    expect(requireWasm()).toBe(a);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toMatch(/\/wasm\/streetview-wasm\.wasm$/);
  });

  test('returns the installed module without fetching', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await loadWasmModule()).toBe(installed);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
