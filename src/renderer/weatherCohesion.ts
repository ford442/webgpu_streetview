/**
 * weatherCohesion.ts — CPU-side coupling between weather channels.
 *
 * Before this module every atmospheric channel was independent: rain could
 * fall under a clear lens-flared sky, fog and precipitation both wrote the
 * same `fogDensity` value into two different uniform slots (double counting),
 * and dust motes kept sparkling through a downpour.
 *
 * The rules below give the presets a single physical story:
 *   1. Precipitation implies cloud cover, and cloud cover kills direct-sun FX.
 *   2. Rain wets the air — humidity haze and low ground mist follow it.
 *   3. Rain washes dust out of the air; snow does not (it *is* the particle).
 *   4. Fog splits into a screen-wide ambient wash (`fogIntensity`) and a
 *      depth-integrated ground bank (`fogDensity`) instead of both carrying
 *      the same number.
 *
 * Pure functions only — consumed by packWeatherParams.ts and covered by
 * weatherCohesion.test.ts. Look targets are documented in docs/GRAPHICS.md.
 */

/** Raw UI-space inputs (all 0–100 sliders except sunAltitude in radians). */
export interface WeatherCohesionInput {
    /** UI slider 0–100. */
    rainIntensity: number;
    /** UI slider 0–100. */
    snowIntensity: number;
    /** UI slider 0–100. */
    fogDensity: number;
    /** Sun altitude in radians (negative = below horizon). */
    sunAltitude: number;
    /** 0 = day, 1 = full night. */
    nightIntensity: number;
    /** True while the WASM noise tile is uploading usable data. */
    wasmNoiseActive: boolean;
}

/** Shader-space atmospheric values derived from the raw inputs. */
export interface WeatherCohesionResult {
    /** 0–1 combined precipitation load. */
    precipitation: number;
    /** 0–1 sky occlusion from precipitation + fog. */
    overcast: number;
    /** 0–1 direct-sun visibility after cloud cover. */
    sunVisibility: number;
    fogIntensity: number;
    fogDensity: number;
    fogHeight: number;
    fogColorIndex: number;
    humidityHaze: number;
    dustIntensity: number;
    lightShaftsIntensity: number;
    lensFlareIntensity: number;
    anamorphicStreak: number;
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/**
 * Scene luminance scale-down under rain (shader: `1 - rainIntensity * mix(day, night, nightIntensity)`).
 * Eases toward the night end-stop so the #171 readable floor survives a night storm.
 * Must match weather-post.wgsl, weather-post-compute.wgsl, and the GLSL
 * reference in webgl/weatherReference.glsl.ts.
 */
export const RAIN_DARKEN_DAY = 0.22;
export const RAIN_DARKEN_NIGHT = 0.10;

/** Fog colour palette indices shared with `getFogColor()` in both WGSL paths. */
export const FogColorIndex = {
    gray: 0,
    blue: 1,
    brown: 2,
    green: 3,
} as const;

/**
 * Direct-sun visibility ramp: fades in over the first ~17° of altitude, then
 * is attenuated by cloud cover. Used for shafts, flare and anamorphic streak
 * so all three agree on "is the sun actually shining".
 */
export function resolveSunVisibility(sunAltitude: number, overcast: number): number {
    const altitudeRamp = sunAltitude > 0 ? Math.min(sunAltitude / 0.3, 1.0) : 0.0;
    return altitudeRamp * (1.0 - clamp01(overcast));
}

export function resolveWeatherCohesion(input: WeatherCohesionInput): WeatherCohesionResult {
    const rain = clamp01(input.rainIntensity / 100);
    const snow = clamp01(input.snowIntensity / 100);
    const fog = clamp01(input.fogDensity / 100);
    const night = clamp01(input.nightIntensity);

    // Rain and snow rarely co-exist; take the dominant channel rather than
    // summing so "rain 100 + snow 100" doesn't read as double-overcast.
    const precipitation = clamp01(Math.max(rain, snow * 0.9));

    // Precipitation always implies cloud; fog only partially hides the sun
    // (thin ground fog under a clear sky is a real look worth keeping).
    const overcast = clamp01(precipitation * 0.85 + fog * 0.45);

    const sunVisibility = resolveSunVisibility(input.sunAltitude, overcast);

    // Fog splits into two channels the shader treats differently:
    //  - fogIntensity: flat, screen-wide ambient wash (aerial perspective)
    //  - fogDensity:   extinction coefficient integrated along the depth proxy
    // Precipitation adds its own low ground mist on top of the slider.
    const fogIntensity = fog * 0.55;
    const fogDensity = clamp01(fog * 1.15 + precipitation * 0.28);

    // Height: heavy fog settles into a low bank (0), thin fog sits higher and
    // reads more like haze (up to 0.45). Rain pushes mist back down to ground.
    const fogHeight = clamp01((1.0 - fog) * 0.45 * (1.0 - precipitation * 0.6));

    // Night fog picks up the blue palette; heavy daytime fog stays neutral gray.
    const fogColorIndex = night > 0.6 && fogDensity > 0.05
        ? FogColorIndex.blue
        : FogColorIndex.gray;

    // Rain saturates the air; snow does so far less (cold air holds less water).
    const humidityHaze = clamp01(rain * 0.55 + snow * 0.15 + fog * 0.25);

    // Rain scrubs airborne dust out of the sky. Dust still needs the WASM
    // turbulence tile to look like anything other than uniform speckle.
    const dustIntensity = input.wasmNoiseActive
        ? clamp01(0.3 * (1.0 - rain) * (1.0 - snow * 0.5))
        : 0.0;

    return {
        precipitation,
        overcast,
        sunVisibility,
        fogIntensity,
        fogDensity,
        fogHeight,
        fogColorIndex,
        humidityHaze,
        dustIntensity,
        // Shafts need both a visible sun and something to scatter in — a little
        // haze actually helps them read, so they scale with humidity.
        lightShaftsIntensity: sunVisibility * (0.35 + humidityHaze * 0.35),
        lensFlareIntensity: sunVisibility * 0.4,
        anamorphicStreak: sunVisibility * 0.5,
    };
}
