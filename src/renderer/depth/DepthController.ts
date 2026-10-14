/**
 * The scene-depth pass (#320): turns the road's own pass-1 frame into a
 * per-pixel depth map every effect can read, and owns everything about it on
 * the road's device.
 *
 * ```
 * pass-1 intermediate ──gpuChores.downsampleTexture──▶ RGBA8 (≈252², aspect kept)
 *        ──sRGB──▶ depth Worker (own device, onnxruntime-web WebGPU EP)
 *        ──disparity──▶ normalise + EMA (depthMath) ──half floats──▶ r16float
 *        ──▶ FrameContext.aux.depth ──▶ weather sceneDepth(), pass-1 dolly
 * ```
 *
 * Rules it keeps:
 * - **Input is the intermediate only** — never the Maps canvas, never
 *   `videoTexture` — and never while a hold is active or a transition runs
 *   (`depthScheduler.ts`). A map that comes back after the pano changed is
 *   dropped.
 * - **Optional and lazy.** The `depth` `FramePass` initialises only when scene
 *   depth is switched on (it downloads ~25 MB once); a failure is reported on
 *   `webgpuProbe.passes.depth` and every consumer keeps its pre-depth look.
 * - **`depthBlend = 0` is bit-exact.** No map, a stale map, scene depth off or
 *   a Low/Medium preset all pack an all-zero params block.
 */
import type { FramePass } from '../framePasses/FramePassRegistry';
import type { GpuChores } from '../gpuChores/GpuChores';
import { createTrackedBuffer, createTrackedTexture, destroyTracked } from '../gpuMemoryTracking';
import {
    createSceneDepthBindGroup,
    createSceneDepthSampler,
    SCENE_DEPTH_FORMAT,
    SCENE_DEPTH_PARAMS_BYTE_SIZE,
    SCENE_DEPTH_PARAMS_FLOAT_COUNT,
    SceneDepthParamIndex,
    type AuxDepth,
} from './sceneDepthBinding';
import { DepthEstimator } from './DepthEstimator';
import { depthInputSize } from './depthModel';
import {
    createDepthNormalizeState,
    linearToSrgbBytesInPlace,
    normalizeDisparity,
    packHalfFloats,
} from './depthMath';
import { DepthScheduler, sameView, type DepthPov } from './depthScheduler';
import {
    depthConfidenceTarget,
    packSceneDepthParams,
    stepDepthConfidence,
    travelRelativeToView,
    type DepthHoldPose,
    type DepthMapPose,
} from './depthParams';
import { getSceneDepthStats, resetSceneDepthStats, setSceneDepthStats } from './sceneDepthStatsStore';
import type { SceneDepthOptions } from './sceneDepthOptions';

export const DEPTH_PASS_ORDER = 50;

/** Depth cannot run on this boot at all (as opposed to one inference failing). */
class DepthUnavailableError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'DepthUnavailableError';
    }
}

export interface DepthFrameInput {
    nowMs: number;
    view: DepthPov;
    holdActive: boolean;
    /** A release crossfade, year-chip wipe or legacy transition is running. */
    transitioning: boolean;
}

export interface DepthControllerDeps {
    device: GPUDevice;
    getChores: () => GpuChores | null;
    /** The pass-1 intermediate — the only texture depth may read. */
    getIntermediate: () => { texture: GPUTexture; width: number; height: number } | null;
    isHoldActive: () => boolean;
    isAlive: () => boolean;
    /** The estimator failed or lost its device after the pass was ready: report it. */
    onFailed: (error: Error) => void;
    /** Resolves same-origin model URLs (the page's `document.baseURI`). */
    baseUrl: string;
    createEstimator?: () => DepthEstimator;
}

interface PendingMap {
    halves: Uint16Array<ArrayBuffer>;
    width: number;
    height: number;
    pose: DepthMapPose;
}

const CADENCE_WINDOW_MS = 5000;

export class DepthController {
    public readonly pass: FramePass;

    private readonly options: SceneDepthOptions = { enabled: false, blend: 0, reducedMotion: false };
    private estimator: DepthEstimator | null = null;
    private estimatorLoading: Promise<void> | null = null;
    private readonly scheduler = new DepthScheduler();
    private readonly normalizeState = createDepthNormalizeState();
    private normalizeEpoch = -1;

