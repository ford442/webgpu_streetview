// @vitest-environment jsdom
/**
 * The year-chip wipe as the real `Renderer` encodes it: its "before" is the
 * hold-pause snapshot, it never runs while a hold is active, and nothing on its
 * path uploads the live Maps canvas.
 *
 * GPU-facing collaborators are fakes; `TextureLifecycle`,
 * `HoldTransitionController`, `TransitionManager` and `HistoricalWipePass` are
 * the real ones, so snapshot identity and hold behaviour are the shipped ones.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
    bindingTexture,
    createFakeGpu,
    installGpuGlobals,
    installShaderFetch,
    type FakeGpu,
    type RecordedBindGroup,
} from './computeWeather/__tests__/fakeGpu';

const boot = vi.hoisted(() => ({
    bootDevice: vi.fn(),
    publishBootSuccess: vi.fn(),
    publishBootFailure: vi.fn(),
}));
vi.mock('./bootDevice', () => boot);

const weatherStub = vi.hoisted(() => () => class {
    init = vi.fn().mockResolvedValue(undefined);
    dispose = vi.fn();
    updateWeatherBindGroup = vi.fn();
    updateWeatherParams = vi.fn();
    updateColorParams = vi.fn();
    setShaderEffects = vi.fn();
    renderWeatherOnly = vi.fn();
    renderPass = vi.fn();
    updateWeatherAnimation = vi.fn();
});
vi.mock('./WeatherPostProcessor', () => ({ WeatherPostProcessor: weatherStub() }));
vi.mock('./ComputeWeatherPostProcessor', () => ({ ComputeWeatherPostProcessor: weatherStub() }));
vi.mock('./streetViewPass', () => ({
    buildSamplerDescriptor: () => ({}),
    createStreetViewPipeline: async () => ({ kind: 'pass1Pipeline', getBindGroupLayout: () => ({}) }),
    // Records a pass so the wipe's position in the encode order is visible.
    encodeStreetViewPass: (encoder: GPUCommandEncoder) => {
        const pass = encoder.beginRenderPass({ colorAttachments: [] });
        pass.setPipeline({ kind: 'pass1Pipeline' } as unknown as GPURenderPipeline);
        pass.end();
    },
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
import { streetViewProbe } from '../utils/streetViewProbe';
import { resetRoadFrameSourceForTests } from './roadFrameRegistry';
import type { TextureLifecycle } from './textureLifecycle';
import type { TransitionManager } from './TransitionManager';

let gpu: FakeGpu;
let copyExternal: ReturnType<typeof vi.fn>;
let warnSpy: ReturnType<typeof vi.spyOn>;

function primeBoot() {
    gpu = createFakeGpu();
    copyExternal = vi.fn();
    (gpu.device.queue as unknown as Record<string, unknown>).copyExternalImageToTexture = copyExternal;
    boot.bootDevice.mockImplementation(async () => ({
        ok: true,
        device: gpu.device,
        context: gpu.context,
        presentationFormat: 'bgra8unorm',
        canvasOutputPolicy: { hdr: false, p3: false },
        intermediateFormat: 'rg11b10ufloat',
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

const internals = (r: Renderer) =>
    r as unknown as { textures: TextureLifecycle; transitionManager: TransitionManager };

/** The pipeline `HistoricalWipePass` built — the only real `createRenderPipeline` caller here. */
const wipePipelineId = () => gpu.renderPipelines[0]!.id;
const isWipePass = (p: { pipeline: unknown }) =>
    (p.pipeline as { id?: number } | null)?.id === wipePipelineId();

/** Boot, then arm a hold from a CPU snapshot — what `armHold()` does on a year-chip hop. */
async function heldRenderer() {
    const renderer = new Renderer(canvas(64, 36));
    expect(await renderer.init()).toBe(true);
    const snapshot = canvas(512, 256);
    renderer.beginHoldTransition(90, 0, snapshot);
    expect(renderer.isHoldActive()).toBe(true);
    const { textures, transitionManager } = internals(renderer);
    expect(transitionManager.previousFrame).toBeDefined();
    // The only upload so far is the snapshot itself, into the panorama texture.
    expect(copyExternal).toHaveBeenCalledTimes(1);
    expect(copyExternal.mock.calls[0]![0].source).toBe(snapshot);
    copyExternal.mockClear();
    return { renderer, textures, before: transitionManager.previousFrame! };
}

beforeEach(() => {
    installGpuGlobals();
    installShaderFetch();
    resetRoadFrameSourceForTests();
    streetViewProbe.clear();
    primeBoot();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
    resetRoadFrameSourceForTests();
    warnSpy.mockRestore();
    boot.bootDevice.mockReset();
});

