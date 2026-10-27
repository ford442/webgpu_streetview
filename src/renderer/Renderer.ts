import { RenderMode } from './types';
import { TransitionManager } from './TransitionManager';
import { WeatherPostProcessor } from './WeatherPostProcessor';
import { ComputeWeatherPostProcessor } from './ComputeWeatherPostProcessor';
import { WeatherPostProcessorLike } from './weatherPostProcessorTypes';
import { configureCanvasContext, type CanvasOutputPolicy } from './deviceInit';
import { GpuPassTimer } from './gpuPassTimer';
import { resetGpuPassTimings } from './gpuPassTimingStore';
import { clampSamplerAnisotropy, getSamplerAnisotropyForQuality } from './samplerAnisotropy';
import type { QualityLevel } from '../config/visualPresets';
import { HoldTransitionController } from './holdTransition';
import { TextureLifecycle } from './textureLifecycle';
import {
    PanoramaStatsOptions,
    RendererDebugOptions,
    RendererInitOptions,
    StreetViewRenderer,
    WeatherPostProcessMode,
} from './RendererBackend';
import {
    bootDevice,
    publishBootSuccess,
    publishBootFailure,
    type BootProbeContext,
} from './bootDevice';
import { loadBootWasm, WasmLoadError } from './bootWasm';
import { buildSamplerDescriptor } from './streetViewPass';
import {
    FRAME_UNIFORM_FLOAT_COUNT,
    buildFramePassTimings,
    encodeAndSubmitFrame,
    encodeAndSubmitTail,
    encodeCabinComposite,
    packFrameUniforms,
} from './frameLoop';
import { FramePassRegistry, RequiredPassError } from './framePasses/FramePassRegistry';
import {
    createCabinCompositeFramePass,
    createHistoricalWipeFramePass,
    createReprojectFramePass,
    createStreetViewFramePass,
    createUpscaleFramePass,
    createWeatherFramePass,
} from './framePasses/builtinPasses';
import { PresentFallbackPostProcessor } from './PresentFallbackPostProcessor';
import { reportPassFailed, reportPassReady, resetPassStatuses } from './passStatus';
import { areGpuPassTimingsWanted } from './gpuPassTimingStore';
import { GpuChores } from './gpuChores/GpuChores';
import { histDownsampleSize } from './gpuChores/lumaMath';
import {
    HORIZON_ROWS_HEIGHT,
    HORIZON_ROWS_WIDTH,
    rowLumaMeans,
    viewHorizonYReference,
} from './gpuChores/horizonEstimate';
import { publishHorizonRows } from './gpuChores/gpuChoresStatsStore';
import { CabinCompositePass } from './cabinComposite';
import { getCabinOverlaySource } from './cabinOverlayRegistry';
import {
    createNeutralRoadLook,
    createRoadFrameSource,
    publishRoadFrameSource,
    readRoadLookInto,
    retractRoadFrameSource,
    type RoadFrameSource,
} from './roadFrameRegistry';
import { createTrackedBuffer, destroyTracked } from './gpuMemoryTracking';
import { HistoricalWipePass } from './HistoricalWipePass';
import type { WipeDirection } from './historicalWipe';
import { releaseSceneDepthFallback, resolveSceneDepthBindGroup, type FrameAux } from './depth/sceneDepthBinding';
import { DepthController } from './depth/DepthController';
import type { SceneDepthOptions } from './depth/sceneDepthOptions';
import { isPassFailed } from './passStatus';
import { UpscalePass } from './upscale/UpscalePass';
import {
    getRenderScaleRequest,
    publishAppliedRenderScale,
    scaledSize,
    type RenderScaleFrame,
} from './renderScale';
import { EXTENDED_TONEMAP_HEADROOM } from './shaderFeatureVariants';
import { readFlag } from '../config/flags';
import { ReprojectPass } from './reproject/ReprojectPass';
import { publishCabinStereoRequest } from './cabinStereoRequest';
import {
    DEFAULT_CONVERGENCE_METRES,
    DEFAULT_IPD_METRES,
    REPROJECT_UNIFORM_FLOAT_COUNT,
    latchDelta,
    packReprojectUniforms,
    resolveReprojectMode,
    rotationDelta,
    sourceFromEyeRotation,
    type LatchDelta,
    type PovSample,
} from './reproject/reprojectMath';
import { REPROJECT_UNIFORM_SLOTS } from './reproject/ReprojectPass';
import {
    getXrPresentFrame,
    isXrPresenting,
    noteXrFramePresented,
    releaseXrRepresentHandler,
    setXrRepresentHandler,
    type XrPresentFrame,
} from './xrPresentFrame';
import { frameTailScheduler } from './reproject/frameTail';
import {
    PRESENT_TAIL_OFF,
    recordNoTail,
    recordTail,
    wantsTail,
    type PresentTailOptions,
} from './reproject/presentTail';

const NO_LATCH: LatchDelta = { yawDeg: 0, pitchDeg: 0, magnitudeDeg: 0 };

type ResolvedHistoricalWipe = { pass: HistoricalWipePass; before: GPUTexture | undefined } | null;

/** Pan into [0, 1) — `panX` is `(heading % 360) / 360`, negative for negative headings. */
function wrapUnit(v: number): number {
    return v - Math.floor(v);
}

/**
 * Street View's WebGPU renderer — a façade over four named modules:
 *
 * | Module | Owns |
 * |---|---|
 * | `deviceInit.ts` | adapter/limit/canvas-output policy |
 * | `bootDevice.ts` | boot sequence and the single `requestDevice` call site |
 * | `bootWasm.ts` | the WASM numeric layer, awaited beside the pass shaders |
 * | `streetViewPass.ts` | pass-1 pipeline, bind group layout, sampler, encode |
 * | `framePasses/` | the ordered pass registry — init, ready/failed state, encode |
 * | `frameLoop.ts` | per-frame encode + submit and uniform packing |
 * | `gpuPipelineFactory.ts` | validation-safe module/pipeline creation |
 * | `cabinComposite.ts` | car mode's cabin, drawn over the swap chain last |
 * | `roadFrameRegistry.ts` | the HDR intermediate, handed to the cabin's windshield portal |
 * | `HistoricalWipePass.ts` | the year-chip wipe from the hold snapshot, over pass 1 |
 * | `upscale/UpscalePass.ts` | below render scale 1: the scaled road frame → swap chain |
 * | `reproject/` | the split frame's tail: late latch, stereo, WebXR eyes (#331) |
 *
 * What stays here is what needs the instance: lifetime (init/dispose/device
 * lost), the hold-pause guard, and the public `StreetViewRenderer` surface the
 * rest of the app and the hold-pause probe call into.
 *
 * **Hold-pause danger zone**: while `holdTransition.isHoldActive()` nothing may
 * upload the live Google Maps canvas — it is mid-reload and would flash a
 * blurry or black frame. Every entry point that can reach an upload checks the
 * flag first; see `renderStreetView` and `samplePanoramaStats`.
 */
