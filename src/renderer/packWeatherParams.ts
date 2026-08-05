import {
    WEATHER_PARAMS_FLOAT_COUNT,
    WeatherParamIndex,
} from './weatherUniformLayout';
import { resolveWeatherCohesion } from './weatherCohesion';
import { CINEMATIC_FX_OFF, CinematicCameraFx } from './cinematicCameraFx';

/** Env + frame fields needed to pack the 40-float weather uniform array. */
export interface WeatherParamsEnvInput {
    vibrance: number;
    saturation: number;
    contrast: number;
    exposure: number;
    temperature: number;
    tint: number;
    rainIntensity: number;
    snowIntensity: number;
    wind: number;
    nightIntensity: number;
    headlightsOn: boolean;
    highBeam: boolean;
    domeLightOn: boolean;
    sunAzimuth: number;
    sunAltitude: number;
    moonAzimuth: number;
    moonAltitude: number;
    fogDensity: number;
    shaderEffectsEnabled: boolean;
    timeOfDay: string;
}

export interface PackWeatherParamsOptions {
    env: WeatherParamsEnvInput;
    /** Elapsed animation time in seconds (uniform index 6). */
    timeSeconds: number;
    /** Normalized camera heading 0–1 (same as panX). */
    cameraHeading: number;
    /** Normalized camera pitch 0–1 (same as panY). */
    cameraPitch: number;
    /** True when WASM noise tile is enabled and ready. */
    wasmNoiseActive: boolean;
    /**
     * Resolved depth-of-field / motion-blur strengths (uniforms 38-39). Omit
     * to ship the pass with both effects off — see cinematicCameraFx.ts for
     * the quality + reduced-motion gate that produces this.
     */
    cinematic?: CinematicCameraFx;
}

/**
 * Default CPU-side weather params used by both processors at construction.
 * Matches the historical literal `.set([...])` arrays in WeatherPostProcessor /
 * ComputeWeatherPostProcessor (speed=1, headlight look at center, effects on).
 */
export function createDefaultWeatherParams(): Float32Array {
    const params = new Float32Array(WEATHER_PARAMS_FLOAT_COUNT);
    params[WeatherParamIndex.speed] = 1.0;
    params[WeatherParamIndex.headlightHeading] = 0.5;
    params[WeatherParamIndex.headlightPitch] = 0.5;
    params[WeatherParamIndex.shaderEffectsEnabled] = 1.0;
    return params;
}

/**
 * Pack environment settings into the shared 40-float weather layout.
 * Preserves UI→shader scaling used by WebGPUCanvas (rain/snow /100*2, wind
 * /100*2-1). Atmospheric channels (fog, haze, dust, sun FX) are derived
 * together by resolveWeatherCohesion so presets tell one physical story —
 * see weatherCohesion.ts and docs/GRAPHICS.md.
 */
export function packWeatherParams(options: PackWeatherParamsOptions): Float32Array {
    const { env: e, timeSeconds, cameraHeading, cameraPitch, wasmNoiseActive } = options;
    const params = new Float32Array(WEATHER_PARAMS_FLOAT_COUNT);
    const I = WeatherParamIndex;

    const atmosphere = resolveWeatherCohesion({
        rainIntensity: e.rainIntensity,
        snowIntensity: e.snowIntensity,
        fogDensity: e.fogDensity,
        sunAltitude: e.sunAltitude,
        nightIntensity: e.nightIntensity,
        wasmNoiseActive,
    });
    const cinematic = options.cinematic ?? CINEMATIC_FX_OFF;

    // [0-5]: Color grading (UI 1.0 = neutral for vibrance/saturation/contrast)
    params[I.vibrance] = e.vibrance - 1.0;
    params[I.saturation] = e.saturation - 1.0;
    params[I.contrast] = e.contrast - 1.0;
    params[I.exposure] = e.exposure;
    params[I.temperature] = e.temperature;
    params[I.tint] = e.tint;

    // [6-10]: Animation time, rain, snow, wind, speed
    params[I.time] = timeSeconds;
    params[I.rainIntensity] = (e.rainIntensity / 100.0) * 2.0;
    params[I.snowIntensity] = (e.snowIntensity / 100.0) * 2.0;
    params[I.wind] = (e.wind / 100.0) * 2.0 - 1.0;
    params[I.speed] = 1.0;

    // [11-15]: Night mode and headlights
    params[I.nightIntensity] = e.nightIntensity;
    params[I.headlightsOn] = e.headlightsOn ? 1.0 : 0.0;
    params[I.highBeam] = e.highBeam ? 1.0 : 0.0;
    params[I.headlightHeading] = 0.5;
    params[I.headlightPitch] = 0.5;

    // [16-17]: Dome light
    params[I.domeLightOn] = e.domeLightOn ? 1.0 : 0.0;
    params[I.domeLightIntensity] = e.domeLightOn ? 0.5 : 0.0;

    // [18-21]: Astronomy
    params[I.sunAzimuth] = e.sunAzimuth;
    params[I.sunAltitude] = e.sunAltitude;
    params[I.moonAzimuth] = e.moonAzimuth;
    params[I.moonAltitude] = e.moonAltitude;

    // [22-31]: Atmospheric effects (cohesive — precipitation implies overcast,
    // overcast suppresses direct-sun FX, rain wets the air and scrubs dust)
    params[I.fogIntensity] = atmosphere.fogIntensity;
    params[I.fogDensity] = atmosphere.fogDensity;
    params[I.fogHeight] = atmosphere.fogHeight;
    params[I.fogColorIndex] = atmosphere.fogColorIndex;
    params[I.lightShaftsIntensity] = atmosphere.lightShaftsIntensity;
    params[I.heatShimmerIntensity] = 0.0;
    params[I.lensFlareIntensity] = atmosphere.lensFlareIntensity;
    params[I.chromaticAberration] = 0.0;
    params[I.dustIntensity] = atmosphere.dustIntensity;
    params[I.humidityHaze] = atmosphere.humidityHaze;

    // [32]: Shader effects enabled flag
    params[I.shaderEffectsEnabled] = e.shaderEffectsEnabled ? 1.0 : 0.0;

    // [33-35]: Camera params and WASM noise toggle
    params[I.cameraHeading] = cameraHeading;
    params[I.cameraPitch] = cameraPitch;
    params[I.wasmNoiseEnabled] = wasmNoiseActive ? 1.0 : 0.0;

    // [36-37]: sunrise wash + anamorphic streak (also overcast-suppressed)
    params[I.sunrise] = e.timeOfDay === 'sunrise' ? 1.0 : 0.0;
    params[I.anamorphicStreak] = atmosphere.anamorphicStreak;

    // [38-39]: cinematic camera FX — zero unless quality + a11y gates pass
    params[I.dofStrength] = cinematic.dofStrength;
    params[I.motionBlurStrength] = cinematic.motionBlurStrength;

    return params;
}
