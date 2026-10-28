// @vitest-environment jsdom
/**
 * The render loop never skips a frame (#329): every animation frame renders —
 * live, weather-only or held — however slow the frames are. Under load the
 * frame-budget loop lowers the road's render scale instead, and a hold
 * freezes it. (Before #329 free-look rendered every other frame and adaptive
 * skipping dropped more; car-mode gauges stuttered with it.)
 */
import { Profiler } from 'react';
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sv = vi.hoisted(() => ({
    canvas: null as HTMLCanvasElement | null,
    isPanoramaUpdatePaused: false,
    setRenderer: () => undefined,
}));

vi.mock('../hooks', () => ({
    useWeatherSettings: () => ({ rainIntensity: 0, snowIntensity: 0, wind: 0, fogDensity: 0 }),
    useLightingSettings: () => ({
        nightIntensity: 0, headlightsOn: false, highBeam: false, domeLightOn: false,
        sunAzimuth: 180, sunAltitude: 45, moonAzimuth: 0, moonAltitude: -10, moonIntensity: 0, timeOfDay: 12,
    }),
    useGradeSettings: () => ({
        vibrance: 0, saturation: 1, contrast: 1, exposure: 0, temperature: 0, tint: 0,
        shaderEffectsEnabled: true, activeLookId: 'none', autoExposureEnabled: false,
    }),
    useStreetView: () => sv,
}));

/** Every method a no-op spy, except the few whose result the loop reads. */
const renderer = vi.hoisted(() => {
    const calls = new Map<string, ReturnType<typeof vi.fn>>();
    const hold = { active: false };
    const fixed: Record<string, unknown> = {
        isHoldActive: () => hold.active,
        getWeatherPostProcessMode: () => 'fragment',
        getMaxTextureDimension2D: () => 8192,
        then: undefined,
    };
    const proxy = new Proxy({}, {
        get(_t, key: string) {
            if (key in fixed) return fixed[key];
            if (!calls.has(key)) calls.set(key, vi.fn());
            return calls.get(key);
        },
    });
    return { proxy, hold, count: (key: string) => calls.get(key)?.mock.calls.length ?? 0, reset: () => calls.clear() };
});
vi.mock('../renderer/createStreetViewRenderer', () => ({
    createStreetViewRenderer: async () => ({ renderer: renderer.proxy, backendType: 'webgpu' }),
}));
vi.mock('../renderer/lut', () => ({ fetchLookLutVolume: async () => null }));

import WebGPUCanvas from './WebGPUCanvas';
import { getRenderScaleRequest, resetRenderScaleForTests } from '../renderer/renderScale';
import { resetGpuPassTimings, setGpuPassTimings } from '../renderer/gpuPassTimingStore';
import { perfStore, FRAME_RATE_IDLE } from '../renderer/perfStore';
import { povStore } from '../state/povStore';

let rafQueue: FrameRequestCallback[] = [];
let now = 0;

/** Run `n` animation frames, `dtMs` apart. */
function frames(n: number, dtMs: number, each?: (i: number) => void) {
    for (let i = 0; i < n; i++) {
        now += dtMs;
        each?.(i);
        const queue = rafQueue;
        rafQueue = [];
        act(() => { for (const cb of queue) cb(now); });
    }
}

async function mounted() {
    render(<WebGPUCanvas />);
    // Let the async renderer boot land.
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    renderer.reset();
}

beforeEach(() => {
    now = 0;
    rafQueue = [];
    sv.canvas = null;
    sv.isPanoramaUpdatePaused = false;
    renderer.hold.active = false;
    resetRenderScaleForTests();
    resetGpuPassTimings();
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { rafQueue.push(cb); return rafQueue.length; });
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
});
afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    resetRenderScaleForTests();
    resetGpuPassTimings();
});

describe('WebGPUCanvas render loop', () => {
    it('renders every animation frame, live, at 60 fps and at 20 fps alike', async () => {
        sv.canvas = document.createElement('canvas');
        await mounted();
        frames(30, 1000 / 60);
        expect(renderer.count('renderStreetView')).toBe(30);
        frames(30, 50);
        expect(renderer.count('renderStreetView')).toBe(60);
    });

    it('renders every frame with no panorama (weather only) and while held', async () => {
        await mounted();
        frames(12, 40);
        expect(renderer.count('renderWeatherOnly')).toBe(12);
        renderer.hold.active = true; // the renderer's own hold (advance / teleport)
        frames(12, 40);
        expect(renderer.count('renderHeldFrame')).toBe(12);
    });

    it('under GPU load lowers the requested render scale instead of dropping frames', async () => {
        sv.canvas = document.createElement('canvas');
        await mounted();
        expect(getRenderScaleRequest()).toMatchObject({ mode: 'auto', scale: 1 });
        let seq = 0;
        // 20 ms of road GPU time a frame against a 12.5 ms share, sampled at the current scale.
        frames(60, 30, () => setGpuPassTimings({
            available: true, seq: ++seq, renderScale: getRenderScaleRequest().scale,
            pass1Ms: 12, weatherMs: 8, blitMs: null, upscaleMs: null,
        }));
        expect(renderer.count('renderStreetView')).toBe(60);
        expect(getRenderScaleRequest().scale).toBeLessThan(1);
        expect(getRenderScaleRequest().reason).toBe('over-budget');
    });

    it('a hold freezes the request, however loaded the GPU reads', async () => {
        sv.canvas = document.createElement('canvas');
        sv.isPanoramaUpdatePaused = true;
        await mounted();
        let seq = 0;
        frames(60, 30, () => setGpuPassTimings({
            available: true, seq: ++seq, renderScale: getRenderScaleRequest().scale,
            pass1Ms: 30, weatherMs: 10, blitMs: null, upscaleMs: null,
        }));
        expect(renderer.count('renderHeldFrame')).toBe(60);
        expect(getRenderScaleRequest().scale).toBe(1);
    });

    it('commits nothing while idle-panning: the frame loop lives outside React', async () => {
        sv.canvas = document.createElement('canvas');
        const commits = vi.fn();
        render(<Profiler id="canvas" onRender={commits}><WebGPUCanvas /></Profiler>);
        await act(async () => { await Promise.resolve(); await Promise.resolve(); });
        frames(5, 1000 / 60);
        const settled = commits.mock.calls.length;
        // Two seconds of look-around at 60 fps.
        frames(120, 1000 / 60, (i) => povStore.setView(i, (i % 20) - 10));
        expect(renderer.count('renderStreetView')).toBeGreaterThanOrEqual(120);
        expect(commits.mock.calls.length).toBe(settled);
    });

    it('publishes the real frame rate to perfStore at UI rate', async () => {
        perfStore.set(FRAME_RATE_IDLE);
        const publishes = vi.fn();
        const stop = perfStore.subscribe(publishes);
        await mounted();
        frames(60, 1000 / 30);
        expect(perfStore.get()).toMatchObject({ measured: true, fps: 30 });
        expect(perfStore.get().frameTimeMs).toBeCloseTo(33.33, 1);
        frames(120, 1000 / 60);
        expect(perfStore.get().fps).toBe(60);
        // 4 s of frames → ~8 windows of 500 ms, not 180 publishes.
        expect(publishes.mock.calls.length).toBeGreaterThanOrEqual(7);
        expect(publishes.mock.calls.length).toBeLessThanOrEqual(9);
        stop();
    });
});
