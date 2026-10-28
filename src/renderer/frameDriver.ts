/**
 * The road's frame loop, out of React (#340). `WebGPUCanvas` mounts the canvas
 * and boots the renderer; this class owns everything that happens per frame:
 * the frame clock (`xr/frameClock.ts`, so an XR session drives it), weather
 * packing, auto exposure and the image-derived horizon, the render-scale
 * budget (#329), the present tail options (#331), the scene-depth options
 * (#320), the WASM feeders, and the frame-rate meter behind the overlay.
 *
 * Inputs the shell owns (renderer, settings, hold state) are plain fields it
 * writes when they change; per-frame state (POV, reduced motion, chores stats,
 * GPU timings) is read from external stores. Nothing here renders React.
 *
 * ⚠️ Every frame renders — live, weather-only or held. There is no frame
 * skipping: when the GPU falls behind, the budget lowers the road's render
 * scale (`frameBudget.ts` → `renderScale.ts`). In car mode the road frame is
 * the only thing presenting the cabin, so a skipped frame would freeze the
 * wipers and gauges.
 */
import { povStore } from '../state/povStore';
import { isReducedMotion } from '../state/reducedMotionStore';
import { sceneDepthStore } from '../state/sceneDepthStore';
import { type StreetViewRenderer } from './RendererBackend';
import { packWeatherParams, type WeatherParamsEnvInput } from './packWeatherParams';
import { WEATHER_PARAMS_FLOAT_COUNT, WeatherParamIndex } from './weatherUniformLayout';
import { PRESETS, type QualityLevel } from '../config/visualPresets';
import { resolveCinematicCameraFx } from './cinematicCameraFx';
import { getCameraSpeedNormalized } from './cameraMotionSignal';
import { getGpuChoresStats } from './gpuChores/gpuChoresStatsStore';
import { getGpuPassTimings, roadGpuMs, setGpuPassTimingsWanted } from './gpuPassTimingStore';
import {
    configureRenderScale,
    getRenderScaleRequest,
    resolveRenderScaleRequest,
    setRequestedRenderScale,
} from './renderScale';
import {
    DEFAULT_FRAME_BUDGET,
    createFrameBudgetState,
    stepFrameBudget,
    type FrameBudgetState,
} from './frameBudget';
import { resolveSceneDepthOptions, type SceneDepthOptions } from './depth/sceneDepthOptions';
import {
    readPresentTailFlags,
    resolvePresentTailOptions,
    type PresentTailOptions,
} from './reproject/presentTail';
import {
    AUTO_EXPOSURE_IDLE,
    resolveAutoExposureFrame,
    setAutoExposureStatus,
    type AutoExposureFrameState,
} from './autoExposure';
import { HORIZON_IDLE, resolveHorizonFrame, type HorizonFrameState } from './gpuChores/horizonEstimate';
import { FrameRateMeter } from './perfStore';
import {
    isParticlePrecipitationEnabled,
    particleGridForQuality,
    particleCountForGrid,
    PARTICLE_SEED,
} from './weatherParticles';
import { cancelFrame, requestFrame } from '../xr/frameClock';
import { streetViewProbe } from '../utils/streetViewProbe';
import type { NoiseTileFeeder } from './weatherNoiseTile';
import type { ParticleSeedFeeder } from './weatherParticleSeeds';

/** What the shell hands the driver once, at construction. */
export interface FrameDriverOptions {
    quality: QualityLevel;
    /** The OS reduced-motion preference at boot (cinematic FX and particles need a reload to change). */
    bootReducedMotion: boolean;
    /** The presented canvas — for the hold-pause pixel-drift probe. */
    outputCanvas: () => HTMLCanvasElement | null;
    noiseFeeder: NoiseTileFeeder;
    wasmNoiseEnabled: boolean;
    particleFeeder: ParticleSeedFeeder;
    wasmParticlesEnabled: boolean;
    /** Defaults to the shared meter publishing to `perfStore`. */
    meter?: FrameRateMeter;
}

/** Where the live frame comes from (a `FrameSource`, or the shell's adapter). */
export interface FrameElementSource {
    element(): CanvasImageSource | null;
}

export class FrameDriver {
    /** The shell writes these when they change; the frame reads them. */
    public renderer: StreetViewRenderer | null = null;
    public source: FrameElementSource = { element: () => null };
    public panoramaUpdatePaused = false;
    public env: WeatherParamsEnvInput | null = null;
    public autoExposureEnabled = false;

