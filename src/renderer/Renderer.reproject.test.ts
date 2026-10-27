// @vitest-environment jsdom
/**
 * The split frame (#331) as the real `Renderer` encodes it: with no tail the
 * frame is the pre-#331 frame; with `?latelatch` the road renders into the
 * reproject pass's present source and the tail — after the car loop in car
 * mode — re-aims it at the live POV and composites the cabin.
 *
 * GPU-facing collaborators are fakes; the pass registry, `ReprojectPass` and
 * the tail scheduler are the real ones.
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
const cabin = vi.hoisted(() => ({
    active: false,
    layout: 'mono' as 'mono' | 'sbs',
    encodes: [] as unknown[],
    regions: [] as Array<string | undefined>,
    formats: [] as Array<string | undefined>,
}));

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
            return cabin.active;
        }
        isActive() {
            return cabin.active;
        }
        getLayout() {
            return cabin.layout;
        }
        hasFormat() {
            return true;
        }
        ensureFormat = async () => undefined;
        encode(_e: GPUCommandEncoder, _view: GPUTextureView, viewport?: unknown, region?: string, format?: string) {
            cabin.encodes.push(viewport ?? null);
            cabin.regions.push(region);
            cabin.formats.push(format);
            return true;
        }
    },
}));

import { Renderer } from './Renderer';
import { getPassStatus } from './passStatus';
import { resetRoadFrameSourceForTests } from './roadFrameRegistry';
import { resetRenderScaleForTests } from './renderScale';
import { frameTailScheduler } from './reproject/frameTail';
import { getCabinStereoRequest } from './cabinStereoRequest';
import { getLateLatchStats, type PresentTailOptions } from './reproject/presentTail';
import { REPROJECT_MODE_CODE, ReprojectUniformIndex, latchSourceUV, rotY, type PovSample } from './reproject/reprojectMath';
import { publishXrPresentFrame, resetXrPresentFrameForTests, setXrPresenting, getXrPresentedFrames } from './xrPresentFrame';

let gpu: FakeGpu;
const currentGpu = () => gpu;
let warnSpy: ReturnType<typeof vi.spyOn>;

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
    reprojectInit: Promise<boolean> | null;
    submitPanoramaFrame: (h: number, p: number, z: number) => void;
};
const internals = (r: Renderer) => r as unknown as Internals;

const LATCH: PresentTailOptions = { latch: true, stereo: 'off', fillBlur: true };
let live: PovSample = { heading: 0, pitch: 0, zoom: 1 };

async function booted(options: PresentTailOptions = LATCH) {
    const renderer = new Renderer(canvas(64, 36));
    expect(await renderer.init(), renderer.fallbackReason).toBe(true);
    renderer.setPresentTail(options, () => live);
    return renderer;
}

/** One display frame at `t`: the road at heading/pitch, the way `renderStreetView` reaches the registry. */
function frame(renderer: Renderer, t: number, heading = 0, pitch = 0): RecordedPass[] {
    gpu.encoders.length = 0;
    renderer.beginFrame(t);
    internals(renderer).submitPanoramaFrame(heading, pitch, 1);
    return gpu.allPasses();
}

/** The first frame that wants a tail starts building the lazy pass; let it finish. */
async function settle(renderer: Renderer) {
    frame(renderer, 0);
    await internals(renderer).reprojectInit;
    expect(getPassStatus('reproject')?.state).toBe('ready');
}

const targetTexture = (pass: RecordedPass | undefined) => bindingTexture(pass?.targets[0]);
const swapChain = () => gpu.context.getCurrentTexture() as unknown as FakeTexture;
const sourceTexture = () => gpu.textures.find((t) => t.descriptor.label === 'reproject-source' && !t.destroyed);
const lastUniforms = () => {
    const calls = gpu.writeBufferCalls.filter((c) => c.buffer.descriptor.label === 'reproject-uniforms');
    return calls.at(-1)?.data as Float32Array | undefined;
};

beforeEach(() => {
    installGpuGlobals();
    installShaderFetch();
    resetRoadFrameSourceForTests();
    resetRenderScaleForTests();
    frameTailScheduler.reset();
    (window as unknown as { webgpuProbe?: object }).webgpuProbe = {};
    weatherCalls.renderPass.length = 0;
    cabin.active = false;
    cabin.layout = 'mono';
    cabin.encodes.length = 0;
    cabin.regions.length = 0;
    cabin.formats.length = 0;
    resetXrPresentFrameForTests();
    live = { heading: 0, pitch: 0, zoom: 1 };
    primeBoot();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
    resetRoadFrameSourceForTests();
    resetRenderScaleForTests();
    frameTailScheduler.reset();
    resetXrPresentFrameForTests();
    warnSpy.mockRestore();
    boot.bootDevice.mockReset();
});

