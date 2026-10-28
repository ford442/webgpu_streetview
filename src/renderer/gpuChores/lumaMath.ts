/**
 * BT.709 panorama-analysis helpers shared by the gpu-chores paths.
 *
 * The pixel kernels themselves — histogram, reduce, box downsample and the
 * fused `luma_analyze` — are WASM only (`luma_module.cpp`, via
 * `requireWasm()` / `GpuChores`) or WGSL (`public/shaders/gpu-chores-*.wgsl`);
 * there is no TypeScript twin (#341 removed the last one). What is left here
 * is constants and scalar maths on their outputs.
 */

const BT709_R = 0.2126;
const BT709_G = 0.7152;
const BT709_B = 0.0722;
export const HIST_BINS = 256;
export const CHORES_WORKGROUP_SIZE = 8;

/** Rec.709 luma in 0–255 (same order as C++ / WAT / WGSL). */
export function bt709LumaU8(r: number, g: number, b: number): number {
  return BT709_R * r + BT709_G * g + BT709_B * b;
}

export interface LumaReduce {
  mean: number;
  min: number;
  max: number;
  count: number;
}

/** Mean luma in [0,1] from a 256-bin histogram (gauge path; quantized). */
export function meanLumaFromHistogram(bins: Uint32Array): number {
  let total = 0;
  let weighted = 0;
  for (let i = 0; i < HIST_BINS; i += 1) {
    const c = bins[i] ?? 0;
    total += c;
    weighted += c * i;
  }
  if (total === 0) return 0;
  return weighted / (total * 255);
}

export const PICKER_THUMB_WIDTH = 160;
export const PICKER_THUMB_HEIGHT = 90;

/** Mid-grey target for the auto-exposure hint (Rec.709 scene luma). */
const AE_TARGET_LUMA = 0.18;

/**
 * Suggested exposure compensation in stops from mean luma in [0, 1].
 * Shown in the perf overlay; the opt-in auto exposure (renderer/autoExposure.ts)
 * eases it into the weather `exposure` uniform. Slider/preset writes win.
 */
export function exposureHintFromMeanLuma(mean: number, target: number = AE_TARGET_LUMA): number {
  if (!(mean > 0) || !(target > 0)) return 0;
  const ev = Math.log2(target / mean);
  if (ev > 2) return 2;
  if (ev < -2) return -2;
  return ev;
}

/** Quarter-res sample size used before hist (break-even vs full-res CPU). */
export function histDownsampleSize(width: number, height: number): { width: number; height: number } {
  return {
    width: Math.max(1, Math.floor(width / 4)),
    height: Math.max(1, Math.floor(height / 4)),
  };
}
