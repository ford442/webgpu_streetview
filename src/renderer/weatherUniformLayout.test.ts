import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
  WEATHER_PARAMS_BYTE_SIZE,
  WEATHER_PARAMS_FLOAT_COUNT,
  WeatherParamIndex,
  WeatherParamName,
} from './weatherUniformLayout';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Documented name→index table mirroring both WGSL headers:
 *  - public/shaders/weather-post.wgsl (`struct WeatherParams`)
 *  - public/shaders/weather-post-compute.wgsl (`extraBuffer` comment block)
 *
 * Renaming or reordering WeatherParamIndex without updating this table fails CI.
 */
const DOCUMENTED_LAYOUT: ReadonlyArray<[WeatherParamName, number]> = [
    ['vibrance', 0],
    ['saturation', 1],
    ['contrast', 2],
    ['exposure', 3],
    ['temperature', 4],
    ['tint', 5],
    ['time', 6],
    ['rainIntensity', 7],
    ['snowIntensity', 8],
    ['wind', 9],
    ['speed', 10],
    ['nightIntensity', 11],
    ['headlightsOn', 12],
    ['highBeam', 13],
    ['headlightHeading', 14],
    ['headlightPitch', 15],
    ['domeLightOn', 16],
    ['domeLightIntensity', 17],
    ['sunAzimuth', 18],
    ['sunAltitude', 19],
    ['moonAzimuth', 20],
    ['moonAltitude', 21],
    ['fogIntensity', 22],
    ['fogDensity', 23],
    ['fogHeight', 24],
    ['fogColorIndex', 25],
    ['lightShaftsIntensity', 26],
    ['heatShimmerIntensity', 27],
    ['lensFlareIntensity', 28],
    ['chromaticAberration', 29],
    ['dustIntensity', 30],
    ['humidityHaze', 31],
    ['shaderEffectsEnabled', 32],
    ['cameraHeading', 33],
    ['cameraPitch', 34],
    ['wasmNoiseEnabled', 35],
    ['sunrise', 36],
    ['anamorphicStreak', 37],
    ['_pad2', 38],
    ['_pad3', 39],
];

describe('weatherUniformLayout', () => {
    it('declares exactly 40 floats / 160 bytes', () => {
        expect(WEATHER_PARAMS_FLOAT_COUNT).toBe(40);
        expect(WEATHER_PARAMS_BYTE_SIZE).toBe(160);
        expect(Object.keys(WeatherParamIndex)).toHaveLength(WEATHER_PARAMS_FLOAT_COUNT);
        expect(DOCUMENTED_LAYOUT).toHaveLength(WEATHER_PARAMS_FLOAT_COUNT);
    });

    it('has unique indices covering 0..39 exactly', () => {
        const values = Object.values(WeatherParamIndex);
        expect(new Set(values).size).toBe(WEATHER_PARAMS_FLOAT_COUNT);
        expect([...values].sort((a, b) => a - b)).toEqual(
            Array.from({ length: WEATHER_PARAMS_FLOAT_COUNT }, (_, i) => i)
        );
    });

    it('matches the documented name→index table (WGSL lockstep)', () => {
        for (const [name, index] of DOCUMENTED_LAYOUT) {
            expect(WeatherParamIndex[name]).toBe(index);
        }
        // Every key in WeatherParamIndex must appear in the documented table
        const documentedNames = new Set(DOCUMENTED_LAYOUT.map(([n]) => n));
        for (const name of Object.keys(WeatherParamIndex) as WeatherParamName[]) {
            expect(documentedNames.has(name)).toBe(true);
        }
    });

    it('compute WGSL header comment lists every param name', () => {
        const wgslPath = path.join(
            __dirname,
            '..',
            '..',
            'public',
            'shaders',
            'weather-post-compute.wgsl'
        );
        const header = fs.readFileSync(wgslPath, 'utf8').split('\n').slice(0, 20).join('\n');
        const named = DOCUMENTED_LAYOUT.filter(([name]) => !name.startsWith('_pad')).map(([n]) => n);
        for (const name of named) {
            expect(header).toContain(name);
        }
        expect(header).toMatch(/38-39:padding|padding/);
    });

    it('fragment WGSL WeatherParams struct lists every param name', () => {
        const wgslPath = path.join(
            __dirname,
            '..',
            '..',
            'public',
            'shaders',
            'weather-post.wgsl'
        );
        const source = fs.readFileSync(wgslPath, 'utf8');
        const structMatch = source.match(/struct WeatherParams \{[\s\S]*?\n\}/);
        expect(structMatch).not.toBeNull();
        const structBody = structMatch![0];
        for (const [name] of DOCUMENTED_LAYOUT) {
            expect(structBody).toContain(name);
        }
    });
});
