/**
 * Messages between `DepthEstimator` (main thread) and `depthWorker.ts`.
 * Pixel and depth buffers are transferred, never copied.
 */
import type { DepthModelFile, DepthModelVariant } from './depthModel';

export interface DepthInitRequest {
    type: 'init';
    runtimeUrl: string;
    models: Record<DepthModelVariant, DepthModelFile>;
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
}

interface DepthDisposeRequest {
    type: 'dispose';
}

export type DepthWorkerRequest = DepthInitRequest | DepthInferRequest | DepthDisposeRequest;

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

export type DepthWorkerMessage =
    | DepthProgressMessage
    | DepthReadyMessage
    | DepthResultMessage
    | DepthErrorMessage
    | DepthLostMessage;
