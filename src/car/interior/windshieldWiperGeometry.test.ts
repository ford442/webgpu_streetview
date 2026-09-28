/**
 * The wiper arc constants are inlined as literals in the decal overlay's GLSL
 * (and its TSL twin). The portal's wet mask reads them from
 * `windshieldWiperGeometry.ts`. This pins the two together, so retuning the sweep
 * cannot silently desync the portal from the decal fallback — or from the blades.
 */
import { describe, expect, it } from 'vitest';
import { windowWeatherOverlayFragment } from '../../shaders/windowWeatherOverlay';
import {
    WIPER_BAND_HALF_WIDTH,
    WIPER_PIVOT_LEFT,
    WIPER_PIVOT_RIGHT,
    WIPER_RADIAL_END,
    WIPER_RADIAL_START,
    WIPER_SWEEP_GAIN,
    wiperBladeAngle,
} from './windshieldWiperGeometry';

describe('wiper geometry vs the decal overlay GLSL', () => {
    const glsl = windowWeatherOverlayFragment;

    it('uses the same sweep gain', () => {
        expect(glsl).toContain(`sweep * ${WIPER_SWEEP_GAIN}`);
        expect(glsl.match(/sweep \* 0\.85/g)).toHaveLength(2); // one per blade
    });

    it('uses the same pivots', () => {
        expect(glsl).toContain(`vec2(${WIPER_PIVOT_LEFT[0]}, ${WIPER_PIVOT_LEFT[1]})`);
        expect(glsl).toContain(`vec2(${WIPER_PIVOT_RIGHT[0]}, ${WIPER_PIVOT_RIGHT[1]})`);
    });

    it('uses the same band width and radial ramp', () => {
        expect(glsl).toContain(`smoothstep(${WIPER_BAND_HALF_WIDTH}, 0.0, abs(ang))`);
        expect(glsl).toContain(`smoothstep(${WIPER_RADIAL_START}, ${WIPER_RADIAL_END}, length(dir))`);
    });

    it('takes the blade angle from the animator\'s phase the way CarInteriorAnimator swings the mesh', () => {
        // Animator: angle = sin(cycle * PI) * (PI / 4). The overlay's atan-space gain is a fixed multiple.
        expect(wiperBladeAngle(0)).toBeCloseTo(0);
        expect(wiperBladeAngle(0.5)).toBeCloseTo(WIPER_SWEEP_GAIN);
        expect(wiperBladeAngle(1)).toBeCloseTo(0);
        expect(wiperBladeAngle(0.25)).toBeCloseTo(wiperBladeAngle(0.75));
    });
});
