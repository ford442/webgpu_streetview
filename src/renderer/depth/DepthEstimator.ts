/**
 * Main-thread handle on the depth Worker (`depthWorker.ts`): load once, then
 * one inference at a time. Owns nothing on the road's device.
 */
import {
    DEPTH_MODEL_CACHE_NAME,
    DEPTH_MODEL_CACHE_PREFIX,
    DEPTH_RUNTIME_URL,
    depthModelFiles,
} from './depthModel';
import type {
    DepthReadyMessage,
    DepthResultMessage,
    DepthWorkerMessage,
    DepthWorkerRequest,
    SemanticReadyMessage,
} from './depthProtocol';
import {
    SEMANTIC_MODEL_CACHE_NAME,
    SEMANTIC_MODEL_CACHE_PREFIX,
    semanticModelFile,
} from '../semantic/semanticModel';

/** What `DepthEstimator` needs of a Worker — a fake in tests. */
export interface DepthWorkerLike {
    postMessage(message: DepthWorkerRequest, transfer?: Transferable[]): void;
    terminate(): void;
    onmessage: ((event: MessageEvent<DepthWorkerMessage>) => void) | null;
    onerror: ((event: ErrorEvent) => void) | null;
}

export type DepthWorkerFactory = () => DepthWorkerLike;

/**
 * A module Worker, bundled by Vite as its own file. It imports the runtime
 * from the CDN at run time, so it stays a few KB.
 */
const createDepthWorker: DepthWorkerFactory = () =>
    new Worker(new URL('./depthWorker.ts', import.meta.url), {
        type: 'module',
        name: 'scene-depth',
    });

export interface SemanticLoadOptions {
    baseUrl: string;
    onProgress?: (loaded: number, total: number) => void;
}

interface SemanticLoad {
    promise: Promise<SemanticReadyMessage>;
    resolve: (ready: SemanticReadyMessage) => void;
    reject: (error: Error) => void;
    onProgress: ((loaded: number, total: number) => void) | undefined;
}

export interface DepthLoadOptions {
    /** Base the same-origin model URLs resolve against (the page's `document.baseURI`). */
    baseUrl: string;
    onProgress?: (loaded: number, total: number) => void;
}

type Pending = {
    resolve: (result: DepthResultMessage) => void;
    reject: (error: Error) => void;
};

export class DepthEstimator {
    private worker: DepthWorkerLike | null = null;
    private ready: DepthReadyMessage | null = null;
    private loading: Promise<DepthReadyMessage> | null = null;
    private pending = new Map<number, Pending>();
    private nextId = 1;
    private lostReason: string | null = null;
    /** `uncapturederror`s the Worker's device raised (validation / OOM). */
    public gpuErrors = 0;
    public lastGpuError: string | null = null;
    /** Rejects an in-progress `load` — so a dispose mid-download settles it. */
    private abortLoad: ((error: Error) => void) | null = null;
    /** The semantic session (#352): loading or loaded, on the same Worker. */
    private semanticLoad: SemanticLoad | null = null;
    private semanticReady: SemanticReadyMessage | null = null;

    /** Called once if the Worker's device is lost or the Worker dies after loading. */
    public onLost: ((reason: string) => void) | null = null;

    constructor(private readonly createWorker: DepthWorkerFactory = createDepthWorker) {}

    public isReady(): boolean {
        return this.ready !== null && this.lostReason === null;
    }

    public getReadyInfo(): DepthReadyMessage | null {
        return this.ready;
    }

    /** The semantic session is loaded: `infer(…, { semantic: true })` will run it. */
    public isSemanticReady(): boolean {
        return this.semanticReady !== null && this.isReady();
    }

    /**
     * Load the semantic session into the (ready) Worker — its own download and
     * cache bucket, the same device. Idempotent; a failure rejects this call
     * only (depth keeps running) and a later call tries again.
     */
    public loadSemantic(options: SemanticLoadOptions): Promise<SemanticReadyMessage> {
        if (this.semanticLoad) return this.semanticLoad.promise;
        if (!this.worker || !this.isReady()) {
            return Promise.reject(new Error(this.lostReason ?? 'depth estimator is not ready'));
        }
        let resolve!: (ready: SemanticReadyMessage) => void;
        let reject!: (error: Error) => void;
        const promise = new Promise<SemanticReadyMessage>((res, rej) => {
            resolve = res;
            reject = rej;
        });
        this.semanticLoad = { promise, resolve, reject, onProgress: options.onProgress };
        this.worker.postMessage({
            type: 'load-semantic',
            model: semanticModelFile(options.baseUrl),
            cacheName: SEMANTIC_MODEL_CACHE_NAME,
            cachePrefix: SEMANTIC_MODEL_CACHE_PREFIX,
        });
        return promise;
    }

    public isBusy(): boolean {
        return this.pending.size > 0;
    }

