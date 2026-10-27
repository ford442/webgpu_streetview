// @vitest-environment jsdom
/**
 * Scene depth (#320) wired through the real `Renderer`: the `depth` pass is
 * lazy (nothing downloads at boot), opting in initialises it and reports it on
 * `webgpuProbe.passes`, its map reaches the weather pass and pass 1 through
 * `FrameContext.aux`, and a failure is reported while the road keeps drawing.
 *
 * The Worker-facing `DepthEstimator` is replaced; everything renderer-side —
 * registry, controller, scheduler, uploads — is the shipped code on the
 * recording fake device.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeGpu, installGpuGlobals, installShaderFetch, type FakeGpu } from './computeWeather/__tests__/fakeGpu';

const boot = vi.hoisted(() => ({ bootDevice: vi.fn() }));
vi.mock('./bootDevice', async (importOriginal) => ({
    ...(await importOriginal<typeof import('./bootDevice')>()),
    bootDevice: boot.bootDevice,
}));

const weather = vi.hoisted(() => ({ setSceneDepth: [] as unknown[] }));
vi.mock('./WeatherPostProcessor', () => ({
    WeatherPostProcessor: class {
        init = vi.fn().mockResolvedValue(undefined);
        dispose = vi.fn();
        updateWeatherBindGroup = vi.fn();
        updateWeatherAnimation = vi.fn();
        renderPass = vi.fn();
        setSceneDepth = (d: unknown) => weather.setSceneDepth.push(d);
    },
}));
vi.mock('./TransitionManager', () => ({
    TransitionManager: class {
        init = vi.fn().mockResolvedValue(undefined);
        dispose = vi.fn();
        recordLastPan = vi.fn();
        renderTransitionPass = () => false;
        isInTransition = () => false;
        inlineProgress = 0;
        previousFrame = undefined;
    },
}));
const pass1 = vi.hoisted(() => ({ depthGroups: [] as unknown[] }));
vi.mock('./streetViewPass', () => ({
    buildSamplerDescriptor: () => ({}),
    createStreetViewPipeline: async () => ({ getBindGroupLayout: () => ({}) }),
    encodeStreetViewPass: (_e: unknown, _v: unknown, _p: unknown, _b: unknown, depthGroup: unknown) => {
        pass1.depthGroups.push(depthGroup);
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

const estimator = vi.hoisted(() => ({
    instances: 0,
    loadError: null as string | null,
}));
vi.mock('./depth/DepthEstimator', () => ({
    DepthEstimator: class {
        onLost: ((reason: string) => void) | null = null;
        private ready = false;
        constructor() {
            estimator.instances += 1;
        }
        async load() {
            if (estimator.loadError) throw new Error(estimator.loadError);
            this.ready = true;
            return { type: 'ready', variant: 'q4', shaderF16: false, fromCache: false, createMs: 1, adapter: 'fake' };
        }
        isReady() {
            return this.ready;
        }
        isBusy() {
            return false;
        }
        async infer(_rgba: Uint8Array, width: number, height: number) {
            const disparity = new Float32Array(width * height).map((_, i) => i % width);
            return { type: 'result', id: 1, disparity, width, height, ms: 30 };
        }
        dispose() {
            this.ready = false;
        }
    },
}));

import { Renderer } from './Renderer';
import { TextureLifecycle } from './textureLifecycle';
import { getSceneDepthFallback } from './depth/sceneDepthBinding';
import { resetSceneDepthStats } from './depth/sceneDepthStatsStore';
import { DEPTH_SETTLE_MS } from './depth/depthScheduler';

let gpu: FakeGpu;

function primeBoot() {
    boot.bootDevice.mockResolvedValue({
        ok: true,
        device: gpu.device,
        context: gpu.context,
        presentationFormat: 'bgra8unorm',
        canvasOutputPolicy: { hdr: false, p3: false },
        intermediateFormat: 'rgba16float',
        capabilityMatrix: {},
        timestampQueriesAvailable: false,
        probe: { preference: 'auto', webglPreferenceDeferred: false, capabilityMatrix: { gpuChoresGpuEligible: true } },
    });
}

function canvas(): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = 320;
    c.height = 180;
    return c;
}

function source(): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 256;
    return c;
}

const settle = () => new Promise((r) => setTimeout(r, 0));

async function bootRenderer(): Promise<Renderer> {
    const renderer = new Renderer(canvas());
    expect(await renderer.init()).toBe(true);
    await settle(); // GpuChores.ensureReady
    return renderer;
}

/** Render frames across real time so the scheduler's settle window passes. */
async function renderFor(renderer: Renderer, frames: number) {
    const src = source();
    for (let i = 0; i < frames; i++) {
        vi.spyOn(performance, 'now').mockReturnValue(10_000 + i * DEPTH_SETTLE_MS);
        renderer.renderStreetView('streetview', src, 0, 0, 1);
        await settle();
    }
    vi.mocked(performance.now).mockRestore?.();
}

