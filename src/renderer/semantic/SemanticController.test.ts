/**
 * The semantic layer (#352) riding on the depth pipeline, on the recording
 * fake device with a scripted Worker: one Worker and one readback feed both
 * models, the class map is uploaded as rg8unorm and published on
 * `FrameContext.aux`, weight 0 packs an all-zero block, and a failed semantic
 * session never takes depth down.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeGpu, installGpuGlobals, type FakeGpu } from '../computeWeather/__tests__/fakeGpu';
import { DepthController, type DepthFrameInput } from '../depth/DepthController';
import { DepthEstimator, type DepthWorkerLike } from '../depth/DepthEstimator';
import type { DepthWorkerMessage, DepthWorkerRequest } from '../depth/depthProtocol';
import { DEPTH_SETTLE_MS } from '../depth/depthScheduler';
import { resetSceneDepthStats } from '../depth/sceneDepthStatsStore';
import type { GpuChores } from '../gpuChores/GpuChores';
import { SemanticController } from './SemanticController';
import { SceneSemanticParamIndex as I, SCENE_SEMANTIC_PARAMS_FLOAT_COUNT } from './sceneSemanticBinding';
import { getSceneSemanticStats, resetSceneSemanticStats } from './sceneSemanticStatsStore';
import { SemanticClass } from './semanticClasses';

/** Sky over the top 40% of the map, road below. */
function skyOverRoad(width: number, height: number): Uint8Array<ArrayBuffer> {
    const texels = new Uint8Array(width * height * 2);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 2;
            texels[i] = (y < height * 0.4 ? SemanticClass.sky : SemanticClass.road) + 1;
            texels[i + 1] = 230;
        }
    }
    return texels;
}

class ScriptedWorker implements DepthWorkerLike {
    onmessage: ((event: MessageEvent<DepthWorkerMessage>) => void) | null = null;
    onerror: ((event: ErrorEvent) => void) | null = null;
    readonly received: DepthWorkerRequest[] = [];
    semanticLoadError: string | null = null;
    semanticRunError: string | null = null;

    postMessage(message: DepthWorkerRequest): void {
        this.received.push(message);
        if (message.type === 'init') {
            queueMicrotask(() => this.emit({ type: 'ready', variant: 'q4', shaderF16: false, fromCache: true, createMs: 1, adapter: 'fake', powerPreference: null, adapterMismatch: false, adapterRetried: false }));
        } else if (message.type === 'load-semantic') {
            queueMicrotask(() => this.emit(this.semanticLoadError
                ? { type: 'semantic-error', message: this.semanticLoadError }
                : { type: 'semantic-ready', fromCache: false, createMs: 5 }));
        } else if (message.type === 'infer') {
            const { width, height } = message;
            const disparity = new Float32Array(width * height).fill(0.5);
            const reply: DepthWorkerMessage = { type: 'result', id: message.id, disparity, width, height, ms: 40 };
            if (message.semantic && this.semanticRunError) {
                reply.semanticError = this.semanticRunError;
            } else if (message.semantic) {
                const histogram = new Float32Array(7);
                histogram[SemanticClass.sky] = 0.4;
                histogram[SemanticClass.road] = 0.6;
                reply.semantic = { texels: skyOverRoad(width, height), width, height, histogram, meanConfidence: 0.9, skyColor: [0.4, 0.6, 0.9], ms: 30 };
            }
            queueMicrotask(() => this.emit(reply));
        }
    }

    emit(message: DepthWorkerMessage): void {
        this.onmessage?.({ data: message } as MessageEvent<DepthWorkerMessage>);
    }

    terminate(): void {}
}

const settle = () => new Promise((r) => setTimeout(r, 0));

let gpu: FakeGpu;
let worker: ScriptedWorker;
let downsample: ReturnType<typeof vi.fn>;
let semanticFailures: Error[];

function frame(nowMs: number): DepthFrameInput {
    return { nowMs, view: { panX: 0.25, panY: 0.5, zoom: 1 }, holdActive: false, transitioning: false };
}

