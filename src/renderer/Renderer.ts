import { RenderMode } from './types';

export class Renderer {
    public canvas: HTMLCanvasElement;
    private device!: GPUDevice;
    private context!: GPUCanvasContext;
    private presentationFormat!: GPUTextureFormat;
    private pipeline!: GPURenderPipeline;
    private bindGroup!: GPUBindGroup;
    private sampler!: GPUSampler;
    private texture!: GPUTexture; // static image texture
    private videoTexture?: GPUTexture; // dynamic texture for video/canvas frames
    private videoTextureWidth: number = 0;
    private videoTextureHeight: number = 0;
    private uniformBuffer!: GPUBuffer;

    constructor(canvas: HTMLCanvasElement) {
        this.canvas = canvas;
    }

    public async init(): Promise<boolean> {
        try {
            if (!navigator.gpu) {
                console.error('WebGPU not supported');
                return false;
            }

            const adapter = await navigator.gpu.requestAdapter();
            if (!adapter) {
                console.error('No WebGPU adapter found');
                return false;
            }

  //  add WebGPU extensions
        const requiredFeatures: GPUFeatureName[] = [];
        if (adapter.features.has('float32-filterable')) {
            requiredFeatures.push('float32-filterable');
        } else {
            console.log("Device does not support 'float32-filterable'");
        }
        if (adapter.features.has('float32-blendable')) {
            requiredFeatures.push('float32-blendable');
        } else {
            console.log("Device does not support 'float32-blendable'.");
        }
        if (adapter.features.has('clip-distances')) {
            requiredFeatures.push('clip-distances');
        } else {
            console.log("Device does not support 'clip-distances'.");
        }
        if (adapter.features.has('depth32float-stencil8')) {
            requiredFeatures.push('depth32float-stencil8');
        } else {
            console.log("Device does not support 'depth32float-stencil8'.");
        }
        if (adapter.features.has('dual-source-blending')) {
            requiredFeatures.push('dual-source-blending');
        } else {
            console.log("Device does not support 'dual-source-blending'.");
        }
                if (adapter.features.has('subgroups')) {
            requiredFeatures.push('subgroups');
        } else {
            console.log("Device does not support 'subgroups'.");
        }
        if (adapter.features.has('texture-component-swizzle')) {
            requiredFeatures.push('texture-component-swizzle');
        } else {
            console.log("Device does not support 'texture-component-swizzle'.");
        }
        if (adapter.features.has('shader-f16')) {
            requiredFeatures.push('shader-f16');
        } else {
            console.log("Device does not support 'shader-f16'.");
        }
        
        const device = await adapter.requestDevice({
            requiredFeatures,
        });
            const context = this.canvas.getContext('webgpu');
            if (!context) {
                console.error('Could not get WebGPU context');
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

            await this.createPipeline();

            console.log('WebGPU Renderer initialized');
            return true;
        } catch (e) {
            console.error('Failed to initialize WebGPU:', e);
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

    // NOTE: Accept a nullable source so we can render even if no new frame is provided
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
                // Resize/Create dynamic video texture if dimensions changed
                // Note: GPUTexture does not expose width/height directly in the spec, but existing code
                // used checks against texture.width/height; to be defensive, recreate unconditionally if absent
                if (!this.videoTexture || this.videoTextureWidth !== srcWidth || this.videoTextureHeight !== srcHeight) {
                    this.createVideoTexture(srcWidth, srcHeight);
                    // Rebind so shader uses the videoTexture immediately
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

            renderPass.setPipeline(this.pipeline);
            renderPass.setBindGroup(0, this.bindGroup);
            renderPass.draw(4, 1, 0, 0);
            renderPass.end();

            this.device.queue.submit([commandEncoder.finish()]);
        } catch (e) {
            // Suppress sporadic frame errors to avoid console spam
        }
    }
}

