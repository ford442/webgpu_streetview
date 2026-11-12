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
 * - **It also feeds the semantic layer (#352).** A `SemanticSink`
 *   (`semantic/SemanticController.ts`) rides on this pipeline: same scheduler,
 *   same readback, same Worker and input tensor — each inference also runs the
 *   semantic session while the sink wants maps, and the class map is handed to
 *   the sink with the pose it was inferred at.
 * - **A lost Worker device recovers (#367).** The road's capped backoff
 *   (`deviceLossRecovery.ts`, 3 tries per incident) re-creates the estimator;
 *   depth and the semantic session resume without a user toggle. The state
 *   reads `recovering` meanwhile, and the map's weight is 0 until a new map lands.
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
import { DeviceLossRecovery, type DeviceLossDecision } from '../deviceLossRecovery';
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
    releaseDollyScale,
    stepDepthConfidence,
    travelRelativeToView,
    type DepthHoldPose,
    type DepthMapPose,
} from './depthParams';
import { isXrPresenting } from '../xrPresentFrame';
import {
    clearSceneDepthLoseDeviceHook,
    getSceneDepthStats,
    resetSceneDepthStats,
    setSceneDepthLoseDeviceHook,
    setSceneDepthStats,
} from './sceneDepthStatsStore';
import type { SceneDepthOptions } from './sceneDepthOptions';
import type { SemanticResult, SemanticReadyMessage } from './depthProtocol';
import type { SemanticLoadOptions } from './DepthEstimator';

/** The semantic layer's side of the shared pipeline (#352). */
export interface SemanticSink {
    /** Run the semantic session with every inference (opted in and loaded). */
    wantsMaps(): boolean;
    /** A class map inferred at `pose`, still current when it arrives. */
    accept(result: SemanticResult, pose: DepthMapPose): void;
    /** One semantic run failed (the depth half was fine). */
    inferenceFailed(message: string): void;
    /** The Worker (and with it the semantic session) is gone: depth off, failed, recovering or disposed. */
    pipelineReset(reason?: string): void;
}
const DEPTH_PASS_ORDER = 50;

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
    /** Backoff policy for a lost Worker device; the road's defaults when omitted. */
    lossRecovery?: DeviceLossRecovery;
}