function makeLayer() {
    const intermediate = gpu.device.createTexture({ size: [640, 360], format: 'rgba16float', usage: 0 } as GPUTextureDescriptor);
    const depth = new DepthController({
        device: gpu.device,
        getChores: () => ({ downsampleTexture: downsample, currentBackend: () => 'webgpu' } as unknown as GpuChores),
        getIntermediate: () => ({ texture: intermediate, width: 640, height: 360 }),
        isHoldActive: () => false,
        isAlive: () => true,
        onFailed: () => undefined,
        baseUrl: 'http://127.0.0.1/',
        createEstimator: () => new DepthEstimator(() => worker),
    });
    const semantic = new SemanticController({
        device: gpu.device,
        pipeline: depth,
        baseUrl: 'http://127.0.0.1/',
        onFailed: (e) => semanticFailures.push(e),
    });
    return { depth, semantic };
}

/** Depth + semantic on, both passes initialised, frames run until a class map is applied. */
async function warmUp(layer: ReturnType<typeof makeLayer>, blend = 1) {
    layer.depth.setOptions({ enabled: true, blend: 0.8, reducedMotion: false });
    await layer.depth.pass.init();
    layer.semantic.setOptions({ enabled: true, blend, reducedMotion: false });
    await layer.semantic.pass.init();
    let t = 0;
    for (let i = 0; i < 60 && !layer.semantic.currentAux(); i++) {
        layer.depth.onFrame(frame(t));
        layer.semantic.onFrame({ nowMs: t, view: frame(t).view });
        await settle();
        t += DEPTH_SETTLE_MS;
    }
    return t;
}

function lastParams(): Float32Array {
    const writes = gpu.writeBufferCalls.filter((c) => c.buffer.descriptor.label === 'scene-semantic-params');
    const data = writes[writes.length - 1]!.data as Float32Array;
    return new Float32Array(data.buffer, data.byteOffset, SCENE_SEMANTIC_PARAMS_FLOAT_COUNT);
}

beforeEach(() => {
    installGpuGlobals();
    gpu = createFakeGpu();
    worker = new ScriptedWorker();
    semanticFailures = [];
    downsample = vi.fn(async (_tex: GPUTexture, w: number, h: number) => new Uint8Array(w * h * 4).fill(128));
    resetSceneDepthStats();
    resetSceneSemanticStats();
});

