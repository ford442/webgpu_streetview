#!/usr/bin/env node
/**
 * scripts/gen-wasm-goldens.mjs
 *
 * Generate the cross-implementation golden vectors for the WASM numeric ABI.
 *
 * One C++ source (cpp/src/*_module.cpp), built two ways:
 *
 *   1. public/wasm/streetview-wasm{,.simd}.wasm  – what actually ships (emcc)
 *   2. the host build                            – native ctest, four compilers
 *
 * The goldens are captured **from the shipping scalar binary** and then
 * asserted against (2) by the native host tests (cpp/tests/*_test.cpp) and
 * against both binaries, through the TS loader's wrappers, by
 * src/wasm/__tests__/wasmGoldenParity.test.ts. There is no JS twin: a
 * compiler, flag or SIMD change that moves one bit shows up as a failure.
 *
 * Outputs (both committed):
 *   cpp/tests/goldens.json            – consumed by Vitest (both binaries)
 *   cpp/tests/goldens_generated.h     – consumed by the native host tests
 *
 * Usage:
 *   npm run gen:wasm-goldens          # after a deliberate algorithm change
 *   node scripts/gen-wasm-goldens.mjs --compare   # SIMD CI: vectors must match
 *
 * Flags:
 *   --wasm <path>  --json-out <path>  --header-out <path>  --compare
 *
 * Regenerating is an explicit act: it re-baselines the contract, so the diff
 * should always be reviewed alongside the algorithm change that caused it.
 */

import { createHash } from 'crypto';
import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flagValue = (flag) => {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
};
const compareOnly = argv.includes('--compare');
const wasmPath = flagValue('--wasm') || join(repoRoot, 'public', 'wasm', 'streetview-wasm.wasm');
const jsonOut = flagValue('--json-out') || join(repoRoot, 'cpp', 'tests', 'goldens.json');
const headerOut = flagValue('--header-out') || join(repoRoot, 'cpp', 'tests', 'goldens_generated.h');

const bytes = readFileSync(wasmPath);
const wasmSha256 = createHash('sha256').update(bytes).digest('hex');

// Same import object and start-up as src/wasm/index.ts
// (instantiateStreetViewWasm).
const importObject = {
  env: {
    emscripten_notify_memory_growth: () => {},
  },
};
const { instance } = await WebAssembly.instantiate(bytes, importObject);
/** @type {Record<string, any>} Raw wasm exports: functions, memory, globals. */
const exp = instance.exports;
const memory = exp.memory;
if (typeof exp._initialize === 'function') exp._initialize();

// Scratch comes from the module's own malloc, exactly like the loader's arena
// (src/wasm/marshal.ts) — never a fixed offset, which can land inside the
// downward-growing C++ stack. Every fixture below is tiny; one block covers
// them all, and reserve() refuses to silently overrun it.
const SCRATCH_BYTES = 64 * 1024;
const SCRATCH = exp.malloc(SCRATCH_BYTES);
if (!SCRATCH || SCRATCH % 8 !== 0) throw new Error(`malloc(${SCRATCH_BYTES}) -> ${SCRATCH}`);
if (typeof exp.emscripten_stack_get_base === 'function'
  && SCRATCH < exp.emscripten_stack_get_base()) {
  throw new Error(`scratch ${SCRATCH} is below the stack base ${exp.emscripten_stack_get_base()}`);
}

const reserve = (nbytes) => {
  if (nbytes > SCRATCH_BYTES) {
    throw new Error(`golden fixture needs ${nbytes} B of scratch; raise SCRATCH_BYTES`);
  }
};

// ---------------------------------------------------------------------------
// Fixture inputs. Deliberately include negative, fractional and wrap-around
// coordinates: an off-by-one in the permutation-table wrap only shows up at
// negative inputs, and fast_floor()/Math.floor() only disagree there.
// ---------------------------------------------------------------------------

/** Every noise/fBm golden below is captured with this permutation seed. */
const NOISE_SEED = 1337;

const NOISE_POINTS = [
  [0, 0], [0.5, 0.5], [1.25, -3.75], [-0.25, 0.125],
  [12.5, 7.5], [-12.5, -7.5], [255.5, 255.5], [256.5, 257.25],
  [1000.125, -1000.125], [0.0009765625, 0.0009765625],
];

const FBM_PARAMS = { octaves: 5, lacunarity: 2, gain: 0.5 };
const FBM_POINTS = [
  [0, 0], [0.5, 0.5], [3.25, -1.75], [-8.125, 4.0625], [64.5, -64.5],
];

const NOISE_TILE = { width: 8, height: 6, scale: 12.5, offsetX: 3.25, offsetY: -7.5 };
const FBM_TILE = {
  width: 6, height: 5, scale: 9.75, offsetX: -2.5, offsetY: 11.25,
  octaves: 4, lacunarity: 2, gain: 0.5,
};

const PARTICLES = { count: 16, seed: 20250821 };

const HAVERSINE_PAIRS = [
  [40.7128, -74.006, 51.5074, -0.1278],     // NYC → London
  [37.7749, -122.4194, 37.7749, -122.4194], // zero distance
  [0, 0, 0, 1],                             // one degree of longitude at equator
  [-33.8688, 151.2093, 35.6762, 139.6503],  // Sydney → Tokyo
  [89.9, 0, -89.9, 180],                    // near-antipodal
];

const POLYLINE = [
  [40.7128, -74.006], [40.7138, -74.0055], [40.7148, -74.004],
  [40.7158, -74.002], [40.7168, -73.999], [40.7178, -73.995],
];

// Destination-point cases. The first eight are exactly the ring
// `buildSamplePoints()` in src/utils/historicalImagery.ts walks (10 m at
// 45-degree steps); the rest cover a zero-distance no-op, a bearing that has
// to wrap past the antimeridian, a southern-hemisphere start, a negative
// bearing and a distance far larger than any the crawl uses.
const OFFSET_CASES = [
  ...Array.from({ length: 8 }, (_, i) => ({
    lat: 40.7128, lng: -74.006, distanceMeters: 10, bearingDeg: 45 * i,
  })),
  { lat: 40.7128, lng: -74.006, distanceMeters: 0, bearingDeg: 123.5 },
  { lat: 0, lng: 179.999, distanceMeters: 500, bearingDeg: 90 },
  { lat: -33.8688, lng: 151.2093, distanceMeters: 10, bearingDeg: 22.5 },
  { lat: 51.5074, lng: -0.1278, distanceMeters: 10, bearingDeg: -45 },
  { lat: 89.5, lng: 0, distanceMeters: 100000, bearingDeg: 180 },
];

// Route geometry (initial_bearing / polyline_resample / polyline_project).
// High-latitude routes guard the scratch/stack fix (batch geodesy used to be
// corrupted above 45° for routes of > ~230 points), and the antimeridian
// cases pin the longitude wrap.
const BEARING_PAIRS = [
  [40.7128, -74.006, 51.5074, -0.1278],     // NYC → London
  [37.7749, -122.4194, 37.7749, -122.4194], // identical points → 0
  [0, 0, 0, 1],                             // due east at the equator
  [0, 0, -1, 0],                            // due south
  [69.6492, 18.9553, 69.6592, 18.9853],     // Tromsø, lat ≥ 60°
  [10, 179.99, 10.001, -179.995],           // across the antimeridian
  [-33.8688, 151.2093, 35.6762, 139.6503],  // Sydney → Tokyo
];

/** 250 points ~11 m apart, curving north-east from Tromsø (lat ≈ 69.6°). */
const HIGH_LAT_ROUTE = Array.from({ length: 250 }, (_, i) => [
  69.6492 + i * 1e-4,
  18.9553 + i * 1e-4 + 2e-4 * Math.sin(i / 20),
]);
/** Three vertices straddling 180°: east, across, and on to the west side. */
const ANTIMERIDIAN_ROUTE = [[10, 179.99], [10.001, -179.995], [10.0015, -179.98]];
/** Edinburgh-ish urban zig-zag (lat ≈ 56°), short enough to read. */
const URBAN_ROUTE = [
  [55.9533, -3.1883], [55.9541, -3.1869], [55.9549, -3.1885], [55.9561, -3.1872],
];

