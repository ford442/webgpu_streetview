import { describe, expect, it } from 'vitest';
import {
    createDepthNormalizeState,
    DEFAULT_NEAR_DEPTH,
    disparityPercentiles,
    floatToHalfBits,
    IMAGENET_MEAN,
    IMAGENET_STD,
    linearToSrgbBytesInPlace,
    NEAR_DEPTH_RANGE,
    normalizeDisparity,
    packHalfFloats,
    PROXY_GROUND_K,
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
    const W = 40;
    const H = 50;
    const LEVEL = { width: W, height: H, horizonY: 0.5 };
    /** A level street view: sky above the horizon, ground disparity ∝ 1 / proxy distance below it. */
    function street(scale = 1, shift = 0): Float32Array {
        const d = new Float32Array(W * H);
        for (let y = 0; y < H; y++) {
            const below = (y + 0.5) / H - 0.5;
            const proxy = below > 0 ? Math.min(1, PROXY_GROUND_K / below) : 1;
            for (let x = 0; x < W; x++) d[y * W + x] = (1 / Math.max(proxy, 0.05)) * scale + shift;
        }
        return d;
    }
    const proxyAt = (y: number) => {
        const below = (y + 0.5) / H - 0.5;
        return below > 0 ? Math.min(1, PROXY_GROUND_K / below) : 1;
    };
    const fresh = { aligned: false, sameScene: false, ...LEVEL };

    it('near (high disparity) → small, far (low disparity) → 1, monotone', () => {
        const out = normalizeDisparity(street(), createDepthNormalizeState(), fresh);
        expect(out[0]).toBe(1); // sky
        expect(out[(H - 1) * W]!).toBeLessThan(0.2); // the road under the camera
        for (let y = 1; y < H; y++) expect(out[y * W]!).toBeLessThanOrEqual(out[(y - 1) * W]! + 1e-6);
    });

    it('lands on the proxy\'s own scale on the ground it calibrates against', () => {
        const out = normalizeDisparity(street(), createDepthNormalizeState(), fresh);
        for (const y of [Math.floor(H * 0.88), Math.floor(H * 0.95)]) {
            expect(out[y * W + W / 2]!).toBeCloseTo(proxyAt(y), 1);
        }
    });

    it('is invariant to the network\'s unknown scale (and near-invariant to its shift)', () => {
        const a = normalizeDisparity(street(), createDepthNormalizeState(), fresh);
        const b = normalizeDisparity(street(7.5), createDepthNormalizeState(), fresh);
        for (let i = 0; i < a.length; i++) expect(b[i]!).toBeCloseTo(a[i]!, 5);
    });

    it('falls back to the default near depth when the view looks up (no ground to calibrate on)', () => {
        const state = createDepthNormalizeState();
        normalizeDisparity(street(), state, { ...fresh, horizonY: 0.95 });
        expect(state.nearDepth).toBe(DEFAULT_NEAR_DEPTH);
    });

    it('clamps the calibration when something near fills the bottom of the frame', () => {
        const d = street();
        // A wall right at the lens across the whole bottom band: absurdly near.
        for (let y = Math.floor(H * 0.8); y < H; y++) for (let x = 0; x < W; x++) d[y * W + x] = 1e4;
        const state = createDepthNormalizeState();
        normalizeDisparity(d, state, fresh);
        expect(state.nearDepth).toBeGreaterThanOrEqual(NEAR_DEPTH_RANGE[0]);
        expect(state.nearDepth).toBeLessThanOrEqual(NEAR_DEPTH_RANGE[1]);
    });

    it('eases texels across aligned inferences and snaps when the view moved', () => {
        const state = createDepthNormalizeState();
        const first = Float32Array.from(normalizeDisparity(street(), state, fresh));
        const flipped = street().reverse();
        const eased = normalizeDisparity(flipped, state, { ...fresh, aligned: true, sameScene: true });
        const i = (H - 1) * W;
        expect(eased[i]).toBeGreaterThan(first[i]!);
        expect(eased[i]).toBeLessThan(1);
        const snapped = normalizeDisparity(street(), state, fresh);
        expect(snapped[i]).toBeCloseTo(first[i]!, 5);
    });

    it('a flat or empty map reads as "everything far" — the safe answer (no fog pulled to the lens)', () => {
        const out = normalizeDisparity(new Float32Array([2, 2, 2, 2]), createDepthNormalizeState(), {
            ...fresh, width: 2, height: 2,
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

    const F16 = (globalThis as unknown as { Float16Array?: Float32ArrayConstructor }).Float16Array;
    it.runIf(!!F16)('matches the engine\'s Float16Array rounding across [0, 1] and beyond', () => {
        const values = new Float32Array(20001);
        for (let i = 0; i < values.length; i++) values[i] = (i / 10000) ** 3 * 2;
        const ours = packHalfFloats(values);
        const reference = new Uint16Array(new F16!(values).buffer);
        expect(Array.from(ours)).toEqual(Array.from(reference));
    });
});

describe('the calibration hyperbola is the shaders\' own', () => {
    it('PROXY_GROUND_K is the constant in viewDepthProxy (both weather paths)', async () => {
        const { readFileSync } = await import('fs');
        const { join } = await import('path');
        for (const name of ['weather-post.wgsl', 'weather-post-compute.wgsl']) {
            const wgsl = readFileSync(join(__dirname, '..', '..', '..', 'public', 'shaders', name), 'utf8');
            const body = wgsl.slice(wgsl.indexOf('fn viewDepthProxy('), wgsl.indexOf('fn viewDepthProxy(') + 300);
            expect(body).toContain(`return clamp(${PROXY_GROUND_K.toFixed(2)} / max(below, 0.0025), 0.0, 1.0);`);
        }
    });
});
