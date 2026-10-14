import { describe, expect, it } from 'vitest';
import {
    createDepthNormalizeState,
    disparityPercentiles,
    floatToHalfBits,
    IMAGENET_MEAN,
    IMAGENET_STD,
    linearToSrgbBytesInPlace,
    normalizeDisparity,
    packHalfFloats,
    rgbaToImageNetNchw,
} from './depthMath';

describe('linear → sRGB bytes (the intermediate is linear; the network wants sRGB)', () => {
    it('keeps black and white, lifts mid-grey to the sRGB curve, leaves alpha alone', () => {
        const px = new Uint8Array([0, 255, 55, 200, 128, 128, 128, 17]);
        linearToSrgbBytesInPlace(px);
        expect(px[0]).toBe(0);
        expect(px[1]).toBe(255);
        // linear 55/255 ≈ 0.2157 → sRGB ≈ 0.5 → 128
        expect(px[2]).toBe(128);
        expect(px[3]).toBe(200);
        // linear 0.502 → sRGB 0.735 → 188
        expect(px[4]).toBe(188);
        expect(px[7]).toBe(17);
    });
});

describe('ImageNet NCHW tensor', () => {
    it('lays out planes R, G, B and normalises with the DPT mean / std', () => {
        // 2×1 image: red, white.
        const rgba = new Uint8Array([255, 0, 0, 255, 255, 255, 255, 255]);
        const t = rgbaToImageNetNchw(rgba, 2, 1);
        expect(t).toHaveLength(6);
        const n = (v: number, c: 0 | 1 | 2) => (v - IMAGENET_MEAN[c]) / IMAGENET_STD[c];
        expect(t[0]).toBeCloseTo(n(1, 0), 6); // R plane, pixel 0
        expect(t[1]).toBeCloseTo(n(1, 0), 6); // R plane, pixel 1
        expect(t[2]).toBeCloseTo(n(0, 1), 6); // G plane, pixel 0
        expect(t[3]).toBeCloseTo(n(1, 1), 6);
        expect(t[4]).toBeCloseTo(n(0, 2), 6); // B plane, pixel 0
        expect(t[5]).toBeCloseTo(n(1, 2), 6);
    });
});

describe('disparity percentiles', () => {
    it('ignores outliers beyond the 2nd/98th percentile', () => {
        const d = new Float32Array(1000);
        for (let i = 0; i < 1000; i++) d[i] = i / 999;
        d[0] = -50; // a stray hot pixel
        d[999] = 1e6;
        const [lo, hi] = disparityPercentiles(d);
        expect(lo).toBeGreaterThan(-1);
        expect(lo).toBeLessThan(0.05);
        expect(hi).toBeLessThan(1.1);
        expect(hi).toBeGreaterThan(0.9);
    });

    it('a flat map has an empty range', () => {
        expect(disparityPercentiles(new Float32Array([3, 3, 3]))).toEqual([3, 3]);
    });
});

describe('normalizeDisparity — affine-invariant disparity → the proxy scale', () => {
    const ramp = (n: number, scale = 1, shift = 0) => {
        const d = new Float32Array(n);
        for (let i = 0; i < n; i++) d[i] = (i / (n - 1)) * scale + shift;
        return d;
    };

    it('near (high disparity) → 0, far (low disparity) → 1', () => {
        const out = normalizeDisparity(ramp(200), createDepthNormalizeState(), { aligned: false, sameScene: false });
        expect(out[199]).toBe(0);
        expect(out[0]).toBe(1);
        for (let i = 1; i < 200; i++) expect(out[i]!).toBeLessThanOrEqual(out[i - 1]!);
    });

    it('is invariant to the network\'s unknown scale and shift', () => {
        const a = normalizeDisparity(ramp(200), createDepthNormalizeState(), { aligned: false, sameScene: false });
        const b = normalizeDisparity(ramp(200, 7.5, 3), createDepthNormalizeState(), { aligned: false, sameScene: false });
        for (let i = 0; i < 200; i++) expect(b[i]!).toBeCloseTo(a[i]!, 5);
    });

    it('eases texels across aligned inferences and snaps when the view moved', () => {
        const state = createDepthNormalizeState();
        const first = Float32Array.from(normalizeDisparity(ramp(100), state, { aligned: false, sameScene: false }));
        const inverted = ramp(100).reverse();
        const eased = normalizeDisparity(inverted, state, { aligned: true, sameScene: true });
        // Halfway between the old map and the new one.
        expect(eased[0]).toBeCloseTo((first[0]! + 0) / 2, 5);
        const snapped = normalizeDisparity(ramp(100), state, { aligned: false, sameScene: false });
        expect(snapped[0]).toBe(1);
    });

    it('a flat or empty map reads as "everything far" — the safe answer (no fog pulled to the lens)', () => {
        const out = normalizeDisparity(new Float32Array([2, 2, 2, 2]), createDepthNormalizeState(), {
            aligned: false,
            sameScene: false,
        });
        expect(Array.from(out)).toEqual([1, 1, 1, 1]);
    });
});

describe('half floats for r16float', () => {
    it.each([
        [0, 0x0000],
        [-0, 0x8000],
        [1, 0x3c00],
        [0.5, 0x3800],
        [-2, 0xc000],
        [0.1, 0x2e66],
        [65504, 0x7bff],
        [70000, 0x7c00],
        [2 ** -24, 0x0001],
        [2 ** -14, 0x0400],
        [Infinity, 0x7c00],
    ])('%f → half bits %i', (value, bits) => {
        expect(floatToHalfBits(value)).toBe(bits);
    });

    it('NaN stays NaN', () => {
        const bits = floatToHalfBits(NaN);
        expect(bits & 0x7c00).toBe(0x7c00);
        expect(bits & 0x03ff).not.toBe(0);
    });

    const F16 = (globalThis as { Float16Array?: Float32ArrayConstructor }).Float16Array;
    it.runIf(!!F16)('matches the engine\'s Float16Array rounding across [0, 1] and beyond', () => {
        const values = new Float32Array(20001);
        for (let i = 0; i < values.length; i++) values[i] = (i / 10000) ** 3 * 2;
        const ours = packHalfFloats(values);
        const reference = new Uint16Array(new F16!(values).buffer);
        expect(Array.from(ours)).toEqual(Array.from(reference));
    });
});