const RESAMPLE_CASES = [
  { label: 'urban-50m', points: URBAN_ROUTE, stepMeters: 50 },
  { label: 'nyc-37m', points: POLYLINE, stepMeters: 37.5 },
  { label: 'high-lat-250pt', points: HIGH_LAT_ROUTE, stepMeters: 250 },
  { label: 'antimeridian-100m', points: ANTIMERIDIAN_ROUTE, stepMeters: 100 },
  // A copy-through still wraps longitudes: 190 → -170.
  { label: 'copy-through', points: [[1, 2], [3, 190]], stepMeters: 0 },
  { label: 'single-point', points: [[51.5074, -0.1278]], stepMeters: 10 },
];

const PROJECT_CASES = [
  // Left and right of the second urban segment, before the start, past the end.
  { label: 'urban-left', points: URBAN_ROUTE, lat: 55.9546, lng: -3.1880 },
  { label: 'urban-right', points: URBAN_ROUTE, lat: 55.9544, lng: -3.1872 },
  { label: 'urban-before-start', points: URBAN_ROUTE, lat: 55.9528, lng: -3.1893 },
  { label: 'urban-past-end', points: URBAN_ROUTE, lat: 55.9566, lng: -3.1862 },
  { label: 'urban-on-vertex', points: URBAN_ROUTE, lat: 55.9549, lng: -3.1885 },
  { label: 'high-lat', points: HIGH_LAT_ROUTE, lat: 69.6612, lng: 18.9671 },
  { label: 'antimeridian', points: ANTIMERIDIAN_ROUTE, lat: 10.0007, lng: 179.9999 },
  { label: 'single-point', points: [[51.5074, -0.1278]], lat: 51.5075, lng: -0.1279 },
];

// Link graph (graph_astar / graph_nearest): a 20 × 10 street grid in Lisbon
// with jittered pano positions, ~1 in 7 links missing, ~1 in 5 one-way and a
// few long diagonals — 200 nodes. Node 120 has no inbound links, so routes
// to it are unreachable. A small LCG keeps it byte-identical run to run.
const GRAPH_COLS = 20;
const GRAPH_ROWS = 10;
const GRAPH_SOURCE_ONLY = 120;
function buildGoldenGraph() {
  let state = 0x2c1b3c6d;
  const rand = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const n = GRAPH_COLS * GRAPH_ROWS;
  const coords = [];
  for (let r = 0; r < GRAPH_ROWS; r++) {
    for (let c = 0; c < GRAPH_COLS; c++) {
      coords.push(38.7 + r * 0.0003 + (rand() - 0.5) * 0.00008, -9.15 + c * 0.0004 + (rand() - 0.5) * 0.00008);
    }
  }
  const adj = Array.from({ length: n }, () => /** @type {number[]} */ ([]));
  const link = (a, b) => {
    if (rand() < 1 / 7) return;
    const oneWay = rand() < 0.2;
    if (oneWay && rand() < 0.5) [a, b] = [b, a];
    adj[a].push(b);
    if (!oneWay) adj[b].push(a);
  };
  for (let r = 0; r < GRAPH_ROWS; r++) {
    for (let c = 0; c < GRAPH_COLS; c++) {
      const i = r * GRAPH_COLS + c;
      if (c + 1 < GRAPH_COLS) link(i, i + 1);
      if (r + 1 < GRAPH_ROWS) link(i, i + GRAPH_COLS);
      if (r + 1 < GRAPH_ROWS && c + 1 < GRAPH_COLS && rand() < 0.05) link(i, i + GRAPH_COLS + 1);
    }
  }
  for (const list of adj) {
    for (let k = list.length - 1; k >= 0; k--) if (list[k] === GRAPH_SOURCE_ONLY) list.splice(k, 1);
  }
  const offsets = [0];
  const neighbors = [];
  for (const list of adj) {
    neighbors.push(...list);
    offsets.push(neighbors.length);
  }
  return { nodeCount: n, offsets, neighbors, coords };
}
const GOLDEN_GRAPH = buildGoldenGraph();
const GRAPH_ROUTES = [
  [0, 199], [199, 0], [5, 150], [37, 182], [17, 17], [0, GRAPH_SOURCE_ONLY], [GRAPH_SOURCE_ONLY, 0],
];
const GRAPH_NEAREST_POINTS = [
  [38.7, -9.15], [38.7015, -9.146], [38.7027, -9.1424], [38.65, -9.2], [38.70135, -9.14381],
];

const ANGLES = [0, 0.5, 45, 180, 359.5, 360, 361, -1, -180, -359.5, -720.25, 1080.75];
const ANGLE_PAIRS = [
  [0, 90], [90, 0], [10, 350], [350, 10], [0, 180], [180, 0],
  [-45, 45], [720, 45], [359, 1], [123.25, -456.5],
];

// `phase` is in fundamental cycles and `sampleIndex` is the absolute stream
// position (hashed per sample for the road noise). 'hour-in' is one hour into
// a 48 kHz drive — the f32-time ABI this replaced had turned it into a
// staircase — and 'wrap' crosses 2^32 samples, where the hashed index wraps.
const ENGINE_CASES = [
  { label: 'cruise', count: 64, rpm: 2500, load: 0.6, speedKmh: 90, phase: 0.25, sampleIndex: 143325, sampleRate: 44100 },
  { label: 'idle', count: 32, rpm: 800, load: 0, speedKmh: 0, phase: 0, sampleIndex: 0, sampleRate: 44100 },
  { label: 'redline', count: 32, rpm: 6800, load: 1, speedKmh: 210, phase: 0.9375, sampleIndex: 600000, sampleRate: 48000 },
  { label: 'hour-in', count: 32, rpm: 2500, load: 0.6, speedKmh: 90, phase: 0.123456789, sampleIndex: 172800000, sampleRate: 48000 },
  { label: 'wrap', count: 16, rpm: 3100, load: 0.3, speedKmh: 60, phase: 0.5, sampleIndex: 4294967288, sampleRate: 44100 },
  // Degenerate inputs: the clamp/fallback branches must agree across backends.
  { label: 'clamped', count: 16, rpm: -100, load: 2.5, speedKmh: -5, phase: -1.75, sampleIndex: -1, sampleRate: 0 },
];

// ---------------------------------------------------------------------------
// Capture
// ---------------------------------------------------------------------------

exp.seed(NOISE_SEED);

const noise2d = NOISE_POINTS.map(([x, y]) => ({ x, y, expected: exp.noise2d(x, y) }));

const fbm2d = FBM_POINTS.map(([x, y]) => ({
  x, y,
  expected: exp.fbm2d(x, y, FBM_PARAMS.octaves, FBM_PARAMS.lacunarity, FBM_PARAMS.gain),
}));

const readF32 = (count) =>
  Array.from(new Float32Array(memory.buffer, SCRATCH, count));

reserve(NOISE_TILE.width * NOISE_TILE.height * 4);
exp.fill_noise_buffer(
  SCRATCH, NOISE_TILE.width, NOISE_TILE.height,
  NOISE_TILE.scale, NOISE_TILE.offsetX, NOISE_TILE.offsetY,
);
const noiseTile = { ...NOISE_TILE, expected: readF32(NOISE_TILE.width * NOISE_TILE.height) };

reserve(FBM_TILE.width * FBM_TILE.height * 4);
exp.fill_fbm_buffer(
  SCRATCH, FBM_TILE.width, FBM_TILE.height,
  FBM_TILE.scale, FBM_TILE.offsetX, FBM_TILE.offsetY,
  FBM_TILE.octaves, FBM_TILE.lacunarity, FBM_TILE.gain,
);
const fbmTile = { ...FBM_TILE, expected: readF32(FBM_TILE.width * FBM_TILE.height) };

reserve(PARTICLES.count * 16);
exp.fill_particle_seeds(SCRATCH, PARTICLES.count, PARTICLES.seed);
const particleSeeds = { ...PARTICLES, expected: readF32(PARTICLES.count * 4) };

const haversine = HAVERSINE_PAIRS.map(([lat1, lon1, lat2, lon2]) => ({
  lat1, lon1, lat2, lon2,
  expected: exp.haversine(lat1, lon1, lat2, lon2),
}));

const pointCount = POLYLINE.length;
reserve(pointCount * 16 + (pointCount - 1) * 8);
const outOffset = SCRATCH + pointCount * 16;
new Float64Array(memory.buffer, SCRATCH, pointCount * 2).set(POLYLINE.flat());
const batchTotal = exp.batch_haversine(SCRATCH, pointCount, outOffset);
const batchHaversine = {
  points: POLYLINE.flat(),
  expectedSegments: Array.from(new Float64Array(memory.buffer, outOffset, pointCount - 1)),
  expectedTotal: batchTotal,
};

