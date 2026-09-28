import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { GPUPerformanceProfile } from '../../utils/performance';
import * as THREE from 'three';

const webglInstances: Array<Record<string, unknown>> = [];
const webgpuInstances: Array<Record<string, unknown>> = [];

function fakeRenderer(extra: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        domElement: { style: {} },
        setClearColor: vi.fn(),
        autoClear: false,
        toneMapping: -1,
        toneMappingExposure: 1,
        outputColorSpace: '',
        dispose: vi.fn(),
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
    PMREMGenerator: vi.fn(),
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

vi.mock('./cabinTslMaterials', () => ({
    cabinTslApi: {
        createVanityMirrorMaterial: vi.fn(),
        createRearviewMirrorMaterial: vi.fn(),
        createWindowWeatherOverlayMaterial: vi.fn(),
        createCupLiquidMaterial: vi.fn(),
        createDashboardGlowMaterial: vi.fn(),
    },
}));

import {
    createCabinRenderer,
    createCabinRendererAsync,
    isWebGPUCabinRenderer,
    preloadWebGPUCabinRenderer,
    resetWebGPUCabinRendererForTests,
    resolveCabinRendererPreference,
    resolveCabinOutputColorSpace,
} from './createCabinRenderer';
import {
    getWindshieldPortalSupport,
    resetWindshieldPortalSupportForTests,
} from './windshieldPortalSupport';

const GPU_PROFILE: GPUPerformanceProfile = {
    name: 'high',
    maxPixelRatio: 2,
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
    resetWebGPUCabinRendererForTests();
    resetWindshieldPortalSupportForTests();
    delete (window as Window & { webgpuProbe?: unknown }).webgpuProbe;
    delete (window as Window & { __CABIN_RENDERER_PROBE__?: unknown }).__CABIN_RENDERER_PROBE__;
});

describe('resolveCabinRendererPreference', () => {
    it('defaults to webgl when the boot probe is not ok', () => {
        expect(resolveCabinRendererPreference('', false)).toBe('webgl');
        expect(resolveCabinRendererPreference('?renderer=webgpu&hdr=1', false)).toBe('webgl');
    });

    it('defaults to webgpu on a capable probe', () => {
        expect(resolveCabinRendererPreference('', true)).toBe('webgpu');
        expect(resolveCabinRendererPreference('?hdr=1', true)).toBe('webgpu');
    });

    it('treats ?cabin=webgl as the explicit WebGL hatch', () => {
        expect(resolveCabinRendererPreference('?cabin=webgl', true)).toBe('webgl');
        expect(resolveCabinRendererPreference('?cabin=webgl', false)).toBe('webgl');
    });

    it('treats ?cabin=webgpu as an explicit WebGPU request', () => {
        expect(resolveCabinRendererPreference('?cabin=webgpu', false)).toBe('webgpu');
        expect(resolveCabinRendererPreference('?other=1&cabin=webgpu', true)).toBe('webgpu');
    });

    it('ignores a near-miss cabin value and follows the probe', () => {
        expect(resolveCabinRendererPreference('?cabin=WEBGPU', true)).toBe('webgpu');
        expect(resolveCabinRendererPreference('?cabin=WEBGPU', false)).toBe('webgl');
    });
});

describe('resolveCabinOutputColorSpace', () => {
    it('stays sRGB without a p3 flag', () => {
        expect(resolveCabinOutputColorSpace('')).toBe(THREE.SRGBColorSpace);
        expect(resolveCabinOutputColorSpace('?hdr=1')).toBe(THREE.SRGBColorSpace);
    });

    it('follows ?p3=1 as display-p3 (output-referred, not a second ACES)', () => {
        expect(resolveCabinOutputColorSpace('?p3=1')).toBe('display-p3');
    });
});

describe('isWebGPUCabinRenderer', () => {
    it('distinguishes the two backends by the isWebGPURenderer marker', () => {
        expect(isWebGPUCabinRenderer(fakeRenderer({ isWebGPURenderer: true }) as never)).toBe(true);
        expect(isWebGPUCabinRenderer(fakeRenderer() as never)).toBe(false);
    });
});

