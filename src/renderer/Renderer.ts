import { RenderMode } from './types';
import { TransitionManager } from './TransitionManager';
import { WeatherPostProcessor } from './WeatherPostProcessor';

export class Renderer {
    public canvas: HTMLCanvasElement;
    private device!: GPUDevice;
    private context!: GPUCanvasContext;
    private presentationFormat!: GPUTextureFormat;

    // Main panorama pipeline
    private pipeline!: GPURenderPipeline;
    private bindGroup!: GPUBindGroup;
    private sampler!: GPUSampler;
    private texture!: GPUTexture;
    private videoTexture?: GPUTexture;
    private videoTextureWidth: number = 0;
    private videoTextureHeight: number = 0;
    private uniformBuffer!: GPUBuffer;

    // Car mode effects
    private carModeActive: boolean = false;
    private effectsBuffer?: GPUBuffer;

    // Intermediate HDR texture
    private intermediateTexture!: GPUTexture;
    private intermediateTextureView!: GPUTextureView;
    private intermediateWidth: number = 0;
    private intermediateHeight: number = 0;

    // Sub-systems
    private transitionManager!: TransitionManager;
    private weatherPostProcessor!: WeatherPostProcessor;

    // World-space pan tracking
    private lastPanX: number = 0.5;
    private lastPanY: number = 0.5;

    private onLostCallback?: (info: GPUDeviceLostInfo) => void;
    private isDestroyed: boolean = false;
    private startTime: number = Date.now();

    constructor(canvas: HTMLCanvasElement) {
        this.canvas = canvas;
    }

    public async init(options?: { onLost?: (info: GPUDeviceLostInfo) => void }): Promise<boolean> {
        this.onLostCallback = options?.onLost;
        if (!navigator.gpu) {
            console.warn('WebGPU not supported. Using StreetView fallback.');
            return false;
        }

        try {
            const adapter = await navigator.gpu.requestAdapter();
            if (!adapter) {
                console.warn('No WebGPU adapter found. Fallback active.');
                return false;
            }

            const requiredFeatures: GPUFeatureName[] = [];
            if (adapter.features.has('float32-filterable')) {
                requiredFeatures.push('float32-filterable');
            }

            this.device = await adapter.requestDevice({ requiredFeatures });

            this.device.lost.then((info) => {
                console.warn('[Renderer] WebGPU device lost:', info.reason, info.message);
                this.dispose();
                this.onLostCallback?.(info);
            });

            const context = this.canvas.getContext('webgpu');
            if (!context) {
                console.warn('Could not get WebGPU context. Fallback active.');
                return false;
            }

            this.context = context;
            this.presentationFormat = navigator.gpu.getPreferredCanvasFormat();
            this.configureContext();

            this.sampler = this.device.createSampler({
                magFilter: 'linear',
                minFilter: 'linear',
            });

            this.createTexture(1, 1);

            this.uniformBuffer = this.device.createBuffer({
                size: 32,
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            });

            this.effectsBuffer = this.device.createBuffer({
                size: 48,
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            });

            await this.createPipeline();

            this.weatherPostProcessor = new WeatherPostProcessor(this.device, this.context, this.canvas);
            await this.weatherPostProcessor.init(this.presentationFormat);

            this.transitionManager = new TransitionManager(this.device, this.sampler);
            try {
                await this.transitionManager.init();
            } catch (e) {
                console.warn('[Renderer] Transition pipelines failed to initialize — transitions disabled:', e);
            }

            return true;
        } catch (e) {
            console.warn('WebGPU init failed:', e instanceof Error ? e.message : String(e));
            return false;
        }
    }

    private ensureIntermediateTexture(width: number, height: number) {
        if (this.intermediateTexture &&
            this.intermediateWidth === width &&
            this.intermediateHeight === height) {
            return;
        }

        if (this.intermediateTexture) {
            this.intermediateTexture.destroy();
        }

        this.intermediateWidth = width;
        this.intermediateHeight = height;

        this.intermediateTexture = this.device.createTexture({
            size: [width, height],
            format: 'rgba16float',
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
        });

        this.intermediateTextureView = this.intermediateTexture.createView();
        this.weatherPostProcessor.updateWeatherBindGroup(this.intermediateTextureView);
    }

