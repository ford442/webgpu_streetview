/**
 * src/wasm/__tests__/wasmGoldenParity.test.ts
 *
 * Pins both shipped binaries — public/wasm/streetview-wasm.wasm (scalar: the
 * main thread) and streetview-wasm.simd.wasm (the cabin AudioWorklet) —
 * through the loader's real marshalling wrappers to the golden vectors the
 * native C++ tests use (cpp/tests/noise_module_test.cpp, cabin_dsp_test.cpp).
 *
 * The vectors in cpp/tests/goldens.json are captured from the scalar binary by
 * scripts/gen-wasm-goldens.mjs, and the identical numbers are emitted to
 * cpp/tests/goldens_generated.h for the host `ctest` run:
 *
 *   emcc wasm  →  goldens  →  C++ (ctest)          ← native host CI
 *                    →  scalar + SIMD wasm (here)
 *
 * Every comparison is exact: the binary is the only implementation, so the
 * scalar side is checking that the goldens were captured from the committed
 * bytes, and the SIMD side that -msimd128 (and the hand-vectorised FIR) did
 * not change a single bit.
 */

import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';

import { instantiateStreetViewWasm, type StreetViewWasmAPI } from '../index';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const BLOCK = 128;

interface Keyframe {
  block: number;
  rpm: number;
  load: number;
  speedMps: number;
  openness: number;
  vehicle: number;
  wetRoad: number;
  rain: number;
  windMps: number;
  radioGain: number;
  wipers: number;
  ir?: { vehicle: number; openness: number } | null;
}

interface DspScript {
  label: string;
  sampleRate: number;
  irTaps: number;
  blocks: number;
  keyframes: Keyframe[];
  excerptBlocks: number[];
  expectedChecksum: number;
  expectedExcerpts: { block: number; left: number[]; right: number[] }[];
}

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
  offsetLatLng: {
    lat: number; lng: number; distanceMeters: number; bearingDeg: number;
    expectedLat: number; expectedLng: number;
  }[];
  initialBearing: { lat1: number; lng1: number; lat2: number; lng2: number; expected: number }[];
  polylineResample: { label: string; points: number[]; stepMeters: number; expected: number[] }[];
  polylineProject: {
    label: string; points: number[]; lat: number; lng: number;
    expectedSegment: number; expectedAlong: number; expectedCross: number;
  }[];
  normalizeAngle: { angle: number; expected: number }[];
  signedAngleDiff: { from: number; to: number; expected: number }[];
  engineNoise: {
    label: string; count: number; rpm: number; load: number;
    speedKmh: number; phase: number; sampleIndex: number; sampleRate: number;
    expected: number[]; expectedPhase: number;
  }[];
  cabinIr: {
    label: string; count: number; vehicleType: number;
    openness: number; sampleRate: number; expected: number[];
  }[];
  hrtf: {
    label: string; count: number; azimuthDeg: number; sampleRate: number;
    expectedLeft: number[]; expectedRight: number[];
  }[];
  lumaHistogram: { width: number; height: number; rgba: number[]; expectedBins: number[] };
  lumaReduce: { width: number; height: number; rgba: number[]; expected: number[] };
  downsample2d: {
    width: number; height: number; rgba: number[];
    dstW: number; dstH: number; expected: number[];
  };
  lumaAnalyze: { label: string; dstW: number; dstH: number; expectedBins: number[]; expectedStats: number[] }[];
  cabinDsp: DspScript[];
  depth: {
    width: number;
    height: number;
    nanIndices: number[];
    infIndices: number[];
    stridedCount: number;
    percentiles: { label: string; values: number[] | null; low: number; high: number; expected: number[] }[];
    normalize: {
      label: string; values: number[]; aligned: boolean; sameScene: boolean; horizonY: number;
      expected: number[]; expectedState: number[];
    }[];
    nearMap: number[];
    nearDepth: { label: string; horizonY: number; expected: number }[];
  };
}