describe('createCabinRenderer', () => {
    it('builds the WebGL overlay when the probe is not ok, even with a shared device', () => {
        const handle = createCabinRenderer({
            gpuProfile: GPU_PROFILE,
            search: '',
            sharedDevice: FAKE_DEVICE,
            probeOk: false,
        });

        expect(handle.backend).toBe('webgl');
        expect(handle.isReady()).toBe(true);
        expect(webglInstances).toHaveLength(1);
        expect(webgpuInstances).toHaveLength(0);
        expect(webglInstances[0]!.toneMapping).toBe(THREE.ACESFilmicToneMapping);
    });

    it('falls back to WebGL when default WebGPU is wanted but the module has not been preloaded yet', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        const handle = createCabinRenderer({
            gpuProfile: GPU_PROFILE,
            search: '',
            sharedDevice: FAKE_DEVICE,
            probeOk: true,
        });

        expect(handle.backend).toBe('webgl');
        expect(webglInstances).toHaveLength(1);
        expect(webgpuInstances).toHaveLength(0);
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('has not finished loading'));

        warnSpy.mockRestore();
    });

    it('falls back to WebGL when TSL twins are missing so ShaderMaterial cannot run on WebGPU', async () => {
        await preloadWebGPUCabinRenderer();
        const { setCabinTslApi } = await import('./cabinTslRegistry');
        setCabinTslApi(undefined);
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        const handle = createCabinRenderer({
            gpuProfile: GPU_PROFILE,
            search: '',
            sharedDevice: FAKE_DEVICE,
            probeOk: true,
        });

        expect(handle.backend).toBe('webgl');
        expect(webglInstances).toHaveLength(1);
        expect(webgpuInstances).toHaveLength(0);
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('has not finished loading'));

        warnSpy.mockRestore();
    });

    it('falls back to WebGL when WebGPU is wanted but no shared device is available', async () => {
        await preloadWebGPUCabinRenderer();
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        const handle = createCabinRenderer({
            gpuProfile: GPU_PROFILE,
            search: '?cabin=webgpu',
            probeOk: true,
        });

        expect(handle.backend).toBe('webgl');
        expect(webglInstances).toHaveLength(1);
        expect(webgpuInstances).toHaveLength(0);
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('no shared GPUDevice'));

        warnSpy.mockRestore();
    });

    it('adopts the shared GPUDevice by default once preloaded on a capable probe', async () => {
        await preloadWebGPUCabinRenderer();

        const handle = createCabinRenderer({
            gpuProfile: GPU_PROFILE,
            search: '',
            sharedDevice: FAKE_DEVICE,
            probeOk: true,
        });

        expect(handle.backend).toBe('webgpu');
        expect(webgpuInstances).toHaveLength(1);
        expect(webglInstances).toHaveLength(0);
        expect(webgpuInstances[0]!.opts).toMatchObject({ device: FAKE_DEVICE, forceWebGL: false });
        expect(webgpuInstances[0]!.toneMapping).toBe(THREE.NoToneMapping);
        expect(webgpuInstances[0]!.outputColorSpace).toBe(THREE.SRGBColorSpace);
    });

    it('keeps ?cabin=webgl on WebGL even when the probe and device are ready', async () => {
        await preloadWebGPUCabinRenderer();

        const handle = createCabinRenderer({
            gpuProfile: GPU_PROFILE,
            search: '?cabin=webgl',
            sharedDevice: FAKE_DEVICE,
            probeOk: true,
        });

        expect(handle.backend).toBe('webgl');
        expect(webglInstances).toHaveLength(1);
        expect(webgpuInstances).toHaveLength(0);
    });

    it('starts not-ready and flips ready once the async WebGPURenderer init resolves', async () => {
        await preloadWebGPUCabinRenderer();

        const handle = createCabinRenderer({
            gpuProfile: GPU_PROFILE,
            search: '',
            sharedDevice: FAKE_DEVICE,
            probeOk: true,
        });

        expect(handle.isReady()).toBe(false);

        await handle.whenReady;

        expect(handle.isReady()).toBe(true);
    });
});

describe('createCabinRendererAsync', () => {
    it('falls back to WebGL when WebGPURenderer.init rejects, without a second requestDevice', async () => {
        await preloadWebGPUCabinRenderer();
        const { WebGPURenderer } = await import('three/webgpu');
        vi.mocked(WebGPURenderer).mockImplementationOnce((opts: unknown) => {
            const instance = fakeRenderer({
                opts,
                isWebGPURenderer: true,
                init: vi.fn().mockRejectedValue(new Error('init boom')),
            });
            webgpuInstances.push(instance);
            return instance as never;
        });
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        const handle = await createCabinRendererAsync({
            gpuProfile: GPU_PROFILE,
            search: '',
            sharedDevice: FAKE_DEVICE,
            probeOk: true,
        });

        expect(handle.backend).toBe('webgl');
        expect(handle.isReady()).toBe(true);
        expect(webgpuInstances).toHaveLength(1);
        expect(webglInstances).toHaveLength(1);
        expect(webgpuInstances[0]!.dispose).toHaveBeenCalled();
        expect(window.__CABIN_RENDERER_PROBE__?.initFailed).toBe(true);
        expect(window.__CABIN_RENDERER_PROBE__?.backend).toBe('webgl');

        warnSpy.mockRestore();
    });
});

describe('preloadWebGPUCabinRenderer', () => {
    it('resolves cleanly and is safe to call more than once', async () => {
        await expect(preloadWebGPUCabinRenderer()).resolves.toBeUndefined();
        await expect(preloadWebGPUCabinRenderer()).resolves.toBeUndefined();
    });
});

