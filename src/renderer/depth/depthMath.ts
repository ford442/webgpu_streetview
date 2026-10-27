/**
 * The CPU arithmetic around the depth network — pure, so it is unit-tested
 * rather than trusted: what goes in (sRGB pixels → ImageNet-normalised NCHW,
 * here: it runs in the depth Worker), and what comes out (relative inverse
 * depth → the `viewDepthProxy` scale, stabilised across inferences — the WASM
 * kernels in cpp/src/depth_module.cpp — packed as half floats for `r16float`).
 */
import { requireWasm, type DepthNormalizeOptions, type DepthNormalizeState } from '../../wasm';

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

/**
 * `[lo, hi]` at the given percentiles, from a sorted strided subsample (at
 * most 16384 texels). Exact order statistics, so one absurd texel cannot
 * stretch the range the way it would a min/max-scaled histogram.
 * `depth_percentiles` in cpp/src/depth_module.cpp.
 */
export function disparityPercentiles(
    disparity: Float32Array,
    lowPct: number = DISPARITY_LOW_PERCENTILE,
    highPct: number = DISPARITY_HIGH_PERCENTILE,
): [number, number] {
    return requireWasm().depthPercentiles(disparity, lowPct, highPct);
}

/**
 * The proxy's hyperbola: `viewDepthProxy` is 0.06 / (y − horizon) below the
 * horizon. The C++ calibration (`kProxyGroundK`) puts the map on the same
 * scale. Must match `viewDepthProxy` in both weather shaders.
 */
export const PROXY_GROUND_K = 0.06;

/** Depth of the nearest disparity when the ground cannot calibrate it (`kDefaultNearDepth`). */
export const DEFAULT_NEAR_DEPTH = 0.1;
/** The calibration's clamp (`kNearDepthMin` / `kNearDepthMax`) — a car or wall filling the bottom must not run it away. */
export const NEAR_DEPTH_RANGE: readonly [number, number] = [0.04, 0.3];

export type { DepthNormalizeState } from '../../wasm';

export function createDepthNormalizeState(): DepthNormalizeState {
    return { lo: 0, hi: 0, nearDepth: 0, previous: null };
}

/**
 * Proxy-scale depth of the nearest disparity, from the ground just in front of
 * the camera: in the bottom-centre band (rows 85–98 %, columns 30–70 %), where
 * a Street View frame looks at the road, `viewDepthProxy` is a fair metric
 * estimate — so `q = proxy(y) · n(x, y)` there (`n` = normalised disparity).
 * Median over the band, clamped to [0.04, 0.3]. When the horizon is too low
 * for that band to be ground (looking up), 0.1. `depth_near_depth` in C++.
 */
export function estimateNearDepth(nearness: Float32Array, width: number, height: number, horizonY: number): number {
    return requireWasm().depthNearDepth(nearness, width, height, horizonY);
}

/**
 * Relative inverse depth → the `viewDepthProxy` scale: 0 = at the camera,
 * 1 = horizon or beyond.
 *
 * Depth Anything predicts affine-invariant disparity (unknown scale and shift),
 * so each map is first stretched to "nearness" `n` ∈ [0, 1] between its 2nd
 * and 98th percentiles. Disparity goes as 1 / distance, so distance goes as
 * 1 / n: `depth = q / n`, clamped to 1 — the same hyperbola the proxy uses —
 * with `q` (the nearest disparity's depth) calibrated against the proxy on the
 * ground in front of the camera (`estimateNearDepth`), so blending the two
 * never shifts the scale. A linear `1 − n` would not: it compresses everything
 * beyond the nearest object toward "far" and fogs the road under the camera.
 * Range, scale and texels are eased (by half) across inferences of the same
 * scene. The arithmetic is `depth_normalize` in cpp/src/depth_module.cpp.
 */
export function normalizeDisparity(
    disparity: Float32Array,
    state: DepthNormalizeState,
    options: DepthNormalizeOptions,
    out: Float32Array = new Float32Array(disparity.length),
): Float32Array {
    return requireWasm().depthNormalize(disparity, state, options, out);
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
