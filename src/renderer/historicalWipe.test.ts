import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
    HISTORICAL_WIPE_DURATION_MS,
    WIPE_UNIFORM_FLOAT_COUNT,
    WipeUniformIndex,
    isReducedMotionRequested,
    isRevealedAt,
    packWipeUniforms,
    resolveHistoricalReveal,
    wipeDirectionForHop,
    wipeProgressAt,
} from './historicalWipe';
import { WEATHER_PARAMS_FLOAT_COUNT } from './weatherUniformLayout';

const shader = readFileSync(join(__dirname, '..', '..', 'public', 'shaders', 'historical-wipe.wgsl'), 'utf8');

describe('wipeProgressAt', () => {
    it('runs 0 → 1 over the duration and clamps either side', () => {
        expect(wipeProgressAt(-50)).toBe(0);
        expect(wipeProgressAt(0)).toBe(0);
        expect(wipeProgressAt(HISTORICAL_WIPE_DURATION_MS / 2)).toBeCloseTo(0.5);
        expect(wipeProgressAt(HISTORICAL_WIPE_DURATION_MS)).toBe(1);
        expect(wipeProgressAt(HISTORICAL_WIPE_DURATION_MS * 3)).toBe(1);
    });

    it('eases: slow at both ends, never goes backwards', () => {
        const d = 1000;
        expect(wipeProgressAt(100, d)).toBeLessThan(0.1);
        expect(wipeProgressAt(900, d)).toBeGreaterThan(0.9);
        let prev = -1;
        for (let ms = 0; ms <= d; ms += 25) {
            const p = wipeProgressAt(ms, d);
            expect(p).toBeGreaterThanOrEqual(prev);
            prev = p;
        }
    });

    it('a zero or broken duration is already finished', () => {
        expect(wipeProgressAt(0, 0)).toBe(1);
        expect(wipeProgressAt(0, -5)).toBe(1);
        expect(wipeProgressAt(0, Number.NaN)).toBe(1);
    });
});

describe('resolveHistoricalReveal', () => {
    it('reduced motion is a cut — no shader, no direction', () => {
        expect(resolveHistoricalReveal({ reducedMotion: true, direction: 1 })).toEqual({ kind: 'cut' });
        expect(resolveHistoricalReveal({ reducedMotion: true, direction: -1 })).toEqual({ kind: 'cut' });
    });

    it('otherwise a wipe in the hop direction', () => {
        expect(resolveHistoricalReveal({ reducedMotion: false, direction: -1 })).toEqual({ kind: 'wipe', direction: -1 });
    });

    it('direction follows the chronological strip', () => {
        expect(wipeDirectionForHop(0, 3)).toBe(1);
        expect(wipeDirectionForHop(3, 0)).toBe(-1);
    });
});

describe('isReducedMotionRequested', () => {
    const body = (cls: string[]) => ({ classList: { contains: (c: string) => cls.includes(c) } });
    const media = (matches: boolean) => () => ({ matches });

    it('honours the OS media query', () => {
        expect(isReducedMotionRequested({ matchMedia: media(true), body: body([]) })).toBe(true);
    });

    it('honours the app setting mirrored on body', () => {
        expect(isReducedMotionRequested({ matchMedia: media(false), body: body(['reduced-motion']) })).toBe(true);
    });

    it('is false when neither asks, and survives a throwing matchMedia', () => {
        expect(isReducedMotionRequested({ matchMedia: media(false), body: body([]) })).toBe(false);
        expect(isReducedMotionRequested({ matchMedia: () => { throw new Error('nope'); }, body: null })).toBe(false);
        expect(isReducedMotionRequested({})).toBe(false);
    });
});

describe('wipe uniform', () => {
    it('is 4 floats — progress, direction, two pads — not the weather block', () => {
        expect(WIPE_UNIFORM_FLOAT_COUNT).toBe(4);
        expect(WIPE_UNIFORM_FLOAT_COUNT).not.toBe(WEATHER_PARAMS_FLOAT_COUNT);
        const data = packWipeUniforms(0.25, -1);
        expect(Array.from(data)).toEqual([0.25, -1, 0, 0]);
        expect(data[WipeUniformIndex.progress]).toBe(0.25);
    });

    it('clamps progress', () => {
        expect(packWipeUniforms(2, 1)[0]).toBe(1);
        expect(packWipeUniforms(-1, 1)[0]).toBe(0);
    });

    it('matches the WGSL struct, field for field', () => {
        const struct = shader.match(/struct WipeUniforms \{([\s\S]*?)\};/)![1]!;
        const fields = [...struct.matchAll(/(\w+):\s*f32/g)].map((m) => m[1]);
        expect(fields).toEqual(Object.keys(WipeUniformIndex));
    });
});

describe('isRevealedAt (TS twin of the shader edge)', () => {
    it('forward sweeps in from the left', () => {
        expect(isRevealedAt(0.1, 0.5, 1)).toBe(true);
        expect(isRevealedAt(0.9, 0.5, 1)).toBe(false);
    });

    it('backward sweeps in from the right', () => {
        expect(isRevealedAt(0.9, 0.5, -1)).toBe(true);
        expect(isRevealedAt(0.1, 0.5, -1)).toBe(false);
    });

    it('nothing at 0, everything at 1', () => {
        for (const u of [0, 0.3, 0.99]) {
            expect(isRevealedAt(u, 0, 1)).toBe(false);
            expect(isRevealedAt(u, 1, 1)).toBe(true);
        }
    });

    it('the shader uses the same test', () => {
        expect(shader).toContain('select(input.uv.x, 1.0 - input.uv.x, wipe.direction < 0.0)');
        expect(shader).toContain('if (along < wipe.progress)');
    });
});
