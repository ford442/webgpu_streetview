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
 * `numThreads` is pinned to 1. The page is cross-origin isolated in production
 * (`public/.htaccess`: COOP same-origin + COEP credentialless) and in dev
 * (`vite.config.ts`), so threads are possible; they are not used because the
 * model is small and the CDN-hosted runtime's threaded build is a second,
 * unmeasured artifact (see docs/SCENE_DEPTH.md).
 *
 * **A second session (#352).** The semantic segmenter (`load-semantic`) runs on
 * the same device and runtime, on the same input tensor: an `infer` with
 * `semantic: true` builds the ImageNet tensor once and feeds both sessions
 * (the rebuilt semantic model takes exactly that normalisation). A semantic
 * failure never fails the depth half of a result.
 *
 * **One ORT operation at a time.** ORT's WebGPU backend is not re-entrant:
 * creating the semantic session while a depth inference runs left that run
 * with an invalid pipeline ("setPipeline … is not of type
 * 'GPUComputePipeline'", SwiftShader, ORT 1.30). Every session create and
 * every inference goes through `onOrtQueue`; downloads and hashing stay
 * outside it.
 */
import { loadDepthModel, sha256Hex } from './depthModelCache';
import { pickDepthModelVariant } from './depthModel';
import { decodeDisparity, rgbaToImageNetNchw } from './depthMath';
import type { DepthInitRequest, DepthWorkerMessage, DepthWorkerRequest } from './depthProtocol';
import { rgbaToImageNetNchw } from './depthMath';
import type {
    DepthInitRequest,
    DepthLoadSemanticRequest,
    DepthWorkerMessage,
    DepthWorkerRequest,
    SemanticResult,
} from './depthProtocol';
import { decodeSemanticProbs } from '../semantic/semanticDecode';

/** The slice of the onnxruntime-web API this Worker uses (it has no npm types here). */
interface OrtTensor {
    readonly dims: readonly number[];
    /** ORT element type name (`float32`, `float16`, …); decides how `getData()` is read. */
    readonly type: string;
    getData(): Promise<ArrayLike<number>>;
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
let semanticSession: OrtSession | null = null;
let semanticLoading = false;
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

let ortQueue: Promise<unknown> = Promise.resolve();

/** Run `task` after every ORT operation queued before it (success or failure). */
function onOrtQueue<T>(task: () => Promise<T>): Promise<T> {
    const run = ortQueue.then(task, task);
    ortQueue = run.catch(() => undefined);
    return run;
}

async function createDepthDevice(): Promise<{ device: GPUDevice; shaderF16: boolean; adapter: string }> {
    const gpu = (navigator as Navigator & { gpu?: GPU }).gpu;
    const adapter = await gpu?.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) throw new Error('no WebGPU adapter in the depth worker');
    const shaderF16 = adapter.features.has('shader-f16');
    const requiredFeatures: GPUFeatureName[] = [];
    if (shaderF16) requiredFeatures.push('shader-f16');
    if (adapter.features.has('subgroups')) requiredFeatures.push('subgroups');
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
    // Nothing else listens on this device: a validation error would vanish.
    created.addEventListener('uncapturederror', (event: Event) => {
        const error = (event as GPUUncapturedErrorEvent).error;
        post({ type: 'gpu-error', message: error.message });
    });
    void created.lost.then((info) => {
        if (disposed) return;
        session = null;
        semanticSession = null;
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
    const runtime = ort;
    const createStart = performance.now();
    session = await onOrtQueue(() => runtime.InferenceSession.create(new Uint8Array(loaded.bytes), {
        // wasm last: a WebGPU EP that cannot build this graph degrades to slow
        // inference instead of failing the toggle outright.
        executionProviders: ['webgpu', 'wasm'],
        graphOptimizationLevel: 'all',
        // Batch is always 1. height/width stay free: the input follows the
        // canvas aspect (`depthInputSize`), and a pinned size would fail every other aspect.
        freeDimensionOverrides: { batch_size: 1 },
    }));
    post({
        type: 'ready',
        variant,
        shaderF16: created.shaderF16,
        fromCache: loaded.fromCache,
        createMs: performance.now() - createStart,
        adapter: created.adapter,
    });
}

async function loadSemantic(request: DepthLoadSemanticRequest): Promise<void> {
    if (!ort || !device) throw new Error('the depth worker is not initialised');
    if (semanticSession || semanticLoading) return;
    semanticLoading = true;
    try {
        const loaded = await loadDepthModel({
            file: request.model,
            label: 'semantic-scene',
            fetchScript: 'fetch:models',
            cacheName: request.cacheName,
            cachePrefix: request.cachePrefix,
            io: { caches: scope.caches ?? null, fetch: (url) => fetch(url), sha256Hex },
            onProgress: (loadedBytes, total) => post({ type: 'semantic-progress', loaded: loadedBytes, total }),
        });
        if (disposed) return;
        const runtime = ort;
        let createStart = 0;
        semanticSession = await onOrtQueue(() => {
            createStart = performance.now();
            return runtime.InferenceSession.create(new Uint8Array(loaded.bytes), {
                executionProviders: ['webgpu'],
                graphOptimizationLevel: 'all',
            });
        });
        if (disposed) {
            // Disposed while it was being created: the dispose already ran.
            const late = semanticSession;
            semanticSession = null;
            await late.release().catch(() => undefined);
            return;
        }
        post({ type: 'semantic-ready', fromCache: loaded.fromCache, createMs: performance.now() - createStart });
    } finally {
        semanticLoading = false;
    }
}

/** The semantic session on an already-built input tensor; null if it is not loaded. */
async function runSemantic(input: OrtTensor, rgba: Uint8Array): Promise<SemanticResult | null> {
    const s = semanticSession;
    if (!s) return null;
    const started = performance.now();
    const outputs = await s.run({ [s.inputNames[0]!]: input });
    const output = outputs[s.outputNames[0]!]!;
    try {
        const dims = output.dims;
        if (dims.length !== 4) throw new Error(`semantic output has rank ${dims.length}, expected 4`);
        const [, classes, outHeight, outWidth] = dims as [number, number, number, number];
        const data = await output.getData();
        if (!(data instanceof Float32Array)) throw new Error('semantic output is not float32');
        // The head resizes to the input, so the frame lines up texel for texel.
        const decoded = decodeSemanticProbs(data, classes, outWidth, outHeight,
            rgba.length === outWidth * outHeight * 4 ? rgba : undefined);
        return {
            texels: decoded.texels,
            histogram: decoded.histogram,
            meanConfidence: decoded.meanConfidence,
            skyColor: decoded.skyColor,
            width: outWidth,
            height: outHeight,
            ms: performance.now() - started,
        };
    } finally {
        output.dispose();
    }
}

async function infer(id: number, rgba: Uint8Array, width: number, height: number, semantic: boolean): Promise<void> {
    if (!ort || !session) throw new Error('depth session is not ready');
    const started = performance.now();
    const size = 3 * width * height;
    if (!tensorScratch || tensorScratch.length !== size) tensorScratch = new Float32Array(size);
    const input = new ort.Tensor('float32', rgbaToImageNetNchw(rgba, width, height, tensorScratch), [1, 3, height, width]);
    const outputs = await session.run({ [session.inputNames[0]!]: input });
    const output = outputs[session.outputNames[0]!]!;
    const data = await output.getData();
    const disparity = decodeDisparity(output.type, data);
    output.dispose();
    const dims = output.dims;
    const outHeight = dims.length >= 2 ? dims[dims.length - 2]! : height;
    const outWidth = dims.length >= 1 ? dims[dims.length - 1]! : width;
    const ms = performance.now() - started;

    let semanticResult: SemanticResult | null = null;
    let semanticError: string | undefined;
    if (semantic) {
        try {
            semanticResult = await runSemantic(input, rgba);
            if (!semanticResult) semanticError = 'semantic session is not ready';
        } catch (error) {
            semanticError = error instanceof Error ? error.message : String(error);
        }
    }
    const transfer: Transferable[] = [disparity.buffer];
    if (semanticResult) transfer.push(semanticResult.texels.buffer, semanticResult.histogram.buffer);
    post(
        {
            type: 'result',
            id,
            disparity,
            width: outWidth,
            height: outHeight,
            ms,
            ...(semanticResult ? { semantic: semanticResult } : {}),
            ...(semanticError !== undefined ? { semanticError } : {}),
        },
        transfer,
    );
}

scope.onmessage = (event) => {
    const message = event.data;
    if (message.type === 'init') {
        init(message).catch((error: unknown) => {
            post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
        });
    } else if (message.type === 'load-semantic') {
        loadSemantic(message).catch((error: unknown) => {
            post({ type: 'semantic-error', message: error instanceof Error ? error.message : String(error) });
        });
    } else if (message.type === 'infer') {
        onOrtQueue(() => infer(message.id, message.rgba, message.width, message.height, message.semantic)).catch((error: unknown) => {
            post({ type: 'error', id: message.id, message: error instanceof Error ? error.message : String(error) });
        });
    } else if (message.type === 'dispose') {
        disposed = true;
        const sessions = [session, semanticSession].filter((x): x is OrtSession => x !== null);
        session = null;
        semanticSession = null;
        // After any queued create / inference: releasing a session mid-run is the same re-entrancy.
        void onOrtQueue(() => Promise.all(sessions.map((x) => x.release().catch(() => undefined)))).finally(() => device?.destroy());
    }
};
