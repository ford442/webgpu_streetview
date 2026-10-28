// @vitest-environment jsdom
import { requireWasm } from '../wasm';
import {
  FBM_TILE_GAIN,
  FBM_TILE_LACUNARITY,
  FBM_TILE_OCTAVES,
  NOISE_TILE_SCALE,
  NOISE_TILE_SEED,
  NOISE_TILE_SIZE,
  NOISE_UPDATE_INTERVAL_FRAMES,
  NoiseTileFeeder,
  fillNoiseTile,
  getNoiseTilePreference,
  perlinNoise2d,
  perlinPermutation,
} from './weatherNoiseTile';

const setSearch = (search: string) => {
  window.history.pushState({}, '', `/${search}`);
};

beforeEach(() => {
  setSearch('');
  localStorage.clear();
});

/** Bitwise equality, so -0 / +0 and NaN payloads count. */
function expectBitExact(actual: Float32Array, expected: Float32Array): void {
  expect(actual.length).toBe(expected.length);
  const a = new Uint32Array(actual.buffer, actual.byteOffset, actual.length);
  const b = new Uint32Array(expected.buffer, expected.byteOffset, expected.length);
  let mismatches = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) mismatches++;
  expect(mismatches).toBe(0);
}

describe('getNoiseTilePreference', () => {
  test('defaults to enabled with no params or storage', () => {
    expect(getNoiseTilePreference()).toBe(true);
  });

  test('?wasmNoise=off disables it', () => {
    setSearch('?wasmNoise=off');
    expect(getNoiseTilePreference()).toBe(false);
  });

  test('?wasmNoise=on re-enables it over a stored "off" preference', () => {
    localStorage.setItem('streetview.wasmNoise', 'off');
    setSearch('?wasmNoise=on');
    expect(getNoiseTilePreference()).toBe(true);
  });

  test('a stored "off" preference disables it with no query param', () => {
    localStorage.setItem('streetview.wasmNoise', 'off');
    expect(getNoiseTilePreference()).toBe(false);
  });
});

describe('Perlin tile — bit parity with the committed WASM binary', () => {
  // The WASM permutation table is module state: reseed before every
  // comparison (other suites in this worker may have called seed()).
  test.each([1, 42, 0, 0xdeadbeef])('noise2d with seed %i matches, including negative and huge coordinates', (seed) => {
    const wasm = requireWasm();
    wasm.seed(seed);
    const perm = perlinPermutation(seed);
    const coords = [
      0, 0.5, 1, -0.25, 3.75, -7.125, 255.5, 256.25, -256.75, 1e3 + 0.3, -1e5 - 0.7,
      2147483520, -2147483648, 3e9, -3e9, 1e30, Infinity, -Infinity, NaN,
    ].map(Math.fround);
    for (const x of coords) {
      for (const y of coords) {
        const got = perlinNoise2d(perm, x, y);
        const want = wasm.noise2d(x, y);
        if (Number.isNaN(want)) expect(got).toBeNaN();
        else expect(Object.is(got, want), `noise2d(${x}, ${y}) = ${got}, wasm ${want}`).toBe(true);
      }
    }
  });

  test.each([
    [0, 0],
    [3.25, -7.5],
    [123.456, 0],
    [-98765.4321, 17],
    [1e6 + 0.125, -3],
  ])('classic 64² tile at offset (%f, %f) matches fillNoiseBuffer', (ox, oy) => {
    const wasm = requireWasm();
    wasm.seed(NOISE_TILE_SEED);
    const want = new Float32Array(NOISE_TILE_SIZE * NOISE_TILE_SIZE);
    wasm.fillNoiseBuffer(want, NOISE_TILE_SIZE, NOISE_TILE_SIZE, NOISE_TILE_SCALE, ox, oy);
    const got = new Float32Array(NOISE_TILE_SIZE * NOISE_TILE_SIZE);
    fillNoiseTile(got, perlinPermutation(NOISE_TILE_SEED), NOISE_TILE_SIZE, NOISE_TILE_SIZE, NOISE_TILE_SCALE, ox, oy);
    expectBitExact(got, want);
  });

  test.each([
    [4, 2, 0.5, 0, 0],
    [4, 2, 0.5, 6.5, 0],
    [6, 1.9, 0.6, -40.75, 12.5],
    [1, 2, 0.5, 9, 9],
    [0, 2, 0.5, 9, 9],
  ])('fBm tile (octaves %i, lacunarity %f, gain %f) at (%f, %f) matches fillFbmBuffer', (octaves, lacunarity, gain, ox, oy) => {
    const wasm = requireWasm();
    wasm.seed(NOISE_TILE_SEED);
    const want = new Float32Array(NOISE_TILE_SIZE * NOISE_TILE_SIZE);
    wasm.fillFbmBuffer(want, NOISE_TILE_SIZE, NOISE_TILE_SIZE, 7.5, ox, oy, octaves, lacunarity, gain);
    const got = new Float32Array(NOISE_TILE_SIZE * NOISE_TILE_SIZE);
    fillNoiseTile(got, perlinPermutation(NOISE_TILE_SEED), NOISE_TILE_SIZE, NOISE_TILE_SIZE, 7.5, ox, oy, {
      octaves, lacunarity, gain,
    });
    expectBitExact(got, want);
  });
});