describe('semantic layer — a lazy pass on the depth pipeline', () => {
    it('is lazy and optional, and needs scene depth on to load', async () => {
        const { semantic } = makeLayer();
        expect(semantic.pass.id).toBe('semantic');
        expect(semantic.pass.lazy).toBe(true);
        expect(semantic.pass.required).toBeFalsy();
        semantic.setOptions({ enabled: true, blend: 1, reducedMotion: false });
        await expect(semantic.pass.init()).rejects.toThrow(/needs scene depth on/);
        expect(getSceneSemanticStats().state).toBe('failed');
    });

    it('loads its session into the depth Worker (same Worker, its own file and bucket)', async () => {
        const layer = makeLayer();
        await warmUp(layer);
        const types = worker.received.map((m) => m.type);
        expect(types.filter((t) => t === 'init')).toHaveLength(1);
        const load = worker.received.find((m) => m.type === 'load-semantic');
        expect(load).toBeDefined();
        if (load?.type === 'load-semantic') {
            expect(load.model.url).toBe('http://127.0.0.1/models/semantic/ddrnet23-slim-street7.onnx');
            expect(load.cacheName).toMatch(/^streetview-semantic-model-v\d+$/);
        }
        expect(getSceneSemanticStats()).toMatchObject({ state: 'ready', fromCache: false });
    });

    it('one readback feeds both models: semantic rides on the depth inference', async () => {
        const layer = makeLayer();
        await warmUp(layer);
        const infers = worker.received.filter((m) => m.type === 'infer');
        expect(infers.length).toBeGreaterThan(0);
        expect(downsample).toHaveBeenCalledTimes(infers.length);
        expect(infers.some((m) => m.type === 'infer' && m.semantic)).toBe(true);
    });

    it('uploads an rg8unorm map and publishes it with a live params block', async () => {
        const layer = makeLayer();
        const t = await warmUp(layer);
        const aux = layer.semantic.currentAux()!;
        expect(aux).toBeDefined();
        const texture = gpu.textures.find((x) => x.descriptor.label === 'scene-semantic')!;
        expect(texture.descriptor.format).toBe('rg8unorm');
        expect(aux.width % 14).toBe(0);
        // Trust eases in over frames.
        for (let i = 0; i < 30; i++) {
            layer.semantic.onFrame({ nowMs: t + i * 50, view: frame(0).view });
            layer.semantic.pass.encode({} as never, {} as never);
        }
        const params = lastParams();
        expect(params[I.blend]).toBeCloseTo(1, 2);
        expect(params[I.rainSky]).toBe(1);
        expect(params[I.wetRoad]).toBe(1);
        expect(params[I.stillness]).toBe(0);
        const stats = getSceneSemanticStats();
        expect(stats.histogram!.sky).toBeCloseTo(0.4, 6);
        expect(stats.histogram!.road).toBeCloseTo(0.6, 6);
        expect(stats.skyEdgeY).toBeCloseTo(0.4, 1);
        expect(layer.semantic.currentSkyEdge()).toMatchObject({ pitch: 0.5 });
    });

    it('weight 0 packs an all-zero block (bit-exact shaders)', async () => {
        const layer = makeLayer();
        const t = await warmUp(layer);
        layer.semantic.setOptions({ enabled: false, blend: 0, reducedMotion: false });
        layer.semantic.onFrame({ nowMs: t + 100, view: frame(0).view });
        layer.semantic.pass.encode({} as never, {} as never);
        expect([...lastParams()].every((v) => v === 0)).toBe(true);
        expect(layer.semantic.currentAux()).toBeUndefined();
        expect(layer.semantic.currentSkyEdge()).toBeNull();
    });

    it('a failed semantic session fails its own pass, not depth', async () => {
        worker.semanticLoadError = 'semantic-scene model not deployed (HTTP 404)';
        const layer = makeLayer();
        layer.depth.setOptions({ enabled: true, blend: 0.8, reducedMotion: false });
        await layer.depth.pass.init();
        layer.semantic.setOptions({ enabled: true, blend: 1, reducedMotion: false });
        await expect(layer.semantic.pass.init()).rejects.toThrow(/HTTP 404/);
        let t = 0;
        for (let i = 0; i < 20 && !layer.depth.currentAux(); i++) {
            layer.depth.onFrame(frame(t));
            await settle();
            t += DEPTH_SETTLE_MS;
        }
        expect(layer.depth.currentAux()).toBeDefined();
        expect(layer.semantic.currentAux()).toBeUndefined();
        const infers = worker.received.filter((m) => m.type === 'infer');
        expect(infers.every((m) => m.type === 'infer' && !m.semantic)).toBe(true);
    });

    it('a failed semantic run is counted and keeps the depth half', async () => {
        const layer = makeLayer();
        await warmUp(layer);
        worker.semanticRunError = 'kernel failed';
        layer.depth.requestRefresh();
        let t = 10_000;
        for (let i = 0; i < 10; i++) {
            layer.depth.onFrame(frame(t));
            await settle();
            t += DEPTH_SETTLE_MS;
        }
        expect(getSceneSemanticStats().failures).toBeGreaterThan(0);
        expect(layer.depth.currentAux()).toBeDefined();
    });

    it('switching depth off resets the session; switching back on needs a reload', async () => {
        const layer = makeLayer();
        await warmUp(layer);
        layer.depth.setOptions({ enabled: false, blend: 0, reducedMotion: false });
        expect(layer.semantic.wantsMaps()).toBe(false);
        expect(layer.semantic.needsSession()).toBe(true);
        layer.depth.setOptions({ enabled: true, blend: 0.8, reducedMotion: false });
        await layer.depth.pass.init();
        await layer.semantic.loadSession();
        expect(layer.semantic.wantsMaps()).toBe(true);
    });
});
