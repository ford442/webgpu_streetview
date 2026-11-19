// @vitest-environment jsdom
/**
 * The temporal resolve (#360) as the real `Renderer` drives it:
 *
 * - `?temporal` off (the default): nothing built, pass 1's jitter floats are
 *   zero, the frame is the pre-#360 frame (upscale below scale 1);
 * - `auto` below scale 1 / `on` at scale 1: the lazy pass is built on the
 *   first frame that wants it and then presents instead of the upscale;
 * - the history decision lands in the frame it applies to — a hold, a
 *   release crossfade and a year-chip wipe each reset it — and pass 1's
 *   jitter is zero on every frame without history;
 * - a resolve that cannot build leaves FSR 1 presenting.
 *
 * GPU-facing collaborators are fakes; `TextureLifecycle`, the hold controller,
 * the pass registry, `UpscalePass` and `TemporalPass` are the real ones.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    bindingTexture,
    createFakeGpu,
    installGpuGlobals,
    installShaderFetch,
    type FakeGpu,
    type FakeTexture,
    type RecordedPass,
} from './computeWeather/__tests__/fakeGpu';

const boot = vi.hoisted(() => ({
    bootDevice: vi.fn(),
    publishBootSuccess: vi.fn(),
    publishBootFailure: vi.fn(),
}));
vi.mock('./bootDevice', () => boot);

const weatherCalls = vi.hoisted(() => ({ renderPass: [] as Array<GPUTextureView | undefined> }));
const weatherStub = vi.hoisted(() => () => class {
    init = vi.fn().mockResolvedValue(undefined);
    dispose = vi.fn();
    updateWeatherBindGroup = vi.fn();
    updateWeatherParams = vi.fn();
    updateColorParams = vi.fn();
    setShaderEffects = vi.fn();
    setSceneDepth = vi.fn();
    setSceneSemantic = vi.fn();
    updateWeatherAnimation = vi.fn();
    renderPass = (_encoder: GPUCommandEncoder, _timing: unknown, target?: GPUTextureView) => {
        weatherCalls.renderPass.push(target);
    };
    renderWeatherOnly = (
        _view: GPUTextureView,
        after?: (encoder: GPUCommandEncoder) => void,
        target?: GPUTextureView,
    ) => {
        weatherCalls.renderPass.push(target);
        after?.(currentGpu().createCommandEncoder());
    };
});
vi.mock('./WeatherPostProcessor', () => ({ WeatherPostProcessor: weatherStub() }));
vi.mock('./ComputeWeatherPostProcessor', () => ({ ComputeWeatherPostProcessor: weatherStub() }));
vi.mock('./streetViewPass', () => ({
    buildSamplerDescriptor: () => ({}),
    createStreetViewPipeline: async () => ({ kind: 'pass1Pipeline', getBindGroupLayout: () => ({}) }),
    encodeStreetViewPass: () => undefined,
}));
vi.mock('./gpuChores/GpuChores', () => ({
    GpuChores: class {
        ensureReady = async () => undefined;
        destroy() {}
    },
}));
vi.mock('./cabinComposite', async (importOriginal) => ({
    ...(await importOriginal<typeof import('./cabinComposite')>()),
    CabinCompositePass: class {
        init = async () => undefined;
        dispose() {}
        setSource() {}
        isReady() {
            return false;
        }
        isActive() {
            return false;
        }
    },
}));

import { Renderer } from './Renderer';
import { getPassStatus } from './passStatus';
import { resetRoadFrameSourceForTests } from './roadFrameRegistry';
import {
    configureRenderScale,
    getAppliedRenderScale,
    resetRenderScaleForTests,
    type RenderScaleRequest,
} from './renderScale';
import { getTemporalStats, resetTemporalStatsForTests } from './temporal/temporalStats';
import type { TemporalMode } from './temporal/temporalMath';

let gpu: FakeGpu;
const currentGpu = () => gpu;
let warnSpy: ReturnType<typeof vi.spyOn>;

const fixed = (scale: number): RenderScaleRequest => ({ mode: 'fixed', scale, min: scale, max: scale, reason: 'flag' });

function primeBoot() {
    gpu = createFakeGpu();
    (gpu.device.queue as unknown as Record<string, unknown>).copyExternalImageToTexture = vi.fn();
    boot.bootDevice.mockImplementation(async () => ({
        ok: true,
        device: gpu.device,
        context: gpu.context,
        presentationFormat: 'bgra8unorm',
        canvasOutputPolicy: { hdr: false, p3: false },
        intermediateFormat: 'rgba16float',
        capabilityMatrix: {},
        timestampQueriesAvailable: false,
        probe: {},
    }));
}

function canvas(width: number, height: number): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = width;
    c.height = height;
    return c;
}

type Internals = {
    upscaleInit: Promise<boolean> | null;
    temporalInit: Promise<boolean> | null;
    submitPanoramaFrame: (h: number, p: number, z: number) => void;
};
const internals = (r: Renderer) => r as unknown as Internals;

async function booted(mode: TemporalMode, width = 64, height = 36) {
    const renderer = new Renderer(canvas(width, height));
    expect(await renderer.init(), renderer.fallbackReason).toBe(true);
    renderer.setTemporalMode(mode);
    return renderer;
}

interface Frame {
    passes: RecordedPass[];
    /** Pass 1's uniforms as written for this frame (copied: the renderer reuses its array). */
    pass1: number[];
}

