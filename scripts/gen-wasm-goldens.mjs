#!/usr/bin/env node
/**
 * scripts/gen-wasm-goldens.mjs
 *
 * Generate the cross-implementation golden vectors for the WASM numeric ABI.
 *
 * There are three implementations of the same algorithms:
 *
 *   1. public/wasm/streetview-wasm.wasm  – what actually ships
 *   2. cpp/src/noise_module.cpp          – the C++ source of truth
 *   3. src/wasm/index.ts (JS_FALLBACK)   – the jsdom/degrade twin
 *
 * The goldens are captured **from the shipping binary** (1) and then asserted
 * against (2) by the native host tests (cpp/tests/noise_module_test.cpp) and
 * against (3) by src/wasm/__tests__/wasmGoldenParity.test.ts. One fixture,
 * two consumers — so a change in any single implementation shows up as a test
 * failure instead of silent drift.
 *
 * Outputs (both committed):
 *   cpp/tests/goldens.json            – consumed by Vitest (JS twin)
 *   cpp/tests/goldens_generated.h     – consumed by the native host tests
 *
 * Usage:
 *   npm run gen:wasm-goldens          # after a deliberate algorithm change
 *
 * Regenerating is an explicit act: it re-baselines the contract, so the diff
 * should always be reviewed alongside the algorithm change that caused it.
 */

import { createHash } from 'crypto';
import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const wasmPath = join(repoRoot, 'public', 'wasm', 'streetview-wasm.wasm');
const jsonOut = join(repoRoot, 'cpp', 'tests', 'goldens.json');
const headerOut = join(repoRoot, 'cpp', 'tests', 'goldens_generated.h');

const bytes = readFileSync(wasmPath);
const wasmSha256 = createHash('sha256').update(bytes).digest('hex');

const importObject = { env: { sin: Math.sin, cos: Math.cos, atan2: Math.atan2 } };
const { instance } = await WebAssembly.instantiate(bytes, importObject);
const exp = instance.exports;
const memory = exp.memory;

/** Byte offset the TS loader uses for buffer transfers (see src/wasm/index.ts). */
const SCRATCH = 512;

const reserve = (nbytes) => {
  const available = memory.buffer.byteLength - SCRATCH;
  if (available < nbytes) memory.grow(Math.ceil((nbytes - available) / 65536));
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

const ANGLES = [0, 0.5, 45, 180, 359.5, 360, 361, -1, -180, -359.5, -720.25, 1080.75];
const ANGLE_PAIRS = [
  [0, 90], [90, 0], [10, 350], [350, 10], [0, 180], [180, 0],
  [-45, 45], [720, 45], [359, 1], [123.25, -456.5],
];

const ENGINE_CASES = [
  { label: 'cruise', count: 64, rpm: 2500, load: 0.6, speedKmh: 90, timeSec: 3.25, sampleRate: 44100 },
  { label: 'idle', count: 32, rpm: 800, load: 0, speedKmh: 0, timeSec: 0, sampleRate: 44100 },
  { label: 'redline', count: 32, rpm: 6800, load: 1, speedKmh: 210, timeSec: 12.5, sampleRate: 48000 },
  // Degenerate inputs: the clamp/fallback branches must agree across backends.
  { label: 'clamped', count: 16, rpm: -100, load: 2.5, speedKmh: -5, timeSec: -1, sampleRate: 0 },
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

const normalizeAngle = ANGLES.map((angle) => ({
  angle, expected: exp.normalize_angle(angle),
}));

const signedAngleDiff = ANGLE_PAIRS.map(([from, to]) => ({
  from, to, expected: exp.signed_angle_diff(from, to),
}));

const engineNoise = ENGINE_CASES.map((c) => {
  reserve(c.count * 4);
  exp.fill_engine_noise(
    SCRATCH, c.count, c.rpm, c.load, c.speedKmh, c.timeSec, c.sampleRate,
  );
  return { ...c, expected: readF32(c.count) };
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
  normalizeAngle,
  signedAngleDiff,
  engineNoise,
  lumaHistogram,
  lumaReduce,
  downsample2d,
};

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
lines.push(' * src/wasm/__tests__/wasmGoldenParity.test.ts asserts the JS fallback');
lines.push(' * against — so C++, WAT and JS are pinned to one contract.');
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
  lines.push(`inline constexpr float kEngineTime${i} = ${f32(c.timeSec)};`);
  lines.push(`inline constexpr float kEngineSampleRate${i} = ${f32(c.sampleRate)};`);
  lines.push(f32Array(`kEngineExpected${i}`, c.expected));
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

lines.push('} // namespace goldens');
lines.push('// clang-format on');

writeFileSync(headerOut, `${lines.join('\n')}\n`);

console.log(`==> Goldens captured from ${wasmPath}`);
console.log(`    wasm sha256: ${wasmSha256}`);
console.log(`    ${jsonOut}`);
console.log(`    ${headerOut}`);