export class Renderer implements StreetViewRenderer {
    public readonly backendType = 'webgpu' as const;
    private _fallbackReason?: string;
    public get fallbackReason(): string | undefined {
        return this._fallbackReason;
    }
    public canvas: HTMLCanvasElement;
    private device!: GPUDevice;
    private context!: GPUCanvasContext;
    private presentationFormat!: GPUTextureFormat;
    private canvasOutputPolicy: CanvasOutputPolicy = { hdr: false, p3: false };

    private pipeline!: GPURenderPipeline;
    private sampler!: GPUSampler;
    private uniformBuffer!: GPUBuffer;

    private readonly textures: TextureLifecycle;
    private readonly holdTransition: HoldTransitionController;

    private transitionManager!: TransitionManager;
    private weatherPostProcessor!: WeatherPostProcessorLike;
    private weatherPostProcessMode: WeatherPostProcessMode = 'fragment';
    private gpuPassTimer: GpuPassTimer | null = null;
    private gpuChores: GpuChores | null = null;
    private cabinComposite: CabinCompositePass | null = null;
    private historicalWipe: HistoricalWipePass | null = null;
    /** Render scale (#329): the lazy `upscale` pass, built on the first scale below 1. */
    private upscale: UpscalePass | null = null;
    private upscaleInit: Promise<boolean> | null = null;
    /**
     * This frame's scale (`FrameContext.renderScale`), refilled per frame. Its
     * `scale` is also what a hold freezes on: no scale change between
     * `beginHoldTransition` and `endHoldTransition`.
     */
    private readonly frameScale: RenderScaleFrame = {
        scale: 1,
        width: 0,
        height: 0,
        outputWidth: 0,
        outputHeight: 0,
        upscale: 'none',
        frozen: false,
        limitedBy: null,
    };
    private hasFrameScale = false;
    /** #331: the lazy `reproject` pass — present source → swap chain, in the frame's tail. */
    private reproject: ReprojectPass | null = null;
    private reprojectInit: Promise<boolean> | null = null;
    private presentTail: PresentTailOptions = { ...PRESENT_TAIL_OFF };
    /** The POV at tail time (`povStore.get`), set by `WebGPUCanvas`. */
    private livePov: (() => PovSample) | null = null;
    /** The POV of the road frame in the present source — what a WebXR re-present re-aims (#331). */
    private lastPacked: PovSample | null = null;
    private readonly representXr = (): void => {
        if (this.lastPacked && getXrPresentFrame()) this.encodeTail(this.lastPacked);
    };
    /** This display frame's rAF timestamp — the tail scheduler's frame identity. */
    private frameTime: number | null = null;
    private readonly reprojectUniforms = new Float32Array(REPROJECT_UNIFORM_FLOAT_COUNT);
    /** Scene depth (#320): the lazy `depth` pass and everything feeding it. */
    private depth: DepthController | null = null;
    /** Set while the lazy `depth` pass is initialising (download + session create). */
    private depthInit: Promise<boolean> | null = null;
    /** What the cabin's windshield portal reads — see `roadFrameRegistry.ts`. */
    private roadFrameSource: RoadFrameSource | null = null;
    private readonly roadLook = createNeutralRoadLook();
    private samplerAnisotropy: number = 1;

    private passes: FramePassRegistry | null = null;
    private readonly frameUniforms = new Float32Array(FRAME_UNIFORM_FLOAT_COUNT);
    /** `FrameContext.aux`, refilled every frame (one object, no per-frame allocation). */
    private readonly frameAux: FrameAux = {};

    private onLostCallback?: (info: GPUDeviceLostInfo) => void;
    /**
     * Set before *we* destroy the device. Its `lost` promise then resolves with
     * `reason: 'destroyed'`, and forwarding that is what turned one failed boot
     * into a re-init loop (destroy → lost → reinit → fail → destroy …).
     */
    private teardownIntended = false;
    private isDestroyed: boolean = false;
    private isDisposed: boolean = false;
    private startTime: number = Date.now();

    constructor(canvas: HTMLCanvasElement) {
        this.canvas = canvas;

        this.textures = new TextureLifecycle({
            getDevice: () => this.device,
            getPipeline: () => this.pipeline,
            getSampler: () => this.sampler,
            getUniformBuffer: () => this.uniformBuffer,
            getTransitionPreviousFrame: () => this.transitionManager?.previousFrame,
            isHoldActive: () => this.holdTransition.isHoldActive(),
            getWeatherPostProcessor: () => this.weatherPostProcessor,
        });

        this.holdTransition = new HoldTransitionController({
            getDevice: () => this.device,
            getTransitionManager: () => this.transitionManager,
            getTextures: () => this.textures,
            updateBindGroup: () => this.textures.updateBindGroup(),
        });
    }

