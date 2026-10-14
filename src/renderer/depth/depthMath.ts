/**
 * The CPU arithmetic around the depth network — pure, so it is unit-tested
 * rather than trusted: what goes in (sRGB pixels → ImageNet-normalised NCHW),
 * and what comes out (relative inverse depth → the `viewDepthProxy` scale,
 * stabilised across inferences, packed as half floats for `r16float`).
 */

/** Depth Anything's preprocessor (DPTImageProcessor): ImageNet mean / std on [0, 1] RGB. */
export const IMAGENET_MEAN = [0.485, 0.456, 0.406] as const;
export const IMAGENET_STD = [0.229, 0.224, 0.225] as const;

let linearToSrgbLut: Uint8Array | null = null;

function srgbEncode(linear: number): number {
    return linear <= 0.0031308 ? linear * 12.92 : 1.055 * Math.pow(linear, 1 / 2.4) - 0.055;
}

/**
 * The pass-1 intermediate holds *linear* colour (the panorama is uploaded into
 * an `rgba8unorm-srgb` texture, so sampling decodes it), and the chores'
 * downsample stores those linear values as unorm bytes. The network was trained
 * on sRGB-encoded photos — re-encode before it sees them. RGB only; alpha kept.
 */
export function linearToSrgbBytesInPlace(rgba: Uint8Array): Uint8Array {
    if (!linearToSrgbLut) {
        linearToSrgbLut = new Uint8Array(256);
        for (let i = 0; i < 256; i++) {
            linearToSrgbLut[i] = Math.round(Math.min(1, Math.max(0, srgbEncode(i / 255))) * 255);
        }
    }
    const lut = linearToSrgbLut;
    for (let i = 0; i < rgba.length; i += 4) {
        rgba[i] = lut[rgba[i]!]!;
        rgba[i + 1] = lut[rgba[i + 1]!]!;
        rgba[i + 2] = lut[rgba[i + 2]!]!;
    }
    return rgba;
}

/** Packed RGBA8 → `[1, 3, h, w]` float32, ImageNet-normalised (the model's `pixel_values`). */
export function rgbaToImageNetNchw(
    rgba: Uint8Array,
    width: number,
    height: number,
    out: Float32Array = new Float32Array(3 * width * height),
): Float32Array {
    const plane = width * height;
    const inv255 = 1 / 255;
    for (let i = 0; i < plane; i++) {
        const p = i * 4;
        out[i] = (rgba[p]! * inv255 - IMAGENET_MEAN[0]) / IMAGENET_STD[0];
        out[plane + i] = (rgba[p + 1]! * inv255 - IMAGENET_MEAN[1]) / IMAGENET_STD[1];
        out[2 * plane + i] = (rgba[p + 2]! * inv255 - IMAGENET_MEAN[2]) / IMAGENET_STD[2];
    }
    return out;
}

/** Percentiles the normalisation clamps to — robust against a stray hot pixel or a black border. */
export const DISPARITY_LOW_PERCENTILE = 0.02;
export const DISPARITY_HIGH_PERCENTILE = 0.98;
/** Weight of the newest inference in the EMA (range and, when aligned, every texel). */
export const DEPTH_EMA_ALPHA = 0.5;

/** Percentiles are read from at most this many texels (a fixed stride) — ~1 ms to sort. */
const PERCENTILE_SAMPLES = 16384;

/**
 * `[lo, hi]` at the given percentiles, from a sorted strided subsample. Exact
 * order statistics, so one absurd texel cannot stretch the range the way it
 * would a min/max-scaled histogram.
 */
export function disparityPercentiles(
    disparity: Float32Array,
    lowPct: number = DISPARITY_LOW_PERCENTILE,
    highPct: number = DISPARITY_HIGH_PERCENTILE,
): [number, number] {
    const stride = Math.max(1, Math.ceil(disparity.length / PERCENTILE_SAMPLES));
    const sample = new Float32Array(Math.ceil(disparity.length / stride));
    let n = 0;
    for (let i = 0; i < disparity.length; i += stride) {
        const v = disparity[i]!;
        if (Number.isFinite(v)) sample[n++] = v;
    }
    if (n === 0) return [0, 0];
    const sorted = sample.subarray(0, n).sort();
    const at = (pct: number) => sorted[Math.min(n - 1, Math.max(0, Math.round(pct * (n - 1))))]!;
    return [at(lowPct), at(highPct)];
}

