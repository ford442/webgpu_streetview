import { resolveWeatherCohesion, resolveSunVisibility, FogColorIndex, RAIN_DARKEN_DAY, RAIN_DARKEN_NIGHT } from './weatherCohesion';

function baseInput(overrides: Partial<Parameters<typeof resolveWeatherCohesion>[0]> = {}) {
    return {
        rainIntensity: 0,
        snowIntensity: 0,
        fogDensity: 0,
        sunAltitude: 0.6,
        nightIntensity: 0,
        wasmNoiseActive: false,
        ...overrides,
    };
}

describe('resolveWeatherCohesion', () => {
    it('leaves a clear day fully sunlit with no fog or haze', () => {
        const r = resolveWeatherCohesion(baseInput());
        expect(r.precipitation).toBe(0);
        expect(r.overcast).toBe(0);
        expect(r.sunVisibility).toBe(1);
        expect(r.fogIntensity).toBe(0);
        expect(r.fogDensity).toBe(0);
        expect(r.humidityHaze).toBe(0);
        expect(r.lensFlareIntensity).toBeCloseTo(0.4);
    });

    it('suppresses direct-sun FX under heavy rain (overcast sky)', () => {
        const clear = resolveWeatherCohesion(baseInput());
        const storm = resolveWeatherCohesion(baseInput({ rainIntensity: 100 }));

        expect(storm.overcast).toBeGreaterThan(0.8);
        expect(storm.sunVisibility).toBeLessThan(0.2);
        expect(storm.lensFlareIntensity).toBeLessThan(clear.lensFlareIntensity);
        expect(storm.anamorphicStreak).toBeLessThan(clear.anamorphicStreak);
        expect(storm.lightShaftsIntensity).toBeLessThan(clear.lightShaftsIntensity);
    });

    it('wets the air with rain and scrubs dust out of it', () => {
        const dry = resolveWeatherCohesion(baseInput({ wasmNoiseActive: true }));
        const wet = resolveWeatherCohesion(baseInput({ rainIntensity: 80, wasmNoiseActive: true }));

        expect(wet.humidityHaze).toBeGreaterThan(dry.humidityHaze);
        expect(wet.dustIntensity).toBeLessThan(dry.dustIntensity);
        expect(dry.dustIntensity).toBeCloseTo(0.3);
    });

    it('keeps dust at zero when the WASM noise tile is unavailable', () => {
        expect(resolveWeatherCohesion(baseInput()).dustIntensity).toBe(0);
    });

    it('separates the fog wash from the depth-integrated ground bank', () => {
        const r = resolveWeatherCohesion(baseInput({ fogDensity: 40 }));
        // Previously both slots carried the identical 0.4 slider value, which
        // double-counted inside the shader.
        expect(r.fogIntensity).not.toBeCloseTo(r.fogDensity);
        expect(r.fogIntensity).toBeCloseTo(0.22);
        expect(r.fogDensity).toBeCloseTo(0.46);
    });

    it('adds low ground mist under precipitation even with the fog slider at zero', () => {
        const r = resolveWeatherCohesion(baseInput({ rainIntensity: 100 }));
        expect(r.fogDensity).toBeGreaterThan(0);
        expect(r.fogHeight).toBeLessThan(0.2); // pushed down to the ground
    });

    it('lifts thin fog into a higher haze band and settles thick fog low', () => {
        const thin = resolveWeatherCohesion(baseInput({ fogDensity: 10 }));
        const thick = resolveWeatherCohesion(baseInput({ fogDensity: 100 }));
        expect(thin.fogHeight).toBeGreaterThan(thick.fogHeight);
        expect(thick.fogHeight).toBe(0);
    });

    it('switches fog to the blue palette at night', () => {
        expect(resolveWeatherCohesion(baseInput({ fogDensity: 50 })).fogColorIndex)
            .toBe(FogColorIndex.gray);
        expect(resolveWeatherCohesion(baseInput({ fogDensity: 50, nightIntensity: 1 })).fogColorIndex)
            .toBe(FogColorIndex.blue);
    });

    it('takes the dominant precipitation channel rather than summing them', () => {
        const both = resolveWeatherCohesion(baseInput({ rainIntensity: 100, snowIntensity: 100 }));
        const rainOnly = resolveWeatherCohesion(baseInput({ rainIntensity: 100 }));
        expect(both.precipitation).toBeCloseTo(rainOnly.precipitation);
    });

    it('clamps all outputs into shader-safe ranges', () => {
        const r = resolveWeatherCohesion(baseInput({
            rainIntensity: 999,
            snowIntensity: 999,
            fogDensity: 999,
            nightIntensity: 5,
        }));
        for (const value of [
            r.precipitation, r.overcast, r.sunVisibility, r.fogDensity,
            r.fogHeight, r.humidityHaze, r.dustIntensity,
        ]) {
            expect(value).toBeGreaterThanOrEqual(0);
            expect(value).toBeLessThanOrEqual(1);
        }
    });
});

describe('resolveSunVisibility', () => {
    it('is zero below the horizon regardless of cloud cover', () => {
        expect(resolveSunVisibility(-0.2, 0)).toBe(0);
    });

    it('ramps in over the first ~17 degrees of altitude', () => {
        expect(resolveSunVisibility(0.15, 0)).toBeCloseTo(0.5);
        expect(resolveSunVisibility(0.3, 0)).toBeCloseTo(1);
        expect(resolveSunVisibility(1.2, 0)).toBeCloseTo(1);
    });

    it('is fully occluded by total overcast', () => {
        expect(resolveSunVisibility(1.0, 1)).toBe(0);
    });
});

describe('rain darken coefficients', () => {
    it('eases toward the night floor so a storm cannot crush #171 readability', () => {
        expect(RAIN_DARKEN_DAY).toBeGreaterThan(RAIN_DARKEN_NIGHT);
        expect(RAIN_DARKEN_DAY).toBeCloseTo(0.22);
        expect(RAIN_DARKEN_NIGHT).toBeCloseTo(0.10);
    });
});
