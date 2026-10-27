// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { PRESETS } from '../config/visualPresets';
import {
    configureRenderScale,
    getAppliedRenderScale,
    getRenderScaleRequest,
    publishAppliedRenderScale,
    quantizeRenderScale,
    resetRenderScaleForTests,
    resolveRenderScaleRequest,
    scaledSize,
    setRequestedRenderScale,
    type RenderScaleFrame,
} from './renderScale';

const frame = (scale: number, extra: Partial<RenderScaleFrame> = {}): RenderScaleFrame => ({
    scale,
    ...scaledSize(1920, 1080, scale),
    outputWidth: 1920,
    outputHeight: 1080,
    upscale: scale < 1 ? 'fsr' : 'none',
    frozen: false,
    limitedBy: null,
    ...extra,
});

afterEach(() => {
    resetRenderScaleForTests();
    delete (window as unknown as { webgpuProbe?: unknown }).webgpuProbe;
});

describe('quantizeRenderScale', () => {
    it('clamps to 0.5–1 and snaps to 0.05', () => {
        expect(quantizeRenderScale(0.2)).toBe(0.5);
        expect(quantizeRenderScale(1.7)).toBe(1);
        expect(quantizeRenderScale(0.73)).toBe(0.75);
        expect(quantizeRenderScale(0.82)).toBe(0.8);
        expect(quantizeRenderScale(Number.NaN)).toBe(1);
    });

    it('lands exactly on the grid (no 0.7000000000000001)', () => {
        for (let i = 10; i <= 20; i++) {
            const s = quantizeRenderScale(i / 20 + 1e-9);
            expect(String(s).length).toBeLessThanOrEqual(4);
        }
    });
});

describe('scaledSize', () => {
    it('is the canvas itself at 1 — no rounding at all', () => {
        expect(scaledSize(1279, 721, 1)).toEqual({ width: 1279, height: 721 });
    });

    it('rounds below 1 and never reaches 0', () => {
        expect(scaledSize(1920, 1080, 0.5)).toEqual({ width: 960, height: 540 });
        expect(scaledSize(1279, 721, 0.75)).toEqual({ width: 959, height: 541 });
        expect(scaledSize(1, 1, 0.5)).toEqual({ width: 1, height: 1 });
    });
});

describe('resolveRenderScaleRequest', () => {
    it('presets: Low starts at 0.75, the rest at 1, each adapting within its own floor', () => {
        expect(resolveRenderScaleRequest('low', undefined)).toEqual({
            mode: 'auto', scale: 0.75, min: PRESETS.low.renderScaleMin, max: 0.75, reason: 'preset',
        });
        for (const q of ['medium', 'high', 'ultra'] as const) {
            const r = resolveRenderScaleRequest(q, undefined);
            expect(r).toMatchObject({ mode: 'auto', scale: 1, max: 1 });
            expect(r.min).toBe(PRESETS[q].renderScaleMin);
        }
    });

    it('?scale= pins the scale and turns the budget loop off', () => {
        expect(resolveRenderScaleRequest('ultra', 0.5)).toEqual({ mode: 'fixed', scale: 0.5, min: 0.5, max: 0.5, reason: 'flag' });
        expect(resolveRenderScaleRequest('low', 1)).toMatchObject({ mode: 'fixed', scale: 1 });
        expect(resolveRenderScaleRequest('low', 0.66).scale).toBe(0.65);
    });
});

describe('setRequestedRenderScale', () => {
    it('moves an auto request within its range', () => {
        configureRenderScale(resolveRenderScaleRequest('high', undefined));
        setRequestedRenderScale(0.85, 'over-budget');
        expect(getRenderScaleRequest()).toMatchObject({ scale: 0.85, reason: 'over-budget' });
        setRequestedRenderScale(0.1, 'over-budget');
        expect(getRenderScaleRequest().scale).toBe(PRESETS.high.renderScaleMin);
        setRequestedRenderScale(2, 'under-budget');
        expect(getRenderScaleRequest()).toMatchObject({ scale: 1, reason: 'under-budget' });
    });

    it('is ignored when ?scale= fixed it', () => {
        configureRenderScale(resolveRenderScaleRequest('high', 0.5));
        setRequestedRenderScale(1, 'under-budget');
        expect(getRenderScaleRequest()).toMatchObject({ scale: 0.5, reason: 'flag' });
    });
});

describe('publishAppliedRenderScale', () => {
    it('reports the frame and counts changes of the applied scale only', () => {
        configureRenderScale(resolveRenderScaleRequest('high', undefined));
        publishAppliedRenderScale(frame(1));
        publishAppliedRenderScale(frame(1));
        expect(getAppliedRenderScale().changes).toBe(0);
        publishAppliedRenderScale(frame(0.75));
        publishAppliedRenderScale(frame(0.75));
        expect(getAppliedRenderScale()).toMatchObject({
            mode: 'auto', scale: 0.75, width: 1440, height: 810, outputWidth: 1920, upscale: 'fsr', changes: 1,
        });
    });

    it('lands on window.webgpuProbe.renderScale once the probe exists', () => {
        publishAppliedRenderScale(frame(1));
        const probe = {} as { renderScale?: unknown };
        (window as unknown as { webgpuProbe: unknown }).webgpuProbe = probe;
        publishAppliedRenderScale(frame(0.5, { limitedBy: null }));
        expect(probe.renderScale).toBe(getAppliedRenderScale());
        expect(probe.renderScale).toMatchObject({ scale: 0.5, width: 960 });
    });
});