/** Carried between inferences of the same scene; `reset` when the scene or view changes. */
export interface DepthNormalizeState {
    lo: number;
    hi: number;
    /** Last normalised map, for the per-texel EMA when the next one is aligned with it. */
    previous: Float32Array | null;
}

export function createDepthNormalizeState(): DepthNormalizeState {
    return { lo: 0, hi: 0, previous: null };
}

export interface NormalizeOptions {
    /** Same pano and same view as the previous map: blend texel-wise. */
    aligned: boolean;
    /** Same pano (any view): blend the clamp range, so exposure-like flicker of the range is damped. */
    sameScene: boolean;
}

/**
 * Relative inverse depth → the `viewDepthProxy` scale: 0 = at the camera,
 * 1 = the far end of this view (sky, skyline). Depth Anything predicts
 * affine-invariant disparity (unknown scale *and* shift), so absolute values
 * mean nothing; the 2nd–98th percentile range of each map is stretched to
 * [0, 1] and inverted. Range and texels are eased across inferences of the same
 * scene so a map does not pump as the network's output wobbles.
 */
export function normalizeDisparity(
    disparity: Float32Array,
    state: DepthNormalizeState,
    options: NormalizeOptions,
    out: Float32Array = new Float32Array(disparity.length),
): Float32Array {
    let [lo, hi] = disparityPercentiles(disparity);
    if (options.sameScene && state.hi > state.lo) {
        lo = state.lo + (lo - state.lo) * DEPTH_EMA_ALPHA;
        hi = state.hi + (hi - state.hi) * DEPTH_EMA_ALPHA;
    }
    state.lo = lo;
    state.hi = hi;
    const range = hi - lo;
    const inv = range > 1e-6 ? 1 / range : 0;
    const prev = options.aligned && state.previous?.length === disparity.length ? state.previous : null;
    for (let i = 0; i < disparity.length; i++) {
        const d = disparity[i]!;
        const n = inv > 0 && Number.isFinite(d) ? Math.min(1, Math.max(0, (d - lo) * inv)) : 0;
        const depth = 1 - n;
        out[i] = prev ? prev[i]! + (depth - prev[i]!) * DEPTH_EMA_ALPHA : depth;
    }
    state.previous = out;
    return out;
}

const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);

/** IEEE 754 binary16 bits for one value (round to nearest even; ±Inf/NaN preserved). */
export function floatToHalfBits(value: number): number {
    f32[0] = value;
    const x = u32[0]!;
    const sign = (x >>> 16) & 0x8000;
    const exp = (x >>> 23) & 0xff;
    let mant = x & 0x7fffff;
    if (exp === 0xff) return sign | 0x7c00 | (mant ? 0x200 : 0);
    const e = exp - 127 + 15;
    if (e >= 0x1f) return sign | 0x7c00;
    if (e <= 0) {
        if (e < -10) return sign;
        mant |= 0x800000;
        const shift = 14 - e;
        let half = mant >>> shift;
        const rem = mant & ((1 << shift) - 1);
        const halfway = 1 << (shift - 1);
        if (rem > halfway || (rem === halfway && (half & 1))) half += 1;
        return sign | half;
    }
    let half = (e << 10) | (mant >>> 13);
    const rem = mant & 0x1fff;
    // A carry out of the mantissa bumps the exponent (up to Inf) — the bit layout does it.
    if (rem > 0x1000 || (rem === 0x1000 && (half & 1))) half += 1;
    return sign | half;
}

/** Pack a float map for an `r16float` `writeTexture`. */
export function packHalfFloats(
    values: Float32Array,
    out: Uint16Array<ArrayBuffer> = new Uint16Array(values.length),
): Uint16Array<ArrayBuffer> {
    for (let i = 0; i < values.length; i++) out[i] = floatToHalfBits(values[i]!);
    return out;
}
