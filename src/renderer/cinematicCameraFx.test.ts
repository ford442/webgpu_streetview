import {
    resolveCinematicCameraFx,
    isCinematicQuality,
    CINEMATIC_FX_OFF,
} from './cinematicCameraFx';
import { QualityLevel } from '../config/visualPresets';

function fx(quality: QualityLevel, reducedMotion = false, speedNormalized = 1) {
    return resolveCinematicCameraFx({ quality, reducedMotion, speedNormalized });
}

describe('resolveCinematicCameraFx', () => {
    it('stays off below High quality', () => {
        expect(fx('low')).toEqual(CINEMATIC_FX_OFF);
        expect(fx('medium')).toEqual(CINEMATIC_FX_OFF);
        expect(isCinematicQuality('low')).toBe(false);
        expect(isCinematicQuality('medium')).toBe(false);
    });

    it('stays off entirely when reduced motion is requested', () => {
        expect(fx('high', true)).toEqual(CINEMATIC_FX_OFF);
        expect(fx('ultra', true)).toEqual(CINEMATIC_FX_OFF);
    });

    it('enables depth of field at High and widens it at Ultra', () => {
        expect(fx('high').dofStrength).toBeGreaterThan(0);
        expect(fx('ultra').dofStrength).toBeGreaterThan(fx('high').dofStrength);
    });

    it('only enables motion blur where the preset asks for it (Ultra)', () => {
        expect(fx('high').motionBlurStrength).toBe(0);
        expect(fx('ultra').motionBlurStrength).toBeGreaterThan(0);
    });

    it('gives a stationary camera no motion blur', () => {
        expect(fx('ultra', false, 0).motionBlurStrength).toBe(0);
        expect(fx('ultra', false, 0.1).motionBlurStrength).toBe(0);
    });

    it('ramps motion blur with speed and clamps at the top', () => {
        const slow = fx('ultra', false, 0.3).motionBlurStrength;
        const fast = fx('ultra', false, 0.8).motionBlurStrength;
        expect(fast).toBeGreaterThan(slow);
        expect(fx('ultra', false, 5).motionBlurStrength).toBeCloseTo(0.6);
    });

    it('does not let DOF depend on speed', () => {
        expect(fx('ultra', false, 0).dofStrength).toBe(fx('ultra', false, 1).dofStrength);
    });

    it('treats a non-finite speed as stationary', () => {
        expect(fx('ultra', false, Number.NaN).motionBlurStrength).toBe(0);
    });
});
