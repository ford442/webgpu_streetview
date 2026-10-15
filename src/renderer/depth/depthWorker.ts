/**
 * The scene-depth Worker: onnxruntime-web (WebGPU EP) running Depth Anything
 * V2 Small, off the main thread.
 *
 * **Its own `GPUDevice`, deliberately.** ORT 1.30 does accept an external
 * device (`env.webgpu.device`, set before the first session), but a
 * `GPUDevice` cannot be posted into a Worker, and running the model on the
 * main thread against the road's device would put ORT's graph optimisation on
 * the main thread and let a model fault (out-of-memory, a kernel validation
 * error, a lost device) take the road frame down with it. So this Worker
 * requests one device for the model — the only `requestDevice` outside
 * `bootDevice.ts` (`deviceInit.test.ts` names both) — and hands it to ORT, so
 * ORT never creates a second one. Depth crosses back as a `Float32Array`
 * (~70 K texels, ≤ 5 Hz), which the main thread writes into an `r16float`
 * texture on the road's device. Nothing on this device is ever rendered.
 *
 * `shader-f16` is requested when the adapter has it: that is what lets the
 * `q4f16` model (f16 activations) run; without it the `q4` variant does.
 *
 * The runtime is imported from a pinned CDN URL handed in by the main thread —
 * there is no `onnxruntime-web` npm dependency and nothing of it in the bundle.
 * No threads / `SharedArrayBuffer`: the page is not cross-origin isolated
 * (COOP/COEP would break the Maps embed), so `numThreads` is pinned to 1.
 */
import { loadDepthModel, sha256Hex } from './depthModelCache';
import { pickDepthModelVariant } from './depthModel';
import { rgbaToImageNetNchw } from './depthMath';
import type { DepthInitRequest, DepthWorkerMessage, DepthWorkerRequest } from './depthProtocol';

/** The slice of the onnxruntime-web API this Worker uses (it has no npm types here). */
interface OrtTensor {
    readonly dims: readonly number[];
    getData(): Promise<Float32Array | Uint16Array>;
    dispose(): void;
}
interface OrtSession {
    readonly inputNames: readonly string[];
    readonly outputNames: readonly string[];
    run(feeds: Record<string, OrtTensor>): Promise<Record<string, OrtTensor>>;
    release(): Promise<void>;
}
interface OrtModule {
    env: {
        logLevel?: string;
        wasm: { numThreads?: number; proxy?: boolean };
        webgpu: { device?: GPUDevice };
    };
    Tensor: new (type: 'float32', data: Float32Array, dims: number[]) => OrtTensor;
    InferenceSession: {
        create(model: Uint8Array, options: Record<string, unknown>): Promise<OrtSession>;
    };
}

interface WorkerScope {
    postMessage(message: DepthWorkerMessage, transfer?: Transferable[]): void;
    onmessage: ((event: MessageEvent<DepthWorkerRequest>) => void) | null;
    caches?: CacheStorage;
}

const scope = self as unknown as WorkerScope;

let ort: OrtModule | null = null;
let session: OrtSession | null = null;
let device: GPUDevice | null = null;
let disposed = false;
let tensorScratch: Float32Array | null = null;

function post(message: DepthWorkerMessage, transfer?: Transferable[]): void {
    scope.postMessage(message, transfer);
}

/** Limits ORT's WebGPU EP asks for when it creates its own device — raised to the adapter's. */
const ORT_LIMITS = [
    'maxComputeWorkgroupStorageSize',
    'maxComputeWorkgroupsPerDimension',
    'maxStorageBufferBindingSize',
    'maxBufferSize',
    'maxComputeInvocationsPerWorkgroup',
    'maxComputeWorkgroupSizeX',
    'maxComputeWorkgroupSizeY',
    'maxComputeWorkgroupSizeZ',
] as const;

