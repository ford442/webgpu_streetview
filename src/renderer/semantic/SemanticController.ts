/**
 * The semantic scene layer (#352): a per-pixel class map of the road frame
 * (sky / road / sidewalk / building / vegetation / vehicle / person) every
 * weather effect can read, and everything about it on the road's device.
 *
 * ```
 * DepthController's pipeline (same scheduler, readback, Worker, input tensor)
 *        ──semantic session (DDRNet23-Slim + 7-class head)──▶ rg8 class map
 *        ──▶ SemanticController (this) ──▶ rg8unorm texture + params
 *        ──▶ FrameContext.aux.semantic ──▶ weather group 3 (sceneClass / classWeight)
 *        ──sky lower edge──▶ the image-derived horizon (slots 40–41)
 * ```
 *
 * Rules it keeps (the depth layer's, inherited through its pipeline):
 * - **Input is the intermediate only, never during a hold**; a map is only
 *   handed over while its pano is still on screen.
 * - **Optional and lazy.** The `semantic` `FramePass` initialises when the
 *   layer is switched on (≈ 12 MB once, into the depth Worker); a failure is
 *   reported on `webgpuProbe.passes.semantic` and every consumer keeps its
 *   pre-semantic look. It needs scene depth on — it has no pipeline of its own.
 * - **`semanticBlend = 0` is bit-exact.** No map, a stale map, the layer off
 *   or a Low/Medium preset all pack an all-zero params block.
 */
import type { FramePass } from '../framePasses/FramePassRegistry';
import { createTrackedBuffer, createTrackedTexture, destroyTracked } from '../gpuMemoryTracking';
import type { DepthPov } from '../depth/depthScheduler';
import { depthConfidenceTarget, stepDepthConfidence, type DepthMapPose } from '../depth/depthParams';
import type { SemanticSink } from '../depth/DepthController';
import type { SemanticResult, SemanticReadyMessage } from '../depth/depthProtocol';
import type { SemanticLoadOptions } from '../depth/DepthEstimator';
import {
    createSceneSemanticBindGroup,
    createSceneSemanticSampler,
    SCENE_SEMANTIC_PARAMS_BYTE_SIZE,
    SCENE_SEMANTIC_PARAMS_FLOAT_COUNT,
    SceneSemanticParamIndex,
    type AuxSemantic,
} from './sceneSemanticBinding';
import { SEMANTIC_CLASS_NAMES, SEMANTIC_MAP_FORMAT, type SemanticClassName } from './semanticClasses';
import { packSceneSemanticParams, SEMANTIC_EFFECTS_DEFAULT, type SemanticEffectWeights } from './semanticParams';
import { skyLowerEdge } from './semanticHorizon';
import {
    getSceneSemanticStats,
    resetSceneSemanticStats,
    setSceneSemanticStats,
} from './sceneSemanticStatsStore';
import type { SceneSemanticOptions } from './sceneSemanticOptions';

const SEMANTIC_PASS_ORDER = 51;

/** The slice of `DepthController` the semantic layer rides on. */
interface SemanticPipeline {
    attachSemantic(sink: SemanticSink | null): void;
    loadSemantic(options: SemanticLoadOptions): Promise<SemanticReadyMessage>;
    requestRefresh(): void;
    currentEpoch(): number;
}

export interface SemanticControllerDeps {
    device: GPUDevice;
    pipeline: SemanticPipeline;
    /** Resolves the same-origin model URL (the page's `document.baseURI`). */
    baseUrl: string;
    /** The session failed to load after the pass was ready: report it. */
    onFailed: (error: Error) => void;
}

export interface SemanticFrameInput {
    nowMs: number;
    view: DepthPov;
}

/** The sky boundary of the current map, for the horizon estimate. */
export interface SemanticSkyEdge {
    /** Screen Y (top-origin) of the sky's lower edge at the pitch the map was inferred at. */
    y: number;
    /** Normalised pitch (0.5 = level) the map was inferred at. */
    pitch: number;
    /** Bumped per map, so one edge is integrated once. */
    seq: number;
}

interface PendingMap {
    skyColor: readonly [number, number, number];
    texels: Uint8Array<ArrayBuffer>;
    width: number;
    height: number;
    pose: DepthMapPose;
}

type SessionState = 'none' | 'loading' | 'ready';

export class SemanticController implements SemanticSink {
    public readonly pass: FramePass;

    private readonly options: SceneSemanticOptions = { enabled: false, blend: 0, reducedMotion: false };
    private effects: Readonly<SemanticEffectWeights> = SEMANTIC_EFFECTS_DEFAULT;
    private session: SessionState = 'none';
    private sessionLoad: Promise<void> | null = null;

    private paramsBuffer: GPUBuffer | null = null;
    private sampler: GPUSampler | null = null;
    private texture: GPUTexture | null = null;
    private aux: AuxSemantic | null = null;
    private generation = 0;
    private readonly retired: Array<{ texture: GPUTexture; frame: number }> = [];
    private frameCounter = 0;

