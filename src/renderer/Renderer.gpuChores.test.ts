// @vitest-environment jsdom
/**
 * #320 slice 0: a normal boot runs the GPU chores on the GPU.
 *
 * `GpuChores` decides its backend in its constructor from `isWebGpuProbeOk()`
 * and the limits verdict on the published capability matrix. `Renderer.init`
 * used to build it *before* `publishBootSuccess`, so the probe still read
 * `ok: false` and every boot quietly ran the chores (and everything that reuses
 * their readback) on WASM/JS. Here the real `GpuChores` and the real probe
 * publisher run against the recording fake device; only the GPU-facing
 * collaborators that need real WGSL are mocked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeGpu, installGpuGlobals, installShaderFetch } from './computeWeather/__tests__/fakeGpu';

const boot = vi.hoisted(() => ({ bootDevice: vi.fn() }));
vi.mock('./bootDevice', async (importOriginal) => ({
    ...(await importOriginal<typeof import('./bootDevice')>()),
    bootDevice: boot.bootDevice,
}));
vi.mock('./WeatherPostProcessor', () => ({
    WeatherPostProcessor: class {
        init = vi.fn().mockResolvedValue(undefined);
        dispose = vi.fn();
        updateWeatherBindGroup = vi.fn();
        setAuxDepth = vi.fn();
        renderPass = vi.fn();
        updateWeatherAnimation = vi.fn();
    },
}));
vi.mock('./TransitionManager', () => ({
    TransitionManager: class {
        init = vi.fn().mockResolvedValue(undefined);
        dispose = vi.fn();
        recordLastPan = vi.fn();
        previousFrame = undefined;
    },
}));
vi.mock('./streetViewPass', () => ({
    buildSamplerDescriptor: () => ({}),
    createStreetViewPipeline: async () => ({ getBindGroupLayout: () => ({}) }),
    encodeStreetViewPass: () => undefined,
}));
vi.mock('./cabinComposite', async (importOriginal) => ({
    ...(await importOriginal<typeof import('./cabinComposite')>()),
    CabinCompositePass: class {
        init = async () => undefined;
        dispose() {}
        setSource() {}
        isActive() {
            return false;
        }
    },
}));

import { Renderer } from './Renderer';
import { getGpuChoresStats, resetGpuChoresStats } from './gpuChores/gpuChoresStatsStore';

function primeBoot(
    device: GPUDevice,
    context: GPUCanvasContext,
    capabilityMatrix: Record<string, unknown> = { gpuChoresGpuEligible: true },
) {
    boot.bootDevice.mockResolvedValue({
        ok: true,
        device,
        context,
        presentationFormat: 'bgra8unorm',
        canvasOutputPolicy: { hdr: false, p3: false },
        intermediateFormat: 'rgba16float',
        capabilityMatrix: {},
        timestampQueriesAvailable: false,
        probe: {
            preference: 'auto',
            webglPreferenceDeferred: false,
            capabilityMatrix,
        },
    });
}

function canvas(): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 36;
    return c;
}

/** Let the background `ensureReady()` (shader fetch + pipeline create) settle. */
const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
    installGpuGlobals();
    installShaderFetch();
    resetGpuChoresStats();
    delete (window as Window & { webgpuProbe?: unknown }).webgpuProbe;
    window.history.replaceState(null, '', '/');
});

afterEach(() => {
    vi.clearAllMocks();
    window.history.replaceState(null, '', '/');
});

describe('Renderer boot → GPU chores backend', () => {
    it('a normal boot runs the chores on the shared device (backend "webgpu")', async () => {
        const gpu = createFakeGpu();
        primeBoot(gpu.device, gpu.context);
        const renderer = new Renderer(canvas());

        expect(await renderer.init()).toBe(true);
        expect(window.webgpuProbe?.ok).toBe(true);
        expect(renderer.getGpuChores()?.getDevice()).toBe(gpu.device);
        await settle();
        expect(getGpuChoresStats().backend).toBe('webgpu');
        expect(renderer.getGpuChores()?.currentBackend()).toBe('webgpu');
        // The chores' pipelines were really built on the shared device.
        expect(gpu.computePipelines.map((p) => p.entryPoint)).toEqual(
            expect.arrayContaining(['luma_histogram_bt709', 'downsample_2d']),
        );
        renderer.destroy();
    });

    it('?no_gpu_compute still keeps the chores off the GPU', async () => {
        window.history.replaceState(null, '', '/?no_gpu_compute');
        const gpu = createFakeGpu();
        primeBoot(gpu.device, gpu.context);
        const renderer = new Renderer(canvas());

        expect(await renderer.init()).toBe(true);
        await settle();
        expect(renderer.getGpuChores()?.getDevice()).toBeNull();
        expect(getGpuChoresStats().killSwitch).toBe(true);
        expect(getGpuChoresStats().backend).not.toBe('webgpu');
        renderer.destroy();
    });

    it('the adapter-limits gate still keeps the chores off the GPU', async () => {
        const gpu = createFakeGpu();
        primeBoot(gpu.device, gpu.context, {
            gpuChoresGpuEligible: false,
            gpuChoresIneligibleReason: 'test limits',
        });
        const renderer = new Renderer(canvas());

        expect(await renderer.init()).toBe(true);
        await settle();
        expect(renderer.getGpuChores()?.getDevice()).toBeNull();
        expect(getGpuChoresStats().backend).not.toBe('webgpu');
        renderer.destroy();
    });
});
