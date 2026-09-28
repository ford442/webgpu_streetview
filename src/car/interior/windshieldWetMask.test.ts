/**
 * The windshield wet mask: persistence, wiper phase as the only driver, and
 * re-wetting by real time. Pure CPU — the GPU only ever sees the R8 copy.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
    WET_MASK_BINS,
    WET_MASK_ROW_LEFT,
    WET_MASK_ROW_RIGHT,
    WET_MASK_THETA_MAX,
    WET_MASK_THETA_MIN,
    WET_REGROW_DRY_SECONDS,
    WET_REGROW_RAIN_SECONDS,
    WindshieldWetMask,
    wetMaskBinTheta,
    wetMaskThetaToU,
} from './windshieldWetMask';
import {
    WIPER_BAND_HALF_WIDTH,
    WIPER_SWEEP_GAIN,
    wiperBladeAngle,
} from './windshieldWiperGeometry';

const wiping = (phase: number) => ({ active: true, phase });
const parked = { active: false, phase: 0 };

describe('WindshieldWetMask', () => {
    it('starts fully wet', () => {
        const mask = new WindshieldWetMask();
        for (const row of [WET_MASK_ROW_LEFT, WET_MASK_ROW_RIGHT]) {
            for (const theta of [-1, -0.4, 0, 0.4, 1]) {
                expect(mask.sample(row, theta)).toBe(1);
            }
        }
    });

    it('wipes the glass under the blade, and keeps it wiped behind it', () => {
        const mask = new WindshieldWetMask();
        // Sweep the left blade out to mid-stroke in small steps.
        for (let p = 0; p <= 0.5; p += 0.02) mask.update(1 / 60, wiping(p), 0);
        const tip = wiperBladeAngle(0.5);
        expect(tip).toBeCloseTo(WIPER_SWEEP_GAIN);

        // Under the blade: wiped.
        expect(mask.sample(WET_MASK_ROW_LEFT, tip)).toBeLessThan(0.05);
        // Behind it (the region it already passed): still wiped — a stateless
        // decal could not know this, which is the whole point of the mask.
        expect(mask.sample(WET_MASK_ROW_LEFT, tip * 0.5)).toBeLessThan(0.05);
        expect(mask.sample(WET_MASK_ROW_LEFT, 0.05)).toBeLessThan(0.05);
        // Ahead of it: untouched.
        expect(mask.sample(WET_MASK_ROW_LEFT, tip + WIPER_BAND_HALF_WIDTH * 2)).toBe(1);
        // The other blade's row is a mirror: it wiped the negative angles instead.
        expect(mask.sample(WET_MASK_ROW_RIGHT, -tip)).toBeLessThan(0.05);
        expect(mask.sample(WET_MASK_ROW_RIGHT, tip)).toBe(1);
    });

    it('is driven by the animator\'s phase only: same phase, same wiped strip, whatever the frame rate', () => {
        const fine = new WindshieldWetMask();
        const coarse = new WindshieldWetMask();
        for (let p = 0; p <= 0.5; p += 0.005) fine.update(0, wiping(p), 0);
        for (let p = 0; p <= 0.5; p += 0.1) coarse.update(0, wiping(p), 0);
        coarse.update(0, wiping(0.5), 0);
        // A hitched frame must not leave a dry-looking gap between samples.
        for (let i = 0; i < WET_MASK_BINS; i += 4) {
            const theta = wetMaskBinTheta(i);
            expect(coarse.sample(WET_MASK_ROW_LEFT, theta)).toBeCloseTo(
                fine.sample(WET_MASK_ROW_LEFT, theta),
                1,
            );
        }
    });

    it('wipes the whole interval a hitched frame skipped, not just where the blade landed', () => {
        const mask = new WindshieldWetMask();
        mask.update(0, wiping(0), 0);
        mask.update(0, wiping(0.5), 0); // blade jumps from park to full stroke in one frame
        expect(mask.sample(WET_MASK_ROW_LEFT, WIPER_SWEEP_GAIN * 0.5)).toBeLessThan(0.05);
    });

    it('re-wets by real time, not by wiper phase', () => {
        const mask = new WindshieldWetMask();
        for (let p = 0; p <= 0.5; p += 0.02) mask.update(1 / 60, wiping(p), 0);
        const theta = 0.3;
        const wiped = mask.sample(WET_MASK_ROW_LEFT, theta);
        expect(wiped).toBeLessThan(0.05);

        // Wipers off: the strip re-wets with no phase involved at all.
        mask.update(WET_REGROW_DRY_SECONDS / 2, parked, 0);
        const half = mask.sample(WET_MASK_ROW_LEFT, theta);
        expect(half).toBeGreaterThan(0.4);
        expect(half).toBeLessThan(0.6);
        mask.update(WET_REGROW_DRY_SECONDS, parked, 0);
        expect(mask.sample(WET_MASK_ROW_LEFT, theta)).toBe(1);
    });

    it('re-wets faster in heavy rain than on near-dry glass', () => {
        const dry = new WindshieldWetMask();
        const rainy = new WindshieldWetMask();
        for (const mask of [dry, rainy]) {
            for (let p = 0; p <= 0.5; p += 0.02) mask.update(0, wiping(p), 0);
        }
        dry.update(WET_REGROW_RAIN_SECONDS, parked, 0);
        rainy.update(WET_REGROW_RAIN_SECONDS, parked, 1);
        expect(rainy.sample(WET_MASK_ROW_LEFT, 0.3)).toBeGreaterThan(dry.sample(WET_MASK_ROW_LEFT, 0.3));
        expect(rainy.sample(WET_MASK_ROW_LEFT, 0.3)).toBe(1);
    });

    it('keeps regrowing through an intermittent-wiper dwell (phase frozen at park)', () => {
        const mask = new WindshieldWetMask();
        for (let p = 0; p <= 1; p += 0.02) mask.update(1 / 60, wiping(p), 0);
        const before = mask.sample(WET_MASK_ROW_LEFT, 0.3);
        // Dwell: wipers "active", phase parked at 0 — the blade sits at the park angle.
        for (let i = 0; i < 300; i++) mask.update(1 / 60, wiping(0), 0);
        expect(mask.sample(WET_MASK_ROW_LEFT, 0.3)).toBeGreaterThan(before);
    });

    it('starts a fresh stroke from a point after the wipers were off, not from a stale angle', () => {
        const mask = new WindshieldWetMask();
        for (let p = 0; p <= 0.5; p += 0.02) mask.update(0, wiping(p), 0);
        mask.update(WET_REGROW_DRY_SECONDS * 2, parked, 0); // fully re-wet, wipers off
        expect(mask.sample(WET_MASK_ROW_LEFT, 0.5)).toBe(1);
        // Wipers come back on at park: nothing between the old stroke tip and park is wiped.
        mask.update(0, wiping(0), 0);
        expect(mask.sample(WET_MASK_ROW_LEFT, 0.5)).toBe(1);
    });

    it('never wipes past the sweep + band, so clamp-to-edge sampling reads fully wet', () => {
        const mask = new WindshieldWetMask();
        for (let p = 0; p <= 1; p += 0.01) mask.update(0, wiping(p), 0);
        expect(WET_MASK_THETA_MAX).toBeGreaterThan(WIPER_SWEEP_GAIN + WIPER_BAND_HALF_WIDTH);
        expect(mask.sample(WET_MASK_ROW_LEFT, WET_MASK_THETA_MAX)).toBe(1);
        expect(mask.sample(WET_MASK_ROW_LEFT, WET_MASK_THETA_MIN)).toBe(1);
        expect(mask.sample(WET_MASK_ROW_RIGHT, WET_MASK_THETA_MAX)).toBe(1);
        expect(mask.sample(WET_MASK_ROW_RIGHT, WET_MASK_THETA_MIN)).toBe(1);
    });

    it('does not upload on idle frames', () => {
        const mask = new WindshieldWetMask();
        expect(mask.update(1 / 60, parked, 0)).toBe(false);
        expect(mask.update(1 / 60, wiping(0.25), 0)).toBe(true);
    });

    it('marks the texture for upload when it changes', () => {
        const mask = new WindshieldWetMask();
        const before = mask.texture.version;
        mask.update(0, parked, 0);
        expect(mask.texture.version).toBe(before);
        mask.update(0, wiping(0.25), 0);
        expect(mask.texture.version).toBeGreaterThan(before);
    });

    it('reset() makes the glass fully wet again', () => {
        const mask = new WindshieldWetMask();
        for (let p = 0; p <= 0.5; p += 0.02) mask.update(0, wiping(p), 0);
        mask.reset();
        expect(mask.sample(WET_MASK_ROW_LEFT, 0.3)).toBe(1);
    });

    it('ignores negative and zero time steps', () => {
        const mask = new WindshieldWetMask();
        for (let p = 0; p <= 0.5; p += 0.02) mask.update(0, wiping(p), 0);
        const wiped = mask.sample(WET_MASK_ROW_LEFT, 0.3);
        mask.update(-5, parked, 0);
        expect(mask.sample(WET_MASK_ROW_LEFT, 0.3)).toBe(wiped);
    });
});

describe('wet mask texture', () => {
    it('is a two-row R8 texture the shader can filter linearly', () => {
        const { texture } = new WindshieldWetMask();
        expect(texture.image.width).toBe(WET_MASK_BINS);
        expect(texture.image.height).toBe(2);
        expect(texture.format).toBe(THREE.RedFormat);
        expect(texture.type).toBe(THREE.UnsignedByteType);
        expect(texture.magFilter).toBe(THREE.LinearFilter);
        expect(texture.minFilter).toBe(THREE.LinearFilter);
        expect(texture.generateMipmaps).toBe(false);
        // Data, not colour: three must not sRGB-decode it on sample.
        expect(texture.colorSpace).toBe(THREE.NoColorSpace);
    });

    it('encodes wetness as 255 = wet, 0 = wiped, row 0 left blade', () => {
        const mask = new WindshieldWetMask();
        const data = mask.texture.image.data as Uint8Array;
        expect(data.every((b) => b === 255)).toBe(true);
        for (let p = 0; p <= 0.5; p += 0.02) mask.update(0, wiping(p), 0);
        const i = Math.floor(wetMaskThetaToU(0.3) * WET_MASK_BINS);
        expect(data[WET_MASK_ROW_LEFT * WET_MASK_BINS + i]).toBeLessThan(15);
        expect(data[WET_MASK_ROW_RIGHT * WET_MASK_BINS + i]).toBe(255);
    });

    it('maps angle to texture u the way the shader does', () => {
        expect(wetMaskThetaToU(WET_MASK_THETA_MIN)).toBe(0);
        expect(wetMaskThetaToU(WET_MASK_THETA_MAX)).toBe(1);
        expect(wetMaskThetaToU(0)).toBeCloseTo(0.5);
        // Bin centres sit at texel centres, so a bin's own angle samples that bin.
        for (const i of [0, 17, 64, 127]) {
            expect(wetMaskThetaToU(wetMaskBinTheta(i)) * WET_MASK_BINS).toBeCloseTo(i + 0.5);
        }
    });
});
