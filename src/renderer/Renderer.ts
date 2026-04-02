import { RenderMode } from './types';

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
    
    // === DUAL-PASS WEATHER SYSTEM ===
    // Intermediate HDR texture for post-processing
    private intermediateTexture!: GPUTexture;
    private intermediateTextureView!: GPUTextureView;
    private intermediateWidth: number = 0;
    private intermediateHeight: number = 0;
    
    // Weather post-process pipeline
    private weatherPipeline!: GPURenderPipeline;
    private weatherBindGroup!: GPUBindGroup;
    private weatherParamsBuffer!: GPUBuffer;
    private weatherSampler!: GPUSampler;
    
    // Weather state
    private weatherParams: Float32Array = new Float32Array(16); // [vibrance, sat, contrast, exposure, temp, tint, time, rain, snow, wind, speed, ...]

    private onLostCallback?: (info: GPUDeviceLostInfo) => void;
    private isDestroyed: boolean = false;

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

            // Request HDR float format support
            const requiredFeatures: GPUFeatureName[] = [];
            if (adapter.features.has('float32-filterable')) {
                requiredFeatures.push('float32-filterable');
            }

            this.device = await adapter.requestDevice({ requiredFeatures });

            // Handle device loss for recovery
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

            this.weatherSampler = this.device.createSampler({
                magFilter: 'linear',
                minFilter: 'linear',
                addressModeU: 'clamp-to-edge',
                addressModeV: 'clamp-to-edge',
            });

            // Initialize with a 1x1 placeholder
            this.createTexture(1, 1);

            this.uniformBuffer = this.device.createBuffer({
                size: 16, // 4 floats * 4 bytes
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            });

            // Effects buffer for car mode
            this.effectsBuffer = this.device.createBuffer({
                size: 32,
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            });

            // Weather params buffer (16 floats for HDR weather system)
            this.weatherParamsBuffer = this.device.createBuffer({
                size: 64, // 16 floats × 4 bytes
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            });

            // Initialize default weather params
            this.weatherParams.set([
                0.0,  // vibrance
                0.0,  // saturation
                0.0,  // contrast
                0.0,  // exposure
                0.0,  // temperature
                0.0,  // tint
                0.0,  // time
                0.0,  // rainIntensity
                0.0,  // snowIntensity
                0.0,  // wind
                1.0,  // speed
                0.0, 0.0, 0.0, 0.0, 0.0  // padding
            ]);

            await this.createPipeline();
            await this.createWeatherPipeline();

            return true;
        } catch (e) {
            console.warn('WebGPU init failed:', e instanceof Error ? e.message : String(e));
            return false;
        }
    }

    // Ensure intermediate HDR texture exists and is correct size
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

        // Create HDR intermediate texture (rgba16float for HDR)
        this.intermediateTexture = this.device.createTexture({
            size: [width, height],
            format: 'rgba16float',
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
        });

        this.intermediateTextureView = this.intermediateTexture.createView();

        // Update weather bind group with new intermediate view
        this.updateWeatherBindGroup();
    }

    private createTexture(width: number, height: number) {
        if (this.texture) this.texture.destroy();

        this.texture = this.device.createTexture({
            size: [width, height],
            format: 'rgba8unorm',
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
            format: 'rgba8unorm',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
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
            ],
        });
    }

    private updateWeatherBindGroup() {
        if (!this.weatherPipeline || !this.intermediateTextureView || !this.weatherSampler) return;

        this.weatherBindGroup = this.device.createBindGroup({
            layout: this.weatherPipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: this.weatherParamsBuffer } },
                { binding: 1, resource: this.intermediateTextureView },
                { binding: 2, resource: this.weatherSampler },
            ],
        });
    }

    private async createPipeline(): Promise<void> {
        const shaderCode = await fetch('./shaders/streetview.wgsl').then(r => r.text());

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
            ],
        });

        const pipelineLayout = this.device.createPipelineLayout({
            bindGroupLayouts: [bindGroupLayout],
        });

        // Main pipeline outputs to HDR intermediate format
        this.pipeline = this.device.createRenderPipeline({
            layout: pipelineLayout,
            vertex: {
                module: shaderModule,
                entryPoint: 'vs_main',
            },
            fragment: {
                module: shaderModule,
                entryPoint: 'fs_main',
                targets: [{ format: 'rgba16float' as GPUTextureFormat }], // ← HDR intermediate
            },
            primitive: { topology: 'triangle-strip' },
        });

        this.updateBindGroup();
    }

    private async createWeatherPipeline(): Promise<void> {
        const shaderCode = await fetch('./shaders/weather-post.wgsl').then(r => r.text());

        const shaderModule = this.device.createShaderModule({ code: shaderCode });

        const bindGroupLayout = this.device.createBindGroupLayout({
            entries: [
                {
                    binding: 0,
                    visibility: GPUShaderStage.FRAGMENT,
                    buffer: { type: 'uniform' as GPUBufferBindingType },
                },
                {
                    binding: 1,
                    visibility: GPUShaderStage.FRAGMENT,
                    texture: { sampleType: 'float' as GPUTextureSampleType },
                },
                {
                    binding: 2,
                    visibility: GPUShaderStage.FRAGMENT,
                    sampler: { type: 'filtering' as GPUSamplerBindingType },
                },
            ],
        });

        const pipelineLayout = this.device.createPipelineLayout({
            bindGroupLayouts: [bindGroupLayout],
        });

        // Weather pipeline outputs to final canvas format
        this.weatherPipeline = this.device.createRenderPipeline({
            layout: pipelineLayout,
            vertex: {
                module: shaderModule,
                entryPoint: 'vs_main',
            },
            fragment: {
                module: shaderModule,
                entryPoint: 'fs_main',
                targets: [{ format: this.presentationFormat as GPUTextureFormat }],
            },
            primitive: { topology: 'triangle-list' }, // Triangle for full-screen quad
        });

        this.updateWeatherBindGroup();
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
        // Canvas size is driven by React props; just reconfigure the context
        // so the swap chain matches the new canvas size.
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
            if (this.weatherParamsBuffer) this.weatherParamsBuffer.destroy();
            this.device?.destroy();
        } catch (e) {
            // ignore cleanup errors
        }
        this.texture = undefined as any;
        this.videoTexture = undefined as any;
        this.intermediateTexture = undefined as any;
        this.uniformBuffer = undefined as any;
        this.effectsBuffer = undefined as any;
        this.weatherParamsBuffer = undefined as any;
        this.pipeline = undefined as any;
        this.weatherPipeline = undefined as any;
        this.bindGroup = undefined as any;
        this.weatherBindGroup = undefined as any;
    }

    public setCarMode(active: boolean): void {
        this.carModeActive = active;
    }

    public updateEffects(effectsData: Float32Array): void {
        if (this.effectsBuffer && this.device) {
            this.device.queue.writeBuffer(this.effectsBuffer, 0, effectsData);
        }
    }

    /**
     * Update weather parameters for the HDR post-process pass
     * @param params - Float32Array of weather params:
     *   [0-5]: vibrance, saturation, contrast, exposure, temperature, tint
     *   [6-10]: time, rainIntensity, snowIntensity, wind, speed
     */
    public updateWeatherParams(params: Float32Array): void {
        if (this.weatherParamsBuffer && this.device) {
            this.weatherParams.set(params);
            this.device.queue.writeBuffer(this.weatherParamsBuffer, 0, this.weatherParams);
        }
    }

    /**
     * Update color grading parameters (backward compatible)
     * @param params - Float32Array of 6 floats: [vibrance, saturation, contrast, exposure, temperature, tint]
     */
    public updateColorParams(params: Float32Array): void {
        if (this.weatherParamsBuffer && this.device) {
            // Update only the first 6 values (color grading)
            this.weatherParams.set(params.slice(0, 6), 0);
            this.device.queue.writeBuffer(this.weatherParamsBuffer, 0, this.weatherParams);
        }
    }

    public getCanvasDataURL(): string {
        return this.canvas.toDataURL('image/png', 1.0);
    }

    public renderStreetView(
        mode: RenderMode, 
        source: CanvasImageSource | null, 
        heading?: number, 
        pitch?: number, 
        zoom?: number
    ): void {
        if (this.isDestroyed || !this.device || !this.pipeline || !this.weatherPipeline) return;

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
            // Update time in weather params for animation
            const time = Date.now() / 1000;
            this.weatherParams[6] = time % 10000.0; // looped time
            this.device.queue.writeBuffer(this.weatherParamsBuffer, 0, this.weatherParams);

            // Update panorama uniforms
            const z = zoom || 1;
            const panX = ((heading || 0) % 360) / 360;
            const panY = ((pitch || 0) + 90) / 180;
            const uniforms = new Float32Array([time, z, panX, panY]);
            this.device.queue.writeBuffer(this.uniformBuffer, 0, uniforms);

            // Ensure intermediate texture is correct size
            const canvasWidth = this.canvas.width;
            const canvasHeight = this.canvas.height;
            this.ensureIntermediateTexture(canvasWidth, canvasHeight);

            const commandEncoder = this.device.createCommandEncoder();

            // === PASS 1: Panorama → Intermediate HDR texture ===
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

            // === PASS 2: Intermediate + Weather → Canvas ===
            const finalTextureView = this.context.getCurrentTexture().createView();
            
            const postPass = commandEncoder.beginRenderPass({
                colorAttachments: [{
                    view: finalTextureView,
                    clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
                    loadOp: 'clear' as GPULoadOp,
                    storeOp: 'store' as GPUStoreOp,
                }],
            });

            postPass.setPipeline(this.weatherPipeline);
            postPass.setBindGroup(0, this.weatherBindGroup);
            postPass.draw(3, 1, 0, 0); // Full-screen triangle
            postPass.end();

            this.device.queue.submit([commandEncoder.finish()]);
        } catch (e) {
            // Suppress sporadic frame errors
        }
    }
}
