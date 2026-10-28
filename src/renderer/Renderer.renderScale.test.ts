// @vitest-environment jsdom
/**
 * Render scale (#329) as the real `Renderer` encodes it: at scale 1 the frame
 * is the pre-#329 frame (weather → swap chain, no upscale pass built or
 * encoded); below 1 the intermediate and the weather target shrink and the
 * lazy `upscale` pass brings the frame back to the swap chain; a hold freezes
 * the scale; an upscale that cannot build keeps the road at 1.
 *
 * GPU-facing collaborators are fakes; `TextureLifecycle`, the hold controller,
 * the pass registry and `UpscalePass` are the real ones.
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

/** What the weather pass was asked to write into, per call. */
const weatherCalls = vi.hoisted(() => ({
    renderPass: [] as Array<GPUTextureView | undefined>,
    weatherOnly: [] as Array<GPUTextureView | undefined>,
}));
const weatherStub = vi.hoisted(() => () => class {
    init = vi.fn().mockResolvedValue(undefined);
    dispose = vi.fn();
    updateWeatherBindGroup = vi.fn();
    updateWeatherParams = vi.fn();
    updateColorParams = vi.fn();
    setShaderEffects = vi.fn();
    setSceneDepth = vi.fn();
    updateWeatherAnimation = vi.fn();
    renderPass = (_encoder: GPUCommandEncoder, _timing: unknown, target?: GPUTextureView) => {
        weatherCalls.renderPass.push(target);
    };
    renderWeatherOnly = (
        _view: GPUTextureView,
        after?: (encoder: GPUCommandEncoder) => void,
        target?: GPUTextureView,
    ) => {
        weatherCalls.weatherOnly.push(target);
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
import type { TextureLifecycle } from './textureLifecycle';

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
    textures: TextureLifecycle;
    upscaleInit: Promise<boolean> | null;
    submitPanoramaFrame: (h: number, p: number, z: number) => void;
};
const internals = (r: Renderer) => r as unknown as Internals;

async function booted(width = 64, height = 36) {
    const renderer = new Renderer(canvas(width, height));
    expect(await renderer.init(), renderer.fallbackReason).toBe(true);
    return renderer;
}

/** One normal frame, the way `renderStreetView` reaches the registry. */
function frame(renderer: Renderer): RecordedPass[] {
    gpu.encoders.length = 0;
    internals(renderer).submitPanoramaFrame(0, 0, 1);
    return gpu.allPasses();
}

/** The first scaled request starts building the lazy pass; let it finish. */
async function settleUpscale(renderer: Renderer) {
    frame(renderer);
    expect(getAppliedRenderScale().limitedBy).toBe('upscale-pending');
    await internals(renderer).upscaleInit;
}

const targetTexture = (pass: RecordedPass | undefined) => bindingTexture(pass?.targets[0]);
const texturesLabelled = (label: string) => gpu.textures.filter((t) => t.descriptor.label === label && !t.destroyed);
const upscalePipelines = () => gpu.renderPipelines.filter((p) => p.label?.startsWith('upscale'));

beforeEach(() => {
    installGpuGlobals();
    installShaderFetch();
    resetRoadFrameSourceForTests();
    resetRenderScaleForTests(fixed(1));
    // The real boot publishes the probe; the mocked one does not.
    window.webgpuProbe = {} as unknown as NonNullable<Window['webgpuProbe']>;
    weatherCalls.renderPass.length = 0;
    weatherCalls.weatherOnly.length = 0;
    primeBoot();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
    resetRoadFrameSourceForTests();
    resetRenderScaleForTests();
    warnSpy.mockRestore();
    boot.bootDevice.mockReset();
});

describe('Renderer render scale', () => {
    it('at scale 1: full-size intermediate, weather writes the swap chain, no upscale built or encoded', async () => {
        const renderer = await booted();
        const passes = frame(renderer);

        const { textures } = internals(renderer);
        expect([textures.intermediateWidth, textures.intermediateHeight]).toEqual([64, 36]);
        expect(weatherCalls.renderPass).toEqual([undefined]);
        expect(passes.some((p) => p.label?.startsWith('upscale'))).toBe(false);
        // Lazy: nothing fetched or compiled for it, and nothing on the probe.
        expect(upscalePipelines()).toHaveLength(0);
        expect(getPassStatus('upscale')).toBeUndefined();
        expect(getAppliedRenderScale()).toMatchObject({ scale: 1, width: 64, height: 36, upscale: 'none', limitedBy: null });
    });

    it('below 1: a scaled intermediate and road target, then EASU → RCAS into the swap chain', async () => {
        configureRenderScale(fixed(0.5));
        const renderer = await booted();
        await settleUpscale(renderer);
        expect(getPassStatus('upscale')?.state).toBe('ready');
        expect(upscalePipelines().map((p) => p.label)).toEqual(['upscale-easu-pipeline', 'upscale-rcas-pipeline']);

        weatherCalls.renderPass.length = 0;
        const passes = frame(renderer);
        const { textures } = internals(renderer);
        expect([textures.intermediateWidth, textures.intermediateHeight]).toEqual([32, 18]);

        // Weather drew into the upscale's road target: the intermediate's size, the swap chain's format.
        const [input] = texturesLabelled('upscale-input');
        expect(input!.descriptor).toMatchObject({ size: [32, 18], format: 'bgra8unorm' });
        expect(bindingTexture(weatherCalls.renderPass[0])).toBe(input);

        const easu = passes.find((p) => p.label === 'upscale-easu');
        const rcas = passes.find((p) => p.label === 'upscale-rcas');
        const [easuTexture] = texturesLabelled('upscale-easu');
        expect(easuTexture!.descriptor).toMatchObject({ size: [64, 36], format: 'rgba16float' });
        expect(targetTexture(easu)).toBe(easuTexture);
        expect(bindingTexture((easu!.bindGroups[0]!.group as { entries: Map<number, unknown> }).entries.get(0))).toBe(input);
        expect(targetTexture(rcas)).toBe(gpu.context.getCurrentTexture() as unknown as FakeTexture);
        expect(passes.indexOf(easu!)).toBeLessThan(passes.indexOf(rcas!));

        expect(getAppliedRenderScale()).toMatchObject({
            scale: 0.5, width: 32, height: 18, outputWidth: 64, outputHeight: 36, upscale: 'fsr', limitedBy: null,
        });
        expect(window.webgpuProbe?.renderScale?.scale).toBe(0.5);
    });

    it('the road frame offered to the windshield portal is the (smaller) intermediate', async () => {
        configureRenderScale(fixed(0.5));
        const renderer = await booted();
        await settleUpscale(renderer);
        frame(renderer);
        const { getRoadFrameSource } = await import('./roadFrameRegistry');
        const road = getRoadFrameSource()!.getFrame()!;
        expect(road.texture).toBe(internals(renderer).textures.intermediateTexture);
        expect([road.width, road.height]).toEqual([32, 18]);
    });

    it('weather-only frames take the same scaled route', async () => {
        configureRenderScale(fixed(0.5));
        const renderer = await booted();
        await settleUpscale(renderer);

        gpu.encoders.length = 0;
        renderer.renderWeatherOnly();
        const [input] = texturesLabelled('upscale-input');
        expect(bindingTexture(weatherCalls.weatherOnly.at(-1))).toBe(input);
        const rcas = gpu.allPasses().find((p) => p.label === 'upscale-rcas');
        expect(targetTexture(rcas)).toBe(gpu.context.getCurrentTexture() as unknown as FakeTexture);
    });

    it('a hold keeps the scale it was armed at, then the request applies on release', async () => {
        configureRenderScale(fixed(0.5));
        const renderer = await booted();
        await settleUpscale(renderer);
        frame(renderer);

        renderer.beginHoldTransition(0, 0, canvas(512, 256));
        configureRenderScale(fixed(1));
        for (let i = 0; i < 3; i++) {
            renderer.renderHeldFrame(10 * i, 0, 1);
            expect(getAppliedRenderScale()).toMatchObject({ scale: 0.5, frozen: true });
        }
        const changesDuringHold = getAppliedRenderScale().changes;

        renderer.endHoldTransition();
        frame(renderer);
        expect(getAppliedRenderScale()).toMatchObject({ scale: 1, frozen: false, changes: changesDuringHold + 1 });
        expect(weatherCalls.renderPass.at(-1)).toBeUndefined();
    });

    it('an upscale shader that fails keeps the road at scale 1, reported on the probe', async () => {
        const realFetch = globalThis.fetch;
        (globalThis as Record<string, unknown>).fetch = async (url: string) => (
            String(url).includes('upscale.wgsl')
                ? { ok: false, status: 404, statusText: 'Not Found', text: async () => '' }
                : realFetch(url)
        );
        configureRenderScale(fixed(0.5));
        const renderer = await booted();
        frame(renderer);
        expect(await internals(renderer).upscaleInit).toBe(false);

        expect(getPassStatus('upscale')?.state).toBe('failed');
        weatherCalls.renderPass.length = 0;
        const passes = frame(renderer);
        expect(getAppliedRenderScale()).toMatchObject({ scale: 1, limitedBy: 'upscale-unavailable', width: 64 });
        expect(weatherCalls.renderPass).toEqual([undefined]);
        expect(passes.some((p) => p.label?.startsWith('upscale'))).toBe(false);
        // Not retried every frame.
        expect(internals(renderer).upscaleInit).not.toBeNull();
    });
});