    public async init(options?: RendererInitOptions): Promise<boolean> {
        this.onLostCallback = options?.onLost;
        this.weatherPostProcessMode = options?.weatherPostProcessMode || 'fragment';
        this._fallbackReason = undefined;
        this.teardownIntended = false;
        this.isDestroyed = false;
        this.isDisposed = false;
        resetPassStatuses();

        let probe: BootProbeContext | undefined;
        // In flight across the adapter/device round trips; awaited with the passes.
        const wasmLoad = loadBootWasm();
        wasmLoad.catch(() => {});
        try {
            const boot = await bootDevice({
                canvas: this.canvas,
                weatherPostProcessMode: this.weatherPostProcessMode,
                initOptions: options,
                onDeviceLost: (info) => this.handleDeviceLost(info),
            });

            if (!boot.ok) {
                // bootDevice already destroyed any device it created.
                this._fallbackReason = boot.reason;
                return false;
            }

            probe = boot.probe;
            this.device = boot.device;
            this.context = boot.context;
            this.presentationFormat = boot.presentationFormat;
            this.canvasOutputPolicy = boot.canvasOutputPolicy;
            this.textures.setIntermediateFormat(boot.intermediateFormat);

            this.samplerAnisotropy = 1;
            this.sampler = this.device.createSampler(buildSamplerDescriptor(1));

            if (boot.timestampQueriesAvailable) {
                this.gpuPassTimer = new GpuPassTimer(this.device);
                // The matrix is the same object the probe and
                // `window.rendererAdapterInfo` hold, so correcting it here is
                // what the overlay reads back.
                boot.capabilityMatrix.timestampWriteStrategy = this.gpuPassTimer.strategy;
            } else {
                this.gpuPassTimer = null;
                resetGpuPassTimings();
            }

            this.textures.createTexture(1, 1);

            this.uniformBuffer = createTrackedBuffer(this.device, {
                label: 'streetview-uniforms',
                size: 32,
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            }, 'sv-uniforms');

            const intermediateFormat = this.textures.intermediateFormat;
            this.weatherPostProcessor = this.weatherPostProcessMode === 'compute'
                ? new ComputeWeatherPostProcessor(this.device, this.context, this.canvas)
                : new WeatherPostProcessor(this.device, this.context, this.canvas);
            this.cabinComposite = new CabinCompositePass(this.device);
            this.historicalWipe = new HistoricalWipePass(this.device);
            this.upscale = new UpscalePass(this.device, readFlag('upscale'));
            this.upscaleInit = null;
            this.reproject = new ReprojectPass(this.device);
            this.reprojectInit = null;
            this.lastPacked = null;
            setXrRepresentHandler(this.representXr);
            frameTailScheduler.reset();
            this.hasFrameScale = false;
            this.transitionManager = new TransitionManager(this.device, this.sampler, intermediateFormat);

            const passes = this.buildPassRegistry(intermediateFormat);
            this.passes = passes;

            // Every pass fetches and compiles concurrently. A required pass
            // (pass 1) failing rejects; any other is disabled and reported on
            // `webgpuProbe.passes`, and the frame loop skips it.
            const [passOutcome, wasmOutcome] = await Promise.allSettled([
                passes.initAll(),
                wasmLoad,
                this.transitionManager.init(!!options?.legacyTransitions).then(
                    () => {
                        if (options?.legacyTransitions) reportPassReady('transitions');
                    },
                    (e: unknown) => {
                        // Transitions are optional: hops keep the inline crossfade.
                        reportPassFailed('transitions', e);
                    },
                ),
            ]);
            if (passOutcome.status === 'rejected') throw passOutcome.reason;
            if (wasmOutcome.status === 'rejected') throw wasmOutcome.reason;
            if (this.isDisposed) return false;

            this.textures.updateBindGroup();

            // A pass that did not come up is dropped, exactly as before the
            // registry: the wipe falls back to the crossfade, the cabin to the
            // CSS overlay + 2D latch (`isCabinCompositedInFrame()` → false).
            if (!passes.isReady('cabin-composite')) {
                this.cabinComposite?.dispose();
                this.cabinComposite = null;
            }
            if (!passes.isReady('historical-wipe')) {
                this.historicalWipe?.dispose();
                this.historicalWipe = null;
            }
            if (!passes.isReady('weather')) {
                await this.adoptPresentFallback(passes);
            }

            // The portal reads the pass-1 intermediate only — never `videoTexture`,
            // so during a hold it can only ever see the frozen frame.
            this.roadFrameSource = createRoadFrameSource({
                getDevice: () => this.device,
                getIntermediate: () => ({
                    texture: this.textures.intermediateTexture,
                    format: this.textures.intermediateFormat,
                    width: this.textures.intermediateWidth,
                    height: this.textures.intermediateHeight,
                }),
                isHoldActive: () => this.holdTransition.isHoldActive(),
                getLook: () => this.roadLook,
                isAlive: () => !this.isDestroyed && !this.isDisposed,
            });
            publishRoadFrameSource(this.roadFrameSource);

            publishBootSuccess(probe);

            // After the success probe: `GpuChores` reads `isWebGpuProbeOk()` and
            // the published limits verdict in its constructor, so building it
            // any earlier put every normal boot on the WASM/JS fallback.
            this.gpuChores = new GpuChores(this.device);
            void this.gpuChores.ensureReady();
            return true;
        } catch (e) {
            this._fallbackReason = e instanceof Error ? e.message : String(e);
            if (probe) {
                const stage = e instanceof RequiredPassError ? 'pipeline'
                    : e instanceof WasmLoadError ? 'wasm'
                    : 'device';
                publishBootFailure(probe, stage, this._fallbackReason);
            }
            console.warn('WebGPU init failed:', this._fallbackReason);
            // Never leak the device of a failed boot — and never report its
            // loss: this teardown is ours.
            this.destroy();
            return false;
        }
    }

