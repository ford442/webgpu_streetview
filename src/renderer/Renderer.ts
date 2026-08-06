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
} from './deviceInit';
import { HoldTransitionController } from './holdTransition';
import { TextureLifecycle } from './textureLifecycle';
import {
    RendererDebugOptions,
    RendererInitOptions,
    StreetViewRenderer,
    WeatherPostProcessMode,
} from './RendererBackend';

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

    private pipeline!: GPURenderPipeline;
    private sampler!: GPUSampler;
    private uniformBuffer!: GPUBuffer;

    private readonly textures: TextureLifecycle;
    private readonly holdTransition: HoldTransitionController;

    private transitionManager!: TransitionManager;
    private weatherPostProcessor!: WeatherPostProcessorLike;
    private weatherPostProcessMode: WeatherPostProcessMode = 'fragment';

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
        if (!navigator.gpu) {
            this._fallbackReason = 'WebGPU is not supported in this browser';
            console.warn('WebGPU not supported. Using StreetView fallback.');
            return false;
        }

        try {
            const adapterOptions = await resolveAdapterRequestOptions(options);
            const adapter = await navigator.gpu.requestAdapter(adapterOptions);
            if (!adapter) {
                this._fallbackReason = 'No compatible WebGPU adapter found';
                console.warn('No WebGPU adapter found. Fallback active.');
                return false;
            }

            logAdapterCapabilities(adapter, adapterOptions.powerPreference, this.weatherPostProcessMode);

            const limitCheck = checkRequiredLimits(adapter, this.weatherPostProcessMode);
            if (!limitCheck.ok) {
                this._fallbackReason = limitCheck.reason;
                console.warn('[Renderer] WebGPU adapter limits are insufficient:', limitCheck.reason);
                return false;
            }

            const requiredFeatures = collectOptionalDeviceFeatures(adapter);

            this.device = await adapter.requestDevice({
                requiredFeatures,
                requiredLimits: limitCheck.requiredLimits,
            });

            this.device.lost.then((info) => {
                console.warn('[Renderer] WebGPU device lost:', info.reason, info.message);
                this.dispose({ destroyDevice: false, unconfigureContext: true, markDestroyed: true });
                this.onLostCallback?.(info);
            });

            const context = this.canvas.getContext('webgpu');
            if (!context) {
                this._fallbackReason = 'Could not acquire a WebGPU canvas context';
                console.warn('Could not get WebGPU context. Fallback active.');
                return false;
            }

            this.context = context;
            this.presentationFormat = navigator.gpu.getPreferredCanvasFormat();
            configureCanvasContext(this.context, this.device, this.presentationFormat);

            this.sampler = this.device.createSampler({
                magFilter: 'linear',
                minFilter: 'linear',
                mipmapFilter: 'linear',
                addressModeU: 'clamp-to-edge',
                addressModeV: 'clamp-to-edge',
                addressModeW: 'clamp-to-edge',
                maxAnisotropy: 1,
            });

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

            this.transitionManager = new TransitionManager(this.device, this.sampler);
            try {
                await this.transitionManager.init(!!options?.legacyTransitions);
            } catch (e) {
                console.warn('[Renderer] Transition pipelines failed to initialize — transitions disabled:', e);
            }

            return true;
        } catch (e) {
            this._fallbackReason = e instanceof Error ? e.message : String(e);
            console.warn('WebGPU init failed:', e instanceof Error ? e.message : String(e));
            return false;
        }
    }

    public getWeatherPostProcessMode(): WeatherPostProcessMode {
        return this.weatherPostProcessMode;
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
        configureCanvasContext(this.context, this.device, this.presentationFormat);
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

            const didTransition = this.transitionManager?.renderTransitionPass(
                commandEncoder,
                this.textures.intermediateTextureView,
                this.textures.videoTexture!,
                this.pipeline,
                this.textures.bindGroup
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
                mainPass.setPipeline(this.pipeline);
                mainPass.setBindGroup(0, this.textures.bindGroup);
                mainPass.draw(4, 1, 0, 0);
                mainPass.end();
            }

            this.weatherPostProcessor?.renderPass(commandEncoder);

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
