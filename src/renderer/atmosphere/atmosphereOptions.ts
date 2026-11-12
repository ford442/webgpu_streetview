/**
 * What the frame driver asks the atmosphere pass for each frame, and when the
 * LUTs must be rebuilt. Pure and tested (`atmosphereOptions.test.ts`); no GPU.
 *
 * The pass is absent at Low/Medium (`PRESETS[q].atmosphereLuts`), and until
 * the sky and fog read the LUTs it is opt-in (`?atmosphere=on`).
 */
import { PRESETS, type QualityLevel } from '../../config/visualPresets';

export interface AtmosphereOptions {
    /** Preset allows it and the user opted in. */
    enabled: boolean;
    /** Sun elevation above the horizon, radians (SunCalc `altitude`). */
    sunAltitude: number;
    /** Live meteorological visibility, metres; null for the 23 km default. */
    visibilityM: number | null;
    /** Grey ground albedo, 0–1. */
    groundAlbedo: number;
    /** Observer altitude above the ground, metres (0 until an elevation source exists). */
    observerAltitudeM: number;
}

/** Hillaire's ground albedo for an urban scene. */
const DEFAULT_GROUND_ALBEDO = 0.3;

export function createAtmosphereOptions(): AtmosphereOptions {
    return {
        enabled: false,
        sunAltitude: 0,
        visibilityM: null,
        groundAlbedo: DEFAULT_GROUND_ALBEDO,
        observerAltitudeM: 0,
    };
}

export function resolveAtmosphereOptions(
    input: {
        quality: QualityLevel;
        optedIn: boolean;
        sunAltitude: number;
        visibilityM: number | null;
    },
    out: AtmosphereOptions = createAtmosphereOptions(),
): AtmosphereOptions {
    out.enabled = input.optedIn && PRESETS[input.quality].atmosphereLuts;
    out.sunAltitude = Number.isFinite(input.sunAltitude) ? input.sunAltitude : 0;
    out.visibilityM = input.visibilityM != null && Number.isFinite(input.visibilityM) && input.visibilityM > 0
        ? input.visibilityM
        : null;
    out.groundAlbedo = DEFAULT_GROUND_ALBEDO;
    out.observerAltitudeM = 0;
    return out;
}

/** The sun must move this far (radians; 0.1°) before the sky-view and aerial LUTs rebuild. */
export const SUN_REBUILD_THRESHOLD_RAD = 0.1 * Math.PI / 180;

/**
 * Which LUTs a new state invalidates:
 * - `medium` — the medium changed (visibility, albedo, altitude) or nothing is
 *   built yet: all four, transmittance and multi-scattering first;
 * - `sun` — only the sun moved past the threshold: sky view + aerial perspective;
 * - `none` — nothing to encode this frame.
 */
export type AtmosphereRebuild = 'none' | 'sun' | 'medium';

export interface AtmosphereBuiltState {
    sunAltitude: number;
    visibilityM: number | null;
    groundAlbedo: number;
    observerAltitudeM: number;
}

export function atmosphereRebuild(
    built: AtmosphereBuiltState | null,
    next: AtmosphereBuiltState,
): AtmosphereRebuild {
    if (!built) return 'medium';
    if (
        built.visibilityM !== next.visibilityM
        || built.groundAlbedo !== next.groundAlbedo
        || built.observerAltitudeM !== next.observerAltitudeM
    ) {
        return 'medium';
    }
    return Math.abs(next.sunAltitude - built.sunAltitude) > SUN_REBUILD_THRESHOLD_RAD ? 'sun' : 'none';
}