async function createDepthDevice(): Promise<{ device: GPUDevice; shaderF16: boolean; adapter: string }> {
    const gpu = (navigator as Navigator & { gpu?: GPU }).gpu;
    const adapter = await gpu?.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) throw new Error('no WebGPU adapter in the depth worker');
    const shaderF16 = adapter.features.has('shader-f16');
    const requiredFeatures: GPUFeatureName[] = [];
    if (shaderF16) requiredFeatures.push('shader-f16');
    if (adapter.features.has('subgroups')) requiredFeatures.push('subgroups' as GPUFeatureName);
    const requiredLimits: Record<string, number> = {};
    for (const name of ORT_LIMITS) {
        const value = (adapter.limits as unknown as Record<string, number>)[name];
        if (typeof value === 'number') requiredLimits[name] = value;
    }
    const created = await adapter.requestDevice({
        label: 'scene-depth-device',
        requiredFeatures,
        requiredLimits,
    });
    void created.lost.then((info) => {
        if (disposed) return;
        session = null;
        post({ type: 'lost', message: info.message || info.reason || 'device lost' });
    });
    const info = (adapter as GPUAdapter & { info?: GPUAdapterInfo }).info;
    return {
        device: created,
        shaderF16,
        adapter: [info?.vendor, info?.architecture, info?.description].filter(Boolean).join(' ') || 'unknown',
    };
}

async function init(request: DepthInitRequest): Promise<void> {
    const created = await createDepthDevice();
    device = created.device;

    ort = (await import(/* @vite-ignore */ request.runtimeUrl)) as OrtModule;
    ort.env.logLevel = 'error';
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.proxy = false;
    ort.env.webgpu.device = device;

    const variant = pickDepthModelVariant(created.shaderF16);
    const loaded = await loadDepthModel({
        file: request.models[variant],
        cacheName: request.cacheName,
        cachePrefix: request.cachePrefix,
        io: { caches: scope.caches ?? null, fetch: (url) => fetch(url), sha256Hex },
        onProgress: (loadedBytes, total) => post({ type: 'progress', loaded: loadedBytes, total }),
    });
    if (disposed) return;

    const createStart = performance.now();
    session = await ort.InferenceSession.create(new Uint8Array(loaded.bytes), {
        executionProviders: ['webgpu'],
        graphOptimizationLevel: 'all',
    });
    post({
        type: 'ready',
        variant,
        shaderF16: created.shaderF16,
        fromCache: loaded.fromCache,
        createMs: performance.now() - createStart,
        adapter: created.adapter,
    });
}

async function infer(id: number, rgba: Uint8Array, width: number, height: number): Promise<void> {
    if (!ort || !session) throw new Error('depth session is not ready');
    const started = performance.now();
    const size = 3 * width * height;
    if (!tensorScratch || tensorScratch.length !== size) tensorScratch = new Float32Array(size);
    const input = new ort.Tensor('float32', rgbaToImageNetNchw(rgba, width, height, tensorScratch), [1, 3, height, width]);
    const outputs = await session.run({ [session.inputNames[0]!]: input });
    const output = outputs[session.outputNames[0]!]!;
    const data = await output.getData();
    const disparity = data instanceof Float32Array ? Float32Array.from(data) : Float32Array.from(data, Number);
    output.dispose();
    const dims = output.dims;
    const outHeight = dims.length >= 2 ? dims[dims.length - 2]! : height;
    const outWidth = dims.length >= 1 ? dims[dims.length - 1]! : width;
    post(
        { type: 'result', id, disparity, width: outWidth, height: outHeight, ms: performance.now() - started },
        [disparity.buffer],
    );
}

scope.onmessage = (event) => {
    const message = event.data;
    if (message.type === 'init') {
        init(message).catch((error: unknown) => {
            post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
        });
    } else if (message.type === 'infer') {
        infer(message.id, message.rgba, message.width, message.height).catch((error: unknown) => {
            post({ type: 'error', id: message.id, message: error instanceof Error ? error.message : String(error) });
        });
    } else if (message.type === 'dispose') {
        disposed = true;
        const s = session;
        session = null;
        void s?.release().catch(() => undefined).finally(() => device?.destroy());
        if (!s) device?.destroy();
    }
};