    private paramsBuffer: GPUBuffer | null = null;
    private sampler: GPUSampler | null = null;
    private texture: GPUTexture | null = null;
    private aux: AuxDepth | null = null;
    private generation = 0;
    private readonly retired: Array<{ texture: GPUTexture; frame: number }> = [];
    private frameCounter = 0;

    private pending: PendingMap | null = null;
    private mapPose: DepthMapPose | null = null;
    private epoch = 0;
    private hold: DepthHoldPose | null = null;
    private confidence = 0;
    private lastFrameMs: number | null = null;
    private readonly params = new Float32Array(SCENE_DEPTH_PARAMS_FLOAT_COUNT);
    private readonly completions: number[] = [];
    private inFlight = false;
    private disposed = false;

    constructor(private readonly deps: DepthControllerDeps) {
        this.pass = {
            id: 'depth',
            order: DEPTH_PASS_ORDER,
            lazy: true,
            init: () => this.init(),
            enabled: () => this.aux !== null && this.options.enabled,
            encode: () => this.encode(),
            destroy: () => this.dispose(),
        };
    }

    /** True until the lazy pass has been initialised (or is initialising). */
    public isInitialised(): boolean {
        return this.paramsBuffer !== null;
    }

    public setOptions(options: SceneDepthOptions): void {
        const wasEnabled = this.options.enabled;
        // Copied field by field: called every frame with the caller's reused object.
        this.options.enabled = options.enabled;
        this.options.blend = options.blend;
        this.options.reducedMotion = options.reducedMotion;
        if (options.enabled === wasEnabled) return;
        if (!options.enabled) {
            // Free the Worker and its device; keep the small GPU texture.
            this.estimator?.dispose();
            this.estimator = null;
            this.estimatorLoading = null;
            this.scheduler.reset();
            this.confidence = 0;
            this.mapPose = null;
            this.pending = null;
            setSceneDepthStats({ state: 'off', reason: null, appliedBlend: 0, cadenceHz: 0 });
        } else if (this.isInitialised() && !this.estimator) {
            // Re-enabled after an off: the pass is ready, the Worker is not.
            void this.loadEstimator().catch((error: unknown) => this.fail(error));
        }
    }

    public getOptions(): Readonly<SceneDepthOptions> {
        return this.options;
    }

    /**
     * `Renderer.beginHoldTransition`: remember the hop being made, for the
     * release dolly. Kept until the next hold — pass 1 only reads the dolly
     * fields while the release crossfade runs (0 < t < 1).
     */
    public beginHold(captureHeadingDeg: number, capturePan: { x: number; y: number }, travelHeadingDeg?: number): void {
        this.hold = {
            capturePanX: capturePan.x,
            capturePanY: capturePan.y,
            epoch: this.epoch,
            travel: travelHeadingDeg === undefined || !Number.isFinite(travelHeadingDeg)
                ? null
                : travelRelativeToView(travelHeadingDeg, captureHeadingDeg),
        };
    }

    /** `Renderer.endHoldTransition`: a new pano is on screen — the map now labels the old one. */
    public endHold(): void {
        this.epoch += 1;
    }

    /** This frame's depth, or undefined — `Renderer` puts it on `FrameContext.aux`. */
    public currentAux(): AuxDepth | undefined {
        return this.options.enabled && this.aux ? this.aux : undefined;
    }