describe('NoiseTileFeeder', () => {
  test('sampleTile returns a full tile in [-1, 1] on the update cadence, with no load step', () => {
    const tile = new NoiseTileFeeder().sampleTile(0, 1.23);
    expect(tile).not.toBeNull();
    expect(tile!.length).toBe(NOISE_TILE_SIZE * NOISE_TILE_SIZE);
    for (let i = 0; i < tile!.length; i++) {
      expect(tile![i]).toBeGreaterThanOrEqual(-1);
      expect(tile![i]).toBeLessThanOrEqual(1);
    }
  });

  test('sampleTile returns null between cadence boundaries and non-null on them', () => {
    const feeder = new NoiseTileFeeder();
    expect(feeder.sampleTile(1, 0)).toBeNull();
    expect(feeder.sampleTile(NOISE_UPDATE_INTERVAL_FRAMES - 1, 0)).toBeNull();
    expect(feeder.sampleTile(NOISE_UPDATE_INTERVAL_FRAMES, 0)).not.toBeNull();
    expect(feeder.sampleTile(NOISE_UPDATE_INTERVAL_FRAMES * 2, 0)).not.toBeNull();
  });

  test('reuses the same underlying buffer instance across calls (no per-frame allocation)', () => {
    const feeder = new NoiseTileFeeder();
    const first = feeder.sampleTile(0, 0);
    const second = feeder.sampleTile(NOISE_UPDATE_INTERVAL_FRAMES, 1);
    expect(first).toBe(second);
  });

  test('defaults to the classic single-octave tile', () => {
    expect(new NoiseTileFeeder().getDetail()).toBe('classic');
    expect(new NoiseTileFeeder('fbm').getDetail()).toBe('fbm');
  });

  test('setDetail takes effect on the next tile refresh', () => {
    const feeder = new NoiseTileFeeder();
    const classic = Float32Array.from(feeder.sampleTile(0, 4.5)!);
    feeder.setDetail('fbm');
    expect(feeder.getDetail()).toBe('fbm');
    const fbm = Float32Array.from(feeder.sampleTile(0, 4.5)!);
    expect(Array.from(fbm)).not.toEqual(Array.from(classic));
    for (let i = 0; i < fbm.length; i++) {
      expect(fbm[i]).toBeGreaterThanOrEqual(-1);
      expect(fbm[i]).toBeLessThanOrEqual(1);
    }
  });

  test('the classic tile is the one the WASM feeder uploaded (seed 1, time * 2 drift)', () => {
    const wasm = requireWasm();
    wasm.seed(NOISE_TILE_SEED);
    const time = 3.25;
    const tile = Float32Array.from(new NoiseTileFeeder().sampleTile(0, time)!);
    const expected = new Float32Array(NOISE_TILE_SIZE * NOISE_TILE_SIZE);
    wasm.fillNoiseBuffer(expected, NOISE_TILE_SIZE, NOISE_TILE_SIZE, NOISE_TILE_SCALE, time * 2.0, 0);
    expectBitExact(tile, expected);
  });

  test('the fbm tile is the one the WASM feeder uploaded with the documented parameters', () => {
    const wasm = requireWasm();
    wasm.seed(NOISE_TILE_SEED);
    const time = 1234.5678;
    const tile = Float32Array.from(new NoiseTileFeeder('fbm').sampleTile(0, time)!);
    const expected = new Float32Array(NOISE_TILE_SIZE * NOISE_TILE_SIZE);
    wasm.fillFbmBuffer(
      expected, NOISE_TILE_SIZE, NOISE_TILE_SIZE, NOISE_TILE_SCALE, time * 2.0, 0,
      FBM_TILE_OCTAVES, FBM_TILE_LACUNARITY, FBM_TILE_GAIN,
    );
    expectBitExact(tile, expected);
  });
});