    private readonly options: FrameDriverOptions;
    private readonly meter: FrameRateMeter;
    private readonly params = new Float32Array(WEATHER_PARAMS_FLOAT_COUNT);
    private readonly sceneDepthOptions: SceneDepthOptions = { enabled: false, blend: 0, reducedMotion: false };
    private readonly livePov = () => povStore.get();
    /** Page-relative time, to keep shader sin()/hash() inside f32 precision. */
    private readonly startedAt = Date.now();
    private tailFlags: ReturnType<typeof readPresentTailFlags> = {};
    private tailOptions: PresentTailOptions | null = null;
    private budget: FrameBudgetState | null = null;
    private lastGpuTimingSeq = 0;
    private autoExposure: AutoExposureFrameState = AUTO_EXPOSURE_IDLE;
    private horizon: HorizonFrameState = HORIZON_IDLE;
    private lastFrameMs: number | null = null;
    private frameCount = 0;
    private frameId = 0;
    private running = false;

    constructor(options: FrameDriverOptions) {
        this.options = options;
        this.meter = options.meter ?? new FrameRateMeter();
    }

    /** Configure the render-scale request and present tail, then run every frame until `stop()`. */
    public start(): void {
        if (this.running) return;
        this.running = true;
        // The preset's render-scale range, unless `?scale=` pinned one. In
        // auto mode the budget loop wants GPU timestamps every frame it can get.
        const scaleRequest = resolveRenderScaleRequest(this.options.quality);
        configureRenderScale(scaleRequest);
        this.budget = createFrameBudgetState(scaleRequest.scale);
        if (scaleRequest.mode === 'auto') setGpuPassTimingsWanted(true, 'budget');
        // #331: the URL's late latch / stereo, read once; reduced motion per frame.
        this.tailFlags = readPresentTailFlags();
        this.tailOptions = resolvePresentTailOptions({ reducedMotion: false, ...this.tailFlags });
        this.frame(performance.now());
    }

    public stop(): void {
        if (!this.running) return;
        this.running = false;
        cancelFrame(this.frameId);
        this.meter.pause();
        setGpuPassTimingsWanted(false, 'budget');
    }

    private readonly onFrame = (time: number) => this.frame(time);

    private frame(frameTime: number): void {
        if (!this.running) return;
        this.meter.frame(frameTime);
        const renderer = this.renderer;
        const panoramaUpdatePaused = this.panoramaUpdatePaused;

        const pov = povStore.get();
        const renderHeading = pov.heading;
        const renderPitch = pov.pitch;
        const renderZoom = pov.zoom;

        // Google Maps canvas already reflects heading/pitch via setPov — pass through
        // directly so the WebGPU view matches what you see through the windows.
        const weatherHeading = (((renderHeading % 360) + 360) % 360) / 360;
        const weatherPitch = (renderPitch + 90) / 180;

        if (renderer && this.env) {
            this.prepare(renderer, this.env, panoramaUpdatePaused, weatherHeading, weatherPitch);
        }

        if (renderer) {
            renderer.beginFrame?.(frameTime);
            const holding = panoramaUpdatePaused || renderer.isHoldActive();
            const liveSource = this.source.element();
            if (holding) {
                renderer.renderHeldFrame(renderHeading, renderPitch, renderZoom);
                const output = this.options.outputCanvas();
                if (output) streetViewProbe.checkPixelDrift(output);
            } else if (liveSource) {
                renderer.renderStreetView('streetview', liveSource, renderHeading, renderPitch, renderZoom);
            } else {
                renderer.renderWeatherOnly();
            }
            if (!holding && this.frameCount % 8 === 0) {
                renderer.samplePanoramaStats?.({
                    horizonRows: PRESETS[this.options.quality].horizonEstimateBlend > 0,
                    pitch: (renderPitch + 90) / 180,
                });
            }
        }

        this.frameCount++;
        // The frame clock is the window's rAF — or a WebXR session's while
        // one presents (#331), so the road packs inside the XR frame.
        this.frameId = requestFrame(this.onFrame);
    }

