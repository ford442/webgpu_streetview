// @vitest-environment jsdom
/**
 * How the real `Renderer` feeds the cabin's windshield portal: what it publishes,
 * when, and — the property the hold-pause guarantee rests on — that the only
 * texture it can ever offer is the pass-1 HDR intermediate.
 *
 * GPU-facing collaborators are mocked; `TextureLifecycle` and
 * `HoldTransitionController` are the real ones, so identity, resize and hold
 * behaviour are the shipped behaviour.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const fakeTexture = (desc: Record<string, unknown>) => ({
    ...desc,
    destroy: vi.fn(),
    createView: () => ({ kind: 'view' }),
});

function fakeDevice() {
    return {
        features: new Set<string>(),
        createTexture: vi.fn(fakeTexture),
        createSampler: vi.fn(() => ({})),
        createBuffer: vi.fn(() => ({ destroy: vi.fn() })),
        createBindGroup: vi.fn(() => ({})),
        createCommandEncoder: vi.fn(() => ({})),
        queue: { writeBuffer: vi.fn(), submit: vi.fn(), copyExternalImageToTexture: vi.fn() },
        destroy: vi.fn(),
    } as unknown as GPUDevice;
}

const boot = vi.hoisted(() => ({
    bootDevice: vi.fn(),
    publishBootSuccess: vi.fn(),
    publishBootFailure: vi.fn(),
}));
vi.mock('./bootDevice', () => boot);

/**
 * Plain classes, not `vi.fn()` constructors: `vi.restoreAllMocks()` would reset a
 * `vi.fn()` implementation to nothing after the first test.
 */