function frame(renderer: Renderer, heading = 0): Frame {
    gpu.encoders.length = 0;
    internals(renderer).submitPanoramaFrame(heading, 0, 1);
    const write = gpu.writeBufferCalls.filter((c) => c.buffer.descriptor.label === 'streetview-uniforms').at(-1)!;
    return { passes: gpu.allPasses(), pass1: [...(write.data as Float32Array)] };
}

/** The first frame that wants the lazy passes starts building them; let them finish. */
async function settle(renderer: Renderer) {
    frame(renderer);
    await internals(renderer).upscaleInit;
    await internals(renderer).temporalInit;
}

const labels = (f: Frame) => f.passes.map((p) => p.label);
const jitterOf = (f: Frame) => f.pass1.slice(8, 12);
const live = (label: string) => gpu.textures.filter((t) => t.descriptor.label === label && !t.destroyed);
const swapChain = () => gpu.context.getCurrentTexture() as unknown as FakeTexture;

beforeEach(() => {
    installGpuGlobals();
    installShaderFetch();
    resetRoadFrameSourceForTests();
    resetRenderScaleForTests(fixed(1));
    resetTemporalStatsForTests();
    window.webgpuProbe = {} as unknown as NonNullable<Window['webgpuProbe']>;
    weatherCalls.renderPass.length = 0;
    primeBoot();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
    resetRoadFrameSourceForTests();
    resetRenderScaleForTests();
    warnSpy.mockRestore();
    boot.bootDevice.mockReset();
});

