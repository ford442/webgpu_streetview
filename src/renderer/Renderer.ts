import { RenderMode } from './types';
import { TransitionManager } from './TransitionManager';
import { WeatherPostProcessor } from './WeatherPostProcessor';
import { ComputeWeatherPostProcessor } from './ComputeWeatherPostProcessor';
import { WeatherPostProcessorLike } from './weatherPostProcessorTypes';
import { getCanvasFingerprint } from '../utils/panoramaStability';
import { streetViewProbe } from '../utils/streetViewProbe';
import {
    getAdapterPowerPreferencePolicy,
    getAdapterRequestOptions as getRequestedAdapterOptions,
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

    // Main panorama pipeline
    private pipeline!: GPURenderPipeline;
    private bindGroup!: GPUBindGroup;
    private sampler!: GPUSampler;
    private texture!: GPUTexture;
    private videoTexture?: GPUTexture;
    private videoTextureWidth: number = 0;
    private videoTextureHeight: number = 0;
    private uniformBuffer!: GPUBuffer;

    // === INLINE TRANSITION SYSTEM ===
    // The main shader (streetview.wgsl) mixes between previous and current
    // based on transitionProgress passed in the uniform buffer.
    private holdActive: boolean = false;
    
    // === DUAL-PASS WEATHER SYSTEM ===
    // Intermediate HDR texture for post-processing

    // Intermediate HDR texture
    private intermediateTexture!: GPUTexture;
    private intermediateTextureView!: GPUTextureView;
    private intermediateWidth: number = 0;
    private intermediateHeight: number = 0;

    // Sub-systems
    private transitionManager!: TransitionManager;
    private weatherPostProcessor!: WeatherPostProcessorLike;
    private weatherPostProcessMode: WeatherPostProcessMode = 'fragment';

    // World-space pan tracking
    private capturePanX: number = 0.5;
    private capturePanY: number = 0.5;

    private onLostCallback?: (info: GPUDeviceLostInfo) => void;
    private isDestroyed: boolean = false;
    private isDisposed: boolean = false;
    private startTime: number = Date.now();

    constructor(canvas: HTMLCanvasElement) {
        this.canvas = canvas;
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
            const adapterOptions = await this.getAdapterRequestOptions(options);
            const adapter = await navigator.gpu.requestAdapter(adapterOptions);
            if (!adapter) {
                this._fallbackReason = 'No compatible WebGPU adapter found';
                console.warn('No WebGPU adapter found. Fallback active.');
                return false;
            }

            this.logAdapterCapabilities(adapter, adapterOptions.powerPreference);

            const limitCheck = this.getRequiredLimits(adapter);
            if (!limitCheck.ok) {
                this._fallbackReason = limitCheck.reason;
                console.warn('[Renderer] WebGPU adapter limits are insufficient:', limitCheck.reason);
                return false;
            }

            const requiredFeatures: GPUFeatureName[] = [];
            if (adapter.features.has('float32-filterable')) {
                requiredFeatures.push('float32-filterable');
            }

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
            this.configureContext();

            this.sampler = this.device.createSampler({
                magFilter: 'linear',
                minFilter: 'linear',
                mipmapFilter: 'linear',
                addressModeU: 'clamp-to-edge',
                addressModeV: 'clamp-to-edge',
                addressModeW: 'clamp-to-edge',
                maxAnisotropy: 1,
            });

            this.createTexture(1, 1);

            // Uniform buffer: 32 bytes (8 floats) for 16-byte alignment
            // [0-3]: time, zoom, panX (heading norm), panY (pitch norm)
            // [4]:   transitionProgress (0.0 = old frame, 1.0 = new frame)
            // [5]:   holdActive (1.0 = freeze on previous frame while loading)
            // [6-7]: capturePanX, capturePanY at snapshot time (look-around delta)
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
                await this.transitionManager.init();
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

    private async getAdapterRequestOptions(options?: RendererInitOptions): Promise<GPURequestAdapterOptions> {
        const policy = getAdapterPowerPreferencePolicy(options);
        if (policy.source !== 'default') {
            return getRequestedAdapterOptions(options);
        }

        const batteryApi = (navigator as Navigator & {
            getBattery?: () => Promise<{ charging: boolean; level: number }>;
        }).getBattery;
        if (typeof batteryApi !== 'function') {
            return { powerPreference: 'high-performance' };
        }

        try {
            const battery = await batteryApi.call(navigator);
            if (!battery.charging && battery.level <= 0.2) {
                return { powerPreference: 'low-power' };
            }
        } catch {
            // Ignore battery API failures and fall back to high-performance.
        }

        return { powerPreference: 'high-performance' };
    }

    private getRequiredLimits(adapter: GPUAdapter): {
        ok: boolean;
        reason?: string;
        requiredLimits?: Record<string, number>;
    } {
        const limits = adapter.limits;
        const required: Partial<Record<keyof GPUSupportedLimits, number>> = {
            maxTextureDimension2D: 4096,
        };
        if (this.weatherPostProcessMode === 'compute') {
            required.maxStorageBufferBindingSize = 65536;
            required.maxBufferSize = 65536;
        }

        for (const [name, minimum] of Object.entries(required) as Array<[keyof GPUSupportedLimits, number]>) {
            const supported = Number(limits[name]);
            if (!Number.isFinite(supported) || supported < minimum) {
                return {
                    ok: false,
                    reason: `Adapter limit ${String(name)}=${supported} below required ${minimum}`,
                };
            }
        }

        return {
            ok: true,
            requiredLimits: required as Record<string, number>,
        };
    }

    private logAdapterCapabilities(adapter: GPUAdapter, powerPreference?: GPUPowerPreference): void {
        const adapterInfo = (adapter as GPUAdapter & {
            info?: { vendor?: string; architecture?: string; device?: string; description?: string };
        }).info;
        const summary = {
            powerPreference: powerPreference || 'unspecified',
            weatherMode: this.weatherPostProcessMode,
            vendor: adapterInfo?.vendor || 'unknown',
            architecture: adapterInfo?.architecture || 'unknown',
            device: adapterInfo?.device || 'unknown',
            description: adapterInfo?.description || 'unknown',
            limits: {
                maxTextureDimension2D: Number(adapter.limits.maxTextureDimension2D),
                maxStorageBufferBindingSize: Number(adapter.limits.maxStorageBufferBindingSize),
                maxBufferSize: Number(adapter.limits.maxBufferSize),
            },
        };

        console.info('[Renderer] WebGPU adapter capabilities:', summary);
        if (typeof window !== 'undefined') {
            (window as any).rendererAdapterInfo = summary;
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
        this.weatherPostProcessor.updateWeatherBindGroup(this.intermediateTextureView, width, height);
    }

    public getWeatherPostProcessMode(): WeatherPostProcessMode {
        return this.weatherPostProcessMode;
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
            colorSpace: 'srgb',
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
        });
    }

    public resize(_width: number, _height: number) {
        if (this.isDestroyed) return;
        this.configureContext();
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
            if (this.texture) this.texture.destroy();
            if (this.videoTexture) this.videoTexture.destroy();
            if (this.intermediateTexture) this.intermediateTexture.destroy();
            if (this.uniformBuffer) this.uniformBuffer.destroy();
            this.transitionManager?.dispose();
            this.weatherPostProcessor?.dispose();
            if (unconfigureContext) {
                this.context?.unconfigure();
            }
            if (destroyDevice) {
                this.device?.destroy();
            }
        } catch (e) {
            // ignore cleanup errors
        }
        this.texture = undefined as any;
        this.videoTexture = undefined as any;
        this.intermediateTexture = undefined as any;
        this.uniformBuffer = undefined as any;
        this.pipeline = undefined as any;
        this.bindGroup = undefined as any;
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
        // WebGPU debug isolation remains controlled through shaderEffectsEnabled
        // until individual WGSL effect branches are split into debug toggles.
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

    /**
     * Arm hold-pause transition: snapshot the outgoing frame and freeze rendering
     * on it until endHoldTransition() is called when the new panorama is ready.
     */
    public beginHoldTransition(heading?: number, pitch?: number, cpuSnapshot?: HTMLCanvasElement): void {
        if (this.videoTexture) {
            this.captureCurrentFrame();
        } else if (cpuSnapshot && cpuSnapshot.width >= 256 && cpuSnapshot.height >= 256) {
            this.createVideoTexture(cpuSnapshot.width, cpuSnapshot.height);
            try {
                this.device.queue.copyExternalImageToTexture(
                    { source: cpuSnapshot },
                    { texture: this.videoTexture! },
                    [cpuSnapshot.width, cpuSnapshot.height]
                );
                this.transitionManager?.captureCurrentFrame(this.videoTexture!);
                this.updateBindGroup();
            } catch (e) {
                console.warn('[Renderer] CPU hold snapshot upload failed:', e);
            }
        } else {
            console.warn('[Renderer] beginHoldTransition: no GPU or CPU snapshot available');
        }

        const panX = ((heading ?? 0) % 360) / 360;
        const panY = ((pitch ?? 0) + 90) / 180;
        this.capturePanX = panX;
        this.capturePanY = panY;
        this.holdActive = true;
        this.transitionManager?.setTransitionProgress(0.0);
    }

    /** End the hold phase so the release crossfade can run. */
    public endHoldTransition(): void {
        this.holdActive = false;
    }

    public isHoldActive(): boolean {
        return this.holdActive;
    }

    /**
     * Set the transition progress for the inline shader transition.
     * 0.0 = fully old frame, 1.0 = fully new frame.
     */
    public setTransitionProgress(progress: number): void {
        this.transitionManager?.setTransitionProgress(progress);
    }

    // =========================================================================
    // Main render
    // =========================================================================

    /**
     * Draw using the GPU snapshot only — no external image upload.
     * Used while holdActive to keep blurry/loading GMaps pixels off videoTexture.
     */
    public renderHeldFrame(heading?: number, pitch?: number, zoom?: number): void {
        if (this.isDestroyed || !this.device || !this.pipeline) return;

        if (!this.holdActive || !this.transitionManager?.previousFrame || !this.videoTexture) {
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

            const uniforms = new Float32Array([
                time, z, panX, panY,
                this.transitionManager?.inlineProgress ?? 0.0,
                this.holdActive ? 1.0 : 0.0,
                this.capturePanX,
                this.capturePanY,
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

    private uploadLiveSource(source: CanvasImageSource): boolean {
        // Defense in depth: this is the only place live Google Maps pixels reach
        // videoTexture. If a future change calls renderStreetView() (or this
        // method directly) while a hold is armed, the shader's `holding` branch
        // still won't sample `tex` — but refusing the upload here keeps the
        // texture itself clean and gives a loud signal that the holdActive guard
        // in renderStreetView() was bypassed.
        if (this.holdActive) {
            streetViewProbe.warnLeak(
                'uploadLiveSource() called while holdActive=true — the renderStreetView() hold guard was bypassed.'
            );
            return !!this.videoTexture;
        }

        let srcWidth = 0;
        let srcHeight = 0;

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

        if (srcWidth <= 0 || srcHeight <= 0) {
            return false;
        }

        const needsBindGroupUpdate = !this.videoTexture ||
            this.videoTextureWidth !== srcWidth ||
            this.videoTextureHeight !== srcHeight;

        const isCanvasSource = source instanceof HTMLCanvasElement;
        const sourceStable = !isCanvasSource || !!getCanvasFingerprint(source as HTMLCanvasElement);

        if (!sourceStable) {
            if (!this.videoTexture) {
                return false;
            }
            return true;
        }

        this.createVideoTexture(srcWidth, srcHeight);

        if (needsBindGroupUpdate) {
            this.updateBindGroup();
        }

        try {
            this.device.queue.copyExternalImageToTexture(
                { source: source as GPUCopyExternalImageSource },
                { texture: this.videoTexture! },
                [srcWidth, srcHeight]
            );
        } catch (e) {
            // Ignore transient copy errors
        }

        return true;
    }

    public renderStreetView(
        _mode: RenderMode,
        source: CanvasImageSource | null,
        heading?: number,
        pitch?: number,
        zoom?: number
    ): void {
        if (this.isDestroyed || !this.device || !this.pipeline) return;

        if (this.holdActive) {
            this.renderHeldFrame(heading, pitch, zoom);
            return;
        }

        if (!source) {
            if (this.transitionManager?.isInTransition() && this.transitionManager?.hasPrevTexture && this.videoTexture) {
                // continue — transition pipeline will use cached GPU textures
            } else {
                this.renderWeatherOnly();
                return;
            }
        }

        if (source) {
            const uploaded = this.uploadLiveSource(source);
            if (!uploaded && !this.videoTexture) {
                this.renderWeatherOnly();
                return;
            }
        }

        this.submitPanoramaFrame(heading, pitch, zoom);
    }
}
