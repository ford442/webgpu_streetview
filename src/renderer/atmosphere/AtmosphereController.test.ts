// @vitest-environment jsdom
/**
 * The atmosphere pass against the fake device: what it builds, that it
 * encodes only on change (not per frame), and the uniform block it uploads
 * (the C++ params verbatim + the sun). The LUT *values* are checked on a real
 * device against the C++ reference in e2e/atmosphere.spec.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeGpu, installGpuGlobals, installShaderFetch, type FakeGpu } from '../computeWeather/__tests__/fakeGpu';
import { requireWasm } from '../../wasm';
import { AtmosphereController } from './AtmosphereController';
import { AtmosphereLayer } from './AtmosphereLayer';
import { ATMOSPHERE_LUT_SIZES, ATMOSPHERE_UNIFORM_FLOAT_COUNT, AtmosphereUniformIndex as U } from './atmosphereLayout';
import { createAtmosphereOptions, type AtmosphereOptions } from './atmosphereOptions';
import { getAtmosphereStats, resetAtmosphereStats } from './atmosphereStatsStore';

const deg = (d: number) => (d * Math.PI) / 180;

function options(patch: Partial<AtmosphereOptions> = {}): AtmosphereOptions {
    return { ...createAtmosphereOptions(), enabled: true, sunAltitude: deg(20), ...patch };
}

/** One frame: encode if the pass is enabled, return the compute passes it recorded. */
function frame(gpu: FakeGpu, controller: AtmosphereController) {
    const encoder = gpu.createCommandEncoder();
    if (controller.pass.enabled()) controller.pass.encode(encoder);
    return gpu.lastEncoder().passes.filter((p) => p.type === 'compute');
}

let gpu: FakeGpu;

beforeEach(() => {
    installGpuGlobals();
    installShaderFetch();
    resetAtmosphereStats();
    gpu = createFakeGpu();
});

