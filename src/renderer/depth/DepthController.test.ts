/**
 * The scene-depth pass on the recording fake device, with a scripted Worker:
 * what it reads (the intermediate only, never during a hold), what it uploads,
 * what it publishes on `FrameContext.aux`, and how it fails.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeGpu, installGpuGlobals, type FakeGpu } from '../computeWeather/__tests__/fakeGpu';
import { DepthController, type DepthControllerDeps, type DepthFrameInput } from './DepthController';
import { DepthEstimator, type DepthWorkerLike } from './DepthEstimator';
import type { DepthWorkerMessage, DepthWorkerRequest } from './depthProtocol';
import { SCENE_DEPTH_FORMAT, SceneDepthParamIndex as I } from './sceneDepthBinding';
import { getSceneDepthStats, resetSceneDepthStats } from './sceneDepthStatsStore';
import { DEPTH_SETTLE_MS } from './depthScheduler';
import type { GpuChores } from '../gpuChores/GpuChores';

/** A Worker that answers like `depthWorker.ts`, under test control. */
class ScriptedWorker implements DepthWorkerLike {
    onmessage: ((event: MessageEvent<DepthWorkerMessage>) => void) | null = null;
    onerror: ((event: ErrorEvent) => void) | null = null;
    readonly received: DepthWorkerRequest[] = [];
    terminated = false;
    /** Set to make `init` fail with this message. */
    initError: string | null = null;
    /** Hold inference replies until `flush()`. */
    manual = false;
    private queued: DepthWorkerMessage[] = [];

    postMessage(message: DepthWorkerRequest): void {
        this.received.push(message);
        if (message.type === 'init') {
            queueMicrotask(() => this.emit(this.initError
                ? { type: 'error', message: this.initError }
                : { type: 'ready', variant: 'q4', shaderF16: false, fromCache: true, createMs: 12, adapter: 'fake' }));
        } else if (message.type === 'infer') {
            // Disparity rises left → right: the right edge is nearest.
            const disparity = new Float32Array(message.width * message.height);
            for (let i = 0; i < disparity.length; i++) disparity[i] = (i % message.width) / message.width;
            const reply: DepthWorkerMessage = {
                type: 'result', id: message.id, disparity, width: message.width, height: message.height, ms: 42,
            };
            if (this.manual) this.queued.push(reply);
            else queueMicrotask(() => this.emit(reply));
        }
    }

    flush(): void {
        for (const m of this.queued.splice(0)) this.emit(m);
    }

    emit(message: DepthWorkerMessage): void {
        this.onmessage?.({ data: message } as MessageEvent<DepthWorkerMessage>);
    }

    terminate(): void {
        this.terminated = true;
    }
}

const settle = () => new Promise((r) => setTimeout(r, 0));

let gpu: FakeGpu;
let worker: ScriptedWorker;
let hold: boolean;
let intermediate: GPUTexture;
let videoTexture: GPUTexture;
let downsample: ReturnType<typeof vi.fn>;
let failed: Error[];
let choresBackend: 'webgpu' | 'wasm' | 'js';

function makeController(patch: Partial<DepthControllerDeps> = {}) {
    return new DepthController({
        device: gpu.device,
        getChores: () => ({ downsampleTexture: downsample, currentBackend: () => choresBackend } as unknown as GpuChores),
        getIntermediate: () => ({ texture: intermediate, width: 640, height: 360 }),
        isHoldActive: () => hold,
        isAlive: () => true,
        onFailed: (e) => failed.push(e),
        baseUrl: 'http://127.0.0.1/',
        createEstimator: () => new DepthEstimator(() => worker),
        ...patch,
    });
}

function frame(nowMs: number, patch: Partial<DepthFrameInput> = {}): DepthFrameInput {
    return {
        nowMs,
        view: { panX: 0.25, panY: 0.5, zoom: 1 },
        holdActive: hold,
        transitioning: false,
        ...patch,
    };
}

/** Enable, init, and run frames until the first map is applied. */
async function warmUp(c: DepthController, blend = 0.8) {
    c.setOptions({ enabled: true, blend, reducedMotion: false });
    await c.pass.init();
    let t = 0;
    for (let i = 0; i < 40 && !c.currentAux(); i++) {
        c.onFrame(frame(t));
        await settle();
        t += DEPTH_SETTLE_MS;
    }
    return t;
}

