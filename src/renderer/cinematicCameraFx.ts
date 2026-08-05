/**
 * cinematicCameraFx.ts — gating policy for depth of field and motion blur.
 *
 * Both effects cost extra scene taps in the weather post pass and both can
 * provoke motion sickness, so they only turn on when *all* of these hold:
 *   - the active quality preset enables them (High = DOF, Ultra = DOF + blur)
 *   - the user has not asked for reduced motion (OS media query or the
 *     in-app accessibility toggle)
 *
 * Motion blur additionally scales with car/cruise speed so a parked car gets
 * none of it; DOF is speed-independent (it's a lens property, not motion).
 *
 * Pure functions — covered by cinematicCameraFx.test.ts. The resolved numbers
 * land in weather uniform slots 38/39 (see weatherUniformLayout.ts).
 */

import { PRESETS, QualityLevel } from '../config/visualPresets';

export interface CinematicCameraFxInput {
    quality: QualityLevel;
    /** True when either the OS media query or the a11y panel asks for it. */
    reducedMotion: boolean;
    /** Normalized 0–1 travel speed (see cameraMotionSignal.ts). */
    speedNormalized: number;
}

export interface CinematicCameraFx {
    /** Uniform 38 — 0 disables the DOF taps entirely. */
    dofStrength: number;
    /** Uniform 39 — 0 disables the radial blur taps entirely. */
    motionBlurStrength: number;
}

export const CINEMATIC_FX_OFF: CinematicCameraFx = {
    dofStrength: 0,
    motionBlurStrength: 0,
};

/** Quality levels allowed to spend frame budget on camera FX. */
const CINEMATIC_QUALITY_LEVELS: ReadonlySet<QualityLevel> = new Set<QualityLevel>(['high', 'ultra']);

export function isCinematicQuality(quality: QualityLevel): boolean {
    return CINEMATIC_QUALITY_LEVELS.has(quality);
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));

export function resolveCinematicCameraFx(input: CinematicCameraFxInput): CinematicCameraFx {
    if (input.reducedMotion || !isCinematicQuality(input.quality)) {
        return { ...CINEMATIC_FX_OFF };
    }

    const preset = PRESETS[input.quality];
    const speed = clamp01(input.speedNormalized);

    // DOF: a light lens defocus on the far field. Ultra gets a wider bokeh.
    const dofStrength = preset.depthOfFieldEnabled
        ? (input.quality === 'ultra' ? 0.55 : 0.35)
        : 0;

    // Motion blur: nothing while stationary, ramping in over the first ~40% of
    // the speed range so gentle cruising stays crisp.
    const motionBlurStrength = preset.motionBlurEnabled
        ? clamp01((speed - 0.12) / 0.5) * 0.6
        : 0;

    return { dofStrength, motionBlurStrength };
}

/**
 * True when the OS asks for reduced motion. Safe to call outside a browser
 * (SSR / vitest node env) — returns false when matchMedia is unavailable.
 */
export function prefersReducedMotion(): boolean {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    try {
        return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch {
        return false;
    }
}
