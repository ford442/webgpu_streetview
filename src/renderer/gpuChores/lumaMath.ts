/**
 * BT.709 panorama analysis — JS twin of `sw_luma_histogram_bt709`,
 * `sw_reduce_luma_bt709`, and `sw_downsample_2d` (C++ / WAT).
 *
 * Packed RGBA8, row-major, 4 bytes/pixel. Luma coefficients match the WGSL
 * chores shaders (`public/shaders/gpu-chores-hist.wgsl`).
 */

export const BT709_R = 0.2126;
export const BT709_G = 0.7152;
export const BT709_B = 0.0722;
export const HIST_BINS = 256;
export const CHORES_WORKGROUP_SIZE = 8;

/** Rec.709 luma in 0–255 (same order as C++ / WAT / WGSL). */
export function bt709LumaU8(r: number, g: number, b: number): number {
  return BT709_R * r + BT709_G * g + BT709_B * b;
}

export function bt709Bin(r: number, g: number, b: number): number {
  const acc = bt709LumaU8(r, g, b);
  let bin = Math.floor(acc + 0.5);
  if (bin < 0) bin = 0;
  if (bin > 255) bin = 255;
  return bin;
}

export function lumaHistogramBt709(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  bins: Uint32Array = new Uint32Array(HIST_BINS),
): Uint32Array {
  bins.fill(0);
  if (width <= 0 || height <= 0) return bins;
  const count = width * height;
  const need = count * 4;
  if (rgba.length < need) return bins;
  for (let i = 0; i < count; i += 1) {
    const o = i * 4;
    const bin = bt709Bin(rgba[o]!, rgba[o + 1]!, rgba[o + 2]!);
    bins[bin] = (bins[bin]! + 1) >>> 0;
  }
  return bins;
}

export interface LumaReduce {
  mean: number;
  min: number;
  max: number;
  count: number;
}

export function reduceLumaBt709(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
): LumaReduce {
  if (width <= 0 || height <= 0) {
    return { mean: 0, min: 0, max: 0, count: 0 };
  }
  const count = width * height;
  const need = count * 4;
  if (rgba.length < need) {
    return { mean: 0, min: 0, max: 0, count: 0 };
  }
  let sum = 0;
  let min = 1;
  let max = 0;
  for (let i = 0; i < count; i += 1) {
    const o = i * 4;
    const y = bt709LumaU8(rgba[o]!, rgba[o + 1]!, rgba[o + 2]!) / 255;
    sum += y;
    if (y < min) min = y;
    if (y > max) max = y;
  }
  return { mean: sum / count, min, max, count };
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

export function downsample2d(
  src: Uint8Array | Uint8ClampedArray,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
  dst: Uint8Array = new Uint8Array(Math.max(0, dstW) * Math.max(0, dstH) * 4),
): Uint8Array {
  if (srcW <= 0 || srcH <= 0 || dstW <= 0 || dstH <= 0) return dst;
  if (src.length < srcW * srcH * 4 || dst.length < dstW * dstH * 4) return dst;

  for (let dy = 0; dy < dstH; dy += 1) {
    let y0 = Math.floor((dy * srcH) / dstH);
    let y1 = Math.floor(((dy + 1) * srcH) / dstH);
    if (y1 <= y0) y1 = y0 + 1;
    if (y1 > srcH) y1 = srcH;
    for (let dx = 0; dx < dstW; dx += 1) {
      let x0 = Math.floor((dx * srcW) / dstW);
      let x1 = Math.floor(((dx + 1) * srcW) / dstW);
      if (x1 <= x0) x1 = x0 + 1;
      if (x1 > srcW) x1 = srcW;
      let sr = 0;
      let sg = 0;
      let sb = 0;
      let sa = 0;
      let n = 0;
      for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) {
          const o = (y * srcW + x) * 4;
          sr += src[o]!;
          sg += src[o + 1]!;
          sb += src[o + 2]!;
          sa += src[o + 3]!;
          n += 1;
        }
      }
      const d = (dy * dstW + dx) * 4;
      if (n <= 0) {
        dst[d] = 0;
        dst[d + 1] = 0;
        dst[d + 2] = 0;
        dst[d + 3] = 255;
      } else {
        dst[d] = Math.min(255, Math.floor(sr / n));
        dst[d + 1] = Math.min(255, Math.floor(sg / n));
        dst[d + 2] = Math.min(255, Math.floor(sb / n));
        dst[d + 3] = Math.min(255, Math.floor(sa / n));
      }
    }
  }
  return dst;
}

export const PICKER_THUMB_WIDTH = 160;
export const PICKER_THUMB_HEIGHT = 90;

/** Mid-grey target for the auto-exposure hint (Rec.709 scene luma). */
export const AE_TARGET_LUMA = 0.18;

/**
 * Suggested exposure compensation in stops from mean luma in [0, 1].
 * Display-only — never mutates weather `exposure` (user sliders stay in charge).
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