reserve(16);
const offsetLatLng = OFFSET_CASES.map((c) => {
  exp.offset_latlng(c.lat, c.lng, c.distanceMeters, c.bearingDeg, SCRATCH);
  const v = new Float64Array(memory.buffer, SCRATCH, 2);
  return { ...c, expectedLat: v[0], expectedLng: v[1] };
});

const initialBearing = BEARING_PAIRS.map(([lat1, lng1, lat2, lng2]) => ({
  lat1, lng1, lat2, lng2,
  expected: exp.initial_bearing(lat1, lng1, lat2, lng2),
}));

const polylineResample = RESAMPLE_CASES.map((c) => {
  const n = c.points.length;
  const inBytes = n * 16;
  reserve(inBytes);
  new Float64Array(memory.buffer, SCRATCH, n * 2).set(c.points.flat());
  // Sizing call (snprintf-style: out = null, cap = 0) and then the fill.
  const count = exp.polyline_resample(SCRATCH, n, c.stepMeters, 0, 0);
  reserve(inBytes + count * 16);
  const outOff = SCRATCH + inBytes;
  const written = exp.polyline_resample(SCRATCH, n, c.stepMeters, outOff, count);
  if (written !== count) throw new Error(`polyline_resample ${c.label}: ${written} != ${count}`);
  return {
    label: c.label,
    points: c.points.flat(),
    stepMeters: c.stepMeters,
    expected: Array.from(new Float64Array(memory.buffer, outOff, count * 2)),
  };
});

const polylineProject = PROJECT_CASES.map((c) => {
  const n = c.points.length;
  reserve(n * 16 + 24);
  new Float64Array(memory.buffer, SCRATCH, n * 2).set(c.points.flat());
  const outOff = SCRATCH + n * 16;
  exp.polyline_project(SCRATCH, n, c.lat, c.lng, outOff);
  const v = new Float64Array(memory.buffer, outOff, 3);
  return {
    label: c.label,
    points: c.points.flat(),
    lat: c.lat,
    lng: c.lng,
    expectedSegment: v[0],
    expectedAlong: v[1],
    expectedCross: v[2],
  };
});

const normalizeAngle = ANGLES.map((angle) => ({
  angle, expected: exp.normalize_angle(angle),
}));

const signedAngleDiff = ANGLE_PAIRS.map(([from, to]) => ({
  from, to, expected: exp.signed_angle_diff(from, to),
}));

const engineNoise = ENGINE_CASES.map((c) => {
  reserve(c.count * 4);
  const expectedPhase = exp.fill_engine_noise(
    SCRATCH, c.count, c.rpm, c.load, c.speedKmh, c.phase, c.sampleIndex, c.sampleRate,
  );
  return { ...c, expected: readF32(c.count), expectedPhase };
});

// Cabin IRs: two production-length taps at 44.1 kHz (roof closed vs open, the
// pair the openness contract rests on), a half-open convertible at 48 kHz, a
// buffer too short to hold the late reflections, and out-of-range arguments
// that must clamp identically on every backend.
const CABIN_IR_CASES = [
  { label: 'sedan-closed', count: 128, vehicleType: 0, openness: 0, sampleRate: 44100 },
  { label: 'sedan-open', count: 128, vehicleType: 0, openness: 1, sampleRate: 44100 },
  { label: 'convertible-half', count: 96, vehicleType: 1, openness: 0.5, sampleRate: 48000 },
  { label: 'limousine-short', count: 64, vehicleType: 3, openness: 0, sampleRate: 44100 },
  { label: 'clamped', count: 32, vehicleType: 99, openness: 2.5, sampleRate: 0 },
];

const cabinIr = CABIN_IR_CASES.map((c) => {
  reserve(c.count * 4);
  exp.fill_cabin_ir(SCRATCH, c.count, c.vehicleType, c.openness, c.sampleRate);
  return { ...c, expected: readF32(c.count) };
});

// HRTF: centered (left==right, the invariant WindAudio relies on at azimuth
// 0), symmetric left/right pair (mirror-symmetry sanity), a hard-left/right
// extreme at a different sample rate, and out-of-range clamping.
const HRTF_CASES = [
  { label: 'centered', count: 32, azimuthDeg: 0, sampleRate: 44100 },
  { label: 'right-45', count: 32, azimuthDeg: 45, sampleRate: 44100 },
  { label: 'left-45', count: 32, azimuthDeg: -45, sampleRate: 44100 },
  { label: 'right-90', count: 24, azimuthDeg: 90, sampleRate: 48000 },
  { label: 'clamped', count: 16, azimuthDeg: 400, sampleRate: 0 },
];

const hrtf = HRTF_CASES.map((c) => {
  const bytesPerEar = c.count * 4;
  reserve(bytesPerEar * 2);
  const rightOff = SCRATCH + bytesPerEar;
  exp.fill_hrtf(SCRATCH, rightOff, c.count, c.azimuthDeg, c.sampleRate);
  return {
    ...c,
    expectedLeft: Array.from(new Float32Array(memory.buffer, SCRATCH, c.count)),
    expectedRight: Array.from(new Float32Array(memory.buffer, rightOff, c.count)),
  };
});

const CHORES_IMAGE = {
  width: 4,
  height: 2,
  rgba: [
    0, 0, 0, 255, 255, 255, 255, 255, 255, 0, 0, 255, 0, 255, 0, 255,
    0, 0, 255, 255, 128, 128, 128, 255, 255, 255, 0, 255, 0, 255, 255, 255,
  ],
};
const CHORES_DOWN = { dstW: 2, dstH: 1 };

const choresPix = CHORES_IMAGE.width * CHORES_IMAGE.height * 4;
reserve(choresPix + 256 * 4 + 16);
new Uint8Array(memory.buffer, SCRATCH, choresPix).set(CHORES_IMAGE.rgba);
const histBinsOff = SCRATCH + ((choresPix + 3) & ~3);
exp.luma_histogram_bt709(SCRATCH, CHORES_IMAGE.width, CHORES_IMAGE.height, histBinsOff);
const lumaHistogram = {
  ...CHORES_IMAGE,
  expectedBins: Array.from(new Uint32Array(memory.buffer, histBinsOff, 256)),
};

const reduceOff = histBinsOff;
exp.reduce_luma_bt709(SCRATCH, CHORES_IMAGE.width, CHORES_IMAGE.height, reduceOff);
const lumaReduce = {
  ...CHORES_IMAGE,
  expected: Array.from(new Float32Array(memory.buffer, reduceOff, 3)),
};

const downSrc = CHORES_IMAGE.width * CHORES_IMAGE.height * 4;
const downDst = CHORES_DOWN.dstW * CHORES_DOWN.dstH * 4;
const downOff = SCRATCH + ((downSrc + 3) & ~3);
reserve(downOff - SCRATCH + downDst);
new Uint8Array(memory.buffer, SCRATCH, downSrc).set(CHORES_IMAGE.rgba);
exp.downsample_2d(
  SCRATCH, CHORES_IMAGE.width, CHORES_IMAGE.height,
  downOff, CHORES_DOWN.dstW, CHORES_DOWN.dstH,
);
const downsample2d = {
  ...CHORES_IMAGE,
  dstW: CHORES_DOWN.dstW,
  dstH: CHORES_DOWN.dstH,
  expected: Array.from(new Uint8Array(memory.buffer, downOff, downDst)),
};


// Fused luma chore: the same 4x2 image analysed onto a 2x1 grid (downsample +
// bin + reduce in one pass) and as-is (dst = source size).
const LUMA_ANALYZE_CASES = [
  { label: 'down-2x1', dstW: 2, dstH: 1 },
  { label: 'as-is-4x2', dstW: 4, dstH: 2 },
];
const lumaAnalyze = LUMA_ANALYZE_CASES.map((c) => {
  const binsOff = SCRATCH + ((choresPix + 3) & ~3);
  const statsOff = binsOff + 256 * 4;
  reserve(statsOff - SCRATCH + 12);
  new Uint8Array(memory.buffer, SCRATCH, choresPix).set(CHORES_IMAGE.rgba);
  exp.luma_analyze(
    SCRATCH, CHORES_IMAGE.width, CHORES_IMAGE.height, c.dstW, c.dstH, binsOff, statsOff,
  );
  return {
    ...c,
    expectedBins: Array.from(new Uint32Array(memory.buffer, binsOff, 256)),
    expectedStats: Array.from(new Float32Array(memory.buffer, statsOff, 3)),
  };
});