    /** Spawn the Worker, fetch runtime + model (Cache API first), build the session. */
    public load(options: DepthLoadOptions): Promise<DepthReadyMessage> {
        if (this.loading) return this.loading;
        this.loading = new Promise<DepthReadyMessage>((resolve, reject) => {
            let worker: DepthWorkerLike;
            try {
                worker = this.createWorker();
            } catch (error) {
                reject(error instanceof Error ? error : new Error(String(error)));
                return;
            }
            this.worker = worker;
            let settled = false;
            const fail = (message: string) => {
                if (!settled) {
                    settled = true;
                    this.abortLoad = null;
                    reject(new Error(message));
                } else {
                    this.markLost(message);
                }
            };
            this.abortLoad = (error) => fail(error.message);
            worker.onerror = (event) => {
                event.preventDefault?.();
                fail(`depth worker failed: ${event.message || 'script error'}`);
            };
            worker.onmessage = (event) => {
                const message = event.data;
                switch (message.type) {
                    case 'progress':
                        options.onProgress?.(message.loaded, message.total);
                        break;
                    case 'ready':
                        this.ready = message;
                        settled = true;
                        this.abortLoad = null;
                        resolve(message);
                        break;
                    case 'result': {
                        const p = this.pending.get(message.id);
                        this.pending.delete(message.id);
                        p?.resolve(message);
                        break;
                    }
                    case 'error':
                        if (message.id !== undefined) {
                            const p = this.pending.get(message.id);
                            this.pending.delete(message.id);
                            p?.reject(new Error(message.message));
                        } else {
                            fail(message.message);
                        }
                        break;
                    case 'gpu-error':
                        this.gpuErrors += 1;
                        this.lastGpuError = message.message;
                        console.warn('[SceneDepth] worker device uncapturederror', message.message);
                        break;
                    case 'lost':
                        fail(`depth device lost: ${message.message}`);
                        break;
                    case 'semantic-progress':
                        this.semanticLoad?.onProgress?.(message.loaded, message.total);
                        break;
                    case 'semantic-ready':
                        this.semanticReady = message;
                        this.semanticLoad?.resolve(message);
                        break;
                    case 'semantic-error': {
                        const load = this.semanticLoad;
                        this.semanticLoad = null;
                        load?.reject(new Error(message.message));
                        break;
                    }
                }
            };
            worker.postMessage({
                type: 'init',
                runtimeUrl: DEPTH_RUNTIME_URL,
                models: depthModelFiles(options.baseUrl),
                cacheName: DEPTH_MODEL_CACHE_NAME,
                cachePrefix: DEPTH_MODEL_CACHE_PREFIX,
            });
        });
        // A failed load is final for this estimator; the owner makes a new one to retry.
        this.loading.catch(() => this.terminate());
        return this.loading;
    }

    /**
     * One inference. `rgba` (sRGB RGBA8, `width × height`) is transferred to
     * the Worker. `semantic` also runs the semantic session on the same input.
     */
    public infer(
        rgba: Uint8Array,
        width: number,
        height: number,
        options: { semantic?: boolean } = {},
    ): Promise<DepthResultMessage> {
        if (!this.worker || !this.isReady()) {
            return Promise.reject(new Error(this.lostReason ?? 'depth estimator is not ready'));
        }
        const id = this.nextId++;
        return new Promise<DepthResultMessage>((resolve, reject) => {
            this.pending.set(id, { resolve, reject });
            this.worker!.postMessage(
                { type: 'infer', id, rgba, width, height, semantic: !!options.semantic && this.isSemanticReady() },
                [rgba.buffer],
            );
        });
    }

    public dispose(): void {
        if (this.worker && this.ready) {
            try {
                this.worker.postMessage({ type: 'dispose' });
            } catch {
                // Already gone.
            }
        }
        this.terminate();
    }

    private markLost(reason: string): void {
        if (this.lostReason) return;
        this.lostReason = reason;
        const semanticLoad = this.semanticLoad;
        this.semanticLoad = null;
        this.semanticReady = null;
        semanticLoad?.reject(new Error(reason));
        this.rejectPending(reason);
        this.onLost?.(reason);
    }

    private rejectPending(reason: string): void {
        for (const p of this.pending.values()) p.reject(new Error(reason));
        this.pending.clear();
    }

    private terminate(): void {
        this.abortLoad?.(new Error('depth estimator disposed'));
        this.abortLoad = null;
        const semanticLoad = this.semanticLoad;
        this.semanticLoad = null;
        this.semanticReady = null;
        if (semanticLoad) semanticLoad.reject(new Error('depth estimator disposed'));
        this.rejectPending('depth estimator disposed');
        const worker = this.worker;
        this.worker = null;
        this.ready = null;
        if (worker) {
            worker.onmessage = null;
            worker.onerror = null;
            // Let a posted `dispose` release the session and device first.
            setTimeout(() => worker.terminate(), 0);
        }
    }
}