describe('Renderer split frame (#331)', () => {
    it('without ?latelatch or ?stereo: no reproject built, weather writes the swap chain — the pre-#331 frame', async () => {
        const renderer = await booted({ latch: false, stereo: 'off', fillBlur: true });
        const passes = frame(renderer, 1);
        expect(weatherCalls.renderPass).toEqual([undefined]);
        expect(passes.some((p) => p.label === 'reproject')).toBe(false);
        expect(gpu.renderPipelines.some((p) => p.label?.startsWith('reproject'))).toBe(false);
        expect(getPassStatus('reproject')).toBeUndefined();
        expect(getLateLatchStats().enabled).toBe(false);
    });

    it('latched: weather writes the present source, the tail copies it to the swap chain at rest', async () => {
        const renderer = await booted();
        await settle(renderer);
        weatherCalls.renderPass.length = 0;
        const passes = frame(renderer, 1);

        const source = sourceTexture()!;
        expect(source.descriptor).toMatchObject({ size: [64, 36], format: 'bgra8unorm' });
        expect(bindingTexture(weatherCalls.renderPass[0])).toBe(source);
        const reproject = passes.find((p) => p.label === 'reproject');
        expect(targetTexture(reproject)).toBe(swapChain());
        // Two submits: the road, then the tail.
        expect(gpu.encoders).toHaveLength(2);
        expect(lastUniforms()![ReprojectUniformIndex.mode]).toBe(REPROJECT_MODE_CODE.copy);
        expect(getLateLatchStats()).toMatchObject({ enabled: true, mode: 'copy', latchDeltaDeg: 0 });
    });

    it('re-aims the road at the POV read when the tail encodes', async () => {
        const renderer = await booted();
        await settle(renderer);
        live = { heading: 3, pitch: -4, zoom: 1 };
        frame(renderer, 1, 0, 0);
        const u = lastUniforms()!;
        expect(u[ReprojectUniformIndex.mode]).toBe(REPROJECT_MODE_CODE.latch);
        // The centre of the live view is 3° right of the packed centre.
        const [x] = latchSourceUV([0.5, 0.5], u);
        expect(x - 0.5).toBeCloseTo(Math.tan((3 * Math.PI) / 180) / (2 * u[ReprojectUniformIndex.tanHalfH]!), 6);
        expect(getLateLatchStats().latchDeltaDeg).toBeCloseTo(5, 6);
    });

    it('in car mode the tail waits for the car loop of the same display frame, and composites the cabin there', async () => {
        cabin.active = true;
        const renderer = await booted();
        await settle(renderer);
        // Frame 1: the car loop is seen for the first time.
        frame(renderer, 1);
        frameTailScheduler.producerDone(1);

        // Frame 2: road first — main has no cabin and no reproject yet …
        cabin.encodes.length = 0;
        const main = frame(renderer, 2, 10, 0);
        expect(main.some((p) => p.label === 'reproject')).toBe(false);
        expect(cabin.encodes).toHaveLength(0);
        // … the car loop moves the view and renders the cabin, then releases the tail.
        live = { heading: 12, pitch: 0, zoom: 1 };
        frameTailScheduler.producerDone(2);
        const tail = gpu.allPasses();
        expect(tail.some((p) => p.label === 'reproject')).toBe(true);
        expect(cabin.encodes).toHaveLength(1);
        expect(getLateLatchStats().latchDeltaDeg).toBeCloseTo(2, 6);
        expect(getLateLatchStats().frames.deferred).toBeGreaterThanOrEqual(1);
    });

    it('?stereo=sbs: the stereo mode, and the mono cabin drawn into each half', async () => {
        cabin.active = true;
        const renderer = await booted({ latch: false, stereo: 'sbs', fillBlur: true });
        await settle(renderer);
        cabin.encodes.length = 0;
        frame(renderer, 1);
        expect(lastUniforms()![ReprojectUniformIndex.mode]).toBe(REPROJECT_MODE_CODE.sbs);
        expect(cabin.encodes).toEqual([
            { x: 0, y: 0, width: 32, height: 36 },
            { x: 32, y: 0, width: 32, height: 36 },
        ]);
    });

    it('?stereo=sbs asks the cabin for two eyes, and a stereo cabin composites 1:1', async () => {
        cabin.active = true;
        const renderer = await booted({ latch: false, stereo: 'sbs', fillBlur: true });
        expect(getCabinStereoRequest()).toMatchObject({ kind: 'sbs', ipd: 0.064, convergence: 1 });
        await settle(renderer);
        cabin.layout = 'sbs';
        cabin.encodes.length = 0;
        frame(renderer, 1);
        expect(cabin.encodes).toEqual([null]);
        renderer.setPresentTail({ latch: false, stereo: 'off', fillBlur: true });
        expect(getCabinStereoRequest()).toBeNull();
    });

    it('a reproject shader that fails keeps the frame unsplit, reported on the probe', async () => {
        const realFetch = globalThis.fetch;
        (globalThis as Record<string, unknown>).fetch = async (url: string) => (
            String(url).includes('reproject.wgsl')
                ? { ok: false, status: 404, statusText: 'Not Found', text: async () => '' }
                : realFetch(url)
        );
        const renderer = await booted();
        frame(renderer, 0);
        expect(await internals(renderer).reprojectInit).toBe(false);
        expect(getPassStatus('reproject')?.state).toBe('failed');
        weatherCalls.renderPass.length = 0;
        const passes = frame(renderer, 1);
        expect(weatherCalls.renderPass).toEqual([undefined]);
        expect(passes.some((p) => p.label === 'reproject')).toBe(false);
    });

    it('WebXR: each eye from the packed frame into its sub-image, the cabin\'s half over it, the canvas untouched', async () => {
        cabin.active = true;
        cabin.layout = 'sbs';
        const renderer = await booted({ latch: false, stereo: 'off', fillBlur: true });
        // Presenting alone splits the frame — no ?latelatch needed.
        setXrPresenting(true);
        await settle(renderer);
        const layer = (label: string) => gpu.device.createTexture({
            label, size: [100, 80], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT,
        });
        const left = layer('xr-left');
        const right = layer('xr-right');
        const eye = (texture: GPUTexture, eyeSign: -1 | 1, headingDeg: number) => ({
            view: texture.createView(),
            viewport: { x: 0, y: 0, width: 100, height: 80 },
            frustum: { left: -1, right: 1, down: -1, up: 1 },
            worldFromEye: rotY((headingDeg * Math.PI) / 180),
            eyeSign,
            clear: true,
        });
        const publish = () => publishXrPresentFrame({
            format: 'rgba8unorm',
            halfIpd: 0.032,
            eyes: [eye(left, -1, 4), eye(right, 1, 4)],
        });

        // The layer's format has no pipeline yet: the first frame builds it and draws no eyes.
        publish();
        frame(renderer, 1);
        expect(getXrPresentedFrames()).toBe(0);
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(gpu.renderPipelines.some((p) => p.label === 'reproject-pipeline-rgba8unorm')).toBe(true);

        cabin.encodes.length = 0;
        cabin.regions.length = 0;
        cabin.formats.length = 0;
        // The renderer reuses one uniform array (the real queue copies on write); snapshot each write.
        const eyeWrites: Array<{ offset: number; data: Float32Array }> = [];
        const queue = gpu.device.queue as unknown as { writeBuffer: (b: { descriptor: GPUBufferDescriptor }, o: number, d: Float32Array) => void };
        const write = queue.writeBuffer;
        queue.writeBuffer = (buffer, offset, data) => {
            if (buffer.descriptor.label === 'reproject-uniforms') eyeWrites.push({ offset, data: data.slice() });
            write(buffer, offset, data);
        };
        publish();
        const passes = frame(renderer, 2);
        const eyes = passes.filter((p) => p.label === 'reproject');
        expect(eyes.map((p) => bindingTexture(p.targets[0])?.descriptor.label)).toEqual(['xr-left', 'xr-right']);
        expect(eyes.map((p) => p.viewports)).toEqual([[[0, 0, 100, 80]], [[0, 0, 100, 80]]]);
        // Slots 1 and 2 of the uniform ring; slot 0 stays the flat tail's.
        expect(eyes.map((p) => p.dynamicOffsets[0])).toEqual([[256], [512]]);
        expect(passes.some((p) => p.targets.some((t) => bindingTexture(t) === swapChain()))).toBe(false);
        expect(cabin.regions).toEqual(['left', 'right']);
        expect(cabin.formats).toEqual(['rgba8unorm', 'rgba8unorm']);
        expect(getXrPresentedFrames()).toBe(1);
        // Eye uniforms: the eye mode, each eye's own sign, convergence at infinity.
        const u = eyeWrites.map((c) => c.data);
        expect(eyeWrites.map((c) => c.offset)).toEqual([256, 512]);
        expect(u.map((x) => x[ReprojectUniformIndex.mode])).toEqual([REPROJECT_MODE_CODE.eye, REPROJECT_MODE_CODE.eye]);
        expect(u.map((x) => x[ReprojectUniformIndex.eyeSign])).toEqual([-1, 1]);
        expect(u[0]![ReprojectUniformIndex.halfIpd]).toBeCloseTo(0.032, 6);
        expect(u[0]![ReprojectUniformIndex.convergenceInv]).toBe(0);
        expect(getLateLatchStats()).toMatchObject({ mode: 'eye' });
        expect(getLateLatchStats().latchDeltaDeg).toBeCloseTo(4, 4);
    });
});
