import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
    TEMPORAL_CLIP_GAMMA,
    TEMPORAL_MAX_WEIGHT,
    TEMPORAL_UNIFORM_FLOAT_COUNT,
    TemporalUniformIndex,
    halton,
    jitterOffset,
    jitterPhaseCount,
    packTemporalUniforms,
    wantsTemporal,
} from './temporalMath';

const SHADER = readFileSync(path.resolve(__dirname, '../../../src/shaders/temporal.wesl'), 'utf8');

describe('wantsTemporal', () => {
    it('off never, auto below scale 1 only, on everywhere', () => {
        expect([wantsTemporal('off', 0.5), wantsTemporal('off', 1)]).toEqual([false, false]);
        expect([wantsTemporal('auto', 0.6), wantsTemporal('auto', 1)]).toEqual([true, false]);
        expect([wantsTemporal('on', 0.6), wantsTemporal('on', 1)]).toEqual([true, true]);
    });
});

describe('halton', () => {
    it('is the radical inverse in its base', () => {
        expect([1, 2, 3, 4, 5].map((i) => halton(i, 2))).toEqual([0.5, 0.25, 0.75, 0.125, 0.625]);
        expect([1, 2, 3, 4].map((i) => halton(i, 3))).toEqual([1 / 3, 2 / 3, 1 / 9, 4 / 9]);
        expect(halton(0, 2)).toBe(0);
    });
});

describe('jitter', () => {
    it('eight samples per output pixel: ceil(8 · ratio²), clamped to [8, 64]', () => {
        expect(jitterPhaseCount(1920, 1920)).toBe(8);
        expect(jitterPhaseCount(1152, 1920)).toBe(23); // 0.6
        expect(jitterPhaseCount(960, 1920)).toBe(32); // 0.5
        expect(jitterPhaseCount(100, 1920)).toBe(64);
    });

    it('offsets are sub-pixel, centred, never the origin, and repeat with the phase count', () => {
        const phases = 23;
        const seq = Array.from({ length: phases }, (_, i) => jitterOffset(i, phases));
        for (const [x, y] of seq) {
            expect(x).toBeGreaterThanOrEqual(-0.5);
            expect(x).toBeLessThan(0.5);
            expect(y).toBeGreaterThanOrEqual(-0.5);
            expect(y).toBeLessThan(0.5);
        }
        expect(seq[0]).toEqual([0, 1 / 3 - 0.5]); // index 1, not halton(0) = the origin twice
        expect(jitterOffset(phases, phases)).toEqual(seq[0]);
        expect(jitterOffset(-1, phases)).toEqual(seq[phases - 1]);
        // Low discrepancy: the sequence's mean is near the pixel centre.
        const mean = seq.reduce((a, [x, y]) => [a[0]! + x / phases, a[1]! + y / phases], [0, 0]);
        expect(Math.abs(mean[0]!)).toBeLessThan(0.05);
        expect(Math.abs(mean[1]!)).toBeLessThan(0.05);
    });
});

describe('packTemporalUniforms', () => {
    it('packs sizes, jitter, the history bit and the constants at their slots', () => {
        const u = packTemporalUniforms({
            inputWidth: 1152, inputHeight: 648, outputWidth: 1920, outputHeight: 1080,
            jitter: [0.25, -0.125], history: true, peak: 4,
        });
        const I = TemporalUniformIndex;
        expect(u).toHaveLength(TEMPORAL_UNIFORM_FLOAT_COUNT);
        expect([u[I.inputWidth], u[I.inputHeight], u[I.outputWidth], u[I.outputHeight]]).toEqual([1152, 648, 1920, 1080]);
        expect([u[I.jitterX], u[I.jitterY], u[I.history]]).toEqual([0.25, -0.125, 1]);
        expect([u[I.maxWeight], u[I.peak], u[I.clipGamma]]).toEqual([TEMPORAL_MAX_WEIGHT, 4, TEMPORAL_CLIP_GAMMA]);
        const reset = packTemporalUniforms({
            inputWidth: 1, inputHeight: 1, outputWidth: 1, outputHeight: 1, jitter: [0, 0], history: false, peak: 1,
        });
        expect(reset[I.history]).toBe(0);
    });

    it('matches TemporalUniforms in temporal.wgsl, field for field', () => {
        const body = /struct TemporalUniforms \{([\s\S]*?)\};/.exec(SHADER)![1]!;
        const fields = [...body.matchAll(/(\w+)\s*:\s*(vec2<f32>|f32)/g)].map((m) => [m[1]!, m[2] === 'f32' ? 1 : 2] as const);
        const slots: string[] = [];
        for (const [name, width] of fields) {
            if (width === 1) slots.push(name);
            else slots.push(`${name}.x`, `${name}.y`);
        }
        expect(slots).toHaveLength(TEMPORAL_UNIFORM_FLOAT_COUNT);
        const wgslName: Record<keyof typeof TemporalUniformIndex, string> = {
            inputWidth: 'inputSize.x', inputHeight: 'inputSize.y',
            outputWidth: 'outputSize.x', outputHeight: 'outputSize.y',
            jitterX: 'jitter.x', jitterY: 'jitter.y',
            history: 'history', maxWeight: 'maxWeight', peak: 'peak', clipGamma: 'clipGamma',
            pad0: 'pad0', pad1: 'pad1',
        };
        for (const [key, index] of Object.entries(TemporalUniformIndex)) {
            expect(slots[index], key).toBe(wgslName[key as keyof typeof TemporalUniformIndex]);
        }
    });
});