    /**
     * Per frame, before the encode: apply a finished map, ease trust, pack the
     * params the passes will read, and start an inference when one is due.
     */
    public onFrame(frame: DepthFrameInput): void {
        if (this.disposed || !this.paramsBuffer) return;
        this.frameCounter += 1;
        this.destroyRetired();
        const dt = this.lastFrameMs === null ? 0 : frame.nowMs - this.lastFrameMs;
        this.lastFrameMs = frame.nowMs;

        if (this.pending) this.applyPending(this.pending);

        const target = this.options.enabled ? depthConfidenceTarget(this.mapPose, this.epoch, frame.view.zoom) : 0;
        const panoChanged = !!this.mapPose && this.mapPose.epoch !== this.epoch;
        this.confidence = stepDepthConfidence(this.confidence, target, dt, panoChanged);
        packSceneDepthParams({
            blend: this.options.enabled ? this.options.blend : 0,
            confidence: this.confidence,
            dollyScale: this.options.reducedMotion ? 0 : 1,
            view: frame.view,
            map: this.mapPose,
            hold: this.hold,
        }, this.params);
        if (getSceneDepthStats().appliedBlend !== this.params[SceneDepthParamIndex.blend]) {
            setSceneDepthStats({ appliedBlend: this.params[SceneDepthParamIndex.blend]! });
        }

        const estimator = this.estimator;
        if (!this.options.enabled || !estimator?.isReady()) return;
        const scheduled = {
            nowMs: frame.nowMs,
            pov: frame.view,
            epoch: this.epoch,
            holdActive: frame.holdActive,
            transitioning: frame.transitioning,
            estimatorIdle: !this.inFlight && !estimator.isBusy(),
        };
        if (this.scheduler.shouldStart(scheduled)) {
            this.scheduler.started(scheduled);
            void this.infer(estimator, { ...frame.view, epoch: this.epoch });
        }
    }

    private async init(): Promise<void> {
        const { device } = this.deps;
        if (!this.paramsBuffer) {
            this.paramsBuffer = createTrackedBuffer(device, {
                label: 'scene-depth-params',
                size: SCENE_DEPTH_PARAMS_BYTE_SIZE,
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            }, 'scene-depth-params');
            this.sampler = createSceneDepthSampler(device);
        }
        await this.loadEstimator();
    }

    private loadEstimator(): Promise<void> {
        if (this.estimatorLoading) return this.estimatorLoading;
        const estimator = this.deps.createEstimator?.() ?? new DepthEstimator();
        this.estimator = estimator;
        setSceneDepthStats({ state: 'loading', reason: null, downloadedBytes: 0 });
        estimator.onLost = (reason) => this.fail(new Error(reason));
        this.estimatorLoading = estimator.load({
            baseUrl: this.deps.baseUrl,
            onProgress: (loaded, total) => setSceneDepthStats({ downloadedBytes: loaded, downloadTotal: total }),
        }).then((ready) => {
            if (this.estimator !== estimator) return; // turned off meanwhile
            setSceneDepthStats({
                state: 'ready',
                variant: ready.variant,
                shaderF16: ready.shaderF16,
                adapter: ready.adapter,
                fromCache: ready.fromCache,
                createMs: ready.createMs,
            });
        }, (error: unknown) => {
            // Switched off mid-download: that is "off", not a failure.
            if (this.estimator !== estimator) return;
            this.estimator = null;
            this.estimatorLoading = null;
            const err = error instanceof Error ? error : new Error(String(error));
            setSceneDepthStats({ state: 'failed', reason: err.message });
            throw err;
        });
        return this.estimatorLoading;
    }

    private async infer(estimator: DepthEstimator, pose: DepthMapPose): Promise<void> {
        const chores = this.deps.getChores();
        const intermediate = this.deps.getIntermediate();
        if (!chores || !intermediate || intermediate.width < 2 || intermediate.height < 2) {
            this.scheduler.failed(performance.now());
            return;
        }
        this.inFlight = true;
        try {
            const size = depthInputSize(intermediate.width, intermediate.height);
            const rgba = await chores.downsampleTexture(intermediate.texture, size.width, size.height);
            if (!rgba) {
                // GPU chores off (`?no_gpu_compute`, adapter limits, init failed): no
                // readback path at all. Otherwise one readback failed — try again later.
                if (chores.currentBackend() !== 'webgpu') {
                    throw new DepthUnavailableError(
                        'scene depth needs the GPU chores readback (off: ?no_gpu_compute, adapter limits, or chores init failed)',
                    );
                }
                throw new Error('scene-depth readback failed');
            }
            if (!this.stillCurrent(pose)) {
                this.scheduler.dropped();
                return;
            }
            linearToSrgbBytesInPlace(rgba);
            const result = await estimator.infer(rgba, size.width, size.height);
            if (!this.stillCurrent(pose)) {
                this.scheduler.dropped();
                return;
            }

            const sameScene = this.normalizeEpoch === pose.epoch;
            const aligned = sameScene && !!this.mapPose && this.mapPose.epoch === pose.epoch && sameView(this.mapPose, pose);
            this.normalizeEpoch = pose.epoch;
            const depth = normalizeDisparity(result.disparity, this.normalizeState, { aligned, sameScene });
            this.pending = {
                halves: packHalfFloats(depth),
                width: result.width,
                height: result.height,
                pose,
            };
            this.recordInference(result.ms, size);
        } catch (error) {
            if (this.disposed || this.estimator !== estimator) return;
            this.scheduler.failed(performance.now());
            // A missing readback path is permanent; a single failed run is not.
            if (error instanceof DepthUnavailableError) this.fail(error);
        } finally {
            this.inFlight = false;
        }
    }

