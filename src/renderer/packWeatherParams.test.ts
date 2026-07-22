import {
    createDefaultWeatherParams,
    packWeatherParams,
    WeatherParamsEnvInput,
} from './packWeatherParams';
import {
    WEATHER_PARAMS_FLOAT_COUNT,
    WeatherParamIndex,
} from './weatherUniformLayout';

function baseEnv(overrides: Partial<WeatherParamsEnvInput> = {}): WeatherParamsEnvInput {
    return {
        vibrance: 1.0,
        saturation: 1.0,
        contrast: 1.0,
        exposure: 0.0,
        temperature: 0.0,
        tint: 0.0,
        rainIntensity: 0,
        snowIntensity: 0,
        wind: 50,
        nightIntensity: 0,
        headlightsOn: false,
        highBeam: false,
        domeLightOn: false,
        sunAzimuth: 0,
        sunAltitude: 0,
        moonAzimuth: 0,
        moonAltitude: 0,
        fogDensity: 0,
        shaderEffectsEnabled: true,
        timeOfDay: 'day',
        ...overrides,
    };
}

describe('packWeatherParams', () => {
    it('always returns a 40-float array', () => {
        const params = packWeatherParams({
            env: baseEnv(),
            timeSeconds: 1.5,
            cameraHeading: 0.25,
            cameraPitch: 0.5,
            wasmNoiseActive: false,
        });
        expect(params).toBeInstanceOf(Float32Array);
        expect(params.length).toBe(WEATHER_PARAMS_FLOAT_COUNT);
    });

    it('packs a day preset with neutral color grading and no weather', () => {
        const params = packWeatherParams({
            env: baseEnv({ timeOfDay: 'day', sunAltitude: 0.6 }),
            timeSeconds: 12,
            cameraHeading: 0.1,
            cameraPitch: 0.5,
            wasmNoiseActive: false,
        });
        const I = WeatherParamIndex;
        expect(params[I.vibrance]).toBe(0);
        expect(params[I.saturation]).toBe(0);
        expect(params[I.contrast]).toBe(0);
        expect(params[I.time]).toBe(12);
        expect(params[I.rainIntensity]).toBe(0);
        expect(params[I.wind]).toBe(0); // UI 50 → shader 0
        expect(params[I.nightIntensity]).toBe(0);
        expect(params[I.sunrise]).toBe(0);
        expect(params[I.shaderEffectsEnabled]).toBe(1);
        expect(params[I.cameraHeading]).toBeCloseTo(0.1);
        expect(params[I.cameraPitch]).toBeCloseTo(0.5);
        expect(params[I.wasmNoiseEnabled]).toBe(0);
        expect(params[I.dustIntensity]).toBe(0);
        // sunAltitude 0.6 → sunVisible = 1 → shafts 0.5, flare 0.4, streak 0.5
        expect(params[I.lightShaftsIntensity]).toBeCloseTo(0.5);
        expect(params[I.lensFlareIntensity]).toBeCloseTo(0.4);
        expect(params[I.anamorphicStreak]).toBeCloseTo(0.5);
        expect(params[I._pad2]).toBe(0);
        expect(params[I._pad3]).toBe(0);
    });

    it('packs a night preset with headlights and dome light', () => {
        const params = packWeatherParams({
            env: baseEnv({
                timeOfDay: 'night',
                nightIntensity: 1,
                headlightsOn: true,
                highBeam: true,
                domeLightOn: true,
                sunAltitude: -0.2,
            }),
            timeSeconds: 0,
            cameraHeading: 0,
            cameraPitch: 0.5,
            wasmNoiseActive: false,
        });
        const I = WeatherParamIndex;
        expect(params[I.nightIntensity]).toBe(1);
        expect(params[I.headlightsOn]).toBe(1);
        expect(params[I.highBeam]).toBe(1);
        expect(params[I.domeLightOn]).toBe(1);
        expect(params[I.domeLightIntensity]).toBe(0.5);
        expect(params[I.lightShaftsIntensity]).toBe(0);
        expect(params[I.lensFlareIntensity]).toBe(0);
        expect(params[I.anamorphicStreak]).toBe(0);
        expect(params[I.sunrise]).toBe(0);
    });

    it('packs rain / snow / fog / sunrise with UI→shader scaling', () => {
        const params = packWeatherParams({
            env: baseEnv({
                timeOfDay: 'sunrise',
                rainIntensity: 50,
                snowIntensity: 25,
                wind: 100,
                fogDensity: 40,
            }),
            timeSeconds: 3,
            cameraHeading: 0.5,
            cameraPitch: 0.4,
            wasmNoiseActive: true,
        });
        const I = WeatherParamIndex;
        expect(params[I.rainIntensity]).toBeCloseTo(1.0); // 50/100*2
        expect(params[I.snowIntensity]).toBeCloseTo(0.5); // 25/100*2
        expect(params[I.wind]).toBeCloseTo(1.0); // 100/100*2-1
        expect(params[I.fogIntensity]).toBeCloseTo(0.4);
        expect(params[I.fogDensity]).toBeCloseTo(0.4);
        expect(params[I.sunrise]).toBe(1);
        expect(params[I.wasmNoiseEnabled]).toBe(1);
        expect(params[I.dustIntensity]).toBeCloseTo(0.3);
    });

    it('createDefaultWeatherParams matches historical processor defaults', () => {
        const params = createDefaultWeatherParams();
        expect(params.length).toBe(WEATHER_PARAMS_FLOAT_COUNT);
        expect(params[WeatherParamIndex.speed]).toBe(1);
        expect(params[WeatherParamIndex.headlightHeading]).toBe(0.5);
        expect(params[WeatherParamIndex.headlightPitch]).toBe(0.5);
        expect(params[WeatherParamIndex.shaderEffectsEnabled]).toBe(1);
        expect(params[WeatherParamIndex.rainIntensity]).toBe(0);
        expect(params[WeatherParamIndex.nightIntensity]).toBe(0);
    });
});
