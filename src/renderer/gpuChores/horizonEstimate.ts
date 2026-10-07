/**
 * Image-derived horizon for the weather depth proxy.
 *
 * `viewHorizonY` (weather-post.wgsl / weather-post-compute.wgsl) predicts the
 * horizon from camera pitch alone, which is wrong whenever Google's camera is
 * not level (hills, tunnels, pitched panoramas). Street View has no depth
 * buffer, so we estimate the sky/ground split from per-row luma of the
 * existing chores downsample and let the shader blend toward it.
 *
 * A few dozen row means is not batch numeric work — this stays in TypeScript
 * beside `lumaMath.ts` (no WASM export, no goldens).
 *
 * Pure functions only. Covered by horizonEstimate.test.ts.
 */
import { bt709LumaU8 } from './lumaMath';

/** Row grid sampled from the chores downsample (columns are averaged away). */
export const HORIZON_ROWS_WIDTH = 16;
export const HORIZON_ROWS_HEIGHT = 48;

/** Reject frames whose row means span less than this (fog wall, flat grey). */
export const HORIZON_FLAT_RANGE = 0.06;
/** Reject frames darker than this overall (night, tunnel). */
export const HORIZON_NIGHT_MEAN = 0.08;
/** Minimum sky-minus-ground luma step at the chosen split. */
export const HORIZON_MIN_CONTRAST = 0.05;
/** Largest accepted offset from the pitch prediction, in screen heights. */
export const HORIZON_MAX_BIAS = 0.35;
/** EMA weight given to each newly accepted sample. */
export const HORIZON_SMOOTHING = 0.35;

/** Shader-space horizon uniforms (WeatherParamIndex.horizonEstimateY / horizonBlend). */
export interface HorizonUniforms {
  estimateY: number;
  blend: number;
}

/** Blend 0: the shader keeps the pitch-only horizon bit-exactly. */
export const HORIZON_OFF: HorizonUniforms = { estimateY: 0.5, blend: 0 };

/**
 * CPU mirror of the pitch prediction inside WGSL `viewHorizonY` (before the
 * clamp). Normalized pitch 0.5 = level; ~90° vertical FOV.
 */
export function predictedHorizonY(cameraPitchNorm: number): number {
  return 0.5 + (cameraPitchNorm - 0.5) * 2.0;
}

/**
 * CPU mirror of WGSL `viewHorizonY` (f64, so only exact at blend 0). Used by
 * tests to pin the weight-0 contract.
 */
export function viewHorizonYReference(
  cameraPitchNorm: number,
  estimateY: number,
  blend: number,
): number {
  const predicted = predictedHorizonY(cameraPitchNorm);
  const w = Math.min(Math.max(blend, 0), 1);
  const y = w > 0 ? predicted + (estimateY - predicted) * w : predicted;
  return Math.min(Math.max(y, -0.75), 1.75);
}

/** Mean Rec.709 luma in [0, 1] per row of packed RGBA8 (row-major). */
export function rowLumaMeans(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  out: Float32Array = new Float32Array(Math.max(0, height)),
): Float32Array {
  if (width <= 0 || height <= 0 || rgba.length < width * height * 4) return out.fill(0);
  for (let y = 0; y < height; y += 1) {
    let sum = 0;
    const row = y * width * 4;
    for (let x = 0; x < width; x += 1) {
      const o = row + x * 4;
      sum += bt709LumaU8(rgba[o]!, rgba[o + 1]!, rgba[o + 2]!);
    }
    out[y] = sum / (width * 255);
  }
  return out;
}

export interface HorizonEstimate {
  /** Screen-space horizon, top-origin 0–1. */
  y: number;
  /** Sky-minus-ground luma step at the split. */
  contrast: number;
}

/**
 * Best two-segment split of the row means with a brighter top (sky) than
 * bottom (ground). Returns null when the frame carries no usable horizon:
 * near-uniform luma, a dark frame, or too weak a step.
 */
export function estimateHorizonFromRows(rows: ArrayLike<number>): HorizonEstimate | null {
  const h = rows.length;
  if (h < 6) return null;
  let total = 0;
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < h; i += 1) {
    const v = rows[i]!;
    if (!Number.isFinite(v)) return null;
    total += v;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (hi - lo < HORIZON_FLAT_RANGE) return null;
  if (total / h < HORIZON_NIGHT_MEAN) return null;

  let bestScore = 0;
  let bestK = -1;
  let bestContrast = 0;
  let top = 0;
  for (let k = 1; k < h; k += 1) {
    top += rows[k - 1]!;
    if (k < 2 || k > h - 2) continue;
    const meanTop = top / k;
    const meanBottom = (total - top) / (h - k);
    const contrast = meanTop - meanBottom;
    if (contrast <= 0) continue;
    const score = ((k * (h - k)) / (h * h)) * contrast * contrast;
    if (score > bestScore) {
      bestScore = score;
      bestK = k;
      bestContrast = contrast;
    }
  }
  if (bestK < 0 || bestContrast < HORIZON_MIN_CONTRAST) return null;
  return { y: bestK / h, contrast: bestContrast };
}

export interface HorizonFrameInput {
  /** Preset blend weight 0–1. 0 = pitch-only horizon, no estimate. */
  weight: number;
  holdActive: boolean;
  /** Latest published row means, or null when none were sampled. */
  rows: ArrayLike<number> | null;
  /** Normalized pitch the rows were sampled at. */
  rowsPitch: number | null;
  /** Monotonic id of the published rows (gpuChoresStatsStore.rowLumaSeq). */
  rowsSeq: number;
  /** Normalized pitch this frame renders with. */
  livePitch: number;
}

export interface HorizonFrameState {
  /** Accepted offset from the pitch prediction (screen heights), or null. */
  bias: number | null;
  /** Last rowsSeq consumed, so one sample is integrated once. */
  lastSeq: number;
}

export const HORIZON_IDLE: HorizonFrameState = { bias: null, lastSeq: 0 };

export interface HorizonFrameResult {
  state: HorizonFrameState;
  uniforms: HorizonUniforms;
}

/**
 * Per-frame resolver. The estimate is stored as a pitch-independent bias so a
 * live pan re-projects it immediately instead of lagging the sample cadence.
 * A hold (hop / loading canvas) never consumes rows and freezes the last
 * accepted bias across the hop. No accepted bias yet → blend 0.
 */
export function resolveHorizonFrame(
  input: HorizonFrameInput,
  state: HorizonFrameState,
): HorizonFrameResult {
  if (!(input.weight > 0)) return { state, uniforms: HORIZON_OFF };

  let next = state;
  if (!input.holdActive && input.rows && input.rowsPitch != null && input.rowsSeq !== state.lastSeq) {
    next = { bias: state.bias, lastSeq: input.rowsSeq };
    const est = estimateHorizonFromRows(input.rows);
    if (est) {
      const sampleBias = est.y - predictedHorizonY(input.rowsPitch);
      if (Math.abs(sampleBias) <= HORIZON_MAX_BIAS) {
        next.bias = state.bias == null
          ? sampleBias
          : state.bias + (sampleBias - state.bias) * HORIZON_SMOOTHING;
      }
    }
  }

  if (next.bias == null) return { state: next, uniforms: HORIZON_OFF };
  return {
    state: next,
    uniforms: {
      estimateY: predictedHorizonY(input.livePitch) + next.bias,
      blend: Math.min(input.weight, 1),
    },
  };
}
