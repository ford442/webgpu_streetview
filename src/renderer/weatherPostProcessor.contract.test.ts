import { WeatherPostProcessor } from './WeatherPostProcessor';
import { ComputeWeatherPostProcessor } from './ComputeWeatherPostProcessor';
import {
    WEATHER_POST_PROCESSOR_METHODS,
    WeatherPostProcessorLike,
} from './weatherPostProcessorTypes';

describe('WeatherPostProcessorLike contract', () => {
    it('exports the shared method list used by Renderer', () => {
        expect(WEATHER_POST_PROCESSOR_METHODS.length).toBeGreaterThan(0);
        expect(WEATHER_POST_PROCESSOR_METHODS).toContain('updateWeatherParams');
        expect(WEATHER_POST_PROCESSOR_METHODS).toContain('dispose');
        expect(WEATHER_POST_PROCESSOR_METHODS).toContain('renderPass');
    });

    it.each([
        ['WeatherPostProcessor', WeatherPostProcessor],
        ['ComputeWeatherPostProcessor', ComputeWeatherPostProcessor],
    ] as const)('%s exposes every WeatherPostProcessorLike method', (_label, Ctor) => {
        for (const method of WEATHER_POST_PROCESSOR_METHODS) {
            expect(typeof (Ctor.prototype as WeatherPostProcessorLike)[method]).toBe('function');
        }
    });

    it('WeatherPostProcessorLike is assignable from both class types (structural)', () => {
        // Compile-time / structural check: prototypes satisfy the interface method set.
        const fragmentProto: Partial<WeatherPostProcessorLike> = WeatherPostProcessor.prototype;
        const computeProto: Partial<WeatherPostProcessorLike> = ComputeWeatherPostProcessor.prototype;
        for (const method of WEATHER_POST_PROCESSOR_METHODS) {
            expect(typeof fragmentProto[method]).toBe('function');
            expect(typeof computeProto[method]).toBe('function');
        }
    });
});
