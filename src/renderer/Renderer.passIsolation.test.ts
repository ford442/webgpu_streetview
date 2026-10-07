/**
 * One broken pass must never take the road frame down, and one failed boot
 * must never re-init itself in a loop.
 *
 * The real `Renderer`, `WeatherPostProcessor`, `CabinCompositePass`,
 * `HistoricalWipePass` and pass-1 pipeline code run against the recording fake
 * GPU; the fake's shader modules answer `getCompilationInfo()` with an error
 * for any WGSL containing `BROKEN`, which is what a real device does for a
 * syntax error (and what `gpuPipelineFactory` turns into a rejection).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    createFakeGpu,
    installGpuGlobals,
    type FakeGpu,
} from './computeWeather/__tests__/fakeGpu';

const boot = vi.hoisted(() => ({
    bootDevice: vi.fn(),
    publishBootSuccess: vi.fn(),
    publishBootFailure: vi.fn(),
}));
vi.mock('./bootDevice', () => boot);
vi.mock('./gpuChores/GpuChores', () => ({
    GpuChores: class {
        ensureReady = async () => undefined;
        destroy() {}
    },
}));

import { Renderer } from './Renderer';
import { getPassStatuses } from './passStatus';
import { publishCabinOverlaySource, resetCabinOverlaySourceForTests } from './cabinOverlayRegistry';
import { resetRoadFrameSourceForTests } from './roadFrameRegistry';

let gpu: FakeGpu;
let pipelineLabels: Map<unknown, string>;
let lastBoot: { onDeviceLost: (info: GPUDeviceLostInfo) => void } | undefined;
let destroyDevice: ReturnType<typeof vi.fn>;
let warnSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

/** Serve every shader; the ones named in `broken` carry a syntax error. */
function serveShaders(broken: string[] = []) {
    (globalThis as Record<string, unknown>).fetch = async (url: string) => {
        const name = String(url).split('/').pop()!;
        const code = broken.includes(name) ? `// ${name}\nBROKEN fn (` : `// ${name}`;
        return { ok: true, status: 200, statusText: 'OK', text: async () => code };
    };
}

function primeBoot() {
    gpu = createFakeGpu();
    pipelineLabels = new Map();
    destroyDevice = vi.fn();
    const device = gpu.device as unknown as Record<string, unknown>;
    const createModule = device.createShaderModule as (d: GPUShaderModuleDescriptor) => object;
    device.createShaderModule = (d: GPUShaderModuleDescriptor) => ({
        ...createModule(d),
        getCompilationInfo: async () => ({
            messages: d.code.includes('BROKEN')
                ? [{ type: 'error', message: 'expected an item', lineNum: 2, linePos: 1 }]
                : [],
        }),
    });
    const createRender = device.createRenderPipeline as (d: GPURenderPipelineDescriptor) => object;
    device.createRenderPipeline = (d: GPURenderPipelineDescriptor) => {
        const p = {
            ...createRender(d),
            getBindGroupLayout: () => ({ kind: 'bgl' }),
        };
        pipelineLabels.set(p, d.label ?? '');
        return p;
    };
    device.destroy = destroyDevice;
    (device.queue as Record<string, unknown>).copyExternalImageToTexture = vi.fn();
    boot.bootDevice.mockImplementation(async (options: { onDeviceLost: (i: GPUDeviceLostInfo) => void }) => {
        lastBoot = options;
        return {
            ok: true,
            device: gpu.device,
            context: gpu.context,
            presentationFormat: 'bgra8unorm',
            canvasOutputPolicy: { hdr: false, p3: false },
            intermediateFormat: 'rgba16float',
            capabilityMatrix: {},
            timestampQueriesAvailable: false,
            probe: {},
        };
    });
}

function canvas(): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 36;
    return c;
}

/** Labels of the pipelines set in the last frame's passes, in encode order. */
function lastFramePipelines(): string[] {
    return gpu.lastEncoder().passes.map((p) => pipelineLabels.get(p.pipeline) ?? '?');
}

function renderOneFrame(renderer: Renderer) {
    gpu.encoders.length = 0;
    (renderer as unknown as { submitPanoramaFrame: (h: number, p: number, z: number) => void })
        .submitPanoramaFrame(0, 0, 1);
}

beforeEach(() => {
    installGpuGlobals();
    resetRoadFrameSourceForTests();
    resetCabinOverlaySourceForTests();
    primeBoot();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
    resetRoadFrameSourceForTests();
    resetCabinOverlaySourceForTests();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
    boot.bootDevice.mockReset();
    boot.publishBootFailure.mockReset();
});