function delay(ms: number): Promise<void> {
    return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
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
    private semanticSink: SemanticSink | null = null;
    private readonly lossRecovery: DeviceLossRecovery;

    constructor(private readonly deps: DepthControllerDeps) {
        this.lossRecovery = deps.lossRecovery ?? new DeviceLossRecovery();
        setSceneDepthLoseDeviceHook(this.loseDeviceHook);
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

    /** True once the lazy pass has started initialising (its GPU resources exist). */
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
            this.semanticSink?.pipelineReset();
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

    /** The semantic layer (#352) rides on this pipeline; one sink per controller. */
    public attachSemantic(sink: SemanticSink | null): void {
        this.semanticSink = sink;
    }

    /**
     * Load the semantic session into the depth Worker. Needs scene depth on and
     * its estimator loaded (the semantic layer has no pipeline of its own).
     */
    public async loadSemantic(options: SemanticLoadOptions): Promise<SemanticReadyMessage> {
        if (!this.options.enabled || !this.estimatorLoading) {
            throw new Error('the semantic layer needs scene depth on (it shares the depth pipeline)');
        }
        // A device-loss recovery replaces the load in flight: follow it to the
        // estimator that actually comes up.
        let loading: Promise<void> | null = this.estimatorLoading;
        while (loading !== null) {
            await loading;
            if (this.estimatorLoading === loading) break;
            loading = this.estimatorLoading;
        }
        const estimator = this.estimator;
        if (!estimator || this.disposed) throw new Error('scene depth was switched off');
        return estimator.loadSemantic(options);
    }

    /** Bumped on every hold release: a map from an older epoch labels another pano. */
    public currentEpoch(): number {
        return this.epoch;
    }

    /** Re-infer the current view even though its depth map is current (a new consumer wants a map). */
    public requestRefresh(): void {
        this.scheduler.dropped();
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
            dollyScale: releaseDollyScale({ reducedMotion: this.options.reducedMotion, xr: isXrPresenting() }),
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

    /** Test / `?debug` hook: destroy the Worker's device (the recovery path's trigger). */
    public debugLoseDevice(): boolean {
        return this.estimator?.debugLoseDevice() ?? false;
    }

    private readonly loseDeviceHook = (): boolean => this.debugLoseDevice();

    private loadEstimator(delayMs = 0): Promise<void> {
        if (this.estimatorLoading) return this.estimatorLoading;
        const estimator = this.deps.createEstimator?.() ?? new DepthEstimator();
        this.estimator = estimator;
        const recovering = this.lossRecovery.isRecovering();
        if (!recovering) setSceneDepthStats({ state: 'loading', reason: null, downloadedBytes: 0 });
        estimator.onLost = (reason) => this.onEstimatorLost(estimator, reason);
        const loading: Promise<void> = delay(delayMs).then(() => {
            if (this.estimator !== estimator) throw new Error('scene depth was switched off');
            return estimator.load({
                baseUrl: this.deps.baseUrl,
                onProgress: (loaded, total) => setSceneDepthStats({ downloadedBytes: loaded, downloadTotal: total }),
            });
        }).then((ready) => {
            if (this.estimator !== estimator) return; // turned off meanwhile
            const wasRecovering = this.lossRecovery.isRecovering();
            this.lossRecovery.onBootSucceeded();
            setSceneDepthStats({
                state: 'ready',
                reason: null,
                variant: ready.variant,
                shaderF16: ready.shaderF16,
                adapter: ready.adapter,
                powerPreference: ready.powerPreference,
                adapterMismatch: ready.adapterMismatch,
                fromCache: ready.fromCache,
                createMs: ready.createMs,
                ...(wasRecovering ? { recoveries: getSceneDepthStats().recoveries + 1 } : {}),
            });
            if (ready.adapterMismatch) {
                console.warn(`[SceneDepth] the depth Worker runs on a different adapter than the road (${ready.adapter})`);
            }
        }, (error: unknown) => {
            // Switched off mid-download: that is "off", not a failure.
            if (this.estimator !== estimator) return;
            const err = error instanceof Error ? error : new Error(String(error));
            if (this.lossRecovery.isRecovering()) {
                const decision = this.lossRecovery.onReinitFailed();
                if (decision.action === 'reinit') {
                    this.scheduleRecovery(decision, err.message);
                    return;
                }
            }
            this.estimator = null;
            this.estimatorLoading = null;
            setSceneDepthStats({ state: 'failed', reason: err.message });
            throw err;
        });
        this.estimatorLoading = loading;
        return loading;
    }

    /** The Worker's device was lost (or the Worker died) after it was ready. */
    private onEstimatorLost(estimator: DepthEstimator, reason: string): void {
        if (this.disposed || this.estimator !== estimator) return;
        console.warn('[SceneDepth] worker device lost:', reason);
        setSceneDepthStats({ lastLossReason: reason });
        const decision = this.lossRecovery.onDeviceLost();
        if (decision.action === 'give-up') {
            this.fail(new Error(`${reason} (no recovery after ${decision.attempts} attempt(s))`));
            return;
        }
        this.scheduleRecovery(decision, reason);
    }

    /** Drop the dead estimator, keep the pass, and load a new one after the backoff. */
    private scheduleRecovery(decision: Extract<DeviceLossDecision, { action: 'reinit' }>, reason: string): void {
        this.estimator?.dispose();
        this.estimator = null;
        this.estimatorLoading = null;
        this.semanticSink?.pipelineReset('scene depth is recovering from a device loss');
        this.scheduler.reset();
        this.mapPose = null;
        this.pending = null;
        this.confidence = 0;
        this.inFlight = false;
        setSceneDepthStats({ state: 'recovering', reason, recoveryAttempt: decision.attempt, cadenceHz: 0 });
        console.warn(`[SceneDepth] recovery attempt ${decision.attempt} in ${decision.delayMs} ms`);
        // A give-up surfaces through the load's own rejection: report it as a failure.
        this.loadEstimator(decision.delayMs).catch((error: unknown) => this.fail(error));
    }

    private async infer(estimator: DepthEstimator, pose: DepthMapPose): Promise<void> {
        const chores = this.deps.getChores();
        const intermediate = this.deps.getIntermediate();
        if (!chores || !intermediate || intermediate.width < 2 || intermediate.height < 2) {
            this.scheduler.failed(this.lastFrameMs ?? 0);
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
            const sink = this.semanticSink;
            const result = await estimator.infer(rgba, size.width, size.height, { semantic: !!sink?.wantsMaps() });
            if (!this.stillCurrent(pose)) {
                this.scheduler.dropped();
                return;
            }
            if (sink && result.semantic) sink.accept(result.semantic, pose);
            else if (sink && result.semanticError !== undefined) sink.inferenceFailed(result.semanticError);

            const sameScene = this.normalizeEpoch === pose.epoch;
            const aligned = sameScene && !!this.mapPose && this.mapPose.epoch === pose.epoch && sameView(this.mapPose, pose);
            this.normalizeEpoch = pose.epoch;
            const depth = normalizeDisparity(result.disparity, this.normalizeState, {
                aligned,
                sameScene,
                width: result.width,
                height: result.height,
                // The pitch horizon at inference — the ground below it calibrates the scale.
                horizonY: 0.5 + (pose.panY - 0.5) * 2,
            });
            this.pending = {
                halves: packHalfFloats(depth),
                width: result.width,
                height: result.height,
                pose,
            };
            this.recordInference(result.ms, size);
        } catch (error) {
            if (this.disposed || this.estimator !== estimator) return;
            this.scheduler.failed(this.lastFrameMs ?? 0);
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
        this.scheduler.completed(ms);
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
            slowDevice: this.scheduler.slowDevice,
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
                // COPY_SRC: lets tools and the e2e fixture read the map back.
                usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC,
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
        this.semanticSink?.pipelineReset();
        this.aux = null;
        this.mapPose = null;
        this.confidence = 0;
        setSceneDepthStats({ state: 'failed', reason: err.message, appliedBlend: 0, cadenceHz: 0 });
        this.deps.onFailed(err);
    }

    public dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        clearSceneDepthLoseDeviceHook(this.loseDeviceHook);
        this.estimator?.dispose();
        this.estimator = null;
        this.estimatorLoading = null;
        this.semanticSink?.pipelineReset();
        this.semanticSink = null;
        this.aux = null;
        for (const r of this.retired.splice(0)) destroyTracked(r.texture);
        destroyTracked(this.texture);
        destroyTracked(this.paramsBuffer);
        this.texture = null;
        this.paramsBuffer = null;
        resetSceneDepthStats();
    }
}