describe('AtmosphereController', () => {
    it('builds four pipelines and four rgba16float LUTs at the documented sizes', async () => {
        const controller = new AtmosphereController({ device: gpu.device });
        await controller.pass.init();
        expect(gpu.computePipelines.map((p) => p.entryPoint).sort())
            .toEqual(['aerial_lut', 'multiscatter_lut', 'skyview_lut', 'transmittance_lut']);
        const luts = controller.getLuts()!;
        const size = (t: GPUTexture) => {
            const s = (t as unknown as { descriptor: GPUTextureDescriptor }).descriptor.size as GPUExtent3DDict;
            return [s.width, s.height, s.depthOrArrayLayers ?? 1];
        };
        expect(size(luts.transmittance)).toEqual([...ATMOSPHERE_LUT_SIZES.transmittance, 1]);
        expect(size(luts.multiscatter)).toEqual([...ATMOSPHERE_LUT_SIZES.multiscatter, 1]);
        expect(size(luts.skyview)).toEqual([...ATMOSPHERE_LUT_SIZES.skyview, 1]);
        expect(size(luts.aerial)).toEqual([...ATMOSPHERE_LUT_SIZES.aerial]);
        for (const t of Object.values(luts)) {
            expect((t as unknown as { descriptor: GPUTextureDescriptor }).descriptor.format).toBe('rgba16float');
        }
    });

    it('encodes nothing while disabled', async () => {
        const controller = new AtmosphereController({ device: gpu.device });
        await controller.pass.init();
        controller.setOptions(options({ enabled: false }));
        expect(frame(gpu, controller)).toHaveLength(0);
        expect(gpu.writeBufferCalls).toHaveLength(0);
    });

    it('builds all four LUTs once, then nothing for a still sun', async () => {
        const controller = new AtmosphereController({ device: gpu.device });
        await controller.pass.init();
        controller.setOptions(options());
        const first = frame(gpu, controller);
        expect(first).toHaveLength(1);
        expect(first[0]!.dispatches).toEqual([[32, 8], [4, 4], [24, 14], [4, 4]]);
        for (let i = 0; i < 10; i++) expect(frame(gpu, controller)).toHaveLength(0);
        expect(controller.getBuildCounts()).toEqual({ medium: 1, sun: 0 });
        expect(gpu.writeBufferCalls).toHaveLength(1);
    });

    it('rebuilds sky view + aerial only when the sun moves past 0.1°', async () => {
        const controller = new AtmosphereController({ device: gpu.device });
        await controller.pass.init();
        controller.setOptions(options());
        frame(gpu, controller);
        controller.setOptions(options({ sunAltitude: deg(20.05) }));
        expect(frame(gpu, controller)).toHaveLength(0);
        controller.setOptions(options({ sunAltitude: deg(20.2) }));
        const passes = frame(gpu, controller);
        expect(passes[0]!.dispatches).toEqual([[24, 14], [4, 4]]);
        expect(controller.getBuildCounts()).toEqual({ medium: 1, sun: 1 });
    });

    it('rebuilds everything when the live visibility changes', async () => {
        const controller = new AtmosphereController({ device: gpu.device });
        await controller.pass.init();
        controller.setOptions(options());
        frame(gpu, controller);
        controller.setOptions(options({ visibilityM: 5000 }));
        expect(frame(gpu, controller)[0]!.dispatches).toHaveLength(4);
        expect(controller.getBuildCounts()).toEqual({ medium: 2, sun: 0 });
    });

    it('uploads the C++ params block verbatim, then the sun and the observer', async () => {
        const controller = new AtmosphereController({ device: gpu.device });
        await controller.pass.init();
        controller.setOptions(options({ visibilityM: 8000, sunAltitude: deg(30) }));
        frame(gpu, controller);
        const data = gpu.writeBufferCalls[0]!.data as Float32Array;
        expect(data.length).toBe(ATMOSPHERE_UNIFORM_FLOAT_COUNT);
        const medium = requireWasm().atmoParams(8000, 0.3);
        expect(Array.from(data.subarray(0, medium.length))).toEqual(Array.from(medium));
        expect(data[U.sinSunElevation]).toBeCloseTo(0.5, 6);
        expect(data[U.cosSunElevation]).toBeCloseTo(Math.sqrt(3) / 2, 6);
        expect(data[U.sunIlluminance]).toBe(1);
        expect(data[U.observerAltitudeKm]).toBe(0);
        expect(data[U.aerialMaxKm]).toBe(32);
    });

    it('publishes the build on window.__ATMOSPHERE__ with the CPU sun colour', async () => {
        const controller = new AtmosphereController({ device: gpu.device });
        await controller.pass.init();
        controller.setOptions(options({ sunAltitude: deg(30) }));
        frame(gpu, controller);
        const stats = getAtmosphereStats();
        expect(window.__ATMOSPHERE__).toEqual(stats);
        expect(stats).toMatchObject({ state: 'ready', mediumBuilds: 1, visibilityKm: 23 });
        expect(stats.sunElevationDeg).toBeCloseTo(30, 4);
        const params = requireWasm().atmoParams(null, 0.3);
        const expected = requireWasm().atmoSunColor(params, Math.sin(deg(30)), 0);
        stats.sunColor!.forEach((c, i) => expect(c).toBeCloseTo(expected[i]!, 6));
    });

    it('fails init (and frees what it made) when the shader cannot load', async () => {
        (globalThis as Record<string, unknown>).fetch = async () => ({
            ok: false, status: 404, statusText: 'Not Found', text: async () => '',
        });
        const onFailed = vi.fn();
        const controller = new AtmosphereController({ device: gpu.device, onFailed });
        await expect(controller.pass.init()).rejects.toThrow(/atmosphere\.wgsl/);
        expect(onFailed).toHaveBeenCalledOnce();
        expect(getAtmosphereStats().state).toBe('failed');
        controller.setOptions(options());
        expect(controller.pass.enabled()).toBe(false);
    });

    it('dispose destroys the LUTs and stops encoding', async () => {
        const controller = new AtmosphereController({ device: gpu.device });
        await controller.pass.init();
        const luts = Object.values(controller.getLuts()!);
        controller.dispose();
        for (const t of luts) expect((t as unknown as { destroyed: boolean }).destroyed).toBe(true);
        controller.setOptions(options());
        expect(controller.pass.enabled()).toBe(false);
    });
});

describe('AtmosphereLayer', () => {
    it('does not import the controller chunk until the pass is initialised', async () => {
        const importController = vi.fn(() => import('./AtmosphereController'));
        const layer = new AtmosphereLayer({ device: gpu.device }, importController);
        expect(layer.pass).toMatchObject({ id: 'atmosphere', lazy: true });
        layer.setOptions(options());
        expect(layer.pass.enabled({} as never)).toBe(false);
        expect(importController).not.toHaveBeenCalled();
        await layer.pass.init();
        expect(importController).toHaveBeenCalledOnce();
        expect(layer.isInitialised()).toBe(true);
        // Options set before the load reach the controller.
        expect(layer.pass.enabled({} as never)).toBe(true);
        const encoder = gpu.createCommandEncoder();
        layer.pass.encode(encoder, {} as never);
        expect(layer.getBuildCounts()).toEqual({ medium: 1, sun: 0 });
        layer.dispose();
        expect(layer.getLuts()).toBeNull();
    });
});