    /** The frame, as registered passes in encode order. See `framePasses/builtinPasses.ts`. */
    private buildPassRegistry(intermediateFormat: GPUTextureFormat): FramePassRegistry {
        const passes = new FramePassRegistry();
        passes.register(createStreetViewFramePass({
            device: this.device,
            intermediateFormat,
            onPipeline: (pipeline) => {
                this.pipeline = pipeline;
            },
            getPipeline: () => this.pipeline,
            getTransitionManager: () => this.transitionManager,
        }));
        passes.register(createHistoricalWipeFramePass({
            pass: this.historicalWipe!,
            intermediateFormat,
            resolve: () => this.resolveHistoricalWipe(),
        }));
        passes.register(createWeatherFramePass({
            id: 'weather',
            processor: this.weatherPostProcessor,
            presentationFormat: this.presentationFormat,
            // What `configureCanvasContext` actually applied, not what `?hdr`
            // asked for — a rejected HDR configure stays on the SDR ACES curve.
            initOptions: {
                canvasToneMapping: this.canvasOutputPolicy.hdr ? 'extended' : 'standard',
            },
        }));
        passes.register(createUpscaleFramePass({
            pass: this.upscale!,
            presentationFormat: this.presentationFormat,
            // Same "applied, not requested" rule as the weather tone curve.
            peak: this.canvasOutputPolicy.hdr ? EXTENDED_TONEMAP_HEADROOM : 1,
        }));
        passes.register(createReprojectFramePass({
            pass: this.reproject!,
            presentationFormat: this.presentationFormat,
            device: this.device,
        }));
        passes.register(createCabinCompositeFramePass({
            pass: this.cabinComposite!,
            presentationFormat: this.presentationFormat,
            resolve: () => this.resolveCabinComposite(),
            sideBySide: () => this.presentTail.stereo === 'sbs',
        }));
        // Lazy: initialised by `setSceneDepth` when scene depth is switched on.
        this.depth = new DepthController({
            device: this.device,
            getChores: () => this.gpuChores,
            getIntermediate: () => (this.textures.intermediateTexture
                ? {
                    texture: this.textures.intermediateTexture,
                    width: this.textures.intermediateWidth,
                    height: this.textures.intermediateHeight,
                }
                : null),
            isHoldActive: () => this.holdTransition.isHoldActive(),
            isAlive: () => !this.isDestroyed && !this.isDisposed,
            onFailed: (error) => this.passes?.markFailed('depth', error),
            baseUrl: typeof document !== 'undefined' ? document.baseURI : 'http://localhost/',
        });
        passes.register(this.depth.pass);
        return passes;
    }

    /**
     * Scene depth for this frame (`WebGPUCanvas`, every frame). Switching it on
     * the first time initialises the lazy `depth` pass — a one-time download —
     * and a failure stays reported on `webgpuProbe.passes.depth` until it is
     * switched off and on again.
     */
    public setSceneDepth(options: SceneDepthOptions): void {
        const depth = this.depth;
        const passes = this.passes;
        if (!depth || !passes || this.isDestroyed) return;
        const wasEnabled = depth.getOptions().enabled;
        depth.setOptions(options);
        if (!options.enabled || this.depthInit) return;
        const retry = !wasEnabled && isPassFailed('depth');
        if (depth.isInitialised() && !retry) return;
        if (isPassFailed('depth') && !retry) return;
        this.depthInit = passes.initPass('depth').finally(() => {
            this.depthInit = null;
        });
    }

    /**
     * Weather failed validation: present pass 1 through the inline ACES blit so
     * the road frame still shows. Only if *that* fails too is the boot lost.
     */
    private async adoptPresentFallback(passes: FramePassRegistry): Promise<void> {
        this.weatherPostProcessor?.dispose();
        const fallback = new PresentFallbackPostProcessor(this.device, this.context);
        passes.register(createWeatherFramePass({
            id: 'present-fallback',
            processor: fallback,
            presentationFormat: this.presentationFormat,
            lazy: true,
        }));
        if (!(await passes.initPass('present-fallback'))) {
            throw new RequiredPassError('present-fallback', 'weather and its present fallback both failed');
        }
        this.weatherPostProcessor = fallback;
        if (this.textures.intermediateTextureView) {
            fallback.updateWeatherBindGroup(this.textures.intermediateTextureView);
        }
    }

    /**
     * A loss we did not cause: tear down without touching the (dead) device and
     * tell the owner, which decides whether to re-init (`deviceLossRecovery.ts`).
     */
    private handleDeviceLost(info: GPUDeviceLostInfo): void {
        if (this.teardownIntended) return;
        console.warn('[Renderer] WebGPU device lost:', info.reason, info.message);
        const onLost = this.onLostCallback;
        this.dispose({ destroyDevice: false, unconfigureContext: true, markDestroyed: true });
        onLost?.(info);
    }

    public getWeatherPostProcessMode(): WeatherPostProcessMode {
        return this.weatherPostProcessMode;
    }

    public getGpuChores(): GpuChores | null {
        return this.gpuChores;
    }

    /**
     * The single shared `GPUDevice` (see `bootDevice.ts` — the only allowed
     * `requestDevice` call site). Car mode adopts this device instead of
     * creating its own; never expose it before `init()` has resolved or after
     * teardown.
     */
    public getSharedGpuDevice(): GPUDevice | undefined {
        return this.isDestroyed || this.isDisposed ? undefined : this.device;
    }

    /**
     * #216: sample panorama luma (hist/reduce) on the shared device, or WASM/JS.
     * Skipped while a hold is active so we never read a loading live canvas.
     * `horizonRows` also publishes per-row luma for the image-derived horizon
     * (gpuChores/horizonEstimate.ts), tagged with the pitch it was sampled at.
     */
    public samplePanoramaStats(opts?: PanoramaStatsOptions): void {
        if (this.isDestroyed || !this.gpuChores || this.holdTransition.isHoldActive()) return;
        void this.samplePanoramaStatsAsync(opts);
    }

    public getOutputCanvas(): HTMLCanvasElement {
        return this.canvas;
    }

    private async samplePanoramaStatsAsync(opts?: PanoramaStatsOptions): Promise<void> {
        const chores = this.gpuChores;
        if (!chores || this.isDestroyed || this.holdTransition.isHoldActive()) return;
        await chores.ensureReady();
        if (this.isDestroyed || this.holdTransition.isHoldActive()) return;
        const tex = this.textures.videoTexture;
        if (tex) {
            const sample = await chores.sampleTexture(tex);
            if (this.isDestroyed || this.holdTransition.isHoldActive()) return;
            if (sample) {
                if (opts?.horizonRows) {
                    const rgba = await chores.downsampleTexture(tex, HORIZON_ROWS_WIDTH, HORIZON_ROWS_HEIGHT);
                    if (rgba && !this.isDestroyed && !this.holdTransition.isHoldActive()) {
                        publishHorizonRows(
                            rowLumaMeans(rgba, HORIZON_ROWS_WIDTH, HORIZON_ROWS_HEIGHT),
                            opts.pitch,
                        );
                    }
                }
                return;
            }
        }
        this.samplePanoramaStatsCpu(chores, opts);
    }