    private stillCurrent(pose: DepthMapPose): boolean {
        return !this.disposed
            && this.options.enabled
            && pose.epoch === this.epoch
            && !this.deps.isHoldActive()
            && this.deps.isAlive();
    }

    private recordInference(ms: number, size: { width: number; height: number }): void {
        const now = performance.now();
        this.completions.push(now);
        while (this.completions.length && now - this.completions[0]! > CADENCE_WINDOW_MS) this.completions.shift();
        const stats = getSceneDepthStats();
        setSceneDepthStats({
            inferenceMs: ms,
            inferences: stats.inferences + 1,
            cadenceHz: this.completions.length / (CADENCE_WINDOW_MS / 1000),
            inputWidth: size.width,
            inputHeight: size.height,
        });
    }

    /** Upload a finished map, (re)creating the texture and its bind group when the size changed. */
    private applyPending(map: PendingMap): void {
        this.pending = null;
        const { device } = this.deps;
        if (!this.texture || this.texture.width !== map.width || this.texture.height !== map.height) {
            if (this.texture) this.retired.push({ texture: this.texture, frame: this.frameCounter });
            this.texture = createTrackedTexture(device, {
                label: 'scene-depth',
                size: [map.width, map.height],
                format: SCENE_DEPTH_FORMAT,
                usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
            }, 'scene-depth');
        }
        const texture = this.texture;
        device.queue.writeTexture(
            { texture },
            map.halves,
            { bytesPerRow: map.width * 2, rowsPerImage: map.height },
            { width: map.width, height: map.height },
        );
        this.mapPose = map.pose;
        this.generation += 1;
        if (!this.aux || this.aux.texture !== texture) {
            const view = texture.createView();
            this.aux = {
                texture,
                view,
                width: map.width,
                height: map.height,
                generation: this.generation,
                bindGroup: createSceneDepthBindGroup(device, view, this.sampler!, this.paramsBuffer!, 'scene-depth'),
            };
        } else {
            this.aux = { ...this.aux, generation: this.generation };
        }
        setSceneDepthStats({ generation: this.generation });
    }

    /** The pass's encode: this frame's params, written before the frame's submit. */
    private encode(): void {
        if (!this.paramsBuffer) return;
        this.deps.device.queue.writeBuffer(this.paramsBuffer, 0, this.params);
    }

    /** A replaced texture may still be bound by the frame that last used it: drop it two frames on. */
    private destroyRetired(): void {
        while (this.retired.length && this.frameCounter - this.retired[0]!.frame >= 2) {
            destroyTracked(this.retired.shift()!.texture);
        }
    }

    private fail(error: unknown): void {
        if (this.disposed) return;
        const err = error instanceof Error ? error : new Error(String(error));
        this.estimator?.dispose();
        this.estimator = null;
        this.estimatorLoading = null;
        this.aux = null;
        this.mapPose = null;
        this.confidence = 0;
        setSceneDepthStats({ state: 'failed', reason: err.message, appliedBlend: 0, cadenceHz: 0 });
        this.deps.onFailed(err);
    }

    public dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.estimator?.dispose();
        this.estimator = null;
        this.estimatorLoading = null;
        this.aux = null;
        for (const r of this.retired.splice(0)) destroyTracked(r.texture);
        destroyTracked(this.texture);
        destroyTracked(this.paramsBuffer);
        this.texture = null;
        this.paramsBuffer = null;
        resetSceneDepthStats();
    }
}
