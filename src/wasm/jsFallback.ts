/**
 * src/wasm/jsFallback.ts
 * Pure-JavaScript implementation of the streetview-wasm ABI.
 *
 * This mirrors the C++ logic exactly (see cpp/src/noise_module.cpp) so the
 * app works even when the .wasm file has not been compiled yet, or when
 * `WebAssembly` is unavailable. It is a degrade/test twin, not a third place
 * to invent behaviour — see docs/WASM_BRIDGE.md.
 */
import {
  downsample2d as jsDownsample2d,
  lumaHistogramBt709 as jsLumaHistogramBt709,
  reduceLumaBt709 as jsReduceLumaBt709,
} from '../renderer/gpuChores/lumaMath';
import type { StreetViewWasmAPI } from './abi';

function _fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function _lerp(a: number, b: number, t: number): number {
  return a + t * (b - a);
}

const GRAD2 = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [0.70710678, 0.70710678], [-0.70710678, 0.70710678],
  [0.70710678, -0.70710678], [-0.70710678, -0.70710678],
];

let _perm = new Uint8Array(512);
// Default identity permutation.
for (let i = 0; i < 256; i++) _perm[i] = _perm[i + 256] = i;

function _jsSeed(s: number): void {
  const tmp = new Uint8Array(256);
  for (let i = 0; i < 256; i++) tmp[i] = i;
  let state = s >>> 0;
  for (let i = 255; i > 0; i--) {
    state = ((state * 1664525) + 1013904223) >>> 0;
    const j = ((state >>> 16) & 0x7fff) % (i + 1);
    // i in [1,255] and j in [0,i], both always valid indices into tmp.
    const t = tmp[i]!; tmp[i] = tmp[j]!; tmp[j] = t;
  }
  _perm = new Uint8Array(512);
  // i in [0,255] is always a valid index into tmp.
  for (let i = 0; i < 256; i++) _perm[i] = _perm[i + 256] = tmp[i]!;
}

function _jsGrad2(h: number, dx: number, dy: number): number {
  // h & 7 is always in [0,7], a valid index into GRAD2.
  const g = GRAD2[h & 7]!;
  // Every GRAD2 entry is a 2-element [x, y] pair.
  return g[0]! * dx + g[1]! * dy;
}

function _jsNoise2d(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const u = _fade(fx);
  const v = _fade(fy);
  const X = ix & 255;
  const Y = iy & 255;
  // X, X + 1 in [0,256] are always valid indices into the 512-entry _perm table.
  const pX = _perm[X]!;
  const pX1 = _perm[X + 1]!;
  const n00 = _jsGrad2(_perm[pX + Y]!, fx, fy);
  const n10 = _jsGrad2(_perm[pX1 + Y]!, fx - 1, fy);
  const n01 = _jsGrad2(_perm[pX + Y + 1]!, fx, fy - 1);
  const n11 = _jsGrad2(_perm[pX1 + Y + 1]!, fx - 1, fy - 1);
  return _lerp(_lerp(n00, n10, u), _lerp(n01, n11, u), v);
}

function _jsFillNoiseBuffer(
  out: Float32Array,
  width: number,
  height: number,
  scale: number,
  offsetX: number,
  offsetY: number,
): void {
  const invScale = 1 / scale;
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      out[row * width + col] = _jsNoise2d(
        (col + offsetX) * invScale,
        (row + offsetY) * invScale,
      );
    }
  }
}

function _jsFbm2d(
  x: number,
  y: number,
  octaves: number,
  lacunarity: number,
  gain: number,
): number {
  let sum = 0;
  let norm = 0;
  let amp = 1;
  let freq = 1;
  for (let o = 0; o < octaves; o++) {
    sum += amp * _jsNoise2d(x * freq, y * freq);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return norm > 0 ? sum / norm : 0;
}

function _jsFillFbmBuffer(
  out: Float32Array,
  width: number,
  height: number,
  scale: number,
  offsetX: number,
  offsetY: number,
  octaves: number,
  lacunarity: number,
  gain: number,
): void {
  const invScale = 1 / scale;
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      out[row * width + col] = _jsFbm2d(
        (col + offsetX) * invScale,
        (row + offsetY) * invScale,
        octaves,
        lacunarity,
        gain,
      );
    }
  }
}

