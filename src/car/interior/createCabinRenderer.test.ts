import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { GPUPerformanceProfile } from '../../utils/performance';

const webglInstances: Array<Record<string, unknown>> = [];
const webgpuInstances: Array<Record<string, unknown>> = [];

function fakeRenderer(extra: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        domElement: { style: {} },
        setClearColor: vi.fn(),
        autoClear: false,
        toneMapping: 0,
        toneMappingExposure: 1,
        outputColorSpace: '',
        ...extra,
    };
}

vi.mock('three', async (importOriginal) => {
    const actual = await importOriginal<typeof import('three')>();
    return {
        ...actual,
        WebGLRenderer: vi.fn().mockImplementation((opts: unknown) => {
            const instance = fakeRenderer({ opts, isWebGLRenderer: true });
            webglInstances.push(instance);
            return instance;
        }),
    };
});

vi.mock('three/webgpu', () => ({
    WebGPURenderer: vi.fn().mockImplementation((opts: unknown) => {
        const instance = fakeRenderer({
            opts,
            isWebGPURenderer: true,
            init: vi.fn().mockResolvedValue(undefined),
        });
        webgpuInstances.push(instance);
        return instance;
    }),
}));

import {
    createCabinRenderer,
    isWebGPUCabinRenderer,
    preloadWebGPUCabinRenderer,
    resolveCabinRendererPreference,
} from './createCabinRenderer';

const GPU_PROFILE: GPUPerformanceProfile = {
    name: 'high',
    pixelRatio: 2,
    shadowMapSize: 1024,
    antialias: true,
    maxTextureSize: 2048,
    lodDistance: [10, 20, 30],
};

const FAKE_DEVICE = {} as GPUDevice;

beforeEach(() => {
    webglInstances.length = 0;
    webgpuInstances.length = 0;
    vi.clearAllMocks();
});

describe('resolveCabinRendererPreference', () => {
    it('defaults to webgl with no query string', () => {
        expect(resolveCabinRendererPreference('')).toBe('webgl');
    });

    it('defaults to webgl for an unrelated query string', () => {
        expect(resolveCabinRendererPreference('?renderer=webgpu&hdr=1')).toBe('webgl');
    });

    it('stays on webgl for a near-miss cabin value', () => {
        expect(resolveCabinRendererPreference('?cabin=WEBGPU')).toBe('webgl');
        expect(resolveCabinRendererPreference('?cabin=webgl')).toBe('webgl');
    });

    it('selects webgpu only for the exact ?cabin=webgpu flag', () => {
        expect(resolveCabinRendererPreference('?cabin=webgpu')).toBe('webgpu');
        expect(resolveCabinRendererPreference('?other=1&cabin=webgpu')).toBe('webgpu');
    });
});

describe('isWebGPUCabinRenderer', () => {
    it('distinguishes the two backends by the isWebGPURenderer marker', () => {
        expect(isWebGPUCabinRenderer(fakeRenderer({ isWebGPURenderer: true }) as never)).toBe(true);
        expect(isWebGPUCabinRenderer(fakeRenderer() as never)).toBe(false);
    });
});

describe('createCabinRenderer', () => {
    it('builds the classic WebGL renderer by default, never touching WebGPURenderer', () => {
        const handle = createCabinRenderer({ gpuProfile: GPU_PROFILE, search: '' });

        expect(handle.backend).toBe('webgl');
        expect(handle.isReady()).toBe(true);
        expect(webglInstances).toHaveLength(1);
        expect(webgpuInstances).toHaveLength(0);
    });

    it('never calls into three/webgpu when ?cabin=webgpu is absent, even with a shared device available', () => {
        createCabinRenderer({ gpuProfile: GPU_PROFILE, search: '', sharedDevice: FAKE_DEVICE });

        expect(webglInstances).toHaveLength(1);
        expect(webgpuInstances).toHaveLength(0);
    });

    // Must run before any test below calls preloadWebGPUCabinRenderer() — the
    // resolved class is cached at module scope for the session, matching
    // production (load once, reuse), so once preloaded it stays preloaded.
    it('falls back to WebGL when ?cabin=webgpu is requested but the WebGPU module has not been preloaded yet', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        const handle = createCabinRenderer({
            gpuProfile: GPU_PROFILE,
            search: '?cabin=webgpu',
            sharedDevice: FAKE_DEVICE,
        });

        expect(handle.backend).toBe('webgl');
        expect(webglInstances).toHaveLength(1);
        expect(webgpuInstances).toHaveLength(0);
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('has not finished loading'));

        warnSpy.mockRestore();
    });

    it('falls back to WebGL when ?cabin=webgpu is requested but no shared device is available', async () => {
        await preloadWebGPUCabinRenderer();
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        const handle = createCabinRenderer({ gpuProfile: GPU_PROFILE, search: '?cabin=webgpu' });

        expect(handle.backend).toBe('webgl');
        expect(webglInstances).toHaveLength(1);
        expect(webgpuInstances).toHaveLength(0);
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('no shared GPUDevice'));

        warnSpy.mockRestore();
    });

    it('adopts the shared GPUDevice via WebGPURenderer once preloaded, never requesting its own device', async () => {
        await preloadWebGPUCabinRenderer();

        const handle = createCabinRenderer({
            gpuProfile: GPU_PROFILE,
            search: '?cabin=webgpu',
            sharedDevice: FAKE_DEVICE,
        });

        expect(handle.backend).toBe('webgpu');
        expect(webgpuInstances).toHaveLength(1);
        expect(webglInstances).toHaveLength(0);
        expect(webgpuInstances[0]!.opts).toMatchObject({ device: FAKE_DEVICE, forceWebGL: false });
    });

    it('starts not-ready and flips ready once the async WebGPURenderer init resolves', async () => {
        await preloadWebGPUCabinRenderer();

        const handle = createCabinRenderer({
            gpuProfile: GPU_PROFILE,
            search: '?cabin=webgpu',
            sharedDevice: FAKE_DEVICE,
        });

        expect(handle.isReady()).toBe(false);

        // Flush the mocked renderer.init() promise chain.
        await Promise.resolve();
        await Promise.resolve();

        expect(handle.isReady()).toBe(true);
    });
});

describe('preloadWebGPUCabinRenderer', () => {
    it('resolves cleanly and is safe to call more than once', async () => {
        await expect(preloadWebGPUCabinRenderer()).resolves.toBeUndefined();
        await expect(preloadWebGPUCabinRenderer()).resolves.toBeUndefined();
    });
});