    private samplePanoramaStatsCpu(chores: GpuChores, opts?: PanoramaStatsOptions): void {
        if (typeof document === 'undefined' || this.canvas.width < 2 || this.canvas.height < 2) return;
        const q = histDownsampleSize(this.canvas.width, this.canvas.height);
        const tmp = document.createElement('canvas');
        tmp.width = q.width;
        tmp.height = q.height;
        const ctx = tmp.getContext('2d');
        if (!ctx) return;
        try {
            ctx.drawImage(this.canvas, 0, 0, q.width, q.height);
            const img = ctx.getImageData(0, 0, q.width, q.height);
            chores.analyzePreparedRgba(img.data, q.width, q.height);
            if (opts?.horizonRows) {
                const rgba = chores.downsampleRgba(
                    img.data, q.width, q.height, HORIZON_ROWS_WIDTH, HORIZON_ROWS_HEIGHT,
                );
                publishHorizonRows(
                    rowLumaMeans(rgba, HORIZON_ROWS_WIDTH, HORIZON_ROWS_HEIGHT),
                    opts.pitch,
                );
            }
        } catch {
            // Canvas taint / GPU canvas readback can fail — skip this tick.
        }
    }

    public setSamplerAnisotropy(level: QualityLevel): void {
        if (!this.device || this.isDestroyed) return;
        const requested = getSamplerAnisotropyForQuality(level);
        const anisotropy = clampSamplerAnisotropy(requested, this.device);
        if (anisotropy === this.samplerAnisotropy) return;
        this.samplerAnisotropy = anisotropy;
        this.sampler = this.device.createSampler(buildSamplerDescriptor(anisotropy));
        this.textures.updateBindGroup();
    }

    public resize(_width: number, _height: number) {
        if (this.isDestroyed) return;
        configureCanvasContext(this.context, this.device, this.presentationFormat, this.canvasOutputPolicy);
    }

    public destroy() {
        // Intentional: the `lost` promise this resolves must not re-init.
        this.teardownIntended = true;
        this.onLostCallback = undefined;
        this.dispose({ destroyDevice: true, unconfigureContext: true, markDestroyed: true });
    }

    /** The device's 2D texture limit — the canvas backing store must fit inside it. */
    public getMaxTextureDimension2D(): number | undefined {
        const limit = Number(this.getSharedGpuDevice()?.limits?.maxTextureDimension2D);
        return Number.isFinite(limit) && limit > 0 ? limit : undefined;
    }

    private dispose({
        destroyDevice,
        unconfigureContext,
        markDestroyed,
    }: {
        destroyDevice: boolean;
        unconfigureContext: boolean;
        markDestroyed: boolean;
    }) {
        if (this.isDisposed) {
            if (markDestroyed) this.isDestroyed = true;
            return;
        }
        if (markDestroyed) this.isDestroyed = true;
        this.isDisposed = true;
        // Before the textures go: the cabin must stop being offered a texture
        // that is about to be destroyed.
        retractRoadFrameSource(this.roadFrameSource);
        this.roadFrameSource = null;
        if (destroyDevice) this.teardownIntended = true;
        try {
            this.textures.destroyTextures();
            destroyTracked(this.uniformBuffer);
            this.transitionManager?.dispose();
            if (this.passes) {
                // Weather (and the present fallback), the wipe and the cabin composite.
                this.passes.destroyAll();
                this.passes = null;
            } else {
                this.weatherPostProcessor?.dispose();
                this.cabinComposite?.dispose();
                this.historicalWipe?.dispose();
                this.upscale?.dispose();
                this.reproject?.dispose();
            }
            frameTailScheduler.reset();
            releaseXrRepresentHandler(this.representXr);
            this.lastPacked = null;
            if (this.presentTail.stereo === 'sbs') publishCabinStereoRequest(null);
            this.presentTail = { ...PRESENT_TAIL_OFF };
            this.cabinComposite = null;
            this.historicalWipe = null;
            this.upscale = null;
            this.upscaleInit = null;
            this.reproject = null;
            this.reprojectInit = null;
            // Destroyed with the passes (it is one); drop the handle.
            this.depth = null;
            this.depthInit = null;
            this.gpuChores?.destroy();
            this.gpuChores = null;
            this.gpuPassTimer?.destroy();
            this.gpuPassTimer = null;
            releaseSceneDepthFallback(this.device);
            if (unconfigureContext) {
                this.context?.unconfigure();
            }
            if (destroyDevice) {
                this.device?.destroy();
            }
        } catch {
            // ignore cleanup errors
        }
        this.uniformBuffer = undefined as unknown as GPUBuffer;
        this.pipeline = undefined as unknown as GPURenderPipeline;
        this.textures.bindGroup = undefined as unknown as GPUBindGroup;
    }

    public setCarMode(_active: boolean): void {
    }

    public updateEffects(effectsData: Float32Array): void {
        if (effectsData.length > 8) {
            this.setShaderEffects(!!effectsData[8]);
        }
    }

    public getCanvasDataURL(): string {
        return this.canvas.toDataURL('image/png', 1.0);
    }

    public setDebugOptions(_options: Partial<RendererDebugOptions>): void {
    }

    public setShaderEffects(enabled: boolean): void {
        this.roadLook.graded = enabled;
        this.weatherPostProcessor?.setShaderEffects(enabled);
    }

    public getCameraParams(): { heading: number; pitch: number } {
        return this.weatherPostProcessor?.getCameraParams() ?? { heading: 0, pitch: 0 };
    }

    public getShaderEffectsEnabled(): boolean {
        return this.weatherPostProcessor?.getShaderEffectsEnabled() ?? true;
    }

    public updateWeatherParams(params: Float32Array<ArrayBuffer>): void {
        readRoadLookInto(params, this.roadLook);
        this.weatherPostProcessor?.updateWeatherParams(params);
    }

    public updateCameraParams(heading: number, pitch: number): void {
        this.weatherPostProcessor?.updateCameraParams(heading, pitch);
    }