/** 2π as an f32, matching the literal in the WAT/C++ particle-seed code. */
const _TWO_PI_F32 = Math.fround(6.2831853);

function _jsFillParticleSeeds(out: Float32Array, count: number, seed: number): void {
  // Same LCG and bit slice as the WAT/C++ implementations so a given seed
  // produces the same particle set on every backend.
  let state = seed >>> 0;
  const nextUnit = (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return ((state >>> 8) & 0xffffff) / 16777216;
  };
  for (let i = 0; i < count; i++) {
    const base = i * 4;
    out[base] = nextUnit();
    out[base + 1] = nextUnit();
    out[base + 2] = 0.5 + nextUnit();
    // Single-precision multiply (fround of both operand and product) so the
    // phase matches the WAT/C++ f32 arithmetic exactly rather than rounding
    // twice through a double intermediate.
    out[base + 3] = Math.fround(nextUnit() * _TWO_PI_F32);
  }
}

function _jsHaversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function _jsBatchHaversine(points: Float64Array, segmentsOut: Float64Array): number {
  let total = 0;
  const count = Math.floor(points.length / 2);
  for (let i = 0; i < count - 1; i++) {
    const d = _jsHaversine(
      points[i * 2]!,
      points[i * 2 + 1]!,
      points[i * 2 + 2]!,
      points[i * 2 + 3]!,
    );
    segmentsOut[i] = d;
    total += d;
  }
  return total;
}

function _jsNormalizeAngle(a: number): number {
  return ((a % 360) + 360) % 360;
}

function _jsSignedAngleDiff(from: number, to: number): number {
  const d = to - from;
  return d - 360 * Math.floor((d + 180) / 360);
}

function _jsFillEngineNoise(
  out: Float32Array,
  count: number,
  rpm: number,
  load: number,
  speedKmh: number,
  timeSec: number,
  sampleRate: number,
): void {
  if (count <= 0) return;
  let sr = Math.fround(sampleRate);
  if (!(sr > 1)) sr = 44100;
  rpm = Math.fround(Math.max(0, rpm));
  load = Math.fround(Math.max(0, Math.min(1, load)));
  speedKmh = Math.fround(Math.max(0, speedKmh));
  timeSec = Math.fround(Math.max(0, timeSec));
  const invSr = Math.fround(1 / sr);
  const fund = Math.fround(rpm / 60);
  let state = Math.floor(Math.fround(timeSec * sr)) >>> 0;
  if (state === 0) state = 1;
  let spd = Math.fround(speedKmh / 140);
  if (spd > 1) spd = 1;
  const nMax = Math.min(count, out.length);
  for (let i = 0; i < nMax; i++) {
    const t = Math.fround(timeSec + Math.fround(i * invSr));
    const cycles = Math.fround(t * fund);
    const frac = Math.fround(cycles - Math.fround(Math.floor(cycles)));
    const saw = Math.fround(Math.fround(frac * 2) - 1);
    const cycles2 = Math.fround(t * Math.fround(fund * 2));
    const frac2 = Math.fround(cycles2 - Math.fround(Math.floor(cycles2)));
    const saw2 = Math.fround(Math.fround(frac2 * 2) - 1);
    const eng = Math.fround(
      Math.fround(Math.fround(saw * 0.28) + Math.fround(saw2 * 0.11)) *
        Math.fround(0.22 + Math.fround(0.78 * load)),
    );
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    let n = Math.fround(((state >>> 8) & 0xffffff) / 16777216);
    n = Math.fround(Math.fround(n * 2) - 1);
    let s = Math.fround(eng + Math.fround(Math.fround(n * spd) * 0.18));
    if (s > 1) s = 1;
    else if (s < -1) s = -1;
    out[i] = s;
  }
}

/**
 * Cabin IR profiles — the JS twin of `cabin_profiles` in
 * cpp/src/noise_module.cpp. Times are milliseconds; gains are relative to the
 * direct path. Order matches `CABIN_IR_VEHICLE_INDEX` in
 * `src/car/audio/cabinIr.ts`.
 */