describe('Renderer → historical wipe', () => {
    it('builds its own pipeline with a 16-byte uniform, without ?legacyTransitions', async () => {
        await heldRenderer();
        expect(gpu.renderPipelines).toHaveLength(1);
        const uniform = gpu.buffers.find((b) => b.descriptor.label === 'Historical wipe uniforms');
        expect(uniform?.descriptor.size).toBe(16);
    });

    it('a wipe armed during the hold encodes nothing and uploads nothing — even handed the live canvas', async () => {
        const { renderer, textures } = await heldRenderer();
        const upload = vi.spyOn(textures, 'uploadLiveSource');
        expect(renderer.beginHistoricalWipe(1)).toBe(true);
        renderer.setHistoricalWipeProgress(0.4);

        const live = canvas(512, 256);
        gpu.encoders.length = 0;
        renderer.renderStreetView('streetview', live, 90, 0, 1);
        renderer.renderHeldFrame(90, 0, 1);

        expect(upload).not.toHaveBeenCalled();
        expect(copyExternal).not.toHaveBeenCalled();
        expect(gpu.allPasses().some(isWipePass)).toBe(false);
        expect(streetViewProbe.getWarnings()).toEqual([]);
    });

    it('after release, wipes from the hold snapshot over pass 1 — never binding the live upload texture', async () => {
        const { renderer, textures, before } = await heldRenderer();
        renderer.endHoldTransition();
        expect(renderer.beginHistoricalWipe(-1)).toBe(true);
        renderer.setHistoricalWipeProgress(0.5);

        gpu.encoders.length = 0;
        renderer.renderStreetView('streetview', null, 90, 0, 1);
        // No source and no legacy transition → weather-only; the wipe needs pass 1 under it.
        expect(gpu.allPasses().some(isWipePass)).toBe(false);

        // The release path proper: pass 1 from the (already uploaded) panorama texture, then the wipe.
        (renderer as unknown as { submitPanoramaFrame: (h: number, p: number, z: number) => void })
            .submitPanoramaFrame(90, 0, 1);
        const passes = gpu.lastEncoder().passes;
        const wipeAt = passes.findIndex(isWipePass);
        expect(wipeAt).toBe(1);
        expect((passes[0]!.pipeline as { kind: string }).kind).toBe('pass1Pipeline');

        const group = passes[wipeAt]!.bindGroups[0]!.group as RecordedBindGroup;
        expect(bindingTexture(group.entries.get(1))).toBe(before);
        expect(bindingTexture(group.entries.get(1))).not.toBe(textures.videoTexture);
        expect(copyExternal).not.toHaveBeenCalled();

        const wipeWrites = gpu.writeBufferCalls.filter(
            (w) => w.buffer.descriptor.label === 'Historical wipe uniforms',
        );
        expect(Array.from(wipeWrites.at(-1)!.data as Float32Array)).toEqual([0.5, -1, 0, 0]);
        // The wipe never writes the weather block, and nothing else writes the wipe's.
        expect(wipeWrites.every((w) => (w.data as Float32Array).length === 4)).toBe(true);
        expect(streetViewProbe.getWarnings()).toEqual([]);
    });

    it('stops encoding once finished or ended', async () => {
        const { renderer } = await heldRenderer();
        renderer.endHoldTransition();
        const submit = () =>
            (renderer as unknown as { submitPanoramaFrame: (h: number, p: number, z: number) => void })
                .submitPanoramaFrame(90, 0, 1);

        renderer.beginHistoricalWipe(1);
        renderer.setHistoricalWipeProgress(1);
        submit();
        expect(gpu.lastEncoder().passes.some(isWipePass)).toBe(false);

        renderer.beginHistoricalWipe(1);
        renderer.endHistoricalWipe();
        submit();
        expect(gpu.lastEncoder().passes.some(isWipePass)).toBe(false);
    });

    it('declines without a hold snapshot, so the hook keeps the crossfade', async () => {
        const renderer = new Renderer(canvas(64, 36));
        expect(await renderer.init()).toBe(true);
        expect(renderer.beginHistoricalWipe(1)).toBe(false);
    });

    it('declines when the shader cannot load, and init still succeeds', async () => {
        (globalThis as Record<string, unknown>).fetch = async () =>
            ({ ok: false, status: 404, statusText: 'Not Found', text: async () => '' });
        const renderer = new Renderer(canvas(64, 36));
        expect(await renderer.init()).toBe(true);
        renderer.beginHoldTransition(0, 0, canvas(512, 256));
        renderer.endHoldTransition();
        expect(renderer.beginHistoricalWipe(1)).toBe(false);
    });

    it('has no upload path: the pass never names the live texture or an upload', () => {
        const src = readFileSync(join(__dirname, 'HistoricalWipePass.ts'), 'utf8');
        expect(src).not.toMatch(/copyExternalImageToTexture|uploadLiveSource|videoTexture|writeTexture/);
        const shader = readFileSync(join(__dirname, '..', '..', 'public', 'shaders', 'historical-wipe.wgsl'), 'utf8');
        // One texture binding — the snapshot. "After" is whatever pass 1 drew.
        expect(shader.match(/texture_2d/g)).toHaveLength(1);
    });
});
