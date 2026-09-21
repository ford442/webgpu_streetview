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
import {
    buildSamplerDescriptor,
    createStreetViewPipeline,
} from './streetViewPass';
import {
    buildFramePassTimings,
    encodeAndSubmitFrame,
    packFrameUniforms,
} from './frameLoop';
import { GpuChores } from './gpuChores/GpuChores';
import { histDownsampleSize } from './gpuChores/lumaMath';

/**
 * Street View's WebGPU renderer — a façade over four named modules:
 *
 * | Module | Owns |
 * |---|---|
 * | `deviceInit.ts` | adapter/limit/canvas-output policy |
 * | `bootDevice.ts` | boot sequence and the single `requestDevice` call site |
 * | `streetViewPass.ts` | pass-1 pipeline, bind group layout, sampler, encode |
 * | `frameLoop.ts` | per-frame encode order and uniform packing |
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
    private samplerAnisotropy: number = 1;

    private onLostCallback?: (info: GPUDeviceLostInfo) => void;
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
        this.isDestroyed = false;
        this.isDisposed = false;

        let probe: BootProbeContext | undefined;
        try {
            const boot = await bootDevice({
                canvas: this.canvas,
                weatherPostProcessMode: this.weatherPostProcessMode,
                initOptions: options,
                onDeviceLost: (info) => {
                    this.dispose({ destroyDevice: false, unconfigureContext: true, markDestroyed: true });
                    this.onLostCallback?.(info);
                },
            });

            if (!boot.ok) {
                this._fallbackReason = boot.reason;
                // The compute-probe failure hands back a live device; adopt it
                // so our own teardown runs and the flags stay truthful.
                if (boot.device && boot.context) {
                    this.device = boot.device;
                    this.context = boot.context;
                    this.dispose({ destroyDevice: true, unconfigureContext: true, markDestroyed: true });
                }
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
            } else {
                this.gpuPassTimer = null;
                resetGpuPassTimings();
            }

            this.textures.createTexture(1, 1);

            this.uniformBuffer = this.device.createBuffer({
                size: 32,
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            });

            this.pipeline = await createStreetViewPipeline(this.device, this.textures.intermediateFormat);
            this.textures.updateBindGroup();

            this.weatherPostProcessor = this.weatherPostProcessMode === 'compute'
                ? new ComputeWeatherPostProcessor(this.device, this.context, this.canvas)
                : new WeatherPostProcessor(this.device, this.context, this.canvas);
            await this.weatherPostProcessor.init(this.presentationFormat);

            this.gpuChores = new GpuChores(this.device);
            void this.gpuChores.ensureReady();

            this.transitionManager = new TransitionManager(
                this.device,
                this.sampler,
                this.textures.intermediateFormat,
            );
            try {
                await this.transitionManager.init(!!options?.legacyTransitions);
            } catch (e) {
                console.warn('[Renderer] Transition pipelines failed to initialize — transitions disabled:', e);
            }

            publishBootSuccess(probe);
            return true;
        } catch (e) {
            this._fallbackReason = e instanceof Error ? e.message : String(e);
            if (probe) {
                publishBootFailure(probe, 'device', this._fallbackReason);
            }
            console.warn('WebGPU init failed:', this._fallbackReason);
            return false;
        }
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
     */
    public samplePanoramaStats(): void {
        if (this.isDestroyed || !this.gpuChores || this.holdTransition.isHoldActive()) return;
        void this.samplePanoramaStatsAsync();
    }

    public getOutputCanvas(): HTMLCanvasElement {
        return this.canvas;
    }

    private async samplePanoramaStatsAsync(): Promise<void> {
        const chores = this.gpuChores;
        if (!chores || this.isDestroyed || this.holdTransition.isHoldActive()) return;
        await chores.ensureReady();
        if (this.isDestroyed || this.holdTransition.isHoldActive()) return;
        const tex = this.textures.videoTexture;
        if (tex) {
            const sample = await chores.sampleTexture(tex);
            if (sample || this.isDestroyed || this.holdTransition.isHoldActive()) return;
        }
        this.samplePanoramaStatsCpu(chores);
    }

    private samplePanoramaStatsCpu(chores: GpuChores): void {
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
        this.dispose({ destroyDevice: true, unconfigureContext: true, markDestroyed: true });
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
        try {
            this.textures.destroyTextures();
            if (this.uniformBuffer) this.uniformBuffer.destroy();
            this.transitionManager?.dispose();
            this.weatherPostProcessor?.dispose();
            this.gpuChores?.destroy();
            this.gpuChores = null;
            this.gpuPassTimer?.destroy();
            this.gpuPassTimer = null;
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
        this.weatherPostProcessor?.setShaderEffects(enabled);
    }

    public getCameraParams(): { heading: number; pitch: number } {
        return this.weatherPostProcessor?.getCameraParams() ?? { heading: 0, pitch: 0 };
    }

    public getShaderEffectsEnabled(): boolean {
        return this.weatherPostProcessor?.getShaderEffectsEnabled() ?? true;
    }

    public updateWeatherParams(params: Float32Array): void {
        this.weatherPostProcessor?.updateWeatherParams(params);
    }

    public updateCameraParams(heading: number, pitch: number): void {
        this.weatherPostProcessor?.updateCameraParams(heading, pitch);
    }

    public updateColorParams(params: Float32Array): void {
        this.weatherPostProcessor?.updateColorParams(params);
    }

    public updateNoiseBuffer(tile: Float32Array): void {
        this.weatherPostProcessor?.updateNoiseBuffer(tile);
    }

    public updateParticleSeeds(seeds: Float32Array, width: number, height: number): void {
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
        const canvasWidth = this.canvas.width;
        const canvasHeight = this.canvas.height;
        this.textures.ensureIntermediateTexture(canvasWidth, canvasHeight);
        this.weatherPostProcessor?.renderWeatherOnly(this.textures.intermediateTextureView);
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

    public beginHoldTransition(heading?: number, pitch?: number, cpuSnapshot?: HTMLCanvasElement): void {
        this.holdTransition.beginHoldTransition(heading, pitch, cpuSnapshot);
    }

    public endHoldTransition(): void {
        this.holdTransition.endHoldTransition();
    }

    public isHoldActive(): boolean {
        return this.holdTransition.isHoldActive();
    }

    public setTransitionProgress(progress: number): void {
        this.transitionManager?.setTransitionProgress(progress);
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

            encodeAndSubmitFrame({
                device: this.device,
                canvas: this.canvas,
                textures: this.textures,
                pipeline: this.pipeline,
                uniformBuffer: this.uniformBuffer,
                uniforms: packFrameUniforms({
                    time: (Date.now() - this.startTime) / 1000,
                    zoom: zoom || 1,
                    panX,
                    panY,
                    inlineTransitionProgress: this.transitionManager?.inlineProgress ?? 0.0,
                    holdActive: this.holdTransition.isHoldActive(),
                    capturePan: this.holdTransition.getCapturePan(),
                }),
                transitionManager: this.transitionManager,
                weatherPostProcessor: this.weatherPostProcessor,
                gpuPassTimer: this.gpuPassTimer,
                timings: buildFramePassTimings(this.gpuPassTimer, this.weatherPostProcessMode),
            });
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