const _CABIN_PROFILES_RAW = [
  // sedan
  { reflectMs: [1.15, 1.9, 2.7], reflectGain: [0.42, 0.26, 0.17], tailLevel: 0.3, tailMs: 2.2, dampClosed: 0.3, dampOpen: 0.88 },
  // convertible
  { reflectMs: [0.85, 1.45, 2.05], reflectGain: [0.34, 0.2, 0.11], tailLevel: 0.22, tailMs: 1.5, dampClosed: 0.38, dampOpen: 0.95 },
  // science-lab
  { reflectMs: [1.4, 2.35, 3.1], reflectGain: [0.46, 0.31, 0.22], tailLevel: 0.38, tailMs: 3.1, dampClosed: 0.26, dampOpen: 0.82 },
  // limousine
  { reflectMs: [1.75, 2.8, 3.6], reflectGain: [0.4, 0.28, 0.2], tailLevel: 0.34, tailMs: 3.6, dampClosed: 0.22, dampOpen: 0.8 },
  // cortianics
  { reflectMs: [0.95, 1.6, 2.3], reflectGain: [0.38, 0.24, 0.15], tailLevel: 0.26, tailMs: 1.8, dampClosed: 0.34, dampOpen: 0.92 },
] as const;

/**
 * The same table with every constant rounded to f32 up front. Without this the
 * twin would multiply f64 literals where the module multiplies f32 ones, and
 * the two would disagree at any openness between 0 and 1 (the endpoints hide
 * it, because the interpolation collapses to an exact operand there).
 */
const _CABIN_PROFILES = _CABIN_PROFILES_RAW.map((p) => ({
  reflectMs: Float32Array.from(p.reflectMs),
  reflectGain: Float32Array.from(p.reflectGain),
  tailLevel: Math.fround(p.tailLevel),
  tailMs: Math.fround(p.tailMs),
  dampClosed: Math.fround(p.dampClosed),
  dampOpen: Math.fround(p.dampOpen),
}));

/** Number of cabin profiles the module knows about (C++ `cabin_profile_count`). */
export const CABIN_IR_PROFILE_COUNT = _CABIN_PROFILES.length;

function _jsFillCabinIr(
  out: Float32Array,
  count: number,
  vehicleType: number,
  openness: number,
  sampleRate: number,
): void {
  if (count <= 0) return;
  let sr = Math.fround(sampleRate);
  if (!(sr > 1)) sr = 44100;
  const open = Math.fround(Math.max(0, Math.min(1, openness)));
  let v = Math.trunc(vehicleType);
  if (!(v >= 0)) v = 0;
  if (v >= _CABIN_PROFILES.length) v = _CABIN_PROFILES.length - 1;
  // v is clamped into range above, so the profile always exists.
  const p = _CABIN_PROFILES[v]!;

  const n = Math.min(count, out.length);
  out.fill(0, 0, n);
  out[0] = 1;

  // Every step below is rounded with Math.fround so this twin reproduces the
  // C++/WASM f32 arithmetic op-for-op rather than accumulating in double.
  const enclosure = Math.fround(1 - Math.fround(0.75 * open));
  const msToTaps = Math.fround(sr / 1000);
  for (let r = 0; r < 3; r++) {
    const d = Math.trunc(Math.fround(p.reflectMs[r]! * msToTaps));
    if (d > 0 && d < n) {
      out[d] = Math.fround(out[d]! + Math.fround(p.reflectGain[r]! * enclosure));
    }
  }

  let state = (Math.imul(v, 2654435761) + 1013904223) >>> 0;
  const tailTaps = Math.fround(p.tailMs * msToTaps);
  const decay = tailTaps > 1 ? Math.fround(1 / tailTaps) : 1;
  let env = Math.fround(p.tailLevel * enclosure);
  let prevN = 0;
  for (let i = 1; i < n; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    let noise = Math.fround(((state >>> 8) & 0xffffff) / 16777216);
    noise = Math.fround(Math.fround(noise * 2) - 1);
    out[i] = Math.fround(
      out[i]! + Math.fround(Math.fround(Math.fround(noise - prevN) * 0.5) * env),
    );
    prevN = noise;
    env = Math.fround(env - Math.fround(env * decay));
  }

  const damp = Math.fround(
    p.dampClosed + Math.fround(Math.fround(p.dampOpen - p.dampClosed) * open),
  );
  let y = 0;
  for (let i = 0; i < n; i++) {
    y = Math.fround(y + Math.fround(damp * Math.fround(out[i]! - y)));
    out[i] = y;
  }

  let dc = 0;
  for (let i = 0; i < n; i++) dc = Math.fround(dc + out[i]!);
  if (dc > 0) {
    const norm = Math.fround(1 / dc);
    for (let i = 0; i < n; i++) out[i] = Math.fround(out[i]! * norm);
  }
}