describe('windshield portal support follows the cabin backend', () => {
    const CLIP_DEVICE = { features: new Set(['clip-distances']) } as unknown as GPUDevice;
    const NO_CLIP_DEVICE = { features: new Set(['float32-filterable']) } as unknown as GPUDevice;

    it('is enabled on the shared WebGPU device when it has clip-distances', async () => {
        await preloadWebGPUCabinRenderer();
        createCabinRenderer({ gpuProfile: GPU_PROFILE, search: '', sharedDevice: CLIP_DEVICE, probeOk: true });

        expect(getWindshieldPortalSupport()).toMatchObject({ enabled: true, clipDistances: true });
        // The gate remembers the device the cabin adopted, so the portal can refuse a road frame from another.
        expect(getWindshieldPortalSupport().device).toBe(CLIP_DEVICE);
        expect(window.__CABIN_RENDERER_PROBE__?.portal).toMatchObject({ active: false, clipDistances: true });
    });

    it('falls back — with the reason on the probe — when the device has no clip-distances', async () => {
        await preloadWebGPUCabinRenderer();
        createCabinRenderer({ gpuProfile: GPU_PROFILE, search: '', sharedDevice: NO_CLIP_DEVICE, probeOk: true });

        expect(getWindshieldPortalSupport().enabled).toBe(false);
        expect(window.__CABIN_RENDERER_PROBE__?.backend).toBe('webgpu');
        expect(window.__CABIN_RENDERER_PROBE__?.portal?.clipDistances).toBe(false);
        expect(window.__CABIN_RENDERER_PROBE__?.portal?.reason).toMatch(/clip-distances/);
    });

    it('honours ?portal=off even when everything is available', async () => {
        await preloadWebGPUCabinRenderer();
        createCabinRenderer({
            gpuProfile: GPU_PROFILE,
            search: '?portal=off',
            sharedDevice: CLIP_DEVICE,
            probeOk: true,
        });

        expect(getWindshieldPortalSupport().enabled).toBe(false);
        expect(getWindshieldPortalSupport().clipDistances).toBe(true);
        expect(window.__CABIN_RENDERER_PROBE__?.portal?.reason).toMatch(/portal=off/);
    });

    it('is off on the ?cabin=webgl hatch — the WebGL cabin cannot bind the road texture', async () => {
        await preloadWebGPUCabinRenderer();
        createCabinRenderer({
            gpuProfile: GPU_PROFILE,
            search: '?cabin=webgl',
            sharedDevice: CLIP_DEVICE,
            probeOk: true,
        });

        expect(getWindshieldPortalSupport().enabled).toBe(false);
        expect(window.__CABIN_RENDERER_PROBE__?.portal?.reason).toMatch(/WebGL/);
    });

    it('turns back off when a failed WebGPU init falls back to the WebGL cabin', async () => {
        await preloadWebGPUCabinRenderer();
        const { WebGPURenderer } = await import('three/webgpu');
        vi.mocked(WebGPURenderer).mockImplementationOnce((opts: unknown) => {
            const instance = fakeRenderer({
                opts,
                isWebGPURenderer: true,
                init: vi.fn().mockRejectedValue(new Error('init boom')),
            });
            webgpuInstances.push(instance);
            return instance as never;
        });
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        const handle = await createCabinRendererAsync({
            gpuProfile: GPU_PROFILE,
            search: '',
            sharedDevice: CLIP_DEVICE,
            probeOk: true,
        });

        // The device still has clip-distances, but the cabin that would bind the road texture is gone.
        expect(handle.backend).toBe('webgl');
        expect(getWindshieldPortalSupport().enabled).toBe(false);
        expect(getWindshieldPortalSupport().reason).toMatch(/WebGL/);

        warnSpy.mockRestore();
    });

    it('keeps the portal verdict on the probe when the async WebGPU init succeeds', async () => {
        // `createCabinRendererAsync` republishes the probe once the renderer is ready; that
        // must not drop what `noteHandle` said, or a cabin that never builds a weather layer
        // (quality low) would leave the probe silent about why the portal is off.
        await preloadWebGPUCabinRenderer();
        await createCabinRendererAsync({
            gpuProfile: GPU_PROFILE,
            search: '',
            sharedDevice: NO_CLIP_DEVICE,
            probeOk: true,
        });
        const probe = window.__CABIN_RENDERER_PROBE__;
        expect(probe?.ready).toBe(true);
        expect(probe?.backend).toBe('webgpu');
        expect(probe?.portal?.reason).toMatch(/clip-distances/);
    });

    it('is off when no shared device is available', async () => {
        await preloadWebGPUCabinRenderer();
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        createCabinRenderer({ gpuProfile: GPU_PROFILE, search: '?cabin=webgpu', probeOk: true });
        expect(getWindshieldPortalSupport().enabled).toBe(false);
        warnSpy.mockRestore();
    });
});