    /**
     * The split frame's tail (#331): late latch and/or stereo. `livePov` is
     * read when the tail encodes — after the car loop in car mode.
     */
    public setPresentTail(options: PresentTailOptions, livePov?: () => PovSample): void {
        if (options.stereo !== this.presentTail.stereo) {
            // The cabin draws its own two eyes for a side-by-side road; the
            // anaglyph keeps the mono cabin (it sits at the convergence plane).
            publishCabinStereoRequest(options.stereo === 'sbs'
                ? { kind: 'sbs', ipd: DEFAULT_IPD_METRES, convergence: DEFAULT_CONVERGENCE_METRES }
                : null);
        }
        this.presentTail.latch = options.latch;
        this.presentTail.stereo = options.stereo;
        this.presentTail.fillBlur = options.fillBlur;
        if (livePov) this.livePov = livePov;
    }

    /** The display frame's rAF timestamp, before this frame's render call. */
    public beginFrame(frameTime: number): void {
        this.frameTime = frameTime;
    }

    public updateColorParams(params: Float32Array<ArrayBuffer>): void {
        // The first six floats only — `readRoadLookInto` leaves the rest alone.
        readRoadLookInto(params.subarray(0, 6), this.roadLook);
        this.weatherPostProcessor?.updateColorParams(params);
    }

    public updateNoiseBuffer(tile: Float32Array<ArrayBuffer>): void {
        this.weatherPostProcessor?.updateNoiseBuffer(tile);
    }

    public updateParticleSeeds(seeds: Float32Array<ArrayBuffer>, width: number, height: number): void {
        this.weatherPostProcessor?.updateParticleSeeds(seeds, width, height);
    }

    public setLookLut(volume: import('./lut').LutVolume | null): void {
        this.weatherPostProcessor?.setLookLut(volume);
    }

    public setTemporalHistoryEnabled(enabled: boolean): void {
        this.weatherPostProcessor?.setTemporalHistoryEnabled(enabled);
    }

    public updateWeatherAnimation(): void {
        this.weatherPostProcessor?.updateWeatherAnimation();
    }

    public renderWeatherOnly(): void {
        if (this.isDestroyed || !this.device) return;
        const frame = this.resolveFrameScale();
        this.textures.ensureIntermediateTexture(frame.width, frame.height);
        const upscale = frame.scale < 1 ? this.upscale : null;
        const roadTarget = upscale?.ensureInput(frame.width, frame.height);
        const cabin = this.resolveCabinComposite();
        this.weatherPostProcessor?.renderWeatherOnly(
            this.textures.intermediateTextureView,
            (encoder) => {
                if (upscale) {
                    const view = this.getSwapChainView();
                    if (view) upscale.encode(encoder, view, frame.outputWidth, frame.outputHeight);
                }
                encodeCabinComposite(encoder, cabin, () => this.getSwapChainView());
            },
            roadTarget,
        );
    }

    /**
     * The road's scale for the frame about to be encoded (`renderScale.ts`):
     * the request, unless the upscale pass is not there to present a scaled
     * frame (then 1 — and the first such request starts building it), or a
     * hold is active (then whatever the hold was armed at: the held frame
     * never changes resolution under the user).
     */
    private resolveFrameScale(): RenderScaleFrame {
        const frame = this.frameScale;
        const requested = getRenderScaleRequest().scale;
        const hold = this.holdTransition.isHoldActive();
        let scale: number;
        let limitedBy: RenderScaleFrame['limitedBy'] = null;
        if (hold && this.hasFrameScale) {
            scale = frame.scale;
            limitedBy = frame.limitedBy;
        } else if (requested < 1 && !this.upscale?.isReady()) {
            scale = 1;
            limitedBy = this.requestUpscalePass() ? 'upscale-pending' : 'upscale-unavailable';
        } else {
            scale = requested;
        }
        const size = scaledSize(this.canvas.width, this.canvas.height, scale);
        frame.scale = scale;
        frame.width = size.width;
        frame.height = size.height;
        frame.outputWidth = this.canvas.width;
        frame.outputHeight = this.canvas.height;
        frame.upscale = scale < 1 && this.upscale ? this.upscale.getMode() : 'none';
        frame.frozen = hold && this.hasFrameScale;
        frame.limitedBy = limitedBy;
        this.hasFrameScale = true;
        publishAppliedRenderScale(frame);
        return frame;
    }

    /**
     * The present source when this frame has a tail, else undefined (the
     * frame presents in `main`, as before #331). The first frame that wants a
     * tail starts building the lazy pass and presents without one meanwhile; a
     * pass that failed is reported on `webgpuProbe.passes.reproject` and the
     * tail stays off.
     */
    private resolvePresentTarget(frame: RenderScaleFrame): GPUTextureView | undefined {
        if (!(wantsTail(this.presentTail) || isXrPresenting()) || !this.reproject || !this.passes) return undefined;
        if (!this.reproject.isReady()) {
            if (!isPassFailed('reproject')) this.reprojectInit ??= this.passes.initPass('reproject');
            return undefined;
        }
        return this.reproject.ensureSource(frame.outputWidth, frame.outputHeight);
    }

    /**
     * Hand the tail to the scheduler: now, or after the car loop of this same
     * display frame. It reads the POV again and re-aims the packed frame.
     */
    private scheduleTail(packed: PovSample): void {
        this.lastPacked = packed;
        const frameTime = this.frameTime ?? performance.now();
        frameTailScheduler.submit(frameTime, () => this.encodeTail(packed));
    }