/** Max interaural time difference (seconds) — mirrors kMaxItdSeconds in hrtf_module.cpp. */
const _HRTF_MAX_ITD_SECONDS = Math.fround(6.6e-4);
/** Max amplitude cut for the far ear at |azimuth| = 90 — mirrors kMaxFarGainCut. */
const _HRTF_MAX_FAR_GAIN_CUT = Math.fround(0.35);
/** 1 - the far-ear damp floor at |azimuth| = 90 — mirrors (1.0f - kFarEarDampFloor). */
const _HRTF_DAMP_RANGE = Math.fround(1 - Math.fround(0.28));

/**
 * JS twin of sw_fill_hrtf (cpp/src/hrtf_module.cpp) — see that file for the
 * algorithm rationale. Every step below is rounded with Math.fround so this
 * twin reproduces the C++/WASM f32 arithmetic op-for-op.
 */
function _jsFillHrtf(
  left: Float32Array,
  right: Float32Array,
  count: number,
  azimuthDeg: number,
  sampleRate: number,
): void {
  if (count <= 0) return;
  let sr = Math.fround(sampleRate);
  if (!(sr > 1)) sr = 44100;
  let az = Math.fround(azimuthDeg);
  if (az > 90) az = 90;
  else if (az < -90) az = -90;

  const n = Math.min(count, left.length, right.length);
  if (n <= 0) return;
  left.fill(0, 0, n);
  right.fill(0, 0, n);

  const ratio = Math.fround(az / 90);
  const absRatio = Math.abs(ratio);
  const shaped = Math.fround(ratio * Math.fround(2 - absRatio));
  const absShaped = Math.abs(shaped);

  const itdA = Math.fround(_HRTF_MAX_ITD_SECONDS * sr);
  const itdB = Math.fround(itdA * absShaped);
  const itdC = Math.fround(itdB + 0.5);
  let delay = Math.trunc(itdC);
  if (delay > n - 1) delay = n - 1;
  if (delay < 0) delay = 0;

  const farGain = Math.fround(1 - Math.fround(_HRTF_MAX_FAR_GAIN_CUT * absShaped));
  const damp = Math.fround(1 - Math.fround(_HRTF_DAMP_RANGE * absShaped));

  const rightIsNear = shaped >= 0;
  const nearEar = rightIsNear ? right : left;
  const farEar = rightIsNear ? left : right;

  nearEar[0] = 1;

  farEar[delay] = farGain;
  let y = 0;
  for (let i = delay; i < n; i++) {
    const x = farEar[i]!;
    y = Math.fround(y + Math.fround(damp * Math.fround(x - y)));
    farEar[i] = y;
  }
}

export const JS_FALLBACK: StreetViewWasmAPI = {
  seed: _jsSeed,
  noise2d: _jsNoise2d,
  fillNoiseBuffer: _jsFillNoiseBuffer,
  fbm2d: _jsFbm2d,
  fillFbmBuffer: _jsFillFbmBuffer,
  fillParticleSeeds: _jsFillParticleSeeds,
  haversine: _jsHaversine,
  batchHaversine: _jsBatchHaversine,
  normalizeAngle: _jsNormalizeAngle,
  signedAngleDiff: _jsSignedAngleDiff,
  fillEngineNoise: _jsFillEngineNoise,
  fillCabinIr: _jsFillCabinIr,
  fillHrtf: _jsFillHrtf,
  lumaHistogramBt709: jsLumaHistogramBt709,
  reduceLumaBt709: jsReduceLumaBt709,
  downsample2d: jsDownsample2d,
  isWasm: false,
};

/**
 * Reset the fallback's internal noise state (used by `_resetWasmModule()`
 * between tests, so a seed call in one test can't leak into the next).
 * @internal
 */
export function resetJsFallbackState(): void {
  _jsSeed(0);
  for (let i = 0; i < 256; i++) _perm[i] = _perm[i + 256] = i;
}
