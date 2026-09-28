/**
 * Wiper arc geometry in windshield-UV space, shared by everything that has to
 * agree with the blade meshes about where the glass is being wiped.
 *
 * These are the constants `src/shaders/windowWeatherOverlay.ts` (GLSL) and its
 * TSL twin in `cabinTslMaterials.ts` inline as literals; the windshield portal's
 * wet mask (`windshieldWetMask.ts`) and its shader read them from here. A test
 * pins the GLSL literals to these values, so retuning the sweep is one edit plus
 * a red test, not a silent divergence between the decal fallback and the portal.
 *
 * The phase itself is **not** owned here. `CarInteriorAnimator` is the one
 * writer (`wiperAnimationTime % 1`, handed over through
 * `WindowWeatherOverlay.setWipersActive`); everything below is a pure function
 * of that phase.
 */

/** Radians of sweep at mid-stroke, in the overlay's atan space (blade angle = sin(phase·π) · gain). */
export const WIPER_SWEEP_GAIN = 0.85;

/** Half-width of the wiped band around the blade, in the same radians. */
export const WIPER_BAND_HALF_WIDTH = 0.16;

/**
 * Wiping fades in over this radial range from the pivot (windshield-UV
 * units): nothing is cleared right at the pivot, everything is by the outer end.
 */
export const WIPER_RADIAL_START = 0.06;
export const WIPER_RADIAL_END = 0.62;

/** Blade pivots in windshield UV. The right blade mirrors the left. */
export const WIPER_PIVOT_LEFT: readonly [number, number] = [0.25, 0.02];
export const WIPER_PIVOT_RIGHT: readonly [number, number] = [0.75, 0.02];

/**
 * Where the left blade's band centres for a sweep phase. `phase` is the
 * animator's 0..1 cycle (0 = park, 0.5 = full stroke, 1 = back at park); the
 * right blade sweeps the mirror angle.
 */
export function wiperBladeAngle(phase: number): number {
    return Math.sin(phase * Math.PI) * WIPER_SWEEP_GAIN;
}