    private encodeTail(packed: PovSample): void {
        const passes = this.passes;
        const reproject = this.reproject;
        if (this.isDestroyed || !passes || !reproject?.isReady()) return;
        const xr = getXrPresentFrame();
        if (xr) {
            this.encodeXrTail(packed, reproject, xr);
            return;
        }
        const options = this.presentTail;
        const live = options.latch && this.livePov ? this.livePov() : packed;
        const delta = options.latch ? latchDelta(packed, live) : NO_LATCH;
        const mode = resolveReprojectMode(options.stereo, delta);
        const frame = this.frameScale;
        packReprojectUniforms({
            mode,
            zoom: packed.zoom,
            outputWidth: frame.outputWidth,
            outputHeight: frame.outputHeight,
            delta,
            packedPitchDeg: packed.pitch,
            horizonY: viewHorizonYReference((packed.pitch + 90) / 180, 0.5, 0),
            fillBlur: options.fillBlur,
        }, this.reprojectUniforms);
        reproject.writeUniforms(0, this.reprojectUniforms);
        encodeAndSubmitTail(this.device, passes, {
            textures: this.textures,
            getSwapChainView: () => this.getSwapChainView(),
            aux: this.frameAux,
            renderScale: frame,
            roadTarget: undefined,
            hasTail: true,
            presentTarget: undefined,
        });
        recordTail(options, mode, delta, frameTailScheduler.stats());
    }

    /**
     * A WebXR frame's tail (#331): each eye drawn from the packed road frame —
     * re-aimed by the eye's full orientation, its own frustum, its own
     * parallax (convergence at infinity: each eye has its own frustum) — then
     * the cabin's matching half over it, into the layer's sub-image. The
     * canvas is left alone. A layer format without a pipeline yet starts
     * building one and skips the frame (the compositor reprojects the last).
     */
    private encodeXrTail(packed: PovSample, reproject: ReprojectPass, xr: XrPresentFrame): void {
        if (!reproject.hasFormat(xr.format)) {
            void reproject.ensureFormat(xr.format).catch((error: unknown) => {
                console.warn('[Renderer] reproject pipeline for the WebXR layer failed', error);
            });
            return;
        }
        const cabin = this.resolveCabinComposite();
        const cabinOn = !!cabin?.isActive();
        if (cabinOn && !cabin!.hasFormat(xr.format)) {
            void cabin!.ensureFormat(xr.format).catch((error: unknown) => {
                console.warn('[Renderer] cabin composite pipeline for the WebXR layer failed', error);
            });
        }
        const sideBySide = cabin?.getLayout() === 'sbs';
        const frame = this.frameScale;
        const depth = resolveSceneDepthBindGroup(this.device, this.frameAux);
        const encoder = this.device.createCommandEncoder({ label: 'streetview-frame-xr' });
        let firstDelta: LatchDelta = NO_LATCH;
        xr.eyes.forEach((eye, i) => {
            // Slot 0 is the flat tail's; the eyes take the rest.
            if (i >= REPROJECT_UNIFORM_SLOTS - 1) return;
            const rotation = sourceFromEyeRotation(packed, eye.worldFromEye);
            if (i === 0) firstDelta = rotationDelta(rotation);
            packReprojectUniforms({
                mode: 'eye',
                zoom: packed.zoom,
                // The *source's* size: its aspect sets the packed frustum.
                outputWidth: frame.outputWidth,
                outputHeight: frame.outputHeight,
                delta: NO_LATCH,
                rotation,
                outFrustum: eye.frustum,
                ipd: xr.halfIpd * 2,
                convergence: Number.POSITIVE_INFINITY,
                eyeSign: eye.eyeSign,
                horizonY: viewHorizonYReference((packed.pitch + 90) / 180, 0.5, 0),
                fillBlur: this.presentTail.fillBlur,
            }, this.reprojectUniforms);
            reproject.writeUniforms(1 + i, this.reprojectUniforms);
            reproject.encode(encoder, eye.view, depth, {
                slot: 1 + i,
                format: xr.format,
                viewport: eye.viewport,
                clear: eye.clear,
            });
            if (cabinOn && cabin!.hasFormat(xr.format)) {
                cabin!.encode(encoder, eye.view, eye.viewport, sideBySide ? (eye.eyeSign < 0 ? 'left' : 'right') : 'full', xr.format);
            }
        });
        this.device.queue.submit([encoder.finish()]);
        noteXrFramePresented();
        recordTail({ ...this.presentTail, latch: true }, 'eye', firstDelta, frameTailScheduler.stats());
    }

    /**
     * Start building the lazy `upscale` pass once. False when it cannot come:
     * it failed (reported on `webgpuProbe.passes.upscale`, not retried) or
     * there is no device.
     */
    private requestUpscalePass(): boolean {
        if (!this.upscale || !this.passes || isPassFailed('upscale')) return false;
        this.upscaleInit ??= this.passes.initPass('upscale');
        return true;
    }

    /**
     * Pick up whatever car mode published this frame (`cabinOverlayRegistry`).
     * Called from both encode paths and from `isCabinCompositedInFrame`, so the
     * answer capture reads is the same one the next frame will draw.
     */
    private resolveCabinComposite(): CabinCompositePass | null {
        if (!this.cabinComposite || this.isDestroyed) return null;
        this.cabinComposite.setSource(getCabinOverlaySource());
        return this.cabinComposite;
    }

    private getSwapChainView(): GPUTextureView | null {
        if (this.isDestroyed || !this.context) return null;
        return this.context.getCurrentTexture().createView();
    }

    /**
     * True when the road frame this renderer presents already contains the
     * cabin. Cinema and snapshots read it to skip the 2D overlay latch — see
     * `utils/canvasRecorder.ts` and `car/runtime/frameCapture.ts`. False in
     * free-look, on the `?cabin=webgl` hatch, and any frame the cabin has not
     * produced a texture for, which are exactly the cases the latch still covers.
     */
    public isCabinCompositedInFrame(): boolean {
        return this.resolveCabinComposite()?.isActive() ?? false;
    }

    public beginTransition(mode: string = 'zoom'): void {
        this.transitionManager?.beginTransition(mode);
    }

    public capturePanorama(movementHeading: number): void {
        if (!this.textures.videoTexture) return;
        this.transitionManager?.capturePanorama(movementHeading, this.textures.videoTexture);
        this.textures.updateBindGroup();
    }

    public updateTransitionProgress(progress: number): void {
        this.transitionManager?.updateTransitionProgress(progress);
    }

    public endTransition(): void {
        this.transitionManager?.endTransition();
    }

    public isInTransition(): boolean {
        return this.transitionManager?.isInTransition() ?? false;
    }