beforeEach(() => {
    installGpuGlobals();
    gpu = createFakeGpu();
    worker = new ScriptedWorker();
    hold = false;
    failed = [];
    choresBackend = 'webgpu';
    intermediate = gpu.device.createTexture({ size: [640, 360], format: 'rgba16float', usage: 0 } as GPUTextureDescriptor);
    videoTexture = gpu.device.createTexture({ size: [640, 360], format: 'rgba8unorm-srgb', usage: 0 } as GPUTextureDescriptor);
    downsample = vi.fn(async (_tex: GPUTexture, w: number, h: number) => new Uint8Array(w * h * 4).fill(128));
    resetSceneDepthStats();
});

afterEach(() => {
    vi.useRealTimers();
});

describe('scene depth — lazy, optional pass', () => {
    it('is a lazy, optional FramePass that does nothing until switched on', () => {
        const c = makeController();
        expect(c.pass.id).toBe('depth');
        expect(c.pass.lazy).toBe(true);
        expect(c.pass.required).toBeFalsy();
        expect(c.isInitialised()).toBe(false);
        c.onFrame(frame(0));
        expect(c.currentAux()).toBeUndefined();
        expect(worker.received).toEqual([]);
    });

    it('init downloads through the Worker and reports ready', async () => {
        const c = makeController();
        c.setOptions({ enabled: true, blend: 0.6, reducedMotion: false });
        await c.pass.init();
        const init = worker.received[0]!;
        expect(init.type).toBe('init');
        if (init.type === 'init') {
            expect(init.runtimeUrl).toMatch(/^https:\/\/cdn\.jsdelivr\.net\/npm\/onnxruntime-web@\d+\.\d+\.\d+\/dist\/ort\.webgpu\.min\.mjs$/);
            expect(init.models.q4.url).toMatch(/^http:\/\/127\.0\.0\.1\/models\/depth\/.+\.onnx$/);
        }
        expect(getSceneDepthStats()).toMatchObject({ state: 'ready', variant: 'q4', fromCache: true });
    });

    it('a failed load rejects init (the registry reports it) and leaves no depth', async () => {
        worker.initError = 'scene-depth model not deployed (HTTP 404)';
        const c = makeController();
        c.setOptions({ enabled: true, blend: 0.6, reducedMotion: false });
        await expect(c.pass.init()).rejects.toThrow(/HTTP 404/);
        expect(getSceneDepthStats()).toMatchObject({ state: 'failed', reason: expect.stringMatching(/404/) });
        c.onFrame(frame(1000));
        expect(c.currentAux()).toBeUndefined();
    });
});

