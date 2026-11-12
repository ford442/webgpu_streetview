/**
 * Messages between `DepthEstimator` (main thread) and `depthWorker.ts`.
 * Pixel and depth buffers are transferred, never copied.
 */
import type { DepthModelFile, DepthModelVariant } from './depthModel';
import type { SemanticModelFile } from '../semantic/semanticModel';
import type { DepthAdapterRequest } from './depthAdapterPolicy';
import type { GpuAdapterIdentity } from '../../runtime/contexts';

export interface DepthInitRequest {
    type: 'init';
    runtimeUrl: string;
    models: Record<DepthModelVariant, DepthModelFile>;
    cacheName: string;
    cachePrefix: string;
    /** The road's resolved adapter options (#367): power preference, feature level, fallback. */
    adapterRequest: DepthAdapterRequest;
    /** The road adapter's identity, to prefer the same physical GPU; null before the road booted. */
    mainAdapter: GpuAdapterIdentity | null;
}

/**
 * Second session (#352): the semantic segmenter, on the same device and
 * runtime. Sent after `ready`; answered by `semantic-ready` or `semantic-error`.
 */
export interface DepthLoadSemanticRequest {
    type: 'load-semantic';
    model: SemanticModelFile;
    cacheName: string;
    cachePrefix: string;
}

interface DepthInferRequest {
    type: 'infer';
    id: number;
    /** sRGB-encoded RGBA8, `width × height`, tightly packed. */
    rgba: Uint8Array;
    width: number;
    height: number;
    /** Also run the semantic session on the same input tensor (#352). */
    semantic: boolean;
}

interface DepthDisposeRequest {
    type: 'dispose';
}

/**
 * Test / `?debug` hook: `device.destroy()` the Worker's device, which then
 * reports `lost` like a real loss — the recovery path's e2e trigger.
 */
interface DepthDebugLoseDeviceRequest {
    type: 'debug-lose-device';
}

export type DepthWorkerRequest =
    | DepthInitRequest
    | DepthLoadSemanticRequest
    | DepthInferRequest
    | DepthDisposeRequest
    | DepthDebugLoseDeviceRequest;

interface DepthProgressMessage {
    type: 'progress';
    loaded: number;
    total: number;
}

export interface DepthReadyMessage {
    type: 'ready';
    variant: DepthModelVariant;
    shaderF16: boolean;
    /** The model came out of the Cache API bucket — nothing was downloaded. */
    fromCache: boolean;
    /** Session create (graph optimisation + weight upload). */
    createMs: number;
    adapter: string;
    /** The power preference the accepted adapter was requested with; null = browser default. */
    powerPreference: GPUPowerPreference | null;
    /** The Worker's adapter is known to differ from the road's (after the one retry). */
    adapterMismatch: boolean;
    /** The first adapter differed and the opposite power preference was tried. */
    adapterRetried: boolean;
}

/** The semantic half of a result (#352): the class map at the input size. */
export interface SemanticResult {
    /** `width × height × 2` bytes for `rg8unorm`: class id + 1, probability. */
    texels: Uint8Array<ArrayBuffer>;
    width: number;
    height: number;
    /** Fraction of texels per class (`semanticClasses.ts` order). */
    histogram: Float32Array<ArrayBuffer>;
    meanConfidence: number;
    /** Mean RGB of the input pixels labelled sky (0–1; zeros without sky) — the sky regrade's reference and key. */
    skyColor: [number, number, number];
    /** The semantic `session.run` + decode, ms. */
    ms: number;
}

export interface DepthResultMessage {
    type: 'result';
    id: number;
    /** Relative inverse depth (larger = nearer), `width × height`. */
    disparity: Float32Array;
    width: number;
    height: number;
    /** `session.run` wall time, preprocessing and readback included. */
    ms: number;
    /** Present when the request asked for it and the semantic run succeeded. */
    semantic?: SemanticResult;
    /** The semantic run failed (the depth half is still good). */
    semanticError?: string;
}

interface SemanticProgressMessage {
    type: 'semantic-progress';
    loaded: number;
    total: number;
}

export interface SemanticReadyMessage {
    type: 'semantic-ready';
    fromCache: boolean;
    createMs: number;
}

/** The semantic session could not be created; depth is unaffected. */
interface SemanticLoadErrorMessage {
    type: 'semantic-error';
    message: string;
}

interface DepthErrorMessage {
    type: 'error';
    /** Set when one inference failed; absent when loading failed. */
    id?: number;
    message: string;
}

/** The worker's own device was lost; it will not run again. */
interface DepthLostMessage {
    type: 'lost';
    message: string;
}

/** An `uncapturederror` on the Worker's own device (validation / OOM); counted, not fatal. */
interface DepthGpuErrorMessage {
    type: 'gpu-error';
    message: string;
}

export type DepthWorkerMessage =
    | DepthProgressMessage
    | DepthReadyMessage
    | DepthResultMessage
    | DepthErrorMessage
    | DepthLostMessage
    | DepthGpuErrorMessage
    | SemanticProgressMessage
    | SemanticReadyMessage
    | SemanticLoadErrorMessage;