const goldens: Goldens = JSON.parse(
  readFileSync(join(REPO_ROOT, 'cpp', 'tests', 'goldens.json'), 'utf8'),
) as Goldens;

/** Exact: compares the printed doubles, so -0/+0 and the last ULP both count. */
function expectExact(actual: number, expected: number, label: string): void {
  expect(`${label}: ${actual}`).toBe(`${label}: ${expected}`);
}

/** The golden harness's radio input (see scripts/gen-wasm-goldens.mjs). */
const radioSample = (k: number, ch: number): number =>
  Math.fround((((k % 2001) * 7919 + ch * 104729) % 2001 - 1000) / 2000);

function fnv1a(h: number, samples: Float32Array): number {
  const words = new Uint32Array(samples.buffer, samples.byteOffset, samples.length);
  for (let i = 0; i < words.length; i++) {
    h ^= words[i]!;
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

interface RunResult {
  checksum: number;
  excerpts: Map<number, { left: Float32Array; right: Float32Array }>;
}

/** Run a golden script; `chunks` splits each 128-frame block into renders of those sizes. */
function runScript(api: StreetViewWasmAPI, script: DspScript, chunks: number[] = [BLOCK]): RunResult {
  const dsp = api.createCabinDsp(script.sampleRate);
  if (!dsp) throw new Error('createCabinDsp returned null');
  const byBlock = new Map(script.keyframes.map((k) => [k.block, k]));
  const ir = new Float32Array(script.irTaps);
  const inL = new Float32Array(BLOCK);
  const inR = new Float32Array(BLOCK);
  const outL = new Float32Array(BLOCK);
  const outR = new Float32Array(BLOCK);
  const excerpts = new Map<number, { left: Float32Array; right: Float32Array }>();
  let checksum = 2166136261;
  let chunkIndex = 0;
  for (let b = 0; b < script.blocks; b++) {
    const k = byBlock.get(b);
    if (k) {
      dsp.setParams({ ...k, wipers: k.wipers !== 0 });
      if (k.ir === null) dsp.setIr(null);
      else if (k.ir) {
        api.fillCabinIr(ir, script.irTaps, k.ir.vehicle, k.ir.openness, script.sampleRate);
        dsp.setIr(ir);
      }
    }
    for (let i = 0; i < BLOCK; i++) {
      inL[i] = radioSample(b * BLOCK + i, 0);
      inR[i] = radioSample(b * BLOCK + i, 1);
    }
    let done = 0;
    while (done < BLOCK) {
      const n = Math.min(chunks[chunkIndex++ % chunks.length]!, BLOCK - done);
      dsp.render(
        inL.subarray(done, done + n), inR.subarray(done, done + n),
        outL.subarray(done, done + n), outR.subarray(done, done + n), n,
      );
      done += n;
    }
    checksum = fnv1a(checksum, outL);
    checksum = fnv1a(checksum, outR);
    if (script.excerptBlocks.includes(b)) {
      excerpts.set(b, { left: outL.slice(), right: outR.slice() });
    }
  }
  dsp.destroy();
  return { checksum, excerpts };
}

function expectGolden(result: RunResult, script: DspScript): void {
  for (const e of script.expectedExcerpts) {
    const got = result.excerpts.get(e.block);
    expect(got, `${script.label} excerpt ${e.block}`).toBeDefined();
    // Compare as f32 bit patterns so -0 / +0 and the last ULP both count.
    const want = new Uint32Array(Float32Array.from(e.left).buffer);
    const wantR = new Uint32Array(Float32Array.from(e.right).buffer);
    expect(Array.from(new Uint32Array(got!.left.buffer)), `${script.label} L@${e.block}`).toEqual(Array.from(want));
    expect(Array.from(new Uint32Array(got!.right.buffer)), `${script.label} R@${e.block}`).toEqual(Array.from(wantR));
  }
  expect(result.checksum, `${script.label} checksum`).toBe(script.expectedChecksum);
}

/** A golden depth map with the documented NaN / +Infinity texels poked in. */
function depthInput(values: number[]): Float32Array {
  const map = Float32Array.from(values);
  for (const i of goldens.depth.nanIndices) map[i] = NaN;
  for (const i of goldens.depth.infIndices) map[i] = Infinity;
  return map;
}

const f32Bits = (a: Float32Array): number[] => Array.from(new Uint32Array(a.buffer, a.byteOffset, a.length));

const BINARIES = ['streetview-wasm.wasm', 'streetview-wasm.simd.wasm'] as const;

it('the goldens were captured from the committed scalar binary', () => {
  // Regenerating the wasm without regenerating the goldens would leave both
  // the C++ and the TS side asserting against a stale contract.
  const bytes = readFileSync(join(REPO_ROOT, 'public', 'wasm', 'streetview-wasm.wasm'));
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  expect(sha256).toBe(goldens.wasmSha256);
});

describe.each(BINARIES)('WASM golden parity: %s', (file) => {
  let api: StreetViewWasmAPI;

  beforeAll(async () => {
    api = await instantiateStreetViewWasm(readFileSync(join(REPO_ROOT, 'public', 'wasm', file)));
  });

  it('noise2d matches the goldens', () => {
    api.seed(goldens.noiseSeed);
    goldens.noise2d.forEach(({ x, y, expected }, i) => {
      expectExact(api.noise2d(x, y), expected, `noise2d[${i}] (${x}, ${y})`);
    });
  });

  it('fbm2d matches the goldens', () => {
    api.seed(goldens.noiseSeed);
    const { octaves, lacunarity, gain } = goldens.fbmParams;
    goldens.fbm2d.forEach(({ x, y, expected }, i) => {
      expectExact(api.fbm2d(x, y, octaves, lacunarity, gain),
        expected, `fbm2d[${i}] (${x}, ${y})`,
      );
    });
  });

  it('fillNoiseBuffer matches the goldens', () => {
    api.seed(goldens.noiseSeed);
    const t = goldens.noiseTile;
    const out = new Float32Array(t.width * t.height);
    api.fillNoiseBuffer(out, t.width, t.height, t.scale, t.offsetX, t.offsetY);
    t.expected.forEach((expected, i) => {
      expectExact(out[i]!, expected, `noiseTile[${i}]`);
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
      expectExact(out[i]!, expected, `fbmTile[${i}]`);
    });
  });

  it('fillParticleSeeds matches the goldens', () => {
    const { count, seed, expected } = goldens.particleSeeds;
    const out = new Float32Array(count * 4);
    api.fillParticleSeeds(out, count, seed);
    expected.forEach((want, i) => {
      expectExact(out[i]!, want, `particleSeeds[${i}]`);
    });
  });

  it('haversine matches the goldens', () => {
    goldens.haversine.forEach(({ lat1, lon1, lat2, lon2, expected }, i) => {
      expectExact(api.haversine(lat1, lon1, lat2, lon2),
        expected, `haversine[${i}]`,
      );
    });
  });

  it('batchHaversine matches the goldens', () => {
    const { points, expectedSegments, expectedTotal } = goldens.batchHaversine;
    const input = Float64Array.from(points);
    const segments = new Float64Array(expectedSegments.length);
    const total = api.batchHaversine(input, segments);
    expectedSegments.forEach((expected, i) => {
      expectExact(segments[i]!, expected, `segment[${i}]`);
    });
    expectExact(total, expectedTotal, 'batchHaversine total');
  });

  it('offsetLatLng matches the goldens', () => {
    goldens.offsetLatLng.forEach(
      ({ lat, lng, distanceMeters, bearingDeg, expectedLat, expectedLng }, i) => {
        const out = api.offsetLatLng(lat, lng, distanceMeters, bearingDeg);
        expectExact(out.lat, expectedLat, `offsetLatLng[${i}].lat`);
        expectExact(out.lng, expectedLng, `offsetLatLng[${i}].lng`);
      },
    );
  });

  it('initialBearing matches the goldens', () => {
    goldens.initialBearing.forEach(({ lat1, lng1, lat2, lng2, expected }, i) => {
      expectExact(api.initialBearing(lat1, lng1, lat2, lng2), expected, `initialBearing[${i}]`);
    });
  });

  it('polylineResample matches the goldens', () => {
    for (const { label, points, stepMeters, expected } of goldens.polylineResample) {
      const out = api.polylineResample(Float64Array.from(points), stepMeters);
      expect(out.length, label).toBe(expected.length);
      expected.forEach((e, k) => {
        expectExact(out[k]!, e, `polylineResample ${label}[${k}]`);
      });
    }
  });

  it('polylineProject matches the goldens', () => {
    for (const c of goldens.polylineProject) {
      const out = api.polylineProject(Float64Array.from(c.points), c.lat, c.lng);
      expect(out.segment, c.label).toBe(c.expectedSegment);
      expectExact(out.alongMeters, c.expectedAlong, `polylineProject ${c.label} along`);
      expectExact(out.crossMeters, c.expectedCross, `polylineProject ${c.label} cross`);
    }
  });

  it('normalizeAngle matches the goldens', () => {
    goldens.normalizeAngle.forEach(({ angle, expected }, i) => {
      expectExact(api.normalizeAngle(angle), expected, `normalizeAngle[${i}] (${angle})`);
    });
  });

  it('signedAngleDiff matches the goldens', () => {
    // This is the case that used to disagree between the C++ source and every
    // other implementation: fmodf keeps the dividend's sign, so a negative
    // difference needs an explicit +360 correction.
    goldens.signedAngleDiff.forEach(({ from, to, expected }, i) => {
      expectExact(api.signedAngleDiff(from, to),
        expected, `signedAngleDiff[${i}] (${from} -> ${to})`,
      );
    });
  });

  it('fillEngineNoise matches the goldens', () => {
    goldens.engineNoise.forEach((c) => {
      const out = new Float32Array(c.count);
      const next = api.fillEngineNoise(
        out, c.count, c.rpm, c.load, c.speedKmh, c.phase, c.sampleIndex, c.sampleRate,
      );
      expectExact(next, c.expectedPhase, `engineNoise[${c.label}].phase`);
      c.expected.forEach((expected, i) => {
        expectExact(out[i]!, expected, `engineNoise[${c.label}][${i}]`);
      });
    });
  });

  it('fillCabinIr matches the goldens', () => {
    goldens.cabinIr.forEach((c) => {
      const out = new Float32Array(c.count);
      api.fillCabinIr(out, c.count, c.vehicleType, c.openness, c.sampleRate);
      c.expected.forEach((expected, i) => {
        expectExact(out[i]!, expected, `cabinIr[${c.label}][${i}]`);
      });
    });
  });

  it('fillHrtf matches the goldens', () => {
    goldens.hrtf.forEach((c) => {
      const left = new Float32Array(c.count);
      const right = new Float32Array(c.count);
      api.fillHrtf(left, right, c.count, c.azimuthDeg, c.sampleRate);
      c.expectedLeft.forEach((expected, i) => {
        expectExact(left[i]!, expected, `hrtf[${c.label}].left[${i}]`);
      });
      c.expectedRight.forEach((expected, i) => {
        expectExact(right[i]!, expected, `hrtf[${c.label}].right[${i}]`);
      });
    });
  });

  it('lumaHistogramBt709 matches the goldens', () => {
    const rgba = Uint8Array.from(goldens.lumaHistogram.rgba);
    const bins = api.lumaHistogramBt709(rgba, goldens.lumaHistogram.width, goldens.lumaHistogram.height);
    goldens.lumaHistogram.expectedBins.forEach((expected, i) => {
      expect(bins[i], `hist[${i}]`).toBe(expected);
    });
  });

  it('reduceLumaBt709 matches the goldens', () => {
    const rgba = Uint8Array.from(goldens.lumaReduce.rgba);
    const reduced = api.reduceLumaBt709(rgba, goldens.lumaReduce.width, goldens.lumaReduce.height);
    expectExact(reduced.mean, goldens.lumaReduce.expected[0]!, 'reduce.mean');
    expectExact(reduced.min, goldens.lumaReduce.expected[1]!, 'reduce.min');
    expectExact(reduced.max, goldens.lumaReduce.expected[2]!, 'reduce.max');
  });

  it('downsample2d matches the goldens', () => {
    const src = Uint8Array.from(goldens.downsample2d.rgba);
    const dst = api.downsample2d(
      src,
      goldens.downsample2d.width,
      goldens.downsample2d.height,
      goldens.downsample2d.dstW,
      goldens.downsample2d.dstH,
    );
    expect([...dst]).toEqual(goldens.downsample2d.expected);
  });

  it('lumaAnalyze matches the goldens', () => {
    const img = goldens.lumaHistogram;
    for (const c of goldens.lumaAnalyze) {
      const got = api.lumaAnalyze(Uint8Array.from(img.rgba), img.width, img.height, c.dstW, c.dstH);
      expect(Array.from(got.bins), c.label).toEqual(c.expectedBins);
      expect([got.mean, got.min, got.max], c.label).toEqual(c.expectedStats);
      expect(got.count).toBe(c.dstW * c.dstH);
    }
  });

  it('depthPercentiles matches the goldens', () => {
    for (const c of goldens.depth.percentiles) {
      const input = c.values
        ? depthInput(c.values)
        : Float32Array.from({ length: goldens.depth.stridedCount }, (_, i) => ((i * 7919) % 10007) / 10007);
      expect(api.depthPercentiles(input, c.low, c.high), c.label).toEqual(c.expected);
    }
  });

  it('depthNormalize walks the golden sequence bit for bit', () => {
    const state = { lo: 0, hi: 0, nearDepth: 0, previous: null as Float32Array | null };
    const { width, height } = goldens.depth;
    for (const step of goldens.depth.normalize) {
      const out = api.depthNormalize(depthInput(step.values), state, { ...step, width, height }, new Float32Array(width * height));
      expect(f32Bits(out), step.label).toEqual(f32Bits(Float32Array.from(step.expected)));
      expect([state.lo, state.hi, state.nearDepth], step.label).toEqual(step.expectedState);
      expect(state.previous).toBe(out);
    }
  });

  it('depthNearDepth matches the goldens', () => {
    const map = Float32Array.from(goldens.depth.nearMap);
    for (const c of goldens.depth.nearDepth) {
      expectExact(api.depthNearDepth(map, goldens.depth.width, goldens.depth.height, c.horizonY), c.expected, c.label);
    }
  });

  for (const script of goldens.cabinDsp) {
    it(`cabin DSP renders "${script.label}" bit-for-bit`, () => {
      expectGolden(runScript(api, script), script);
    }, 60_000);
  }

  it('the cabin DSP does not care how a block is split', () => {
    const script = goldens.cabinDsp.find((s) => s.label === 'ir-swap-48k-2048')!;
    expectGolden(runScript(api, script, [37, 91]), script);
    expectGolden(runScript(api, script, [1, 3, 124]), script);
  });

  it('the cabin DSP wrapper renders more than one quantum per call', () => {
    const p = { rpm: 3000, load: 0.5, speedMps: 20, openness: 0.3, vehicle: 1, wetRoad: 0.5, rain: 0.4, windMps: 5, radioGain: 0, wipers: true };
    const whole = api.createCabinDsp(48000)!;
    const quanta = api.createCabinDsp(48000)!;
    whole.setParams(p);
    quanta.setParams(p);
    const a = new Float32Array(384);
    const b = new Float32Array(384);
    whole.render(null, null, a, null, 384);
    for (let done = 0; done < 384; done += BLOCK) {
      quanta.render(null, null, b.subarray(done, done + BLOCK), null, BLOCK);
    }
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(a.some((v) => v !== 0)).toBe(true);
    whole.destroy();
    whole.destroy(); // idempotent
    whole.render(null, null, a, null, 128); // no-op after destroy
    quanta.destroy();
  });
});
