/**
 * src/wasm/__tests__/wasmGoldenParity.test.ts
 *
 * Pins the pure-JS fallback in src/wasm/index.ts to the same golden vectors the
 * native C++ tests use (cpp/tests/noise_module_test.cpp).
 *
 * The vectors in cpp/tests/goldens.json are captured from the shipping binary
 * public/wasm/streetview-wasm.wasm by scripts/gen-wasm-goldens.mjs, and the
 * identical numbers are emitted to cpp/tests/goldens_generated.h for the host
 * `ctest` run. So the same contract covers all three implementations:
 *
 *   WAT/wasm  →  goldens  →  C++ (ctest)      ← native host CI
 *                         →  JS fallback (here)
 *
 * Without this, a C++ change could pass the native tests while the JS twin —
 * the code that actually runs in jsdom and on WebAssembly-less browsers —
 * quietly drifted.
 *
 * Tolerances: the JS fallback computes in double precision and rounds once, at
 * the Float32Array store; the WASM module rounds to f32 after every operation.
 * The two therefore agree to a few f32 ULP rather than bit-for-bit on the noise
 * and PCM paths. The integer-LCG paths (particle seeds) and the angle helpers
 * are exact and are asserted as such. See TOLERANCES below for the measured
 * worst cases.
 */

import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';

import { loadWasmModule, _resetWasmModule, type StreetViewWasmAPI } from '../index';

const REPO_ROOT = join(__dirname, '..', '..', '..');

interface Goldens {
  wasmSha256: string;
  noiseSeed: number;
  fbmParams: { octaves: number; lacunarity: number; gain: number };
  noise2d: { x: number; y: number; expected: number }[];
  fbm2d: { x: number; y: number; expected: number }[];
  noiseTile: {
    width: number; height: number; scale: number;
    offsetX: number; offsetY: number; expected: number[];
  };
  fbmTile: {
    width: number; height: number; scale: number;
    offsetX: number; offsetY: number;
    octaves: number; lacunarity: number; gain: number; expected: number[];
  };
  particleSeeds: { count: number; seed: number; expected: number[] };
  haversine: { lat1: number; lon1: number; lat2: number; lon2: number; expected: number }[];
  batchHaversine: { points: number[]; expectedSegments: number[]; expectedTotal: number };
  normalizeAngle: { angle: number; expected: number }[];
  signedAngleDiff: { from: number; to: number; expected: number }[];
  engineNoise: {
    label: string; count: number; rpm: number; load: number;
    speedKmh: number; timeSec: number; sampleRate: number; expected: number[];
  }[];
}

const goldens: Goldens = JSON.parse(
  readFileSync(join(REPO_ROOT, 'cpp', 'tests', 'goldens.json'), 'utf8'),
) as Goldens;

/**
 * Absolute tolerances, sized from the measured worst case with headroom.
 * `0` means the comparison is exact — those paths really are bit-for-bit and a
 * regression there is drift, not rounding.
 *
 * Measured worst-case |JS - golden| at the time of writing:
 *   noise2d 1.2e-8 · fbm2d 7.4e-9 · noise tile 2.2e-7 · fBm tile 9.3e-8
 *   engine PCM 3.0e-8 · particle seeds 0 · angle helpers 0
 */
const TOLERANCES = {
  /**
   * ≈4 f32 ULP near 1.0. Covers every path where the JS twin accumulates in
   * double and rounds once while the module rounds after each operation.
   */
  f32RoundingOrder: 5e-7,
  /** Both sides use the host's Math.sin/cos/atan2 in double precision. */
  haversineRelative: 1e-12,
  /** Integer-LCG and fmod paths: no accumulation, so exact agreement. */
  exact: 0,
} as const;

function expectClose(actual: number, expected: number, tol: number, label: string): void {
  if (tol === 0) {
    expect(`${label}: ${actual}`).toBe(`${label}: ${expected}`);
    return;
  }
  const delta = Math.abs(actual - expected);
  if (delta > tol) {
    throw new Error(`${label}: ${actual} != ${expected} (delta ${delta} > ${tol})`);
  }
}

function expectRelClose(actual: number, expected: number, tol: number, label: string): void {
  const denom = Math.abs(expected);
  const rel = denom > 1e-12 ? Math.abs(actual - expected) / denom : Math.abs(actual - expected);
  if (rel > tol) {
    throw new Error(`${label}: ${actual} != ${expected} (relative ${rel} > ${tol})`);
  }
}

let api: StreetViewWasmAPI;

beforeAll(async () => {
  _resetWasmModule();
  // jsdom has no fetch for public/wasm/, so loadWasmModule() resolves to the
  // pure-JS fallback. That is exactly the implementation under test here.
  api = await loadWasmModule();
});

afterAll(() => {
  _resetWasmModule();
});