    /** Uniforms, budget and feeders for this frame — before the render call. */
    private prepare(
        renderer: StreetViewRenderer,
        e: WeatherParamsEnvInput,
        panoramaUpdatePaused: boolean,
        weatherHeading: number,
        weatherPitch: number,
    ): void {
        const { quality, bootReducedMotion } = this.options;
        const wasmNoiseActive = this.options.wasmNoiseEnabled;
        const holdActive = panoramaUpdatePaused || renderer.isHoldActive();
        const choresStats = getGpuChoresStats();
        const horizon = resolveHorizonFrame({
            weight: PRESETS[quality].horizonEstimateBlend,
            holdActive,
            rows: choresStats.rowLuma,
            rowsPitch: choresStats.rowLumaPitch,
            rowsSeq: choresStats.rowLumaSeq,
            livePitch: weatherPitch,
        }, this.horizon);
        this.horizon = horizon.state;
        const params = packWeatherParams({
            env: e,
            timeSeconds: (Date.now() - this.startedAt) / 1000.0,
            cameraHeading: weatherHeading,
            cameraPitch: weatherPitch,
            wasmNoiseActive,
            cinematic: resolveCinematicCameraFx({
                quality,
                reducedMotion: bootReducedMotion,
                speedNormalized: getCameraSpeedNormalized(),
            }),
            horizon: horizon.uniforms,
        }, this.params);

        const nowMs = performance.now();
        const dtMs = this.lastFrameMs == null ? 0 : nowMs - this.lastFrameMs;
        this.lastFrameMs = nowMs;
        const reducedMotion = bootReducedMotion || isReducedMotion();
        const ae = resolveAutoExposureFrame({
            enabled: this.autoExposureEnabled,
            holdActive,
            meanLuma: choresStats.meanLuma,
            manualExposure: e.exposure,
            dtMs,
            reducedMotion,
        }, this.autoExposure);
        this.autoExposure = ae.state;
        if (ae.exposure != null) params[WeatherParamIndex.exposure] = ae.exposure;
        setAutoExposureStatus({
            enabled: this.autoExposureEnabled,
            appliedEv: ae.exposure,
            holdActive,
        });

        renderer.updateWeatherParams(params);
        renderer.updateCameraParams(weatherHeading, weatherPitch);
        if (this.tailOptions) {
            renderer.setPresentTail?.(
                resolvePresentTailOptions({ reducedMotion, ...this.tailFlags }, this.tailOptions),
                this.livePov,
            );
        }
        renderer.setSceneDepth?.(resolveSceneDepthOptions({
            quality,
            optedIn: sceneDepthStore.get().enabled,
            reducedMotion,
        }, this.sceneDepthOptions));

        // Frame budget: frozen through a hold and under reduced motion
        // (a resolution that pumps is motion too). A GPU sample counts
        // only once, and only if it timed a frame at the current scale.
        const request = getRenderScaleRequest();
        if (request.mode === 'auto' && this.budget) {
            const timings = getGpuPassTimings();
            const fresh = timings.seq !== this.lastGpuTimingSeq
                && timings.renderScale === request.scale;
            this.lastGpuTimingSeq = timings.seq;
            const budget = stepFrameBudget(this.budget, {
                nowMs,
                gpuMs: fresh ? roadGpuMs(timings) : null,
                gpuAvailable: timings.available,
                // The raw last frame interval, not an average: the budget
                // smooths with its own windowed median.
                frameMs: this.meter.lastIntervalMs,
                frozen: holdActive || reducedMotion,
            }, { ...DEFAULT_FRAME_BUDGET, min: request.min, max: request.max });
            this.budget = budget;
            if (budget.scale !== request.scale) {
                setRequestedRenderScale(
                    budget.scale,
                    budget.scale < request.scale ? 'over-budget' : 'under-budget',
                );
            }
        }

        if (this.options.wasmNoiseEnabled) {
            const tile = this.options.noiseFeeder.sampleTile(this.frameCount, params[WeatherParamIndex.time]!);
            if (tile) renderer.updateNoiseBuffer(tile);
        }

        if (
            this.options.wasmParticlesEnabled
            && isParticlePrecipitationEnabled({
                weatherMode: renderer.getWeatherPostProcessMode?.() ?? 'fragment',
                quality,
                preference: true,
                reducedMotion: bootReducedMotion,
            })
        ) {
            const grid = particleGridForQuality(quality, bootReducedMotion);
            const precipActive = e.rainIntensity + e.snowIntensity > 0.001;
            const seeds = this.options.particleFeeder.sampleSeeds(
                particleCountForGrid(grid),
                precipActive,
                PARTICLE_SEED,
            );
            if (seeds) renderer.updateParticleSeeds(seeds, grid.width, grid.height);
        }
    }
}
