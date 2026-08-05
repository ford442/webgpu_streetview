/**
 * Single source of truth for the 40-float (160-byte) weather post-process
 * uniform layout shared by:
 *  - src/renderer/WeatherPostProcessor.ts   (fragment pass, uniform buffer)
 *  - src/renderer/ComputeWeatherPostProcessor.ts (compute pass, storage buffer)
 *  - public/shaders/weather-post.wgsl        (`struct WeatherParams`)
 *  - public/shaders/weather-post-compute.wgsl (`extraBuffer` accessors)
 *  - src/renderer/WebGLFallbackRenderer.ts   (SDR approximation)
 *
 * Changing an index here means updating all five in lockstep. See
 * docs/RENDERER_FALLBACK.md and AGENTS.md ("Shader Uniform Layouts").
 */

export const WEATHER_PARAMS_FLOAT_COUNT = 40;
export const WEATHER_PARAMS_BYTE_SIZE = WEATHER_PARAMS_FLOAT_COUNT * 4;

export const WeatherParamIndex = {
    // 0-5: color grading
    vibrance: 0,
    saturation: 1,
    contrast: 2,
    exposure: 3,
    temperature: 4,
    tint: 5,
    // 6-10: weather / animation
    time: 6,
    rainIntensity: 7,
    snowIntensity: 8,
    wind: 9,
    speed: 10,
    // 11-15: nighttime + headlights
    nightIntensity: 11,
    headlightsOn: 12,
    highBeam: 13,
    headlightHeading: 14,
    headlightPitch: 15,
    // 16-17: dome light
    domeLightOn: 16,
    domeLightIntensity: 17,
    // 18-21: astronomical sun/moon positions (SunCalc radians)
    sunAzimuth: 18,
    sunAltitude: 19,
    moonAzimuth: 20,
    moonAltitude: 21,
    // 22-31: atmospheric effects
    fogIntensity: 22,
    fogDensity: 23,
    fogHeight: 24,
    fogColorIndex: 25,
    lightShaftsIntensity: 26,
    heatShimmerIntensity: 27,
    lensFlareIntensity: 28,
    chromaticAberration: 29,
    dustIntensity: 30,
    humidityHaze: 31,
    // 32: shader toggle
    shaderEffectsEnabled: 32,
    // 33-35: camera + WASM noise toggle
    cameraHeading: 33,
    cameraPitch: 34,
    wasmNoiseEnabled: 35,
    // 36-37
    sunrise: 36,
    anamorphicStreak: 37,
    // 38-39: cinematic camera FX (gated by quality >= high + reduced motion,
    // see src/renderer/cinematicCameraFx.ts). Total stays 40 floats / 160 bytes.
    dofStrength: 38,
    motionBlurStrength: 39,
} as const;

export type WeatherParamName = keyof typeof WeatherParamIndex;
