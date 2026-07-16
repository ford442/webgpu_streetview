// Must match NOISE_TILE_SIZE in src/wasm/wasmNoiseFeeder.ts and the
// `array<f32, 4096>` storage buffer declared in weather-post.wgsl.
const NOISE_TILE_SIZE = 64;
const NOISE_BUFFER_BYTES = NOISE_TILE_SIZE * NOISE_TILE_SIZE * 4;

export class WeatherPostProcessor {
    private device: GPUDevice;
    private context: GPUCanvasContext;
    private canvas: HTMLCanvasElement;

    private weatherPipeline!: GPURenderPipeline;
    private weatherBindGroup!: GPUBindGroup;
    private weatherParamsBuffer!: GPUBuffer;
    private weatherSampler!: GPUSampler;
    private noiseBuffer!: GPUBuffer;
    private weatherParams: Float32Array = new Float32Array(40);
    private startTime: number = Date.now();
    private shaderEffectsEnabled: boolean = true;

    constructor(device: GPUDevice, context: GPUCanvasContext, canvas: HTMLCanvasElement) {
        this.device = device;
        this.context = context;
        this.canvas = canvas;

        this.weatherSampler = this.device.createSampler({
            magFilter: 'linear',
            minFilter: 'linear',
            addressModeU: 'clamp-to-edge',
            addressModeV: 'clamp-to-edge',
        });

        this.weatherParamsBuffer = this.device.createBuffer({
            size: 160,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        // Zero-initialized until the first WASM-computed tile lands — the
        // shader only samples it when wasmNoiseEnabled (params[35]) is set.
        this.noiseBuffer = this.device.createBuffer({
            size: NOISE_BUFFER_BYTES,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });

        this.weatherParams.set([
            0.0, 0.0, 0.0, 0.0, 0.0, 0.0,
            0.0, 0.0, 0.0, 0.0, 1.0,
            0.0, 0.0, 0.0, 0.5, 0.5,
            0.0, 0.0,
            0.0, 0.0, 0.0, 0.0,
            0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0,
            1.0,
            0.0, 0.0,
            0.0, 0.0, 0.0, 0.0, 0.0
        ]);
    }

    public async init(presentationFormat: GPUTextureFormat): Promise<void> {
        const shaderUrl = `${process.env.PUBLIC_URL || '/'}/shaders/weather-post.wgsl`;
        let shaderCode: string;
        try {
            const response = await fetch(shaderUrl);
            if (!response.ok) {
                throw new Error(`Failed to load weather-post.wgsl: ${response.status} ${response.statusText}`);
            }
            shaderCode = await response.text();
        } catch (error) {
            console.error(`[Renderer] Failed to load weather-post shader from ${shaderUrl}:`, error);
            throw error;
        }

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
                {
                    binding: 3,
                    visibility: GPUShaderStage.FRAGMENT,
                    buffer: { type: 'read-only-storage' as GPUBufferBindingType },
                },
            ],
        });

        const pipelineLayout = this.device.createPipelineLayout({
            bindGroupLayouts: [bindGroupLayout],
        });

        this.weatherPipeline = this.device.createRenderPipeline({
            layout: pipelineLayout,
            vertex: {
                module: shaderModule,
                entryPoint: 'vs_main',
            },
            fragment: {
                module: shaderModule,
                entryPoint: 'fs_main',
                targets: [{ format: presentationFormat as GPUTextureFormat }],
            },
            primitive: { topology: 'triangle-list' },
        });
    }

    public updateWeatherBindGroup(intermediateTextureView: GPUTextureView): void {
        if (!this.weatherPipeline || !intermediateTextureView || !this.weatherSampler) return;

        this.weatherBindGroup = this.device.createBindGroup({
            layout: this.weatherPipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: this.weatherParamsBuffer } },
                { binding: 1, resource: intermediateTextureView },
                { binding: 2, resource: this.weatherSampler },
                { binding: 3, resource: { buffer: this.noiseBuffer } },
            ],
        });
    }

    /**
     * Upload a WASM-computed noise tile (see src/wasm/wasmNoiseFeeder.ts).
     * `tile` must be NOISE_TILE_SIZE * NOISE_TILE_SIZE elements, row-major.
     */
    public updateNoiseBuffer(tile: Float32Array): void {
        if (!this.noiseBuffer || !this.device) return;
        this.device.queue.writeBuffer(this.noiseBuffer, 0, tile);
    }

    public setShaderEffects(enabled: boolean): void {
        this.shaderEffectsEnabled = enabled;
        if (this.weatherParamsBuffer && this.device) {
            this.weatherParams[32] = enabled ? 1.0 : 0.0;
            this.device.queue.writeBuffer(this.weatherParamsBuffer, 0, this.weatherParams);
        }
    }

    public getCameraParams(): { heading: number; pitch: number } {
        return {
            heading: this.weatherParams[33],
            pitch: this.weatherParams[34]
        };
    }

    public getShaderEffectsEnabled(): boolean {
        return this.shaderEffectsEnabled;
    }

    public updateWeatherParams(params: Float32Array): void {
        if (this.weatherParamsBuffer && this.device) {
            this.weatherParams.set(params);
            this.device.queue.writeBuffer(this.weatherParamsBuffer, 0, this.weatherParams);
        }
    }

    public updateCameraParams(heading: number, pitch: number): void {
        if (this.weatherParamsBuffer && this.device) {
            this.weatherParams[33] = heading;
            this.weatherParams[34] = pitch;
            this.device.queue.writeBuffer(this.weatherParamsBuffer, 0, this.weatherParams);
        }
    }

    public updateColorParams(params: Float32Array): void {
        if (this.weatherParamsBuffer && this.device) {
            this.weatherParams.set(params.slice(0, 6), 0);
            this.device.queue.writeBuffer(this.weatherParamsBuffer, 0, this.weatherParams);
        }
    }

    public updateWeatherAnimation(): void {
        if (!this.device || !this.weatherParamsBuffer) return;
        try {
            const time = (Date.now() - this.startTime) / 1000;
            this.weatherParams[6] = time % 10000.0;
            this.device.queue.writeBuffer(this.weatherParamsBuffer, 0, this.weatherParams);
        } catch (e) {
            // Ignore errors during weather-only updates
        }
    }

    public renderWeatherOnly(intermediateTextureView: GPUTextureView): void {
        if (!this.device || !this.weatherPipeline) return;

        try {
            this.updateWeatherAnimation();

            const commandEncoder = this.device.createCommandEncoder();

            const clearPass = commandEncoder.beginRenderPass({
                colorAttachments: [{
                    view: intermediateTextureView,
                    clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
                    loadOp: 'clear' as GPULoadOp,
                    storeOp: 'store' as GPUStoreOp,
                }],
            });
            clearPass.end();

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
            postPass.draw(3, 1, 0, 0);
            postPass.end();

            this.device.queue.submit([commandEncoder.finish()]);
        } catch (e) {
            // Suppress errors during weather-only rendering
        }
    }

    public renderPass(commandEncoder: GPUCommandEncoder): void {
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
        postPass.draw(3, 1, 0, 0);
        postPass.end();
    }

    public dispose(): void {
        try {
            if (this.weatherParamsBuffer) this.weatherParamsBuffer.destroy();
            if (this.noiseBuffer) this.noiseBuffer.destroy();
        } catch (e) {
            // ignore cleanup errors
        }
        this.weatherParamsBuffer = undefined as any;
        this.noiseBuffer = undefined as any;
        this.weatherPipeline = undefined as any;
        this.weatherBindGroup = undefined as any;
    }
}