// ---------------------------------------------------------------------------
// Cabin DSP (dsp_*): parameter scripts rendered 128 frames at a time.
// ---------------------------------------------------------------------------
// Every consumer (this capture, cpp/tests and the JS-twin parity test) runs
// the same harness:
//   create(sampleRate); for each block b: apply the keyframe at b (set_params
//   with every field; `ir` {vehicle, openness} -> fill_cabin_ir(irTaps) then
//   set_ir, `ir: null` -> set_ir(nullptr, 0)); render 128 frames with radio
//   input radioSample(b * 128 + i, ch); fold L then R into the FNV-1a sum.
// radioSample(k, ch) = f32((((k % 2001) * 7919 + ch * 104729) % 2001 - 1000) / 2000)
// The checksum is FNV-1a 32 over the f32 bit patterns (one u32 per sample).
// Keyframes carry every parameter, so a script reads top to bottom.
const DSP_BLOCK = 128;
const kf = (block, p, ir) => ({
  block,
  rpm: 850, load: 0.12, speedMps: 0, openness: 0, vehicle: 0, wetRoad: 0, rain: 0,
  windMps: 0, radioGain: 0, wipers: 0,
  ...p,
  ...(ir !== undefined ? { ir } : {}),
});
const DRIVE = { rpm: 2600, load: 0.35, speedMps: 22, radioGain: 0.3 };
const DSP_SCRIPTS = [
  {
    // Ten seconds of a trip: pull away, cruise with the radio, rain and the
    // wipers, roof down, a gusty headwind, a swap to the limousine, roof up,
    // past full speed at the redline, and a stop on a damp road.
    label: 'ten-second-drive',
    sampleRate: 22050,
    irTaps: 512,
    blocks: Math.ceil((10 * 22050) / DSP_BLOCK),
    keyframes: [
      kf(0, {}, { vehicle: 0, openness: 0 }),
      kf(86, { rpm: 4200, load: 0.85, speedMps: 8 }),
      kf(258, DRIVE),
      kf(430, { ...DRIVE, rain: 0.7, wetRoad: 1, wipers: 1 }),
      kf(603, { ...DRIVE, rain: 0.7, wetRoad: 1, wipers: 1, openness: 1 }, { vehicle: 0, openness: 1 }),
      kf(775, { ...DRIVE, rain: 0.7, wetRoad: 1, wipers: 1, openness: 1, windMps: 12 }),
      kf(947, { ...DRIVE, rain: 0.7, wetRoad: 1, wipers: 1, openness: 1, windMps: 12, vehicle: 3 }, { vehicle: 3, openness: 1 }),
      kf(1120, { ...DRIVE, rain: 0.2, wetRoad: 1, wipers: 1, windMps: 12, vehicle: 3 }, { vehicle: 3, openness: 0 }),
      kf(1292, { rpm: 6800, load: 1, speedMps: 45, wetRoad: 0.6, vehicle: 3 }),
      kf(1464, { rpm: 900, load: 0, speedMps: 0, wetRoad: 0.4, vehicle: 3 }),
      kf(1550, { rpm: 900, load: 0, speedMps: 0, wetRoad: 0.4, vehicle: 3 }, null),
    ],
    excerptBlocks: [0, 260, 610, 950, 1722],
  },
  {
    // Production rate and the limousine's 2048 taps; a second swap lands one
    // block into the first crossfade (the restart path).
    label: 'ir-swap-48k-2048',
    sampleRate: 48000,
    irTaps: 2048,
    blocks: 94,
    keyframes: [
      kf(0, { ...DRIVE, radioGain: 0.8 }, { vehicle: 0, openness: 0 }),
      kf(20, { ...DRIVE, radioGain: 0.8, vehicle: 3, openness: 1 }, { vehicle: 3, openness: 1 }),
      kf(21, { ...DRIVE, radioGain: 0.8, vehicle: 3 }, { vehicle: 3, openness: 0 }),
      kf(60, { ...DRIVE, radioGain: 0.8, vehicle: 3, rain: 1, wipers: 1 }),
    ],
    excerptBlocks: [0, 20, 21, 22, 93],
  },
  {
    // Out-of-range everything: sample rate 0 (-> 44100), an IR longer than
    // dsp_max_ir_taps, negative / oversized parameters and vehicle 99.
    label: 'clamped',
    sampleRate: 0,
    irTaps: 5000,
    blocks: 8,
    keyframes: [
      kf(0, {
        rpm: -100, load: 3, speedMps: 500, openness: 2, vehicle: 99, wetRoad: -1,
        rain: 4, windMps: 1000, radioGain: 9, wipers: 7,
      }, { vehicle: 99, openness: 2 }),
      kf(4, { rpm: 20000, load: -1, speedMps: -3, openness: -1, vehicle: -4, radioGain: -2 }),
    ],
    excerptBlocks: [0, 7],
  },
];