vi.mock('./WeatherPostProcessor', () => ({
    WeatherPostProcessor: class {
        init = vi.fn().mockResolvedValue(undefined);
        dispose = vi.fn();
        updateWeatherBindGroup = vi.fn();
        updateWeatherParams = vi.fn();
        updateColorParams = vi.fn();
        setShaderEffects = vi.fn();
        renderWeatherOnly = vi.fn();
        renderPass = vi.fn();
        updateWeatherAnimation = vi.fn();
    },
}));
vi.mock('./ComputeWeatherPostProcessor', () => ({
    ComputeWeatherPostProcessor: class {
        init = vi.fn().mockResolvedValue(undefined);
        dispose = vi.fn();
        updateWeatherBindGroup = vi.fn();
        updateWeatherParams = vi.fn();
        updateColorParams = vi.fn();
        setShaderEffects = vi.fn();
        renderWeatherOnly = vi.fn();
        renderPass = vi.fn();
        updateWeatherAnimation = vi.fn();
    },
}));
vi.mock('./TransitionManager', () => ({
    TransitionManager: class {
        init = vi.fn().mockResolvedValue(undefined);
        dispose = vi.fn();
        captureCurrentFrame = vi.fn();
        setTransitionProgress = vi.fn();
        recordLastPan = vi.fn();
        previousFrame = undefined;
    },
}));
vi.mock('./streetViewPass', () => ({
    buildSamplerDescriptor: () => ({}),
    createStreetViewPipeline: async () => ({ getBindGroupLayout: () => ({}) }),
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
import { installGpuGlobals } from './computeWeather/__tests__/fakeGpu';
import {
    getRoadFrameSource,
    resetRoadFrameSourceForTests,
} from './roadFrameRegistry';
import { WEATHER_PARAMS_FLOAT_COUNT, WeatherParamIndex } from './weatherUniformLayout';

let lastBootOptions: { onDeviceLost: (info: GPUDeviceLostInfo) => void } | undefined;
let warnSpy: ReturnType<typeof vi.spyOn>;

function primeBoot(intermediateFormat: GPUTextureFormat = 'rg11b10ufloat') {
    boot.bootDevice.mockImplementation(async (options: { onDeviceLost: (i: GPUDeviceLostInfo) => void }) => {
        lastBootOptions = options;
        return {
            ok: true,
            device: fakeDevice(),
            context: { unconfigure: vi.fn(), getCurrentTexture: vi.fn() },
            presentationFormat: 'bgra8unorm',
            canvasOutputPolicy: { hdr: false, p3: false },
            intermediateFormat,
            capabilityMatrix: {},
            timestampQueriesAvailable: false,
            probe: {},
        };
    });
}

function canvas(width = 64, height = 36): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = width;
    c.height = height;
    return c;
}

async function bootedRenderer(c = canvas()) {
    const renderer = new Renderer(c);
    const ok = await renderer.init();
    expect(ok, `init failed: ${renderer.fallbackReason}`).toBe(true);
    return { renderer, canvas: c };
}

const internals = (r: Renderer) => r as unknown as { textures: import('./textureLifecycle').TextureLifecycle };

beforeEach(() => {
    installGpuGlobals();
    resetRoadFrameSourceForTests();
    lastBootOptions = undefined;
    primeBoot();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
    resetRoadFrameSourceForTests();
    warnSpy.mockRestore();
    boot.bootDevice.mockReset();
});

describe('Renderer → road frame registry', () => {
    it('publishes a source once init succeeds, with no frame until pass 1 has an intermediate', async () => {
        expect(getRoadFrameSource()).toBeNull();
        await bootedRenderer();
        const source = getRoadFrameSource();
        expect(source).not.toBeNull();
        expect(source!.getFrame()).toBeNull();
    });

    it('does not publish when boot fails', async () => {
        boot.bootDevice.mockResolvedValue({ ok: false, reason: 'no adapter' });
        expect(await new Renderer(canvas()).init()).toBe(false);
        expect(getRoadFrameSource()).toBeNull();
    });

    it('offers the pass-1 intermediate — with its format and size — and nothing else', async () => {
        const { renderer } = await bootedRenderer();
        renderer.renderWeatherOnly();
        const frame = getRoadFrameSource()!.getFrame()!;
        const textures = internals(renderer).textures;

        expect(frame.texture).toBe(textures.intermediateTexture);
        // The device the cabin must be on to bind it.
        expect(frame.device).toBe(renderer.getSharedGpuDevice());
        expect(frame.format).toBe('rg11b10ufloat');
        expect(frame.width).toBe(64);
        expect(frame.height).toBe(36);
        // Never the live-upload texture, and never the panorama snapshot.
        expect(frame.texture).not.toBe(textures.videoTexture);
        expect(frame.texture).not.toBe(textures.texture);
    });

    it('follows the intermediate when the canvas resizes and the renderer replaces it', async () => {
        const { renderer, canvas: c } = await bootedRenderer();
        renderer.renderWeatherOnly();
        const first = getRoadFrameSource()!.getFrame()!.texture;

        c.width = 128;
        c.height = 72;
        renderer.renderWeatherOnly();
        const second = getRoadFrameSource()!.getFrame()!;

        expect(second.texture).not.toBe(first);
        expect(second.width).toBe(128);
        // The old one really was destroyed by the road, which is why the cabin re-reads every frame.
        expect((first as unknown as { destroy: ReturnType<typeof vi.fn> }).destroy).toHaveBeenCalled();
    });

    it('reports the hold-pause while still offering only the intermediate', async () => {
        const { renderer } = await bootedRenderer();
        renderer.renderWeatherOnly();
        const source = getRoadFrameSource()!;
        const before = source.getFrame()!;
        expect(before.held).toBe(false);

        renderer.beginHoldTransition(90, 0);
        const during = source.getFrame()!;
        expect(during.held).toBe(true);
        expect(during.texture).toBe(before.texture);
        expect(during.texture).not.toBe(internals(renderer).textures.videoTexture);

        renderer.endHoldTransition();
        expect(source.getFrame()!.held).toBe(false);
    });

    it('never exposes a live Maps upload: the publish block only reads the intermediate', () => {
        // Structural hold-pause guard, in the style of the variants' no-WebGLRenderer grep.
        const src = readFileSync(join(__dirname, 'Renderer.ts'), 'utf8');
        const start = src.indexOf('createRoadFrameSource({');
        const block = src.slice(start, src.indexOf('publishRoadFrameSource(', start));
        expect(block).toContain('this.textures.intermediateTexture');
        expect(block).not.toMatch(/videoTexture|previousFrame|copyExternalImageToTexture|canvas/i);
    });
});

describe('Renderer → road look', () => {
    it('mirrors the packed weather block the road is graded with', async () => {
        const { renderer } = await bootedRenderer();
        renderer.renderWeatherOnly();
        const params = new Float32Array(WEATHER_PARAMS_FLOAT_COUNT);
        params[WeatherParamIndex.exposure] = 0.75;
        params[WeatherParamIndex.contrast] = -0.25;
        params[WeatherParamIndex.nightIntensity] = 0.5;
        params[WeatherParamIndex.rainIntensity] = 1.5;
        params[WeatherParamIndex.shaderEffectsEnabled] = 1;
        renderer.updateWeatherParams(params);

        expect(getRoadFrameSource()!.getFrame()!.look).toMatchObject({
            exposure: 0.75,
            contrast: -0.25,
            nightIntensity: 0.5,
            rainIntensity: 1.5,
            graded: true,
        });
    });

    it('also follows updateColorParams (first six floats only) without clobbering night or rain', async () => {
        const { renderer } = await bootedRenderer();
        renderer.renderWeatherOnly();
        const all = new Float32Array(WEATHER_PARAMS_FLOAT_COUNT);
        all[WeatherParamIndex.nightIntensity] = 0.9;
        all[WeatherParamIndex.shaderEffectsEnabled] = 1;
        renderer.updateWeatherParams(all);

        const colour = new Float32Array(WEATHER_PARAMS_FLOAT_COUNT);
        colour[WeatherParamIndex.exposure] = -1;
        renderer.updateColorParams(colour);

        const look = getRoadFrameSource()!.getFrame()!.look;
        expect(look.exposure).toBe(-1);
        expect(look.nightIntensity).toBeCloseTo(0.9);
    });

    it('follows the shader-effects bypass, which makes the road show the raw intermediate', async () => {
        const { renderer } = await bootedRenderer();
        renderer.renderWeatherOnly();
        renderer.setShaderEffects(false);
        expect(getRoadFrameSource()!.getFrame()!.look.graded).toBe(false);
        renderer.setShaderEffects(true);
        expect(getRoadFrameSource()!.getFrame()!.look.graded).toBe(true);
    });
});

describe('Renderer → teardown', () => {
    it('retracts its source when destroyed, and the source stops handing out frames', async () => {
        const { renderer } = await bootedRenderer();
        renderer.renderWeatherOnly();
        const source = getRoadFrameSource()!;
        expect(source.getFrame()).not.toBeNull();

        renderer.destroy();
        expect(getRoadFrameSource()).toBeNull();
        // A cabin that grabbed the source earlier must not be handed a destroyed texture.
        expect(source.getFrame()).toBeNull();
    });

    it('retracts on device loss too', async () => {
        await bootedRenderer();
        expect(getRoadFrameSource()).not.toBeNull();
        lastBootOptions!.onDeviceLost({ reason: 'unknown', message: 'lost' } as GPUDeviceLostInfo);
        expect(getRoadFrameSource()).toBeNull();
    });

    it('a re-init that publishes before the old renderer\'s teardown is not wiped by it', async () => {
        const { renderer: oldRenderer } = await bootedRenderer();
        const { renderer: newRenderer } = await bootedRenderer();
        const newSource = getRoadFrameSource();
        expect(newSource).not.toBeNull();

        oldRenderer.destroy();
        expect(getRoadFrameSource()).toBe(newSource);

        newRenderer.destroy();
        expect(getRoadFrameSource()).toBeNull();
    });
});