    public getTransitionDuration(mode?: string): number {
        return this.transitionManager?.getTransitionDuration(mode) ?? 450;
    }

    public captureCurrentFrame(): void {
        if (!this.textures.videoTexture) {
            console.warn('[Renderer] captureCurrentFrame: videoTexture not available');
            return;
        }
        this.transitionManager?.captureCurrentFrame(this.textures.videoTexture);
        this.textures.updateBindGroup();
    }

    public beginHoldTransition(
        heading?: number,
        pitch?: number,
        cpuSnapshot?: HTMLCanvasElement,
        travelHeading?: number,
    ): void {
        this.holdTransition.beginHoldTransition(heading, pitch, cpuSnapshot);
        this.depth?.beginHold(heading ?? 0, this.holdTransition.getCapturePan(), travelHeading);
    }

    public endHoldTransition(): void {
        this.holdTransition.endHoldTransition();
        this.depth?.endHold();
    }

    public isHoldActive(): boolean {
        return this.holdTransition.isHoldActive();
    }

    public setTransitionProgress(progress: number): void {
        this.transitionManager?.setTransitionProgress(progress);
    }

    /**
     * Arm the year-chip wipe from the hold-pause snapshot to the live frame.
     * False — and the caller keeps the crossfade — when the pipeline is
     * missing or there is no snapshot to wipe from.
     */
    public beginHistoricalWipe(direction: WipeDirection): boolean {
        if (this.isDestroyed || !this.historicalWipe || !this.transitionManager?.previousFrame) return false;
        return this.historicalWipe.begin(direction);
    }

    public setHistoricalWipeProgress(progress: number): void {
        this.historicalWipe?.setProgress(progress);
    }

    public endHistoricalWipe(): void {
        this.historicalWipe?.end();
    }

    /**
     * The wipe for this frame, or null. Never while a hold is active: the held
     * frame is already the "before", and the wipe must not run ahead of the
     * release that makes the live frame safe to show.
     */
    private resolveHistoricalWipe(): ResolvedHistoricalWipe {
        if (this.holdTransition.isHoldActive() || !this.historicalWipe?.isActive()) return null;
        return { pass: this.historicalWipe, before: this.transitionManager?.previousFrame };
    }

    public renderHeldFrame(heading?: number, pitch?: number, zoom?: number): void {
        if (this.isDestroyed || !this.device || !this.pipeline) return;

        if (!this.holdTransition.shouldRenderHeldFrame()) {
            this.renderWeatherOnly();
            return;
        }

        this.submitPanoramaFrame(heading, pitch, zoom);
    }

    /** Pack this frame's uniforms and hand the encode order to `frameLoop`. */
    private submitPanoramaFrame(heading?: number, pitch?: number, zoom?: number): void {
        try {
            this.weatherPostProcessor?.updateWeatherAnimation();

            const panX = ((heading || 0) % 360) / 360;
            const panY = ((pitch || 0) + 90) / 180;
            this.transitionManager?.recordLastPan(panX, panY);

            const passes = this.passes;
            if (!passes) return;
            const holdActive = this.holdTransition.isHoldActive();
            const inline = this.transitionManager?.inlineProgress ?? 0;
            this.depth?.onFrame({
                nowMs: performance.now(),
                view: { panX: wrapUnit(panX), panY, zoom: zoom || 1 },
                holdActive,
                transitioning: (inline > 0 && inline < 1)
                    || !!this.transitionManager?.isInTransition()
                    || !!this.historicalWipe?.isActive(),
            });
            this.frameAux.depth = passes.isReady('depth') && !isPassFailed('depth')
                ? this.depth?.currentAux()
                : undefined;
            // Timestamp queries only while the overlay or the budget loop reads them.
            const timer = areGpuPassTimingsWanted() ? this.gpuPassTimer : null;
            const renderScale = this.resolveFrameScale();
            const presentTarget = this.resolvePresentTarget(renderScale);
            const roadTarget = renderScale.scale < 1
                ? this.upscale?.ensureInput(renderScale.width, renderScale.height)
                : presentTarget;
            encodeAndSubmitFrame({
                device: this.device,
                textures: this.textures,
                uniformBuffer: this.uniformBuffer,
                uniforms: packFrameUniforms({
                    time: (Date.now() - this.startTime) / 1000,
                    zoom: zoom || 1,
                    panX,
                    panY,
                    inlineTransitionProgress: this.transitionManager?.inlineProgress ?? 0.0,
                    holdActive,
                    capturePan: this.holdTransition.getCapturePan(),
                }, this.frameUniforms),
                passes,
                frame: {
                    getSwapChainView: () => this.getSwapChainView(),
                    aux: this.frameAux,
                    renderScale,
                    roadTarget,
                    hasTail: !!presentTarget,
                    presentTarget,
                },
                gpuPassTimer: timer,
                timings: buildFramePassTimings(timer, this.weatherPostProcessMode),
            });
            if (presentTarget) {
                this.scheduleTail({ heading: heading || 0, pitch: pitch || 0, zoom: zoom || 1 });
            } else {
                recordNoTail();
            }
        } catch {
            // Suppress sporadic frame errors
        }
    }

    public renderStreetView(
        _mode: RenderMode,
        source: CanvasImageSource | null,
        heading?: number,
        pitch?: number,
        zoom?: number
    ): void {
        if (this.isDestroyed || !this.device || !this.pipeline) return;

        // Hold-pause: the live Maps canvas is mid-reload, so re-render the
        // frozen frame instead of uploading whatever is on it right now.
        if (this.holdTransition.isHoldActive()) {
            this.renderHeldFrame(heading, pitch, zoom);
            return;
        }

        if (!source) {
            if (this.transitionManager?.isInTransition() && this.transitionManager?.hasPrevTexture && this.textures.videoTexture) {
                // continue — transition pipeline will use cached GPU textures
            } else {
                this.renderWeatherOnly();
                return;
            }
        }

        if (source) {
            const uploaded = this.textures.uploadLiveSource(source);
            if (!uploaded && !this.textures.videoTexture) {
                this.renderWeatherOnly();
                return;
            }
        }

        this.submitPanoramaFrame(heading, pitch, zoom);
    }
}