describe('Renderer temporal resolve', () => {
    it('off: nothing built or encoded, pass 1 has 12 floats and the four jitter floats are zero', async () => {
        configureRenderScale(fixed(0.5));
        const renderer = await booted('off');
        await settle(renderer);
        const f = frame(renderer, 10);
        expect(f.pass1).toHaveLength(12);
        expect(jitterOf(f)).toEqual([0, 0, 0, 0]);
        expect(labels(f)).toEqual(['upscale-easu', 'upscale-rcas']);
        expect(gpu.renderPipelines.some((p) => p.label?.startsWith('temporal'))).toBe(false);
        expect(getPassStatus('temporal')).toBeUndefined();
        expect(getAppliedRenderScale().upscale).toBe('fsr');
        expect(window.webgpuProbe?.temporal).toBeUndefined();
    });

    it('auto at scale 1 is off', async () => {
        const renderer = await booted('auto');
        const f = frame(renderer);
        expect(labels(f)).toEqual([]);
        expect(internals(renderer).temporalInit).toBeNull();
        expect(weatherCalls.renderPass.at(-1)).toBeUndefined();
        expect(jitterOf(f)).toEqual([0, 0, 0, 0]);
    });

    it('auto below 1: built lazily, then presents in the upscale\'s place from its own road target', async () => {
        configureRenderScale(fixed(0.5));
        const renderer = await booted('auto');
        await settle(renderer);
        expect(getPassStatus('temporal')?.state).toBe('ready');

        weatherCalls.renderPass.length = 0;
        const f = frame(renderer);
        expect(labels(f)).toEqual(['motion', 'temporal-resolve', 'temporal-present']);
        const [input] = live('temporal-input');
        expect(input!.descriptor).toMatchObject({ size: [32, 18], format: 'bgra8unorm' });
        expect(bindingTexture(weatherCalls.renderPass[0])).toBe(input);
        expect(bindingTexture(f.passes.at(-1)!.targets[0])).toBe(swapChain());
        expect(getAppliedRenderScale()).toMatchObject({ scale: 0.5, width: 32, height: 18, upscale: 'temporal' });
        expect(window.webgpuProbe?.temporal).toBe(getTemporalStats());
    });

    it('on at scale 1: the resolve presents the native frame', async () => {
        const renderer = await booted('on');
        await settle(renderer);
        const f = frame(renderer);
        expect(labels(f)).toEqual(['motion', 'temporal-resolve', 'temporal-present']);
        expect(getAppliedRenderScale()).toMatchObject({ scale: 1, width: 64, upscale: 'temporal' });
        expect(live('temporal-input')[0]!.descriptor.size).toEqual([64, 36]);
    });

    it('jitter only on frames that blend history; the sequence moves every frame', async () => {
        configureRenderScale(fixed(0.5));
        const renderer = await booted('auto');
        await settle(renderer);
        const first = frame(renderer, 0);
        expect(getTemporalStats()).toMatchObject({ presenting: true, history: false, historyReset: 'first-frame' });
        expect(jitterOf(first)).toEqual([0, 0, 0, 0]);
        const a = frame(renderer, 0.5);
        const b = frame(renderer, 1);
        expect(getTemporalStats()).toMatchObject({ history: true, historyReset: null, phases: 32 });
        // Pass 1 gets the jitter in screen UV: intermediate px / size.
        const [jx, jy] = getTemporalStats().jitter;
        expect(jitterOf(b)[0]).toBeCloseTo(jx / 32, 6);
        expect(jitterOf(b)[1]).toBeCloseTo(jy / 18, 6);
        expect(jitterOf(a)).not.toEqual(jitterOf(b));
        expect(Math.abs(jitterOf(a)[0]!)).toBeLessThanOrEqual(0.5 / 32);
    });

    it('a hold, its release and a wipe reset the history in the frame they are on screen', async () => {
        configureRenderScale(fixed(0.5));
        const renderer = await booted('auto');
        await settle(renderer);
        frame(renderer);
        frame(renderer);
        expect(getTemporalStats().history).toBe(true);

        renderer.beginHoldTransition(0, 0, canvas(512, 256));
        const held = frame(renderer);
        expect(getTemporalStats()).toMatchObject({ history: false, historyReset: 'hold', motionReset: 'hold' });
        expect(jitterOf(held)).toEqual([0, 0, 0, 0]);
        renderer.endHoldTransition();
        renderer.setTransitionProgress(0.5);
        frame(renderer);
        // The frame after a hold shows another pano.
        expect(getTemporalStats()).toMatchObject({ history: false, historyReset: 'hold' });
        frame(renderer);
        expect(getTemporalStats()).toMatchObject({ history: false, historyReset: 'transition' });
        renderer.setTransitionProgress(1);
        frame(renderer);
        // Its history was written mid-crossfade: it holds a ghost of the old pano.
        expect(getTemporalStats()).toMatchObject({ history: false, historyReset: 'dirty-history' });
        frame(renderer);
        expect(getTemporalStats().history).toBe(true);

        const wipe = { isActive: () => true } as const;
        (renderer as unknown as { historicalWipe: typeof wipe }).historicalWipe = wipe;
        frame(renderer);
        expect(getTemporalStats()).toMatchObject({ history: false, historyReset: 'historical-wipe' });
        (renderer as unknown as { historicalWipe: null }).historicalWipe = null;
        frame(renderer);
        expect(getTemporalStats()).toMatchObject({ history: false, historyReset: 'dirty-history' });
        frame(renderer);
        expect(getTemporalStats().history).toBe(true);
        expect(getTemporalStats().resets).toBeGreaterThanOrEqual(6);
    });

    it('a weather-only frame presents through the resolve alone, and the next frame starts afresh', async () => {
        configureRenderScale(fixed(0.5));
        const renderer = await booted('auto');
        await settle(renderer);
        frame(renderer);
        frame(renderer);
        gpu.encoders.length = 0;
        renderer.renderWeatherOnly();
        expect(gpu.allPasses().map((p) => p.label)).toEqual(['motion', 'temporal-resolve', 'temporal-present']);
        expect(getTemporalStats()).toMatchObject({ history: false, historyReset: 'weather-only' });
        frame(renderer);
        expect(getTemporalStats()).toMatchObject({ history: false, historyReset: 'first-frame' });
    });

    it('a resolve that cannot build: failed on the probe, FSR 1 presents, never retried', async () => {
        const realFetch = globalThis.fetch;
        (globalThis as Record<string, unknown>).fetch = async (url: string) => (
            String(url).includes('temporal.wgsl')
                ? { ok: false, status: 404, statusText: 'Not Found', text: async () => '' }
                : realFetch(url)
        );
        configureRenderScale(fixed(0.5));
        const renderer = await booted('auto');
        await settle(renderer);
        expect(getPassStatus('temporal')?.state).toBe('failed');
        const f = frame(renderer);
        expect(labels(f)).toEqual(['upscale-easu', 'upscale-rcas']);
        expect(getAppliedRenderScale()).toMatchObject({ scale: 0.5, upscale: 'fsr', limitedBy: null });
        expect(jitterOf(f)).toEqual([0, 0, 0, 0]);
        const pending = internals(renderer).temporalInit;
        frame(renderer);
        expect(internals(renderer).temporalInit).toBe(pending);
    });

    it('a hold freezes what presents along with the scale', async () => {
        configureRenderScale(fixed(0.5));
        const renderer = await booted('off');
        await settle(renderer);
        frame(renderer);
        renderer.beginHoldTransition(0, 0, canvas(512, 256));
        renderer.setTemporalMode('auto');
        frame(renderer);
        expect(getAppliedRenderScale()).toMatchObject({ frozen: true, upscale: 'fsr' });
        renderer.endHoldTransition();
        await settle(renderer);
        frame(renderer);
        expect(getAppliedRenderScale()).toMatchObject({ frozen: false, upscale: 'temporal' });
    });
});
