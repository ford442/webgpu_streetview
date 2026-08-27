/**
 * weatherParticles.ts — gating + grid policy for compute-path precipitation.
 *
 * True GPU particles are an Ultra / `?weather=compute` enhancement. The
 * fragment weather path stays purely procedural so the default look does not
 * change. Low and Medium quality never allocate the storage textures.
 *
 * Particle *controls* (wind, rain, snow, speed) already live in the 40-float
 * weather block — this module does not add uniforms.
 *
 * Fall direction matches `WEATHER_FALL_Y_SIGN` in src/car/carSpatialModel.ts
 * (negative Y in top-origin UV). The WGSL integrate shader hardcodes the
 * same sign; keep them together.
 */

import { PRESETS, QualityLevel } from '../config/visualPresets';
import type { WeatherPostProcessMode } from './RendererBackend';
import { WEATHER_FALL_Y_SIGN } from '../car/carSpatialModel';

export interface ParticlePrecipitationInput {
    weatherMode: WeatherPostProcessMode;
    quality: QualityLevel;
    /** `?wasmParticles=off` (and the stored preference). */
    preference: boolean;
    /** OS / in-app reduced motion — halves the grid. */
    reducedMotion: boolean;
}

export interface ParticleGrid {
    width: number;
    height: number;
}

export const PARTICLE_SEED = 0x51ed;

/** Matches carSpatialModel.WEATHER_FALL_Y_SIGN — flakes fall downward. */
export const PARTICLE_FALL_Y_SIGN: typeof WEATHER_FALL_Y_SIGN = WEATHER_FALL_Y_SIGN;

/** UV wind advection per (wind * speed * dt). */
export const PARTICLE_WIND_SCALE = 0.35;

/** Base fall speed along Y (multiplied by seed speed and rain/snow mix). */
export const PARTICLE_FALL_SPEED = 0.55;

/** Clamp so a backgrounded tab does not teleport the field. */
export const PARTICLE_MAX_DT = 0.05;

/** Half-res density splat target relative to the weather write texture. */
export const PARTICLE_DENSITY_SCALE = 0.5;

const WORKGROUP = 16;

/**
 * Round a particle axis up to a compute workgroup multiple so dispatch
 * covers the grid without a ragged edge.
 */
export function alignParticleAxis(count: number): number {
    return Math.max(WORKGROUP, Math.ceil(Math.max(1, count) / WORKGROUP) * WORKGROUP);
}

export function isParticlePrecipitationEnabled(input: ParticlePrecipitationInput): boolean {
    if (!input.preference) return false;
    if (input.weatherMode !== 'compute') return false;
    // Low/Medium stay on the cheap procedural look even if someone forces
    // `?weather=compute`. High+compute (URL flag) and Ultra (default compute)
    // are the quality gates in the issue.
    if (input.quality === 'low' || input.quality === 'medium') return false;
    return true;
}

/**
 * Square-ish grid sized from the quality preset's `particleCount`, aligned
 * to the integrate workgroup. Reduced motion halves the axis (quarter the
 * particles) rather than disabling the effect.
 */
export function particleGridForQuality(
    quality: QualityLevel,
    reducedMotion: boolean,
): ParticleGrid {
    const presetCount = PRESETS[quality]?.particleCount ?? PRESETS.high.particleCount;
    const target = reducedMotion ? Math.max(256, Math.floor(presetCount / 4)) : presetCount;
    const axis = alignParticleAxis(Math.ceil(Math.sqrt(target)));
    // Cap at 64 so a 16×16 workgroup dispatch stays two groups per axis on Ultra.
    const dim = Math.min(64, axis);
    return { width: dim, height: dim };
}

export function particleCountForGrid(grid: ParticleGrid): number {
    return grid.width * grid.height;
}