describe('pass isolation', () => {
    it('a healthy boot reports every pass ready and encodes pass 1 → weather', async () => {
        serveShaders();
        const renderer = new Renderer(canvas());
        expect(await renderer.init()).toBe(true);
        expect(getPassStatuses()).toMatchObject({
            streetview: { state: 'ready' },
            'historical-wipe': { state: 'ready' },
            weather: { state: 'ready' },
            'cabin-composite': { state: 'ready' },
        });
        renderOneFrame(renderer);
        expect(lastFramePipelines()).toEqual(['streetview-pipeline', 'weather-post-pipeline']);
        renderer.destroy();
    });

    it('a broken cabin-composite.wgsl disables only the cabin: road frame presents, latch stays on', async () => {
        serveShaders(['cabin-composite.wgsl']);
        const renderer = new Renderer(canvas());
        expect(await renderer.init()).toBe(true);

        const status = getPassStatuses()['cabin-composite'];
        expect(status?.state).toBe('failed');
        expect(status?.compilation?.[0]).toMatchObject({ type: 'error', lineNum: 2 });

        // A cabin is published, but a cabin pass that never compiled must not
        // claim the frame — cinema/snapshots keep their 2D latch.
        const cabinTexture = gpu.device.createTexture({ size: [4, 4], format: 'rgba8unorm', usage: 0 });
        publishCabinOverlaySource({ getTexture: () => cabinTexture });
        expect(renderer.isCabinCompositedInFrame()).toBe(false);

        renderOneFrame(renderer);
        expect(lastFramePipelines()).toEqual(['streetview-pipeline', 'weather-post-pipeline']);
        expect(gpu.submits).toBeGreaterThan(0);
        renderer.destroy();
    });

    it('a broken weather-post.wgsl presents pass 1 through the ACES fallback instead of failing boot', async () => {
        serveShaders(['weather-post.wgsl']);
        const renderer = new Renderer(canvas());
        expect(await renderer.init()).toBe(true);

        expect(getPassStatuses().weather?.state).toBe('failed');
        expect(getPassStatuses()['present-fallback']).toEqual({ state: 'ready' });

        renderOneFrame(renderer);
        expect(lastFramePipelines()).toEqual(['streetview-pipeline', 'present-fallback-pipeline']);
        renderer.destroy();
    });

    it('a broken historical-wipe.wgsl leaves year hops on the crossfade', async () => {
        serveShaders(['historical-wipe.wgsl']);
        const renderer = new Renderer(canvas());
        expect(await renderer.init()).toBe(true);
        expect(getPassStatuses()['historical-wipe']?.state).toBe('failed');
        expect(renderer.beginHistoricalWipe(1)).toBe(false);
        renderer.destroy();
    });

    it('a broken streetview.wgsl fails boot at stage "pipeline" and destroys the device', async () => {
        serveShaders(['streetview.wgsl']);
        const renderer = new Renderer(canvas());
        expect(await renderer.init()).toBe(false);
        expect(getPassStatuses().streetview?.state).toBe('failed');
        expect(boot.publishBootFailure).toHaveBeenCalledWith({}, 'pipeline', expect.stringContaining('streetview'));
        expect(destroyDevice).toHaveBeenCalledTimes(1);
        expect(renderer.getSharedGpuDevice()).toBeUndefined();
    });
});

describe('device loss', () => {
    const lost = (reason: GPUDeviceLostReason): GPUDeviceLostInfo =>
        ({ reason, message: reason }) as GPUDeviceLostInfo;

    it('the loss of a device we destroyed after a failed init is never reported (no re-init loop)', async () => {
        serveShaders(['streetview.wgsl']);
        const onLost = vi.fn();
        const renderer = new Renderer(canvas());
        expect(await renderer.init({ onLost })).toBe(false);
        // createStreetViewRenderer destroys a failed renderer again; then the
        // destroyed device's `lost` promise resolves.
        renderer.destroy();
        lastBoot!.onDeviceLost(lost('destroyed'));
        expect(onLost).not.toHaveBeenCalled();
    });

    it('an intentional destroy() of a healthy renderer is not reported either', async () => {
        serveShaders();
        const onLost = vi.fn();
        const renderer = new Renderer(canvas());
        expect(await renderer.init({ onLost })).toBe(true);
        renderer.destroy();
        lastBoot!.onDeviceLost(lost('destroyed'));
        expect(onLost).not.toHaveBeenCalled();
    });

    it('a genuine loss is reported once, and tears down without touching the dead device', async () => {
        serveShaders();
        const onLost = vi.fn();
        const renderer = new Renderer(canvas());
        expect(await renderer.init({ onLost })).toBe(true);
        lastBoot!.onDeviceLost(lost('unknown'));
        expect(onLost).toHaveBeenCalledTimes(1);
        expect(destroyDevice).not.toHaveBeenCalled();
        expect(renderer.getSharedGpuDevice()).toBeUndefined();
        // The owner's cleanup destroy() afterwards is a no-op and reports nothing new.
        renderer.destroy();
        lastBoot!.onDeviceLost(lost('unknown'));
        expect(onLost).toHaveBeenCalledTimes(1);
    });
});
