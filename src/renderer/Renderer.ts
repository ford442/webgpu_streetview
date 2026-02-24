import { RenderMode } from './types';

export class Renderer {
    public canvas: HTMLCanvasElement;
    private device!: GPUDevice;
    private context!: GPUCanvasContext;
    private presentationFormat!: GPUTextureFormat;
    private pipeline!: GPURenderPipeline;
    private carPipeline?: GPURenderPipeline; // Car view pipeline with post-processing
    private bindGroup!: GPUBindGroup;
    private carBindGroup?: GPUBindGroup;
    private sampler!: GPUSampler;
    private texture!: GPUTexture; // static image texture
    private videoTexture?: GPUTexture; // dynamic texture for video/canvas frames
    private videoTextureWidth: number = 0;
    private videoTextureHeight: number = 0;
    private uniformBuffer!: GPUBuffer;
    private effectsBuffer?: GPUBuffer; // Post-processing effects uniform buffer
    private carModeActive: boolean = false;

    constructor(canvas: HTMLCanvasElement) {
        this.canvas = canvas;
    }

    public async init(): Promise<boolean> {
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

  //  add WebGPU extensions
        const requiredFeatures: GPUFeatureName[] = [];
        if (adapter.features.has('float32-filterable')) {
            requiredFeatures.push('float32-filterable');
        } else {
            // console.log("Device does not support 'float32-filterable'");
        }
        if (adapter.features.has('float32-blendable')) {
            requiredFeatures.push('float32-blendable');
        } else {
            // console.log("Device does not support 'float32-blendable'.");
        }
        if (adapter.features.has('clip-distances')) {
            requiredFeatures.push('clip-distances');
        } else {
            // console.log("Device does not support 'clip-distances'.");
        }
        if (adapter.features.has('depth32float-stencil8')) {
            requiredFeatures.push('depth32float-stencil8');
        } else {
            // console.log("Device does not support 'depth32float-stencil8'.");
        }
        if (adapter.features.has('dual-source-blending')) {
            requiredFeatures.push('dual-source-blending');
        } else {
            // console.log("Device does not support 'dual-source-blending'.");
        }
                if (adapter.features.has('subgroups')) {
            requiredFeatures.push('subgroups');
        } else {
            // console.log("Device does not support 'subgroups'.");
        }
        if (adapter.features.has('texture-component-swizzle')) {
            requiredFeatures.push('texture-component-swizzle');
        } else {
            // console.log("Device does not support 'texture-component-swizzle'.");
        }
        if (adapter.features.has('shader-f16')) {
            requiredFeatures.push('shader-f16');
        } else {
            // console.log("Device does not support 'shader-f16'.");
        }

       this.device = await adapter.requestDevice({
            requiredFeatures,
        });
            const context = this.canvas.getContext('webgpu');
            if (!context) {
                console.warn('Could not get WebGPU context. Fallback active.');
                return false;
            }

            this.context = context;
            this.presentationFormat = navigator.gpu.getPreferredCanvasFormat();
            this.context.configure({
                device: this.device,
                format: this.presentationFormat,
                alphaMode: 'opaque',
            });

            this.sampler = this.device.createSampler({
                magFilter: 'linear',
                minFilter: 'linear',
            });

            // Initialize with a 1x1 placeholder to prevent null errors before first frame
            this.createTexture(1, 1);

            this.uniformBuffer = this.device.createBuffer({
                size: 16, // 4 floats * 4 bytes
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            });

            // Effects uniform buffer for car view post-processing
            // Layout: array<vec4<f32>, 2> = 2 × vec4 (each 16-byte aligned) = 32 bytes total
            // effects[0] = [rainIntensity, vignetteStrength, brightness, contrast]
            // effects[1] = [tintR, tintG, tintB, nightMode]
            this.effectsBuffer = this.device.createBuffer({
                size: 32, // 2 vec4s × 16 bytes each
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            });

            await this.createPipeline();
            await this.createCarPipeline();

            // console.log('WebGPU Renderer initialized');
            return true;
        } catch (e) {
            console.warn('WebGPU init failed (expected in some envs). Fallback active:', e instanceof Error ? e.message : String(e));
            return false;
        }
    }

    // Helper to create/recreate the static image texture
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

    // Helper to create/recreate the dynamic video/canvas texture
    private createVideoTexture(width: number, height: number) {
        // Performance: Only recreate if dimensions actually changed
        if (this.videoTexture && this.videoTextureWidth === width && this.videoTextureHeight === height) {
            return; // Skip recreation - texture already correct size
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

    // Helper to update bind group when texture changes
    private updateBindGroup() {
        if (!this.pipeline || !this.texture || !this.sampler || !this.uniformBuffer) return;

        // Prefer the videoTexture if present, otherwise fall back to the static image texture
        const textureView = (this.videoTexture ? this.videoTexture.createView() : this.texture.createView());

        this.bindGroup = this.device.createBindGroup({
            layout: this.pipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: this.sampler },
                { binding: 1, resource: textureView },
                { binding: 2, resource: { buffer: this.uniformBuffer } },
            ],
        });

        // Also update car bind group if car pipeline exists
        this.updateCarBindGroup();
    }

    private async createPipeline(): Promise<void> {
        const shaderCode = await fetch('./shaders/streetview.wgsl').then(r => r.text());

        const shaderModule = this.device.createShaderModule({
            code: shaderCode,
        });

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

        this.pipeline = this.device.createRenderPipeline({
            layout: pipelineLayout,
            vertex: {
                module: shaderModule,
                entryPoint: 'vs_main',
            },
            fragment: {
                module: shaderModule,
                entryPoint: 'fs_main',
                targets: [{ format: this.presentationFormat }],
            },
            primitive: { topology: 'triangle-strip' },
        });

        this.updateBindGroup();
    }

    private async createCarPipeline(): Promise<void> {
        try {
            const shaderCode = await fetch('./shaders/carview.wgsl').then(r => r.text());

            const shaderModule = this.device.createShaderModule({
                code: shaderCode,
            });

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
                        buffer: { type: 'uniform' as GPUBufferBindingType },
                    },
                ],
            });

            const pipelineLayout = this.device.createPipelineLayout({
                bindGroupLayouts: [bindGroupLayout],
            });

            this.carPipeline = this.device.createRenderPipeline({
                layout: pipelineLayout,
                vertex: {
                    module: shaderModule,
                    entryPoint: 'vs_main',
                },
                fragment: {
                    module: shaderModule,
                    entryPoint: 'fs_main',
                    targets: [{ format: this.presentationFormat }],
                },
                primitive: { topology: 'triangle-strip' },
            });

            this.updateCarBindGroup();
        } catch (e) {
            // Car view shader is optional; fall back to standard pipeline
            console.warn('Car view shader not available:', e instanceof Error ? e.message : String(e));
        }
    }

    private updateCarBindGroup(): void {
        if (!this.carPipeline || !this.texture || !this.sampler || !this.uniformBuffer || !this.effectsBuffer) return;

        const textureView = (this.videoTexture ? this.videoTexture.createView() : this.texture.createView());

        this.carBindGroup = this.device.createBindGroup({
            layout: this.carPipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: this.sampler },
                { binding: 1, resource: textureView },
                { binding: 2, resource: { buffer: this.uniformBuffer } },
                { binding: 3, resource: { buffer: this.effectsBuffer } },
            ],
        });
    }

    /**
     * Enable or disable car mode rendering with post-processing effects.
     */
    public setCarMode(active: boolean): void {
        this.carModeActive = active;
    }

    /**
     * Update post-processing effects data.
     * @param effectsData - Float32Array of 8 floats: [rainIntensity, vignetteStrength, brightness, contrast, tintR, tintG, tintB, nightMode]
     */
    public updateEffects(effectsData: Float32Array): void {
        if (this.effectsBuffer && this.device) {
            this.device.queue.writeBuffer(this.effectsBuffer, 0, effectsData);
        }
    }

    // NOTE: Accept a nullable source so we can render even if no new frame is provided
    // [NEW] Export canvas data as PNG data URL for snapshot functionality
    public getCanvasDataURL(): string {
        return this.canvas.toDataURL('image/png', 1.0);
    }

    public renderStreetView(mode: RenderMode, source: CanvasImageSource | null, heading?: number, pitch?: number, zoom?: number): void {
        if (!this.device || !this.pipeline) return;

        // 1. If a source is provided, determine Source Dimensions safely and upload to videoTexture
        let srcWidth = 0;
        let srcHeight = 0;

        if (source) {
            if (source instanceof HTMLCanvasElement) {
                srcWidth = source.width;
                srcHeight = source.height;
            } else if (source instanceof HTMLVideoElement) {
                // Only use video dimensions when ready
                if (source.readyState >= 2) {
                    srcWidth = source.videoWidth;
                    srcHeight = source.videoHeight;
                }
            } else if (source instanceof ImageBitmap) {
                srcWidth = source.width;
                srcHeight = source.height;
            }

            // If we have a valid source size, ensure videoTexture exists and upload
            if (srcWidth > 0 && srcHeight > 0) {
                // Performance: createVideoTexture now checks dimensions internally
                const needsBindGroupUpdate = !this.videoTexture || this.videoTextureWidth !== srcWidth || this.videoTextureHeight !== srcHeight;
                
                this.createVideoTexture(srcWidth, srcHeight);
                
                // Only update bind group when texture was actually recreated
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

        // 2. If no dynamic source provided but the static texture size differs from canvas, adjust it
        // (Keep original createTexture logic intact if a static image is used elsewhere.)

        try {
            // Update uniforms
            const time = Date.now() / 1000;
            const z = zoom || 1;
            const panX = ((heading || 0) % 360) / 360;
            const panY = ((pitch || 0) + 90) / 180;
            const uniforms = new Float32Array([time, z, panX, panY]);
            this.device.queue.writeBuffer(this.uniformBuffer, 0, uniforms);

            // 3. Render using whichever texture the bind group currently references (videoTexture preferred)
            // Use car pipeline with post-processing when car mode is active
            const useCarPipeline = this.carModeActive && this.carPipeline && this.carBindGroup;
            const activePipeline = useCarPipeline ? this.carPipeline! : this.pipeline;
            const activeBindGroup = useCarPipeline ? this.carBindGroup! : this.bindGroup;

            const commandEncoder = this.device.createCommandEncoder();
            const textureView = this.context.getCurrentTexture().createView();

            const renderPass = commandEncoder.beginRenderPass({
                colorAttachments: [{
                    view: textureView,
                    clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
                    loadOp: 'clear' as GPULoadOp,
                    storeOp: 'store' as GPUStoreOp,
                }],
            });

            renderPass.setPipeline(activePipeline);
            renderPass.setBindGroup(0, activeBindGroup);
            renderPass.draw(4, 1, 0, 0);
            renderPass.end();

            this.device.queue.submit([commandEncoder.finish()]);
        } catch (e) {
            // Suppress sporadic frame errors to avoid console spam
        }
    }
}