    private pending: PendingMap | null = null;
    private mapPose: DepthMapPose | null = null;
    private mapSkyColor: readonly [number, number, number] = [0, 0, 0];
    private skyEdge: SemanticSkyEdge | null = null;
    private confidence = 0;
    private lastFrameMs: number | null = null;
    private readonly params = new Float32Array(SCENE_SEMANTIC_PARAMS_FLOAT_COUNT);
    private disposed = false;

    constructor(private readonly deps: SemanticControllerDeps) {
        this.pass = {
            id: 'semantic',
            order: SEMANTIC_PASS_ORDER,
            lazy: true,
            init: () => this.init(),
            enabled: () => this.aux !== null && this.options.enabled,
            encode: () => this.encode(),
            destroy: () => this.dispose(),
        };
        deps.pipeline.attachSemantic(this);
    }

    public isInitialised(): boolean {
        return this.paramsBuffer !== null;
    }

    /** The session is gone (depth was switched off and on): the pass is ready, the session is not. */
    public needsSession(): boolean {
        return this.isInitialised() && this.options.enabled && this.session === 'none';
    }

    public setOptions(options: SceneSemanticOptions): void {
        const wasEnabled = this.options.enabled;
        this.options.enabled = options.enabled;
        this.options.blend = options.blend;
        this.options.reducedMotion = options.reducedMotion;
        if (options.enabled === wasEnabled) return;
        if (!options.enabled) {
            this.confidence = 0;
            this.mapPose = null;
            this.pending = null;
            this.skyEdge = null;
            setSceneSemanticStats({ state: 'off', reason: null, appliedBlend: 0, skyEdgeY: null });
        } else if (this.session === 'ready') {
            // Back on with the session still loaded: label the current view now.
            this.deps.pipeline.requestRefresh();
        }
    }

    public getOptions(): Readonly<SceneSemanticOptions> {
        return this.options;
    }

    /** Per-consumer strengths (tests, tools; the presets use the defaults). */
    public setEffects(effects: Readonly<SemanticEffectWeights>): void {
        this.effects = effects;
    }

    /** This frame's class map, or undefined — `Renderer` puts it on `FrameContext.aux`. */
    public currentAux(): AuxSemantic | undefined {
        return this.options.enabled && this.aux ? this.aux : undefined;
    }

    /** The current map's sky edge while its weight is applied; null otherwise. */
    public currentSkyEdge(): SemanticSkyEdge | null {
        return this.params[SceneSemanticParamIndex.blend]! > 0 ? this.skyEdge : null;
    }

    /** Load (or reload, after depth was cycled) the semantic session into the depth Worker. */
    public loadSession(): Promise<void> {
        if (this.sessionLoad) return this.sessionLoad;
        this.session = 'loading';
        setSceneSemanticStats({ state: 'loading', reason: null, downloadedBytes: 0 });
        const load = this.deps.pipeline.loadSemantic({
            baseUrl: this.deps.baseUrl,
            onProgress: (loaded, total) => setSceneSemanticStats({ downloadedBytes: loaded, downloadTotal: total }),
        }).then((ready) => {
            if (this.sessionLoad !== load) return;
            this.sessionLoad = null;
            this.session = 'ready';
            setSceneSemanticStats({ state: 'ready', fromCache: ready.fromCache, createMs: ready.createMs });
            // The current depth map was inferred without a class map: run again.
            this.deps.pipeline.requestRefresh();
        }, (error: unknown) => {
            if (this.sessionLoad !== load) return;
            this.sessionLoad = null;
            this.session = 'none';
            const err = error instanceof Error ? error : new Error(String(error));
            setSceneSemanticStats({ state: 'failed', reason: err.message, appliedBlend: 0 });
            throw err;
        });
        this.sessionLoad = load;
        return load;
    }

    // ---------------------------------------------------------------- SemanticSink

    public wantsMaps(): boolean {
        return !this.disposed && this.options.enabled && this.session === 'ready';
    }

    public accept(result: SemanticResult, pose: DepthMapPose): void {
        if (!this.wantsMaps()) return;
        this.pending = { texels: result.texels, width: result.width, height: result.height, pose, skyColor: result.skyColor };
        const histogram = {} as Record<SemanticClassName, number>;
        SEMANTIC_CLASS_NAMES.forEach((name, i) => {
            histogram[name] = result.histogram[i] ?? 0;
        });
        const edge = skyLowerEdge(result.texels, result.width, result.height);
        this.skyEdge = edge
            ? {
                // Map Y is screen Y at the zoom and pitch the map was inferred at.
                y: edge.y,
                pitch: pose.panY,
                seq: (this.skyEdge?.seq ?? 0) + 1,
            }
            : null;
        const stats = getSceneSemanticStats();
        setSceneSemanticStats({
            inferences: stats.inferences + 1,
            inferenceMs: result.ms,
            width: result.width,
            height: result.height,
            histogram,
            meanConfidence: result.meanConfidence,
            skyColor: result.skyColor.some((v) => v > 0) ? [...result.skyColor] : null,
            skyEdgeY: edge ? edge.y : null,
        });
    }

