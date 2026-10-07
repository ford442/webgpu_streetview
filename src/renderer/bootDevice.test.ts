/**
 * `bootDevice` against a fake `navigator.gpu`: context before device, no
 * leaked device on a post-device failure, and no `onDeviceLost` for a device
 * it destroyed itself.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bootDevice } from './bootDevice';
import { installGpuGlobals } from './computeWeather/__tests__/fakeGpu';

interface FakeBoot {
    requestAdapter: ReturnType<typeof vi.fn>;
    requestDevice: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
    unconfigure: ReturnType<typeof vi.fn>;
    resolveLost: (info: Partial<GPUDeviceLostInfo>) => void;
    canvas: HTMLCanvasElement;
}

function installFakeGpu(opts: {
    context?: boolean;
    computePipelineError?: string;
    configureThrows?: boolean;
} = {}): FakeBoot {
    let resolveLost!: (info: GPUDeviceLostInfo) => void;
    const lost = new Promise<GPUDeviceLostInfo>((r) => { resolveLost = r; });
    const destroy = vi.fn(() => resolveLost({ reason: 'destroyed', message: '' } as GPUDeviceLostInfo));
    const device = {
        label: '',
        queue: { label: '', onSubmittedWorkDone: async () => undefined },
        features: new Set<string>(),
        limits: { maxTextureDimension2D: 8192 },
        lost,
        destroy,
        addEventListener: vi.fn(),
        createShaderModule: () => ({ getCompilationInfo: async () => ({ messages: [] }) }),
        createComputePipelineAsync: async () => {
            if (opts.computePipelineError) throw new Error(opts.computePipelineError);
            return {};
        },
    };
    const requestDevice = vi.fn(async () => device);
    const adapter = {
        limits: {
            maxTextureDimension2D: 8192,
            maxStorageBufferBindingSize: 1 << 27,
            maxBufferSize: 1 << 28,
            maxComputeWorkgroupSizeX: 256,
            maxComputeWorkgroupSizeY: 256,
            maxComputeInvocationsPerWorkgroup: 256,
        },
        features: { has: () => false },
        requestDevice,
    };
    const requestAdapter = vi.fn(async () => adapter);
    vi.stubGlobal('navigator', {
        ...navigator,
        gpu: { requestAdapter, getPreferredCanvasFormat: () => 'bgra8unorm' },
    });
    const unconfigure = vi.fn();
    const context = {
        configure: vi.fn(() => {
            if (opts.configureThrows) throw new Error('configure rejected');
        }),
        unconfigure,
    };
    const canvas = document.createElement('canvas');
    vi.spyOn(canvas, 'getContext').mockImplementation(
        (() => (opts.context === false ? null : context)) as unknown as HTMLCanvasElement['getContext'],
    );
    return {
        requestAdapter,
        requestDevice,
        destroy,
        unconfigure,
        resolveLost: (info) => resolveLost({ reason: 'unknown', message: '', ...info } as GPUDeviceLostInfo),
        canvas,
    };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('bootDevice', () => {
    beforeEach(() => {
        installGpuGlobals();
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        vi.spyOn(console, 'info').mockImplementation(() => undefined);
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
    });
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('acquires the canvas context before asking for an adapter or a device', async () => {
        const gpu = installFakeGpu({ context: false });
        const result = await bootDevice({ canvas: gpu.canvas, weatherPostProcessMode: 'fragment', onDeviceLost: vi.fn() });
        expect(result).toEqual({ ok: false, reason: 'Could not acquire a WebGPU canvas context' });
        expect(gpu.requestAdapter).not.toHaveBeenCalled();
        expect(gpu.requestDevice).not.toHaveBeenCalled();
    });

    it('a failed compute probe destroys the device here, and that loss is never reported', async () => {
        const gpu = installFakeGpu({ computePipelineError: 'backend cannot compile compute' });
        const onDeviceLost = vi.fn();
        const result = await bootDevice({ canvas: gpu.canvas, weatherPostProcessMode: 'fragment', onDeviceLost });
        expect(result.ok).toBe(false);
        expect(result.ok === false && result.reason).toContain('backend cannot compile compute');
        expect(gpu.destroy).toHaveBeenCalledTimes(1);
        expect(gpu.unconfigure).toHaveBeenCalled();
        await flush();
        expect(onDeviceLost).not.toHaveBeenCalled();
        expect(window.webgpuProbe?.stage).toBe('compute');
    });

    it('a swap chain that cannot be configured at all destroys the device', async () => {
        const gpu = installFakeGpu({ configureThrows: true });
        const onDeviceLost = vi.fn();
        const result = await bootDevice({ canvas: gpu.canvas, weatherPostProcessMode: 'fragment', onDeviceLost });
        expect(result.ok).toBe(false);
        expect(gpu.destroy).toHaveBeenCalledTimes(1);
        await flush();
        expect(onDeviceLost).not.toHaveBeenCalled();
    });

    it('requests the adapter texture limit and forwards a genuine loss', async () => {
        const gpu = installFakeGpu();
        const onDeviceLost = vi.fn();
        const result = await bootDevice({ canvas: gpu.canvas, weatherPostProcessMode: 'fragment', onDeviceLost });
        expect(result.ok).toBe(true);
        expect(gpu.requestDevice.mock.calls[0]![0].requiredLimits.maxTextureDimension2D).toBe(8192);
        gpu.resolveLost({ reason: 'unknown', message: 'GPU process crashed' });
        await flush();
        expect(onDeviceLost).toHaveBeenCalledWith(expect.objectContaining({ reason: 'unknown' }));
    });
});
