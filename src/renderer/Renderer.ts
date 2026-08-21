import { RenderMode } from './types';
import { TransitionManager } from './TransitionManager';
import { WeatherPostProcessor } from './WeatherPostProcessor';
import { ComputeWeatherPostProcessor } from './ComputeWeatherPostProcessor';
import { WeatherPostProcessorLike } from './weatherPostProcessorTypes';
import {
    configureCanvasContext,
    checkRequiredLimits,
    collectOptionalDeviceFeatures,
    logAdapterCapabilities,
    resolveAdapterRequestOptions,
    buildCapabilityMatrix,
    describeAdapterSelection,
    attachUncapturedErrorHandler,
    labelDevice,
    getCanvasOutputFlags,
    readDisplayOutputCapabilities,
    resolveCanvasOutputPolicy,
    type CanvasOutputPolicy,
} from './deviceInit';
import { DEVICE_LABELS } from './deviceCapabilities';
import { GpuPassTimer } from './gpuPassTimer';
import { resetGpuPassTimings } from './gpuPassTimingStore';
import { clampSamplerAnisotropy, getSamplerAnisotropyForQuality } from './samplerAnisotropy';
import type { QualityLevel } from '../config/visualPresets';
import type { WeatherPassTimingContext } from './weatherPostProcessorTypes';
import { HoldTransitionController } from './holdTransition';
import { TextureLifecycle } from './textureLifecycle';
import {
    RendererDebugOptions,
    RendererInitOptions,
    StreetViewRenderer,
    WeatherPostProcessMode,
    getRendererPreference,
} from './RendererBackend';
import {
    adapterInfoFromGpuAdapter,
    publishWebGpuProbe,
} from './webgpuBootProbe';
import { GpuChores } from './gpuChores/GpuChores';
import { histDownsampleSize } from './gpuChores/lumaMath';

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

        const preference = getRendererPreference();
        const webglPreferenceDeferred = preference === 'webgl';

        if (!navigator.gpu) {
            this._fallbackReason = 'WebGPU is not supported in this browser';
            publishWebGpuProbe({
                ok: false,
                stage: 'navigator',
                reason: this._fallbackReason,
                preference,
                webglPreferenceDeferred,
            });
            console.warn('WebGPU not supported. Hard-fail — WebGL weather deferred.');
            return false;
        }

        try {
            const adapterOptions = await resolveAdapterRequestOptions(options);
            const adapter = await navigator.gpu.requestAdapter(adapterOptions);
            if (!adapter) {
                this._fallbackReason = 'No compatible WebGPU adapter found';
                publishWebGpuProbe({
                    ok: false,
                    stage: 'adapter',
                    reason: this._fallbackReason,
                    preference,
                    webglPreferenceDeferred,
                });
                console.warn('No WebGPU adapter found. Hard-fail — WebGL weather deferred.');
                return false;
            }

            const probeAdapter = adapterInfoFromGpuAdapter(adapter);

            const limitCheck = checkRequiredLimits(adapter, this.weatherPostProcessMode);
            if (!limitCheck.ok) {
                this._fallbackReason = limitCheck.reason;
                publishWebGpuProbe({
                    ok: false,
                    stage: 'limits',
                    reason: this._fallbackReason,
                    preference,
                    webglPreferenceDeferred,
                    adapter: probeAdapter,
                });
                console.warn('[Renderer] WebGPU adapter limits are insufficient:', limitCheck.reason);
                return false;
            }

            const requiredFeatures = collectOptionalDeviceFeatures(adapter);

            try {
                this.device = await adapter.requestDevice({
                    label: DEVICE_LABELS.device,
                    requiredFeatures,
                    requiredLimits: limitCheck.requiredLimits,
                });
            } catch (deviceError) {
                this._fallbackReason = deviceError instanceof Error
                    ? deviceError.message
                    : String(deviceError);
                publishWebGpuProbe({
                    ok: false,
                    stage: 'device',
                    reason: this._fallbackReason,
                    preference,
                    webglPreferenceDeferred,
                    adapter: probeAdapter,
                });
                console.warn('[Renderer] requestDevice failed:', this._fallbackReason);
                return false;
            }
            labelDevice(this.device);

            this.device.lost.then((info) => {
                console.warn('[Renderer] WebGPU device lost:', info.reason, info.message);
                this.dispose({ destroyDevice: false, unconfigureContext: true, markDestroyed: true });
                this.onLostCallback?.(info);
            });

            const context = this.canvas.getContext('webgpu');
            if (!context) {
                this._fallbackReason = 'Could not acquire a WebGPU canvas context';
                publishWebGpuProbe({
                    ok: false,
                    stage: 'canvas',
                    reason: this._fallbackReason,
                    preference,
                    webglPreferenceDeferred,
                    adapter: probeAdapter,
                });
                console.warn('Could not get WebGPU context. Hard-fail — WebGL weather deferred.');
                return false;
            }

            this.context = context;
            const preferredFormat = navigator.gpu.getPreferredCanvasFormat();
            this.canvasOutputPolicy = resolveCanvasOutputPolicy({
                preferredFormat,
                enabledFeatures: requiredFeatures,
                flags: getCanvasOutputFlags(),
                ...readDisplayOutputCapabilities(),
            });
            if (this.canvasOutputPolicy.hdrRejectedReason) {
                console.info('[Renderer] HDR canvas not enabled:', this.canvasOutputPolicy.hdrRejectedReason);
            }
            const appliedCanvas = configureCanvasContext(
                this.context,
                this.device,
                preferredFormat,
                this.canvasOutputPolicy,
            );
            // The HDR path swaps the swap-chain format, so pipelines follow what was applied.
            this.presentationFormat = appliedCanvas.format;
            // Resize re-configures; keep the policy in sync with what the browser accepted.
            this.canvasOutputPolicy = {
                hdr: appliedCanvas.toneMapping === 'extended',
                p3: appliedCanvas.colorSpace === 'display-p3',
            };

            const capabilityMatrix = buildCapabilityMatrix(
                this.weatherPostProcessMode,
                limitCheck.requiredLimits!,
                requiredFeatures,
                { ...describeAdapterSelection(adapterOptions), canvas: appliedCanvas },
            );
            logAdapterCapabilities(
                adapter,
                adapterOptions.powerPreference,
                this.weatherPostProcessMode,
                requiredFeatures,
                capabilityMatrix,
            );
            attachUncapturedErrorHandler(this.device, capabilityMatrix);

            // Boot-probe compute smoke: catch Edge/Chrome shader backend gaps before weather mounts.
            try {
                await this.runComputeBootProbe();
            } catch (computeError) {
                this._fallbackReason = computeError instanceof Error
                    ? computeError.message
                    : String(computeError);
                publishWebGpuProbe({
                    ok: false,
                    stage: 'compute',
                    reason: this._fallbackReason,
                    preference,
                    webglPreferenceDeferred,
                    adapter: probeAdapter,
                    capabilityMatrix,
                });
                console.warn('[Renderer] Compute boot probe failed:', this._fallbackReason);
                this.dispose({ destroyDevice: true, unconfigureContext: true, markDestroyed: true });
                return false;
            }

            this.samplerAnisotropy = 1;
            this.sampler = this.device.createSampler(this.buildSamplerDescriptor(1));

            if (capabilityMatrix.timestampQueriesAvailable) {
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

            await this.createPipeline();

            this.weatherPostProcessor = this.weatherPostProcessMode === 'compute'
                ? new ComputeWeatherPostProcessor(this.device, this.context, this.canvas)
                : new WeatherPostProcessor(this.device, this.context, this.canvas);
            await this.weatherPostProcessor.init(this.presentationFormat);

            this.gpuChores = new GpuChores(this.device);
            void this.gpuChores.ensureReady();

            this.transitionManager = new TransitionManager(this.device, this.sampler);
            try {
                await this.transitionManager.init(!!options?.legacyTransitions);
            } catch (e) {
                console.warn('[Renderer] Transition pipelines failed to initialize — transitions disabled:', e);
            }

            publishWebGpuProbe({
                ok: true,
                stage: 'ok',
                reason: '',
                preference,
                webglPreferenceDeferred,
                adapter: probeAdapter,
                capabilityMatrix,
            });

            return true;
        } catch (e) {
            this._fallbackReason = e instanceof Error ? e.message : String(e);
            publishWebGpuProbe({
                ok: false,
                stage: 'device',
                reason: this._fallbackReason,
                preference,
                webglPreferenceDeferred,
            });
            console.warn('WebGPU init failed:', e instanceof Error ? e.message : String(e));
            return false;
        }
    }

    /** Tiny @compute pipeline create — surfaces backend compile failures during boot. */
    private async runComputeBootProbe(): Promise<void> {
        const shader = this.device.createShaderModule({
            label: 'streetview-boot-compute-probe',
            code: `@compute @workgroup_size(1) fn main() {}`,
        });
        this.device.createComputePipeline({
            label: 'streetview-boot-compute-probe-pipeline',
            layout: 'auto',
            compute: { module: shader, entryPoint: 'main' },
        });
        // Yield so async compilation / uncapturederror can surface before we continue.
        await this.device.queue.onSubmittedWorkDone();
    }

    public getWeatherPostProcessMode(): WeatherPostProcessMode {
        return this.weatherPostProcessMode;
    }

    public getGpuChores(): GpuChores | null {
        return this.gpuChores;
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
        this.sampler = this.device.createSampler(this.buildSamplerDescriptor(anisotropy));
        this.textures.updateBindGroup();
    }

    private buildSamplerDescriptor(maxAnisotropy: number): GPUSamplerDescriptor {
        return {
            magFilter: 'linear',
            minFilter: 'linear',
            mipmapFilter: 'linear',
            addressModeU: 'clamp-to-edge',
            addressModeV: 'clamp-to-edge',
            addressModeW: 'clamp-to-edge',
            maxAnisotropy,
        };
    }

    private async createPipeline(): Promise<void> {
        const shaderUrl = `${process.env.PUBLIC_URL || '/'}/shaders/streetview.wgsl`;
        let shaderCode: string;
        try {
            const response = await fetch(shaderUrl);
            if (!response.ok) {
                throw new Error(`Failed to load streetview.wgsl: ${response.status} ${response.statusText}`);
            }
            shaderCode = await response.text();
        } catch (error) {
            console.error(`[Renderer] Failed to load streetview shader from ${shaderUrl}:`, error);
            throw error;
        }

        const shaderModule = this.device.createShaderModule({ code: shaderCode });

        const bindGroupLayout = this.device.createBindGroupLayout({
            entries: [
                {
                    binding: 0,
                    visibility: GPUShaderStage.FRAGMENT,
                    sampler: { type: 'filtering' as GPUSamplerBindingType },
                },
                {
                    binding: 1,
                    visibility: GPUShaderStage.FRAGMENT,
                    texture: { sampleType: 'float' as GPUTextureSampleType },
                },
                {
                    binding: 2,
                    visibility: GPUShaderStage.FRAGMENT,
                    buffer: { type: 'uniform' as GPUBufferBindingType },
                },
                {
                    binding: 3,
                    visibility: GPUShaderStage.FRAGMENT,
                    texture: { sampleType: 'float' as GPUTextureSampleType },
                },
            ],
        });

        const pipelineLayout = this.device.createPipelineLayout({
            bindGroupLayouts: [bindGroupLayout],
        });

        this.pipeline = this.device.createRenderPipeline({
            layout: pipelineLayout,
            vertex: {
                module: shaderModule,
                entryPoint: 'vs_main',
            },
            fragment: {
                module: shaderModule,
                entryPoint: 'fs_main',
                targets: [{ format: 'rgba16float' as GPUTextureFormat }],
            },
            primitive: { topology: 'triangle-strip' },
        });

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

    private submitPanoramaFrame(heading?: number, pitch?: number, zoom?: number): void {
        try {
            const time = (Date.now() - this.startTime) / 1000;
            this.weatherPostProcessor?.updateWeatherAnimation();

            const z = zoom || 1;
            const panX = ((heading || 0) % 360) / 360;
            const panY = ((pitch || 0) + 90) / 180;

            this.transitionManager?.recordLastPan(panX, panY);

            const capturePan = this.holdTransition.getCapturePan();
            const uniforms = new Float32Array([
                time, z, panX, panY,
                this.transitionManager?.inlineProgress ?? 0.0,
                this.holdTransition.isHoldActive() ? 1.0 : 0.0,
                capturePan.x,
                capturePan.y,
            ]);
            this.device.queue.writeBuffer(this.uniformBuffer, 0, uniforms);

            const canvasWidth = this.canvas.width;
            const canvasHeight = this.canvas.height;
            this.textures.ensureIntermediateTexture(canvasWidth, canvasHeight);

            const commandEncoder = this.device.createCommandEncoder();
            const pass1Timing = this.gpuPassTimer
                ? { timer: this.gpuPassTimer, startIndex: 0, endIndex: 1 }
                : undefined;
            const weatherTiming: WeatherPassTimingContext | undefined = this.gpuPassTimer
                ? {
                    timer: this.gpuPassTimer,
                    weatherStartIndex: 2,
                    weatherEndIndex: 3,
                    blitStartIndex: this.weatherPostProcessMode === 'compute' ? 4 : undefined,
                    blitEndIndex: this.weatherPostProcessMode === 'compute' ? 5 : undefined,
                }
                : undefined;

            const didTransition = this.transitionManager?.renderTransitionPass(
                commandEncoder,
                this.textures.intermediateTextureView,
                this.textures.videoTexture!,
                this.pipeline,
                this.textures.bindGroup,
                pass1Timing,
            );

            if (!didTransition) {
                const mainPass = commandEncoder.beginRenderPass({
                    colorAttachments: [{
                        view: this.textures.intermediateTextureView,
                        clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
                        loadOp: 'clear' as GPULoadOp,
                        storeOp: 'store' as GPUStoreOp,
                    }],
                });
                if (pass1Timing) {
                    pass1Timing.timer.markPassStart(mainPass, pass1Timing.startIndex);
                }
                mainPass.setPipeline(this.pipeline);
                mainPass.setBindGroup(0, this.textures.bindGroup);
                mainPass.draw(4, 1, 0, 0);
                if (pass1Timing) {
                    pass1Timing.timer.markPassEnd(mainPass, pass1Timing.endIndex);
                }
                mainPass.end();
            }

            this.weatherPostProcessor?.renderPass(commandEncoder, weatherTiming);

            if (this.gpuPassTimer) {
                this.gpuPassTimer.resolveAndScheduleRead(commandEncoder);
            }

            this.device.queue.submit([commandEncoder.finish()]);
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