    public inferenceFailed(message: string): void {
        const stats = getSceneSemanticStats();
        setSceneSemanticStats({ failures: stats.failures + 1, reason: message });
    }

    public pipelineReset(reason = 'scene depth is off'): void {
        this.session = 'none';
        this.sessionLoad = null;
        this.confidence = 0;
        this.mapPose = null;
        this.pending = null;
        this.skyEdge = null;
        this.params.fill(0);
        if (!this.disposed && this.options.enabled) {
            setSceneSemanticStats({ state: 'off', reason, appliedBlend: 0, skyEdgeY: null });
        }
    }

    // ---------------------------------------------------------------- per frame

    /** Before the encode: apply a finished map, ease trust, pack the params. */
    public onFrame(frame: SemanticFrameInput): void {
        if (this.disposed || !this.paramsBuffer) return;
        this.frameCounter += 1;
        this.destroyRetired();
        const dt = this.lastFrameMs === null ? 0 : frame.nowMs - this.lastFrameMs;
        this.lastFrameMs = frame.nowMs;

        if (this.pending) this.applyPending(this.pending);

        const epoch = this.deps.pipeline.currentEpoch();
        const target = this.options.enabled ? depthConfidenceTarget(this.mapPose, epoch, frame.view.zoom) : 0;
        const panoChanged = !!this.mapPose && this.mapPose.epoch !== epoch;
        this.confidence = stepDepthConfidence(this.confidence, target, dt, panoChanged);
        packSceneSemanticParams({
            blend: this.options.enabled ? this.options.blend : 0,
            confidence: this.confidence,
            view: frame.view,
            map: this.mapPose,
            effects: this.effects,
            reducedMotion: this.options.reducedMotion,
            skyColor: this.mapSkyColor,
        }, this.params);
        const applied = this.params[SceneSemanticParamIndex.blend]!;
        if (getSceneSemanticStats().appliedBlend !== applied) setSceneSemanticStats({ appliedBlend: applied });
    }

    private async init(): Promise<void> {
        const { device } = this.deps;
        if (!this.paramsBuffer) {
            this.paramsBuffer = createTrackedBuffer(device, {
                label: 'scene-semantic-params',
                size: SCENE_SEMANTIC_PARAMS_BYTE_SIZE,
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            }, 'scene-semantic-params');
            this.sampler = createSceneSemanticSampler(device);
        }
        await this.loadSession();
    }

    private applyPending(map: PendingMap): void {
        this.pending = null;
        const { device } = this.deps;
        if (!this.texture || this.texture.width !== map.width || this.texture.height !== map.height) {
            if (this.texture) this.retired.push({ texture: this.texture, frame: this.frameCounter });
            this.texture = createTrackedTexture(device, {
                label: 'scene-semantic',
                size: [map.width, map.height],
                format: SEMANTIC_MAP_FORMAT,
                // COPY_SRC: lets tools and the e2e fixture read the map back.
                usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC,
            }, 'scene-semantic');
        }
        const texture = this.texture;
        device.queue.writeTexture(
            { texture },
            map.texels,
            { bytesPerRow: map.width * 2, rowsPerImage: map.height },
            { width: map.width, height: map.height },
        );
        this.mapPose = map.pose;
        this.mapSkyColor = map.skyColor;
        this.generation += 1;
        if (!this.aux || this.aux.texture !== texture) {
            const view = texture.createView();
            this.aux = {
                texture,
                view,
                width: map.width,
                height: map.height,
                generation: this.generation,
                bindGroup: createSceneSemanticBindGroup(device, view, this.sampler!, this.paramsBuffer!, 'scene-semantic'),
            };
        } else {
            this.aux = { ...this.aux, generation: this.generation };
        }
        setSceneSemanticStats({ generation: this.generation });
    }

    private encode(): void {
        if (!this.paramsBuffer) return;
        this.deps.device.queue.writeBuffer(this.paramsBuffer, 0, this.params);
    }

    private destroyRetired(): void {
        while (this.retired.length && this.frameCounter - this.retired[0]!.frame >= 2) {
            destroyTracked(this.retired.shift()!.texture);
        }
    }

    /** The session failed after the pass was ready (a reload): drop the map and report it. */
    public fail(error: unknown): void {
        if (this.disposed) return;
        const err = error instanceof Error ? error : new Error(String(error));
        this.aux = null;
        this.mapPose = null;
        this.confidence = 0;
        this.params.fill(0);
        setSceneSemanticStats({ state: 'failed', reason: err.message, appliedBlend: 0 });
        this.deps.onFailed(err);
    }

    public dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.deps.pipeline.attachSemantic(null);
        this.aux = null;
        this.sessionLoad = null;
        for (const r of this.retired.splice(0)) destroyTracked(r.texture);
        destroyTracked(this.texture);
        destroyTracked(this.paramsBuffer);
        this.texture = null;
        this.paramsBuffer = null;
        resetSceneSemanticStats();
    }
}
