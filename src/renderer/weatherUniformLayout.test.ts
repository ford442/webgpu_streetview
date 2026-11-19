import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
  WEATHER_PARAMS_BYTE_SIZE,
  WEATHER_PARAMS_FLOAT_COUNT,
  WeatherParamIndex,
  type WeatherParamName,
} from './weatherUniformLayout';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Documented name→index table mirroring both paths of the WGSL block, both in
 * src/shaders/weather/bindings.wesl:
 *  - the fragment `struct WeatherParams`
 *  - the compute `p_<name>()` accessors over `extraBuffer`
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
    ['dofStrength', 38],
    ['motionBlurStrength', 39],
    ['horizonEstimateY', 40],
    ['horizonBlend', 41],
    ['horizonPad0', 42],
    ['horizonPad1', 43],
];

describe('weatherUniformLayout', () => {
    it('declares exactly 44 floats / 176 bytes (a multiple of 4 floats)', () => {
        expect(WEATHER_PARAMS_FLOAT_COUNT).toBe(44);
        expect(WEATHER_PARAMS_BYTE_SIZE).toBe(176);
        expect(WEATHER_PARAMS_FLOAT_COUNT % 4).toBe(0);
        expect(Object.keys(WeatherParamIndex)).toHaveLength(WEATHER_PARAMS_FLOAT_COUNT);
        expect(DOCUMENTED_LAYOUT).toHaveLength(WEATHER_PARAMS_FLOAT_COUNT);
    });

    it('has unique indices covering 0..43 exactly', () => {
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

    const BINDINGS = path.join(__dirname, '..', 'shaders', 'weather', 'bindings.wesl');

    it('the compute accessors read every param at its WeatherParamIndex, and the fragment ones its field', () => {
        const source = fs.readFileSync(BINDINGS, 'utf8');
        const compute = new Map([...source.matchAll(/^@if\(compute\) fn p_(\w+)\(\) -> f32 \{ return ep\((\d+)\); \}$/gm)]
            .map((m) => [m[1]!, Number(m[2])]));
        const fragment = new Set([...source.matchAll(/^@else fn p_(\w+)\(\) -> f32 \{ return p\.(\w+); \}$/gm)]
            .filter((m) => m[1] === m[2]).map((m) => m[1]!));
        // `speed` is read by the entry points only (the compute one clamps it); pads are never read.
        const named = DOCUMENTED_LAYOUT.filter(([name]) => !name.startsWith('horizonPad') && name !== 'speed');
        for (const [name, index] of named) {
            expect(compute.get(name), name).toBe(index);
            expect(fragment.has(name), name).toBe(true);
        }
        expect(compute.size).toBe(named.length);
    });

    it('fragment WGSL WeatherParams struct lists every param name', () => {
        const source = fs.readFileSync(BINDINGS, 'utf8');
        const structMatch = source.match(/struct WeatherParams \{[\s\S]*?\n\}/);
        expect(structMatch).not.toBeNull();
        const structBody = structMatch![0];
        for (const [name] of DOCUMENTED_LAYOUT) {
            expect(structBody).toContain(name);
        }
    });
});