describe('WASM golden parity (JS fallback)', () => {
  it('is exercising the JS fallback, not the compiled module', () => {
    expect(api.isWasm).toBe(false);
  });

  it('the goldens were captured from the committed binary', () => {
    // Regenerating the wasm without regenerating the goldens would leave both
    // the C++ and the JS side asserting against a stale contract.
    const bytes = readFileSync(join(REPO_ROOT, 'public', 'wasm', 'streetview-wasm.wasm'));
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    expect(sha256).toBe(goldens.wasmSha256);
  });

  it('noise2d matches the goldens', () => {
    api.seed(goldens.noiseSeed);
    goldens.noise2d.forEach(({ x, y, expected }, i) => {
      expectClose(api.noise2d(x, y), expected, TOLERANCES.f32RoundingOrder, `noise2d[${i}] (${x}, ${y})`);
    });
  });

  it('fbm2d matches the goldens', () => {
    api.seed(goldens.noiseSeed);
    const { octaves, lacunarity, gain } = goldens.fbmParams;
    goldens.fbm2d.forEach(({ x, y, expected }, i) => {
      expectClose(
        api.fbm2d(x, y, octaves, lacunarity, gain),
        expected,
        TOLERANCES.f32RoundingOrder,
        `fbm2d[${i}] (${x}, ${y})`,
      );
    });
  });

  it('fillNoiseBuffer matches the goldens', () => {
    api.seed(goldens.noiseSeed);
    const t = goldens.noiseTile;
    const out = new Float32Array(t.width * t.height);
    api.fillNoiseBuffer(out, t.width, t.height, t.scale, t.offsetX, t.offsetY);
    t.expected.forEach((expected, i) => {
      expectClose(out[i]!, expected, TOLERANCES.f32RoundingOrder, `noiseTile[${i}]`);
    });
  });

  it('fillFbmBuffer matches the goldens', () => {
    api.seed(goldens.noiseSeed);
    const t = goldens.fbmTile;
    const out = new Float32Array(t.width * t.height);
    api.fillFbmBuffer(
      out, t.width, t.height, t.scale, t.offsetX, t.offsetY,
      t.octaves, t.lacunarity, t.gain,
    );
    t.expected.forEach((expected, i) => {
      expectClose(out[i]!, expected, TOLERANCES.f32RoundingOrder, `fbmTile[${i}]`);
    });
  });

  it('fillParticleSeeds matches the goldens bit-for-bit', () => {
    const { count, seed, expected } = goldens.particleSeeds;
    const out = new Float32Array(count * 4);
    api.fillParticleSeeds(out, count, seed);
    expected.forEach((want, i) => {
      expectClose(out[i]!, want, TOLERANCES.exact, `particleSeeds[${i}]`);
    });
  });

  it('haversine matches the goldens', () => {
    goldens.haversine.forEach(({ lat1, lon1, lat2, lon2, expected }, i) => {
      expectRelClose(
        api.haversine(lat1, lon1, lat2, lon2),
        expected,
        TOLERANCES.haversineRelative,
        `haversine[${i}]`,
      );
    });
  });

  it('batchHaversine matches the goldens', () => {
    const { points, expectedSegments, expectedTotal } = goldens.batchHaversine;
    const input = Float64Array.from(points);
    const segments = new Float64Array(expectedSegments.length);
    const total = api.batchHaversine(input, segments);
    expectedSegments.forEach((expected, i) => {
      expectRelClose(segments[i]!, expected, TOLERANCES.haversineRelative, `segment[${i}]`);
    });
    expectRelClose(total, expectedTotal, TOLERANCES.haversineRelative, 'batchHaversine total');
  });

  it('normalizeAngle matches the goldens', () => {
    goldens.normalizeAngle.forEach(({ angle, expected }, i) => {
      expectClose(api.normalizeAngle(angle), expected, TOLERANCES.exact, `normalizeAngle[${i}] (${angle})`);
    });
  });

  it('signedAngleDiff matches the goldens', () => {
    // This is the case that used to disagree between the C++ source and every
    // other implementation: fmodf keeps the dividend's sign, so a negative
    // difference needs an explicit +360 correction.
    goldens.signedAngleDiff.forEach(({ from, to, expected }, i) => {
      expectClose(
        api.signedAngleDiff(from, to),
        expected,
        TOLERANCES.exact,
        `signedAngleDiff[${i}] (${from} -> ${to})`,
      );
    });
  });

  it('fillEngineNoise matches the goldens', () => {
    goldens.engineNoise.forEach((c) => {
      const out = new Float32Array(c.count);
      api.fillEngineNoise(out, c.count, c.rpm, c.load, c.speedKmh, c.timeSec, c.sampleRate);
      c.expected.forEach((expected, i) => {
        expectClose(out[i]!, expected, TOLERANCES.f32RoundingOrder, `engineNoise[${c.label}][${i}]`);
      });
    });
  });
});