    private createTexture(width: number, height: number) {
        if (this.texture) this.texture.destroy();

        this.texture = this.device.createTexture({
            size: [width, height],
            format: 'rgba8unorm-srgb',
            usage: GPUTextureUsage.TEXTURE_BINDING |
                GPUTextureUsage.COPY_DST |
                GPUTextureUsage.RENDER_ATTACHMENT,
        });
    }

    private createVideoTexture(width: number, height: number) {
        if (this.videoTexture && this.videoTextureWidth === width && this.videoTextureHeight === height) {
            return;
        }

        if (this.videoTexture) this.videoTexture.destroy();

        this.videoTexture = this.device.createTexture({
            size: [width, height],
            format: 'rgba8unorm-srgb',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | GPUTextureUsage.RENDER_ATTACHMENT,
        });
        this.videoTextureWidth = width;
        this.videoTextureHeight = height;
    }

    private updateBindGroup() {
        if (!this.pipeline || !this.texture || !this.sampler || !this.uniformBuffer) return;

        const textureView = (this.videoTexture ? this.videoTexture.createView() : this.texture.createView());

        this.bindGroup = this.device.createBindGroup({
            layout: this.pipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: this.sampler },
                { binding: 1, resource: textureView },
                { binding: 2, resource: { buffer: this.uniformBuffer } },
                { binding: 3, resource: (this.transitionManager?.previousFrame ? this.transitionManager.previousFrame.createView() : textureView) },
            ],
        });
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

        this.updateBindGroup();
    }

    private configureContext() {
        if (!this.context || !this.device) return;
        this.context.configure({
            device: this.device,
            format: this.presentationFormat,
            alphaMode: 'opaque',
        });
    }

    public resize(width: number, height: number) {
        if (this.isDestroyed) return;
        this.configureContext();
    }

    public destroy() {
        this.isDestroyed = true;
        this.dispose();
    }

    private dispose() {
        try {
            if (this.texture) this.texture.destroy();
            if (this.videoTexture) this.videoTexture.destroy();
            if (this.intermediateTexture) this.intermediateTexture.destroy();
            if (this.uniformBuffer) this.uniformBuffer.destroy();
            if (this.effectsBuffer) this.effectsBuffer.destroy();
            this.transitionManager?.dispose();
            this.weatherPostProcessor?.dispose();
            this.device?.destroy();
        } catch (e) {
            // ignore cleanup errors
        }
        this.texture = undefined as any;
        this.videoTexture = undefined as any;
        this.intermediateTexture = undefined as any;
        this.uniformBuffer = undefined as any;
        this.effectsBuffer = undefined as any;
        this.pipeline = undefined as any;
        this.bindGroup = undefined as any;
    }

    public setCarMode(active: boolean): void {
        this.carModeActive = active;
    }

    public updateEffects(effectsData: Float32Array): void {
        if (this.effectsBuffer && this.device) {
            const fullEffects = new Float32Array(12);
            fullEffects.set(effectsData);
            if (fullEffects[8] === 0) {
                fullEffects[8] = this.weatherPostProcessor?.getShaderEffectsEnabled() ? 1.0 : 0.0;
            }
            this.device.queue.writeBuffer(this.effectsBuffer, 0, fullEffects);
        }
    }

    public getCanvasDataURL(): string {
        return this.canvas.toDataURL('image/png', 1.0);
    }

    // =========================================================================
    // Weather Post-Processor delegation
    // =========================================================================

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

    public updateWeatherAnimation(): void {
        this.weatherPostProcessor?.updateWeatherAnimation();
    }

    public renderWeatherOnly(): void {
        if (this.isDestroyed || !this.device) return;
        const canvasWidth = this.canvas.width;
        const canvasHeight = this.canvas.height;
        this.ensureIntermediateTexture(canvasWidth, canvasHeight);
        this.weatherPostProcessor?.renderWeatherOnly(this.intermediateTextureView);
    }

    // =========================================================================
    // Transition Manager delegation
    // =========================================================================

    public beginTransition(mode: string = 'zoom'): void {
        this.transitionManager?.beginTransition(mode);
    }

    public capturePanorama(movementHeading: number): void {
        if (!this.videoTexture) return;
        this.transitionManager?.capturePanorama(movementHeading, this.videoTexture);
        this.updateBindGroup();
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
        if (!this.videoTexture) {
            console.warn('[Renderer] captureCurrentFrame: videoTexture not available');
            return;
        }
        this.transitionManager?.captureCurrentFrame(this.videoTexture);
        this.updateBindGroup();
    }

    public setTransitionProgress(progress: number): void {
        this.transitionManager?.setTransitionProgress(progress);
    }

    // =========================================================================
    // Main render
    // =========================================================================

    public renderStreetView(
        mode: RenderMode,
        source: CanvasImageSource | null,
        heading?: number,
        pitch?: number,
        zoom?: number
    ): void {
        if (this.isDestroyed || !this.device || !this.pipeline) return;

        if (!source) {
            if (this.transitionManager?.isInTransition() && this.transitionManager?.hasPrevTexture && this.videoTexture) {
                // continue — transition pipeline will use cached GPU textures
            } else {
                this.renderWeatherOnly();
                return;
            }
        }

        let srcWidth = 0;
        let srcHeight = 0;

        if (source) {
            if (source instanceof HTMLCanvasElement) {
                srcWidth = source.width;
                srcHeight = source.height;
            } else if (source instanceof HTMLVideoElement) {
                if (source.readyState >= 2) {
                    srcWidth = source.videoWidth;
                    srcHeight = source.videoHeight;
                }
            } else if (source instanceof ImageBitmap) {
                srcWidth = source.width;
                srcHeight = source.height;
            }

            if (srcWidth > 0 && srcHeight > 0) {
                const needsBindGroupUpdate = !this.videoTexture ||
                    this.videoTextureWidth !== srcWidth ||
                    this.videoTextureHeight !== srcHeight;

                this.createVideoTexture(srcWidth, srcHeight);

                if (needsBindGroupUpdate) {
                    this.updateBindGroup();
                }

                try {
                    this.device.queue.copyExternalImageToTexture(
                        { source: source },
                        { texture: this.videoTexture! },
                        [srcWidth, srcHeight]
                    );
                } catch (e) {
                    // Ignore transient copy errors
                }
            }
        }

        try {
            const time = (Date.now() - this.startTime) / 1000;
            this.weatherPostProcessor?.updateWeatherAnimation();

            const z = zoom || 1;
            const panX = ((heading || 0) % 360) / 360;
            const panY = ((pitch || 0) + 90) / 180;

            this.lastPanX = panX;
            this.lastPanY = panY;

            const uniforms = new Float32Array([
                time, z, panX, panY,
                this.transitionManager?.inlineProgress ?? 0.0,
                this.transitionManager?.transitionDefaults['zoom'].param1 ?? 2.4,
                this.transitionManager?.transitionDefaults['zoom-blur'].param2 ?? 1.1,
                0.0,
            ]);
            this.device.queue.writeBuffer(this.uniformBuffer, 0, uniforms);

            const canvasWidth = this.canvas.width;
            const canvasHeight = this.canvas.height;
            this.ensureIntermediateTexture(canvasWidth, canvasHeight);

            const commandEncoder = this.device.createCommandEncoder();

            const didTransition = this.transitionManager?.renderTransitionPass(
                commandEncoder,
                this.intermediateTextureView,
                this.videoTexture!,
                this.pipeline,
                this.bindGroup
            );

            if (!didTransition) {
                const mainPass = commandEncoder.beginRenderPass({
                    colorAttachments: [{
                        view: this.intermediateTextureView,
                        clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
                        loadOp: 'clear' as GPULoadOp,
                        storeOp: 'store' as GPUStoreOp,
                    }],
                });
                mainPass.setPipeline(this.pipeline);
                mainPass.setBindGroup(0, this.bindGroup);
                mainPass.draw(4, 1, 0, 0);
                mainPass.end();
            }

            this.weatherPostProcessor?.renderPass(commandEncoder);

            this.device.queue.submit([commandEncoder.finish()]);
        } catch (e) {
            // Suppress sporadic frame errors
        }
    }
}