const radioSample = (k, ch) => Math.fround((((k % 2001) * 7919 + ch * 104729) % 2001 - 1000) / 2000);
const fnv1a = (h, words) => {
  for (let i = 0; i < words.length; i++) {
    h ^= words[i];
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
};

const cabinDsp = DSP_SCRIPTS.map((script) => {
  const state = exp.dsp_create(script.sampleRate);
  if (!state) throw new Error(`dsp_create(${script.sampleRate}) failed`);
  const ioBytes = 4 * DSP_BLOCK * 4;
  reserve(ioBytes + script.irTaps * 4);
  const inL = SCRATCH;
  const inR = inL + DSP_BLOCK * 4;
  const outL = inR + DSP_BLOCK * 4;
  const outR = outL + DSP_BLOCK * 4;
  const irOff = SCRATCH + ioBytes;
  const byBlock = new Map(script.keyframes.map((k) => [k.block, k]));
  const excerpts = [];
  let checksum = 2166136261;
  for (let b = 0; b < script.blocks; b++) {
    const k = byBlock.get(b);
    if (k) {
      exp.dsp_set_params(
        state, k.rpm, k.load, k.speedMps, k.openness, k.vehicle, k.wetRoad, k.rain,
        k.windMps, k.radioGain, k.wipers,
      );
      if (k.ir === null) exp.dsp_set_ir(state, 0, 0);
      else if (k.ir) {
        exp.fill_cabin_ir(irOff, script.irTaps, k.ir.vehicle, k.ir.openness, script.sampleRate);
        exp.dsp_set_ir(state, irOff, script.irTaps);
      }
    }
    const l = new Float32Array(memory.buffer, inL, DSP_BLOCK);
    const r = new Float32Array(memory.buffer, inR, DSP_BLOCK);
    for (let i = 0; i < DSP_BLOCK; i++) {
      l[i] = radioSample(b * DSP_BLOCK + i, 0);
      r[i] = radioSample(b * DSP_BLOCK + i, 1);
    }
    exp.dsp_render(state, inL, inR, outL, outR, DSP_BLOCK);
    checksum = fnv1a(checksum, new Uint32Array(memory.buffer, outL, DSP_BLOCK));
    checksum = fnv1a(checksum, new Uint32Array(memory.buffer, outR, DSP_BLOCK));
    if (script.excerptBlocks.includes(b)) {
      excerpts.push({
        block: b,
        left: Array.from(new Float32Array(memory.buffer, outL, DSP_BLOCK)),
        right: Array.from(new Float32Array(memory.buffer, outR, DSP_BLOCK)),
      });
    }
  }
  exp.dsp_destroy(state);
  return { ...script, expectedChecksum: checksum, expectedExcerpts: excerpts };
});
const dspMaxIrTaps = exp.dsp_max_ir_taps();

// Graph layout in scratch: offsets, neighbors, coords, work, path — the same
// order and alignment as the loader (src/wasm/index.ts graphAstar).
const graphLayout = (g) => {
  const offsetsOff = SCRATCH;
  const neighborsOff = offsetsOff + (g.nodeCount + 1) * 4;
  const coordsOff = (neighborsOff + g.neighbors.length * 4 + 7) & ~7;
  const workOff = coordsOff + g.nodeCount * 16;
  const pathOff = workOff + g.nodeCount * 32;
  reserve(pathOff + g.nodeCount * 4 - SCRATCH);
  new Int32Array(memory.buffer, offsetsOff, g.nodeCount + 1).set(g.offsets);
  new Int32Array(memory.buffer, neighborsOff, g.neighbors.length).set(g.neighbors);
  new Float64Array(memory.buffer, coordsOff, g.nodeCount * 2).set(g.coords);
  return { offsetsOff, neighborsOff, coordsOff, workOff, pathOff };
};
const gl = graphLayout(GOLDEN_GRAPH);
const graphAstar = GRAPH_ROUTES.map(([from, to]) => {
  const length = exp.graph_astar(
    gl.offsetsOff, gl.neighborsOff, gl.coordsOff, GOLDEN_GRAPH.nodeCount, GOLDEN_GRAPH.neighbors.length,
    from, to, gl.workOff, gl.pathOff, GOLDEN_GRAPH.nodeCount,
  );
  const expected = length > 0 ? Array.from(new Int32Array(memory.buffer, gl.pathOff, length)) : [];
  return { from, to, expectedLength: length, expected };
});
const graphNearest = GRAPH_NEAREST_POINTS.map(([lat, lng]) => ({
  lat, lng, expected: exp.graph_nearest(gl.coordsOff, GOLDEN_GRAPH.nodeCount, lat, lng),
}));

// ---------------------------------------------------------------------------
// Scene depth (depth_*): percentiles, ground calibration, and a normalize
// sequence that walks every easing branch (fresh, same scene, aligned).
// ---------------------------------------------------------------------------
// Inputs are explicit f32 maps, except `nanIndices` / `infIndices`, which the
// consumers poke in as NaN / +Infinity (JSON and C++ literals cannot carry
// them) — non-finite texels must be skipped by the percentiles and read as far.
const DEPTH_W = 24;
const DEPTH_H = 20;
const depthMap = (scale, shift, salt) => Array.from({ length: DEPTH_W * DEPTH_H }, (_, i) => {
  const x = i % DEPTH_W;
  const y = Math.floor(i / DEPTH_W);
  return Math.fround(shift + scale * ((y + 1) / DEPTH_H) ** 2 + ((x * 31 + y * 17 + salt) % 13) / 130);
});
const DEPTH_NAN = [5, 77, 300];
const DEPTH_INF = [123];
/** Strided percentile input, by formula: f32(((i * 7919) % 10007) / 10007) — longer than 16384, so the stride is 2. */
const DEPTH_STRIDED_COUNT = 20000;
const depthBlock = exp.malloc(DEPTH_STRIDED_COUNT * 8 + 4096);
if (!depthBlock) throw new Error('malloc for the depth goldens failed');
const writeDepthMap = (values) => {
  const view = new Float32Array(memory.buffer, depthBlock, values.length);
  view.set(values);
  for (const i of DEPTH_NAN) if (i < values.length) view[i] = NaN;
  for (const i of DEPTH_INF) if (i < values.length) view[i] = Infinity;
};
const DEPTH_PERCENTILE_CASES = [
  { label: 'map-2-98', values: depthMap(3, 0.5, 0), low: 0.02, high: 0.98 },
  { label: 'map-10-90', values: depthMap(3, 0.5, 0), low: 0.1, high: 0.9 },
];
/** @type {Array<{ label: string, values: number[] | null, low: number, high: number, expected: number[] }>} */
const depthPercentiles = DEPTH_PERCENTILE_CASES.map((c) => {
  writeDepthMap(c.values);
  const n = c.values.length;
  const out = depthBlock + DEPTH_STRIDED_COUNT * 8;
  exp.depth_percentiles(depthBlock, n, c.low, c.high, depthBlock + n * 4, out);
  return { ...c, expected: Array.from(new Float64Array(memory.buffer, out, 2)) };
});
{
  const view = new Float32Array(memory.buffer, depthBlock, DEPTH_STRIDED_COUNT);
  for (let i = 0; i < DEPTH_STRIDED_COUNT; i++) view[i] = ((i * 7919) % 10007) / 10007;
  const out = depthBlock + DEPTH_STRIDED_COUNT * 8;
  exp.depth_percentiles(depthBlock, DEPTH_STRIDED_COUNT, 0.02, 0.98, depthBlock + DEPTH_STRIDED_COUNT * 4, out);
  depthPercentiles.push({
    label: 'strided-20000', values: null, low: 0.02, high: 0.98,
    expected: Array.from(new Float64Array(memory.buffer, out, 2)),
  });
}
// Each step feeds the state (and, when aligned, the previous output) forward.
const DEPTH_STEPS = [
  { label: 'fresh', values: depthMap(3, 0.5, 0), aligned: false, sameScene: false, horizonY: 0.45 },
  { label: 'same-scene-rescaled', values: depthMap(7, -0.25, 3), aligned: false, sameScene: true, horizonY: 0.45 },
  { label: 'aligned', values: depthMap(5, 0.1, 6), aligned: true, sameScene: true, horizonY: 0.5 },
  { label: 'looking-up', values: depthMap(5, 0.1, 9), aligned: false, sameScene: false, horizonY: 0.8 },
  { label: 'flat', values: Array(DEPTH_W * DEPTH_H).fill(1.5), aligned: true, sameScene: true, horizonY: 0.45 },
];
const depthNormalize = (() => {
  const n = DEPTH_W * DEPTH_H;
  const stateOff = depthBlock + n * 12;
  const prevOff = depthBlock + n * 4;
  const outOff = depthBlock + n * 8;
  new Float64Array(memory.buffer, stateOff, 3).fill(0);
  let havePrev = false;
  return DEPTH_STEPS.map((step) => {
    writeDepthMap(step.values);
    const usePrev = step.aligned && havePrev;
    exp.depth_normalize(
      depthBlock, n, DEPTH_W, DEPTH_H, step.horizonY, step.aligned ? 1 : 0, step.sameScene ? 1 : 0,
      stateOff, usePrev ? prevOff : 0, outOff,
    );
    const expected = Array.from(new Float32Array(memory.buffer, outOff, n));
    new Float32Array(memory.buffer, prevOff, n).set(expected);
    havePrev = true;
    return { ...step, expected, expectedState: Array.from(new Float64Array(memory.buffer, stateOff, 3)) };
  });
})();
// Ground calibration on the first step's output (a real nearness-shaped map is
// not needed: any [0, 1] map exercises the band, the median and the clamp).
const DEPTH_NEAR_CASES = [
  { label: 'ground', horizonY: 0.45 },
  { label: 'looking-up', horizonY: 0.8 },
  { label: 'high-horizon', horizonY: 0.1 },
];
const depthNearMap = depthNormalize[0].expected.map((v) => Math.fround(1 - v));
const depthNearDepth = DEPTH_NEAR_CASES.map((c) => {
  new Float32Array(memory.buffer, depthBlock, depthNearMap.length).set(depthNearMap);
  return { ...c, expected: exp.depth_near_depth(depthBlock, DEPTH_W, DEPTH_H, c.horizonY) };
});
exp.free(depthBlock);

const goldens = {
  $comment:
    'GENERATED by scripts/gen-wasm-goldens.mjs from public/wasm/streetview-wasm.wasm. '
    + 'Do not hand-edit — run `npm run gen:wasm-goldens`.',
  wasmSha256,
  noiseSeed: NOISE_SEED,
  fbmParams: FBM_PARAMS,
  noise2d,
  fbm2d,
  noiseTile,
  fbmTile,
  particleSeeds,
  haversine,
  batchHaversine,
  offsetLatLng,
  initialBearing,
  polylineResample,
  polylineProject,
  normalizeAngle,
  signedAngleDiff,
  engineNoise,
  cabinIr,
  hrtf,
  lumaHistogram,
  lumaReduce,
  downsample2d,
  lumaAnalyze,
  dspMaxIrTaps,
  cabinDsp,
  graph: GOLDEN_GRAPH,
  graphAstar,
  graphNearest,
  depth: {
    width: DEPTH_W,
    height: DEPTH_H,
    nanIndices: DEPTH_NAN,
    infIndices: DEPTH_INF,
    stridedCount: DEPTH_STRIDED_COUNT,
    percentiles: depthPercentiles,
    normalize: depthNormalize,
    nearMap: depthNearMap,
    nearDepth: depthNearDepth,
  },
};

function vectorsOnly(obj) {
  const { $comment: _comment, wasmSha256: _sha, ...rest } = obj;
  return rest;
}

if (compareOnly) {
  const committed = JSON.parse(readFileSync(jsonOut, 'utf8'));
  const actual = JSON.stringify(vectorsOnly(goldens));
  const expected = JSON.stringify(vectorsOnly(committed));
  if (actual !== expected) {
    console.error('❌ Golden vectors from this wasm differ from cpp/tests/goldens.json');
    console.error('   (wasmSha256 is ignored — this check is for SIMD bit-identity.)');
    process.exit(1);
  }
  console.log('✅ Golden vectors match cpp/tests/goldens.json (bit-identical, sha ignored)');
  process.exit(0);
}

writeFileSync(jsonOut, `${JSON.stringify(goldens, null, 2)}\n`);

// ---------------------------------------------------------------------------
// C++ header emission
// ---------------------------------------------------------------------------
// The float literals below are the shortest decimal that round-trips the f32
// value, so `<literal>f` parses back to the exact same bits. Doubles are
// emitted without a suffix for the same reason.

const f32 = (v) => {
  if (!Number.isFinite(v)) throw new Error(`non-finite f32 golden: ${v}`);
  const s = String(v);
  return /[.eE]/.test(s) ? `${s}f` : `${s}.0f`;
};
const f64 = (v) => {
  if (!Number.isFinite(v)) throw new Error(`non-finite f64 golden: ${v}`);
  const s = String(v);
  return /[.eE]/.test(s) ? s : `${s}.0`;
};

const rows = (items, perLine = 4) => {
  const out = [];
  for (let i = 0; i < items.length; i += perLine) {
    out.push(`    ${items.slice(i, i + perLine).join(', ')},`);
  }
  return out.join('\n');
};

const u32Array = (name, values) =>
  `inline constexpr unsigned ${name}[] = {\n${rows(values.map((v) => `${v}u`), 8)}\n};`;
const i32Array = (name, values) =>
  `inline constexpr int ${name}[] = {\n${rows(values.map((v) => `${v}`), 12)}\n};`;
const u8Array = (name, values) =>
  `inline constexpr unsigned char ${name}[] = {\n${rows(values.map((v) => `${v}`), 12)}\n};`;
const f32Array = (name, values) =>
  `inline constexpr float ${name}[] = {\n${rows(values.map(f32), 6)}\n};`;
const f64Array = (name, values) =>
  `inline constexpr double ${name}[] = {\n${rows(values.map(f64), 3)}\n};`;

const lines = [];
lines.push('// clang-format off');
lines.push('/**');
lines.push(' * cpp/tests/goldens_generated.h');
lines.push(' *');
lines.push(' * GENERATED FILE — do not hand-edit.');
lines.push(' * Produced by scripts/gen-wasm-goldens.mjs from the shipping binary');
lines.push(' * public/wasm/streetview-wasm.wasm. Regenerate with:');
lines.push(' *');
lines.push(' *     npm run gen:wasm-goldens');
lines.push(' *');
lines.push(' * The same vectors are emitted to cpp/tests/goldens.json, which');
lines.push(' * src/wasm/__tests__/wasmGoldenParity.test.ts asserts both shipped');
lines.push(' * binaries against — so the host C++ and the emcc builds share one contract.');
lines.push(' */');
lines.push('#pragma once');
lines.push('');
lines.push('namespace goldens {');
lines.push('');
lines.push(`inline constexpr const char* kWasmSha256 = "${wasmSha256}";`);
lines.push(`inline constexpr unsigned kNoiseSeed = ${NOISE_SEED}u;`);
lines.push('');

lines.push('// --- noise2d -------------------------------------------------------------');
lines.push(f32Array('kNoise2dX', noise2d.map((n) => n.x)));
lines.push(f32Array('kNoise2dY', noise2d.map((n) => n.y)));
lines.push(f32Array('kNoise2dExpected', noise2d.map((n) => n.expected)));
lines.push(`inline constexpr int kNoise2dCount = ${noise2d.length};`);
lines.push('');

lines.push('// --- fbm2d ---------------------------------------------------------------');
lines.push(`inline constexpr int kFbmOctaves = ${FBM_PARAMS.octaves};`);
lines.push(`inline constexpr float kFbmLacunarity = ${f32(FBM_PARAMS.lacunarity)};`);
lines.push(`inline constexpr float kFbmGain = ${f32(FBM_PARAMS.gain)};`);
lines.push(f32Array('kFbm2dX', fbm2d.map((n) => n.x)));
lines.push(f32Array('kFbm2dY', fbm2d.map((n) => n.y)));
lines.push(f32Array('kFbm2dExpected', fbm2d.map((n) => n.expected)));
lines.push(`inline constexpr int kFbm2dCount = ${fbm2d.length};`);
lines.push('');

lines.push('// --- fill_noise_buffer ---------------------------------------------------');
lines.push(`inline constexpr int kNoiseTileWidth = ${noiseTile.width};`);
lines.push(`inline constexpr int kNoiseTileHeight = ${noiseTile.height};`);
lines.push(`inline constexpr float kNoiseTileScale = ${f32(noiseTile.scale)};`);
lines.push(`inline constexpr float kNoiseTileOffsetX = ${f32(noiseTile.offsetX)};`);
lines.push(`inline constexpr float kNoiseTileOffsetY = ${f32(noiseTile.offsetY)};`);
lines.push(f32Array('kNoiseTileExpected', noiseTile.expected));
lines.push('');

lines.push('// --- fill_fbm_buffer -----------------------------------------------------');
lines.push(`inline constexpr int kFbmTileWidth = ${fbmTile.width};`);
lines.push(`inline constexpr int kFbmTileHeight = ${fbmTile.height};`);
lines.push(`inline constexpr float kFbmTileScale = ${f32(fbmTile.scale)};`);
lines.push(`inline constexpr float kFbmTileOffsetX = ${f32(fbmTile.offsetX)};`);
lines.push(`inline constexpr float kFbmTileOffsetY = ${f32(fbmTile.offsetY)};`);
lines.push(`inline constexpr int kFbmTileOctaves = ${fbmTile.octaves};`);
lines.push(`inline constexpr float kFbmTileLacunarity = ${f32(fbmTile.lacunarity)};`);
lines.push(`inline constexpr float kFbmTileGain = ${f32(fbmTile.gain)};`);
lines.push(f32Array('kFbmTileExpected', fbmTile.expected));
lines.push('');

lines.push('// --- fill_particle_seeds -------------------------------------------------');
lines.push(`inline constexpr int kParticleCount = ${particleSeeds.count};`);
lines.push(`inline constexpr unsigned kParticleSeed = ${particleSeeds.seed}u;`);
lines.push(f32Array('kParticleExpected', particleSeeds.expected));
lines.push('');

lines.push('// --- haversine -----------------------------------------------------------');
lines.push(f64Array('kHaversineLat1', haversine.map((h) => h.lat1)));
lines.push(f64Array('kHaversineLon1', haversine.map((h) => h.lon1)));
lines.push(f64Array('kHaversineLat2', haversine.map((h) => h.lat2)));
lines.push(f64Array('kHaversineLon2', haversine.map((h) => h.lon2)));
lines.push(f64Array('kHaversineExpected', haversine.map((h) => h.expected)));
lines.push(`inline constexpr int kHaversineCount = ${haversine.length};`);
lines.push('');

lines.push('// --- batch_haversine -----------------------------------------------------');
lines.push(`inline constexpr int kPolylinePointCount = ${pointCount};`);
lines.push(f64Array('kPolylinePoints', batchHaversine.points));
lines.push(f64Array('kPolylineExpectedSegments', batchHaversine.expectedSegments));
lines.push(`inline constexpr double kPolylineExpectedTotal = ${f64(batchHaversine.expectedTotal)};`);
lines.push('');

lines.push('// --- offset_latlng -------------------------------------------------------');
lines.push(f64Array('kOffsetLat', offsetLatLng.map((o) => o.lat)));
lines.push(f64Array('kOffsetLng', offsetLatLng.map((o) => o.lng)));
lines.push(f64Array('kOffsetDistance', offsetLatLng.map((o) => o.distanceMeters)));
lines.push(f64Array('kOffsetBearing', offsetLatLng.map((o) => o.bearingDeg)));
lines.push(f64Array('kOffsetExpectedLat', offsetLatLng.map((o) => o.expectedLat)));
lines.push(f64Array('kOffsetExpectedLng', offsetLatLng.map((o) => o.expectedLng)));
lines.push(`inline constexpr int kOffsetCount = ${offsetLatLng.length};`);
lines.push('');

lines.push('// --- initial_bearing -----------------------------------------------------');
lines.push(f64Array('kBearingLat1', initialBearing.map((b) => b.lat1)));
lines.push(f64Array('kBearingLng1', initialBearing.map((b) => b.lng1)));
lines.push(f64Array('kBearingLat2', initialBearing.map((b) => b.lat2)));
lines.push(f64Array('kBearingLng2', initialBearing.map((b) => b.lng2)));
lines.push(f64Array('kBearingExpected', initialBearing.map((b) => b.expected)));
lines.push(`inline constexpr int kBearingCount = ${initialBearing.length};`);
lines.push('');

lines.push('// --- polyline_resample ---------------------------------------------------');
lines.push(`inline constexpr int kResampleCaseCount = ${polylineResample.length};`);
polylineResample.forEach((c, i) => {
  lines.push(`// case ${i}: ${c.label}`);
  lines.push(`inline constexpr int kResampleInCount${i} = ${c.points.length / 2};`);
  lines.push(f64Array(`kResampleIn${i}`, c.points));
  lines.push(`inline constexpr double kResampleStep${i} = ${f64(c.stepMeters)};`);
  lines.push(`inline constexpr int kResampleOutCount${i} = ${c.expected.length / 2};`);
  lines.push(f64Array(`kResampleExpected${i}`, c.expected));
  lines.push('');
});

lines.push('struct ResampleGolden { int in_count; const double* in; double step; int out_count; const double* expected; };');
lines.push('inline constexpr ResampleGolden kResampleCases[] = {');
polylineResample.forEach((_c, i) => {
  lines.push(`    { kResampleInCount${i}, kResampleIn${i}, kResampleStep${i}, kResampleOutCount${i}, kResampleExpected${i} },`);
});
lines.push('};');
lines.push('');

lines.push('// --- polyline_project ----------------------------------------------------');
lines.push(`inline constexpr int kProjectCaseCount = ${polylineProject.length};`);
polylineProject.forEach((c, i) => {
  lines.push(`// case ${i}: ${c.label}`);
  lines.push(`inline constexpr int kProjectInCount${i} = ${c.points.length / 2};`);
  lines.push(f64Array(`kProjectIn${i}`, c.points));
  lines.push(`inline constexpr double kProjectLat${i} = ${f64(c.lat)};`);
  lines.push(`inline constexpr double kProjectLng${i} = ${f64(c.lng)};`);
  lines.push(`inline constexpr double kProjectExpected${i}[] = { ${f64(c.expectedSegment)}, ${f64(c.expectedAlong)}, ${f64(c.expectedCross)} };`);
  lines.push('');
});

lines.push('struct ProjectGolden { int in_count; const double* in; double lat; double lng; const double* expected; };');
lines.push('inline constexpr ProjectGolden kProjectCases[] = {');
polylineProject.forEach((_c, i) => {
  lines.push(`    { kProjectInCount${i}, kProjectIn${i}, kProjectLat${i}, kProjectLng${i}, kProjectExpected${i} },`);
});
lines.push('};');
lines.push('');

lines.push('// --- normalize_angle -----------------------------------------------------');
lines.push(f32Array('kNormalizeAngleIn', normalizeAngle.map((a) => a.angle)));
lines.push(f32Array('kNormalizeAngleExpected', normalizeAngle.map((a) => a.expected)));
lines.push(`inline constexpr int kNormalizeAngleCount = ${normalizeAngle.length};`);
lines.push('');

lines.push('// --- signed_angle_diff ---------------------------------------------------');
lines.push(f32Array('kSignedAngleFrom', signedAngleDiff.map((a) => a.from)));
lines.push(f32Array('kSignedAngleTo', signedAngleDiff.map((a) => a.to)));
lines.push(f32Array('kSignedAngleExpected', signedAngleDiff.map((a) => a.expected)));
lines.push(`inline constexpr int kSignedAngleCount = ${signedAngleDiff.length};`);
lines.push('');

lines.push('// --- fill_engine_noise ---------------------------------------------------');
lines.push(`inline constexpr int kEngineCaseCount = ${engineNoise.length};`);
engineNoise.forEach((c, i) => {
  lines.push(`// case ${i}: ${c.label}`);
  lines.push(`inline constexpr int kEngineCount${i} = ${c.count};`);
  lines.push(`inline constexpr float kEngineRpm${i} = ${f32(c.rpm)};`);
  lines.push(`inline constexpr float kEngineLoad${i} = ${f32(c.load)};`);
  lines.push(`inline constexpr float kEngineSpeed${i} = ${f32(c.speedKmh)};`);
  lines.push(`inline constexpr double kEnginePhase${i} = ${f64(c.phase)};`);
  lines.push(`inline constexpr double kEngineSampleIndex${i} = ${f64(c.sampleIndex)};`);
  lines.push(`inline constexpr float kEngineSampleRate${i} = ${f32(c.sampleRate)};`);
  lines.push(f32Array(`kEngineExpected${i}`, c.expected));
  lines.push(`inline constexpr double kEngineExpectedPhase${i} = ${f64(c.expectedPhase)};`);
  lines.push('');
});

lines.push('// --- fill_cabin_ir -------------------------------------------------------');
lines.push(`inline constexpr int kCabinIrCaseCount = ${cabinIr.length};`);
cabinIr.forEach((c, i) => {
  lines.push(`// case ${i}: ${c.label}`);
  lines.push(`inline constexpr int kCabinIrCount${i} = ${c.count};`);
  lines.push(`inline constexpr int kCabinIrVehicle${i} = ${c.vehicleType};`);
  lines.push(`inline constexpr float kCabinIrOpenness${i} = ${f32(c.openness)};`);
  lines.push(`inline constexpr float kCabinIrSampleRate${i} = ${f32(c.sampleRate)};`);
  lines.push(f32Array(`kCabinIrExpected${i}`, c.expected));
  lines.push('');
});

lines.push('// --- fill_hrtf -------------------------------------------------------');
lines.push(`inline constexpr int kHrtfCaseCount = ${hrtf.length};`);
hrtf.forEach((c, i) => {
  lines.push(`// case ${i}: ${c.label}`);
  lines.push(`inline constexpr int kHrtfCount${i} = ${c.count};`);
  lines.push(`inline constexpr float kHrtfAzimuth${i} = ${f32(c.azimuthDeg)};`);
  lines.push(`inline constexpr float kHrtfSampleRate${i} = ${f32(c.sampleRate)};`);
  lines.push(f32Array(`kHrtfExpectedLeft${i}`, c.expectedLeft));
  lines.push(f32Array(`kHrtfExpectedRight${i}`, c.expectedRight));
  lines.push('');
});

lines.push('// --- luma_histogram_bt709 / reduce / downsample_2d -------------------');
lines.push(`inline constexpr int kChoresWidth = ${lumaHistogram.width};`);
lines.push(`inline constexpr int kChoresHeight = ${lumaHistogram.height};`);
lines.push(u8Array('kChoresRgba', lumaHistogram.rgba));
lines.push(u32Array('kChoresHistExpected', lumaHistogram.expectedBins));
lines.push(f32Array('kChoresReduceExpected', lumaReduce.expected));
lines.push(`inline constexpr int kChoresDownWidth = ${downsample2d.dstW};`);
lines.push(`inline constexpr int kChoresDownHeight = ${downsample2d.dstH};`);
lines.push(u8Array('kChoresDownExpected', downsample2d.expected));
lines.push('');

lines.push('// --- luma_analyze ----------------------------------------------------');
lines.push(`inline constexpr int kLumaAnalyzeCaseCount = ${lumaAnalyze.length};`);
lumaAnalyze.forEach((c, i) => {
  lines.push(`// case ${i}: ${c.label}`);
  lines.push(`inline constexpr int kLumaAnalyzeDstW${i} = ${c.dstW};`);
  lines.push(`inline constexpr int kLumaAnalyzeDstH${i} = ${c.dstH};`);
  lines.push(u32Array(`kLumaAnalyzeBins${i}`, c.expectedBins));
  lines.push(f32Array(`kLumaAnalyzeStats${i}`, c.expectedStats));
  lines.push('');
});
lines.push('struct LumaAnalyzeGolden { int dst_w; int dst_h; const unsigned* bins; const float* stats; };');
lines.push('inline constexpr LumaAnalyzeGolden kLumaAnalyzeCases[] = {');
lumaAnalyze.forEach((_c, i) => {
  lines.push(`    { kLumaAnalyzeDstW${i}, kLumaAnalyzeDstH${i}, kLumaAnalyzeBins${i}, kLumaAnalyzeStats${i} },`);
});
lines.push('};');
lines.push('');

lines.push('// --- dsp_* (cabin engine) ---------------------------------------------');
lines.push(`inline constexpr int kDspBlock = ${DSP_BLOCK};`);
lines.push(`inline constexpr int kDspMaxIrTaps = ${dspMaxIrTaps};`);
lines.push('// ir: 0 = keep, 1 = fill_cabin_ir(ir_vehicle, ir_openness) then set_ir, 2 = set_ir(nullptr, 0)');
lines.push('struct DspKeyframe { int block; float rpm; float load; float speed_mps; float openness; int vehicle;');
lines.push('                     float wet_road; float rain; float wind_mps; float radio_gain; int wipers;');
lines.push('                     int ir; int ir_vehicle; float ir_openness; };');
lines.push('struct DspExcerpt { int block; const float* left; const float* right; };');
lines.push('struct DspScript { const char* label; float sample_rate; int ir_taps; int blocks;');
lines.push('                   const DspKeyframe* keyframes; int keyframe_count;');
lines.push('                   const DspExcerpt* excerpts; int excerpt_count; unsigned checksum; };');
cabinDsp.forEach((c, i) => {
  lines.push(`// script ${i}: ${c.label}`);
  lines.push(`inline constexpr DspKeyframe kDspKeyframes${i}[] = {`);
  c.keyframes.forEach((k) => {
    const irMode = k.ir === undefined ? 0 : k.ir === null ? 2 : 1;
    const irVeh = k.ir ? k.ir.vehicle : 0;
    const irOpen = k.ir ? k.ir.openness : 0;
    lines.push(`    { ${k.block}, ${f32(k.rpm)}, ${f32(k.load)}, ${f32(k.speedMps)}, ${f32(k.openness)}, ${k.vehicle}, `
      + `${f32(k.wetRoad)}, ${f32(k.rain)}, ${f32(k.windMps)}, ${f32(k.radioGain)}, ${k.wipers}, `
      + `${irMode}, ${irVeh}, ${f32(irOpen)} },`);
  });
  lines.push('};');
  c.expectedExcerpts.forEach((e, j) => {
    lines.push(f32Array(`kDspExcerptL${i}_${j}`, e.left));
    lines.push(f32Array(`kDspExcerptR${i}_${j}`, e.right));
  });
  lines.push(`inline constexpr DspExcerpt kDspExcerpts${i}[] = {`);
  c.expectedExcerpts.forEach((e, j) => {
    lines.push(`    { ${e.block}, kDspExcerptL${i}_${j}, kDspExcerptR${i}_${j} },`);
  });
  lines.push('};');
  lines.push('');
});
lines.push('inline constexpr DspScript kDspScripts[] = {');
cabinDsp.forEach((c, i) => {
  lines.push(`    { "${c.label}", ${f32(c.sampleRate)}, ${c.irTaps}, ${c.blocks}, kDspKeyframes${i}, ${c.keyframes.length}, `
    + `kDspExcerpts${i}, ${c.expectedExcerpts.length}, ${c.expectedChecksum}u },`);
});
lines.push('};');
lines.push(`inline constexpr int kDspScriptCount = ${cabinDsp.length};`);
lines.push('');

lines.push('// --- graph_astar / graph_nearest ----------------------------------------');
lines.push(`inline constexpr int kGraphNodeCount = ${GOLDEN_GRAPH.nodeCount};`);
lines.push(`inline constexpr int kGraphEdgeCount = ${GOLDEN_GRAPH.neighbors.length};`);
lines.push(i32Array('kGraphOffsets', GOLDEN_GRAPH.offsets));
lines.push(i32Array('kGraphNeighbors', GOLDEN_GRAPH.neighbors));
lines.push(f64Array('kGraphCoords', GOLDEN_GRAPH.coords));
graphAstar.forEach((c, i) => {
  lines.push(c.expected.length > 0
    ? i32Array(`kGraphPath${i}`, c.expected)
    : `inline constexpr const int* kGraphPath${i} = nullptr;`);
});
lines.push('struct GraphRouteGolden { int from; int to; int length; const int* path; };');
lines.push('inline constexpr GraphRouteGolden kGraphRoutes[] = {');
graphAstar.forEach((c, i) => {
  lines.push(`    { ${c.from}, ${c.to}, ${c.expectedLength}, kGraphPath${i} },`);
});
lines.push('};');
lines.push('struct GraphNearestGolden { double lat; double lng; int expected; };');
lines.push('inline constexpr GraphNearestGolden kGraphNearest[] = {');
graphNearest.forEach((c) => {
  lines.push(`    { ${f64(c.lat)}, ${f64(c.lng)}, ${c.expected} },`);
});
lines.push('};');
lines.push('');

lines.push('// --- depth_* (scene depth) --------------------------------------------');
lines.push(`inline constexpr int kDepthWidth = ${DEPTH_W};`);
lines.push(`inline constexpr int kDepthHeight = ${DEPTH_H};`);
lines.push(`inline constexpr int kDepthNanIndices[] = { ${DEPTH_NAN.join(', ')} };`);
lines.push(`inline constexpr int kDepthInfIndices[] = { ${DEPTH_INF.join(', ')} };`);
lines.push(`inline constexpr int kDepthStridedCount = ${DEPTH_STRIDED_COUNT};`);
lines.push('// values == nullptr: the strided formula input (see gen-wasm-goldens.mjs)');
lines.push('struct DepthPercentileGolden { const char* label; const float* values; double low; double high; double expected[2]; };');
depthPercentiles.forEach((c, i) => {
  if (c.values) lines.push(f32Array(`kDepthPercentileIn${i}`, c.values));
});
lines.push('inline constexpr DepthPercentileGolden kDepthPercentileCases[] = {');
depthPercentiles.forEach((c, i) => {
  lines.push(`    { "${c.label}", ${c.values ? `kDepthPercentileIn${i}` : 'nullptr'}, ${f64(c.low)}, ${f64(c.high)}, `
    + `{ ${f64(c.expected[0])}, ${f64(c.expected[1])} } },`);
});
lines.push('};');
lines.push('struct DepthStepGolden { const char* label; const float* values; int aligned; int same_scene; double horizon_y;');
lines.push('                         const float* expected; double expected_state[3]; };');
depthNormalize.forEach((c, i) => {
  lines.push(f32Array(`kDepthStepIn${i}`, c.values));
  lines.push(f32Array(`kDepthStepExpected${i}`, c.expected));
});
lines.push('inline constexpr DepthStepGolden kDepthSteps[] = {');
depthNormalize.forEach((c, i) => {
  lines.push(`    { "${c.label}", kDepthStepIn${i}, ${c.aligned ? 1 : 0}, ${c.sameScene ? 1 : 0}, ${f64(c.horizonY)}, `
    + `kDepthStepExpected${i}, { ${c.expectedState.map(f64).join(', ')} } },`);
});
lines.push('};');
lines.push(f32Array('kDepthNearMap', depthNearMap));
lines.push('struct DepthNearGolden { const char* label; double horizon_y; double expected; };');
lines.push('inline constexpr DepthNearGolden kDepthNearCases[] = {');
depthNearDepth.forEach((c) => {
  lines.push(`    { "${c.label}", ${f64(c.horizonY)}, ${f64(c.expected)} },`);
});
lines.push('};');
lines.push('');

lines.push('} // namespace goldens');
lines.push('// clang-format on');

writeFileSync(headerOut, `${lines.join('\n')}\n`);

console.log(`==> Goldens captured from ${wasmPath}`);
console.log(`    wasm sha256: ${wasmSha256}`);
console.log(`    ${jsonOut}`);
console.log(`    ${headerOut}`);