describe('scene depth — input, output, publication', () => {
    it('reads the pass-1 intermediate only, at ≈252² with the canvas aspect', async () => {
        const c = makeController();
        await warmUp(c);
        expect(downsample).toHaveBeenCalled();
        for (const [texture, w, h] of downsample.mock.calls) {
            expect(texture).toBe(intermediate);
            expect(texture).not.toBe(videoTexture);
            expect(w % 14).toBe(0);
            expect(h % 14).toBe(0);
            expect(w / h).toBeCloseTo(640 / 360, 1);
        }
    });

    it('uploads an r16float map and publishes it with a bind group on aux', async () => {
        const c = makeController();
        await warmUp(c);
        const aux = c.currentAux()!;
        expect(aux).toBeDefined();
        expect(aux.generation).toBeGreaterThan(0);
        const texture = aux.texture as unknown as { descriptor: GPUTextureDescriptor };
        expect(texture.descriptor.format).toBe(SCENE_DEPTH_FORMAT);
        expect(texture.descriptor.size).toEqual([aux.width, aux.height]);
        expect(gpu.writeTextureCalls.some((w) => w.texture === (aux.texture as unknown))).toBe(true);
        expect(getSceneDepthStats().inferenceMs).toBe(42);
    });

    it('writes the params every encode; blend ramps to the preset weight', async () => {
        const c = makeController();
        let t = await warmUp(c, 0.6);
        for (let i = 0; i < 60; i++) c.onFrame(frame((t += 16)));
        c.pass.encode({} as GPUCommandEncoder, {} as never);
        const params = gpu.writeBufferCalls.at(-1)!.data as Float32Array;
        expect(params[I.blend]).toBeCloseTo(0.6, 5);
    });

    it('never reads the frame during a hold, and drops a map that finishes after the pano changed', async () => {
        const c = makeController();
        let t = await warmUp(c);
        const calls = downsample.mock.calls.length;

        hold = true;
        for (let i = 0; i < 20; i++) c.onFrame(frame((t += 200), { view: { panX: 0.3 + i * 0.01, panY: 0.5, zoom: 1 } }));
        await settle();
        expect(downsample.mock.calls.length).toBe(calls);

        // Release onto a new pano: trust in the old map drops at once.
        hold = false;
        c.endHold();
        c.onFrame(frame((t += 16)));
        c.pass.encode({} as GPUCommandEncoder, {} as never);
        expect((gpu.writeBufferCalls.at(-1)!.data as Float32Array)[I.blend]).toBe(0);

        // An inference that started on the new pano but finishes after yet another hop is dropped.
        worker.manual = true;
        const sent = worker.received.filter((m) => m.type === 'infer').length;
        for (let i = 0; i < 4; i++) c.onFrame(frame((t += DEPTH_SETTLE_MS)));
        await settle();
        expect(worker.received.filter((m) => m.type === 'infer').length).toBe(sent + 1);
        const generation = c.currentAux()!.generation;
        c.endHold();
        worker.flush();
        await settle();
        c.onFrame(frame((t += 16)));
        expect(c.currentAux()!.generation).toBe(generation);
    });

    it('switching off disposes the Worker and stops publishing; on again reloads it', async () => {
        const c = makeController();
        await warmUp(c);
        c.setOptions({ enabled: false, blend: 0, reducedMotion: false });
        expect(c.currentAux()).toBeUndefined();
        await settle();
        expect(worker.received.some((m) => m.type === 'dispose')).toBe(true);
        expect(getSceneDepthStats().state).toBe('off');

        worker = new ScriptedWorker();
        c.setOptions({ enabled: true, blend: 0.8, reducedMotion: false });
        await settle();
        await settle();
        expect(worker.received[0]?.type).toBe('init');
        expect(getSceneDepthStats().state).toBe('ready');
    });

    it('a device lost in the Worker after ready is reported as a pass failure', async () => {
        const c = makeController();
        await warmUp(c);
        worker.emit({ type: 'lost', message: 'GPU hung' });
        expect(failed.map((e) => e.message)).toEqual(['depth device lost: GPU hung']);
        expect(c.currentAux()).toBeUndefined();
        expect(getSceneDepthStats().state).toBe('failed');
    });

    it('without the GPU chores readback (?no_gpu_compute) it fails honestly instead of spinning', async () => {
        downsample.mockResolvedValue(null);
        choresBackend = 'wasm';
        const c = makeController();
        await warmUp(c);
        expect(failed[0]?.message).toMatch(/GPU chores/);
        expect(c.currentAux()).toBeUndefined();
    });

    it('one failed readback on GPU chores is retried, not a pass failure', async () => {
        downsample.mockResolvedValueOnce(null);
        const c = makeController();
        c.setOptions({ enabled: true, blend: 0.8, reducedMotion: false });
        await c.pass.init();
        let t = 0;
        for (let i = 0; i < 40 && !c.currentAux(); i++) {
            c.onFrame(frame(t));
            await settle();
            t += 250;
        }
        expect(failed).toEqual([]);
        expect(c.currentAux()).toBeDefined();
        expect(downsample.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    it('dispose destroys what it created', async () => {
        const c = makeController();
        await warmUp(c);
        const aux = c.currentAux()!;
        c.dispose();
        expect((aux.texture as unknown as { destroyed: boolean }).destroyed).toBe(true);
        expect(gpu.buffers.find((b) => b.descriptor.label === 'scene-depth-params')!.destroyed).toBe(true);
    });
});