beforeEach(() => {
    installGpuGlobals();
    installShaderFetch();
    gpu = createFakeGpu();
    primeBoot();
    estimator.instances = 0;
    estimator.loadError = null;
    weather.setSceneDepth.length = 0;
    pass1.depthGroups.length = 0;
    resetSceneDepthStats();
    // jsdom canvases have no 2D context for the stability fingerprint, and the
    // upload is not what this suite is about: a live frame just lands.
    vi.spyOn(TextureLifecycle.prototype, 'uploadLiveSource').mockImplementation(function (this: TextureLifecycle) {
        if (!this.videoTexture) {
            this.createVideoTexture(512, 256);
            this.updateBindGroup();
        }
        return true;
    });
});

describe('Renderer — scene depth', () => {
    it('boots without touching scene depth: no Worker, no probe entry, the zero fallback bound', async () => {
        const renderer = await bootRenderer();
        expect(estimator.instances).toBe(0);
        expect(window.webgpuProbe?.passes?.depth).toBeUndefined();

        await renderFor(renderer, 2);
        expect(pass1.depthGroups.at(-1)).toBe(getSceneDepthFallback(gpu.device));
        expect(weather.setSceneDepth.at(-1)).toBeNull();
        renderer.destroy();
    });

    it('opting in initialises the pass, and its map reaches pass 1 and weather through aux', async () => {
        const renderer = await bootRenderer();
        renderer.setSceneDepth({ enabled: true, blend: 0.8, reducedMotion: false });
        await settle();
        await settle();
        expect(window.webgpuProbe?.passes?.depth?.state).toBe('ready');

        await renderFor(renderer, 6);
        const published = weather.setSceneDepth.at(-1) as { bindGroup: unknown; generation: number } | null;
        expect(published).not.toBeNull();
        expect(published!.generation).toBeGreaterThan(0);
        expect(pass1.depthGroups.at(-1)).toBe(published!.bindGroup);
        renderer.destroy();
    });

    it('a failed load is reported on webgpuProbe.passes and the road keeps rendering on the fallback', async () => {
        estimator.loadError = 'scene-depth model not deployed (HTTP 404)';
        const renderer = await bootRenderer();
        renderer.setSceneDepth({ enabled: true, blend: 0.8, reducedMotion: false });
        await settle();
        await settle();
        expect(window.webgpuProbe?.passes?.depth).toMatchObject({ state: 'failed', reason: expect.stringMatching(/404/) });
        expect(window.webgpuProbe?.ok).toBe(true);

        const submits = gpu.submits;
        await renderFor(renderer, 3);
        expect(gpu.submits).toBeGreaterThan(submits);
        expect(pass1.depthGroups.at(-1)).toBe(getSceneDepthFallback(gpu.device));
        expect(weather.setSceneDepth.at(-1)).toBeNull();

        // Not retried every frame…
        renderer.setSceneDepth({ enabled: true, blend: 0.8, reducedMotion: false });
        await settle();
        expect(estimator.instances).toBe(1);
        // …only when the user switches it off and on again.
        estimator.loadError = null;
        renderer.setSceneDepth({ enabled: false, blend: 0, reducedMotion: false });
        renderer.setSceneDepth({ enabled: true, blend: 0.8, reducedMotion: false });
        await settle();
        await settle();
        expect(estimator.instances).toBe(2);
        expect(window.webgpuProbe?.passes?.depth?.state).toBe('ready');
        renderer.destroy();
    });

    it('a hop with a link heading dollies; turning scene depth off removes the map from the frame', async () => {
        const renderer = await bootRenderer();
        renderer.setSceneDepth({ enabled: true, blend: 0.8, reducedMotion: false });
        await settle();
        await settle();
        await renderFor(renderer, 6);
        expect(weather.setSceneDepth.at(-1)).not.toBeNull();

        renderer.setSceneDepth({ enabled: false, blend: 0, reducedMotion: false });
        await renderFor(renderer, 1);
        expect(weather.setSceneDepth.at(-1)).toBeNull();
        expect(pass1.depthGroups.at(-1)).toBe(getSceneDepthFallback(gpu.device));
        renderer.destroy();
    });
});
