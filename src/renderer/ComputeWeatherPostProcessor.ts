import { WEATHER_PARAMS_FLOAT_COUNT, WeatherParamIndex } from './weatherUniformLayout';

// Must match NOISE_TILE_SIZE in src/wasm/wasmNoiseFeeder.ts and the
// storage buffer declared in weather-post.wgsl. The compute variant does
// not yet bind this tile to the shader (see weather-post-compute.wgsl
// header) — the buffer is kept here only so the public API matches
// WeatherPostProcessor and callers don't need to branch.
const NOISE_TILE_SIZE = 64;
const NOISE_BUFFER_BYTES = NOISE_TILE_SIZE * NOISE_TILE_SIZE * 4;

// image_video_effects-compatible Uniforms struct size:
// config(vec4) + zoom_config(vec4) + zoom_params(vec4) + ripples(array<vec4,50>)
const COMPUTE_UNIFORMS_BYTE_SIZE = (4 + 4 + 4 + 50 * 4) * 4;

const WORKGROUP_SIZE = 16;

const BLIT_SHADER = `
@group(0) @binding(0) var srcTex: texture_2d<f32>;

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> @builtin(position) vec4<f32> {
    var pos = vec2<f32>(0.0, 0.0);
    switch(vertexIndex) {
        case 0u: { pos = vec2<f32>(-1.0, -1.0); }
        case 1u: { pos = vec2<f32>( 3.0, -1.0); }
        case 2u: { pos = vec2<f32>(-1.0,  3.0); }
        default: {}
    }
    return vec4<f32>(pos, 0.0, 1.0);
}

@fragment
fn fs_main(@builtin(position) fragCoord: vec4<f32>) -> @location(0) vec4<f32> {
    let coord = vec2<i32>(fragCoord.xy);
    return textureLoad(srcTex, coord, 0);
}
`;

/**
 * Compute-shader variant of the weather post-processing pass. Renders the
 * same rain/snow/fog/color-grading effects as WeatherPostProcessor but via
 * a compute pipeline writing into a storage texture, then blits that
 * texture to the canvas. Exposes the same public API as
 * WeatherPostProcessor so Renderer.ts can use either interchangeably.
 *
 * Foundation for WASM noise buffers (#128), volumetric fog, and GPU
 * particles, all of which want storage-buffer access that a fragment pass
 * can't offer efficiently. See docs/RENDERER_FALLBACK.md.
 */
export class ComputeWeatherPostProcessor {
    private device: GPUDevice;
    private context: GPUCanvasContext;

    private computePipeline!: GPUComputePipeline;
    private computeBindGroup!: GPUBindGroup;
    private blitPipeline!: GPURenderPipeline;
    private blitBindGroup!: GPUBindGroup;

    private extraBuffer!: GPUBuffer;
    private computeUniformsBuffer!: GPUBuffer;
    private noiseBuffer!: GPUBuffer;
    private writeTexture!: GPUTexture;
    private writeWidth: number = 0;
    private writeHeight: number = 0;

    // Dummy 1x1 resources for image_video_effects bindings this shader
    // doesn't use yet (depth, data textures, plasma buffer).
    private filteringSampler!: GPUSampler;
    private nonFilteringSampler!: GPUSampler;
    private comparisonSampler!: GPUSampler;
    private dummyReadDepthTexture!: GPUTexture;
    private dummyWriteDepthTexture!: GPUTexture;
    private dummyDataTextureA!: GPUTexture;
    private dummyDataTextureB!: GPUTexture;
    private dummyDataTextureC!: GPUTexture;
    private dummyPlasmaBuffer!: GPUBuffer;

    private weatherParams: Float32Array = new Float32Array(WEATHER_PARAMS_FLOAT_COUNT);
    private startTime: number = Date.now();
    private shaderEffectsEnabled: boolean = true;

    constructor(device: GPUDevice, context: GPUCanvasContext, _canvas: HTMLCanvasElement) {
        this.device = device;
        this.context = context;

        this.filteringSampler = this.device.createSampler({
            magFilter: 'linear',
            minFilter: 'linear',
            addressModeU: 'clamp-to-edge',
            addressModeV: 'clamp-to-edge',
        });
        this.nonFilteringSampler = this.device.createSampler({
            magFilter: 'nearest',
            minFilter: 'nearest',
        });
        this.comparisonSampler = this.device.createSampler({
            compare: 'less',
        });

        this.extraBuffer = this.device.createBuffer({
            size: WEATHER_PARAMS_FLOAT_COUNT * 4,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        this.computeUniformsBuffer = this.device.createBuffer({
            size: COMPUTE_UNIFORMS_BYTE_SIZE,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        this.noiseBuffer = this.device.createBuffer({
            size: NOISE_BUFFER_BYTES,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        this.dummyPlasmaBuffer = this.device.createBuffer({
            size: 16,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });

        this.dummyReadDepthTexture = this.device.createTexture({
            size: [1, 1],
            format: 'rgba8unorm',
            usage: GPUTextureUsage.TEXTURE_BINDING,
        });
        this.dummyDataTextureC = this.device.createTexture({
            size: [1, 1],
            format: 'rgba8unorm',
            usage: GPUTextureUsage.TEXTURE_BINDING,
        });
        this.dummyWriteDepthTexture = this.device.createTexture({
            size: [1, 1],
            format: 'r32float',
            usage: GPUTextureUsage.STORAGE_BINDING,
        });
        this.dummyDataTextureA = this.device.createTexture({
            size: [1, 1],
            format: 'rgba32float',
            usage: GPUTextureUsage.STORAGE_BINDING,
        });
        this.dummyDataTextureB = this.device.createTexture({
            size: [1, 1],
            format: 'rgba32float',
            usage: GPUTextureUsage.STORAGE_BINDING,
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
        this.device.queue.writeBuffer(this.extraBuffer, 0, this.weatherParams);
    }

    public async init(presentationFormat: GPUTextureFormat): Promise<void> {
        const shaderUrl = `${process.env.PUBLIC_URL || '/'}/shaders/weather-post-compute.wgsl`;
        let shaderCode: string;
        try {
            const response = await fetch(shaderUrl);
            if (!response.ok) {
                throw new Error(`Failed to load weather-post-compute.wgsl: ${response.status} ${response.statusText}`);
            }
            shaderCode = await response.text();
        } catch (error) {
            console.error(`[Renderer] Failed to load weather-post-compute shader from ${shaderUrl}:`, error);
            throw error;
        }

        const computeModule = this.device.createShaderModule({ code: shaderCode });

        const computeBindGroupLayout = this.device.createBindGroupLayout({
            entries: [
                { binding: 0, visibility: GPUShaderStage.COMPUTE, sampler: { type: 'filtering' } },
                { binding: 1, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float' } },
                { binding: 2, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'rgba32float' } },
                { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
                { binding: 4, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float' } },
                { binding: 5, visibility: GPUShaderStage.COMPUTE, sampler: { type: 'non-filtering' } },
                { binding: 6, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'r32float' } },
                { binding: 7, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'rgba32float' } },
                { binding: 8, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'rgba32float' } },
                { binding: 9, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float' } },
                { binding: 10, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
                { binding: 11, visibility: GPUShaderStage.COMPUTE, sampler: { type: 'comparison' } },
                { binding: 12, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
            ],
        });

        this.computePipeline = this.device.createComputePipeline({
            layout: this.device.createPipelineLayout({ bindGroupLayouts: [computeBindGroupLayout] }),
            compute: { module: computeModule, entryPoint: 'main' },
        });

        const blitModule = this.device.createShaderModule({ code: BLIT_SHADER });
        const blitBindGroupLayout = this.device.createBindGroupLayout({
            entries: [
                { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } },
            ],
        });
        this.blitPipeline = this.device.createRenderPipeline({
            layout: this.device.createPipelineLayout({ bindGroupLayouts: [blitBindGroupLayout] }),
            vertex: { module: blitModule, entryPoint: 'vs_main' },
            fragment: { module: blitModule, entryPoint: 'fs_main', targets: [{ format: presentationFormat }] },
            primitive: { topology: 'triangle-list' },
        });
    }

    private ensureWriteTexture(width: number, height: number): void {
        if (this.writeTexture && this.writeWidth === width && this.writeHeight === height) return;
        if (this.writeTexture) this.writeTexture.destroy();

        this.writeWidth = width;
        this.writeHeight = height;
        this.writeTexture = this.device.createTexture({
            size: [Math.max(1, width), Math.max(1, height)],
            format: 'rgba32float',
            usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
        });
    }

    public updateWeatherBindGroup(intermediateTextureView: GPUTextureView, width?: number, height?: number): void {
        if (!this.computePipeline || !intermediateTextureView) return;

        this.ensureWriteTexture(width || 1, height || 1);

        this.computeBindGroup = this.device.createBindGroup({
            layout: this.computePipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: this.filteringSampler },
                { binding: 1, resource: intermediateTextureView },
                { binding: 2, resource: this.writeTexture.createView() },
                { binding: 3, resource: { buffer: this.computeUniformsBuffer } },
                { binding: 4, resource: this.dummyReadDepthTexture.createView() },
                { binding: 5, resource: this.nonFilteringSampler },
                { binding: 6, resource: this.dummyWriteDepthTexture.createView() },
                { binding: 7, resource: this.dummyDataTextureA.createView() },
                { binding: 8, resource: this.dummyDataTextureB.createView() },
                { binding: 9, resource: this.dummyDataTextureC.createView() },
                { binding: 10, resource: { buffer: this.extraBuffer } },
                { binding: 11, resource: this.comparisonSampler },
                { binding: 12, resource: { buffer: this.dummyPlasmaBuffer } },
            ],
        });

        this.blitBindGroup = this.device.createBindGroup({
            layout: this.blitPipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: this.writeTexture.createView() },
            ],
        });
    }

    public updateNoiseBuffer(tile: Float32Array): void {
        if (!this.noiseBuffer || !this.device) return;
        this.device.queue.writeBuffer(this.noiseBuffer, 0, tile);
    }

    public setShaderEffects(enabled: boolean): void {
        this.shaderEffectsEnabled = enabled;
        if (this.extraBuffer && this.device) {
            this.weatherParams[WeatherParamIndex.shaderEffectsEnabled] = enabled ? 1.0 : 0.0;
            this.device.queue.writeBuffer(this.extraBuffer, 0, this.weatherParams);
        }
    }

    public getCameraParams(): { heading: number; pitch: number } {
        return {
            heading: this.weatherParams[WeatherParamIndex.cameraHeading]!,
            pitch: this.weatherParams[WeatherParamIndex.cameraPitch]!
        };
    }

    public getShaderEffectsEnabled(): boolean {
        return this.shaderEffectsEnabled;
    }

    public updateWeatherParams(params: Float32Array): void {
        if (this.extraBuffer && this.device) {
            this.weatherParams.set(params);
            this.device.queue.writeBuffer(this.extraBuffer, 0, this.weatherParams);
        }
    }

    public updateCameraParams(heading: number, pitch: number): void {
        if (this.extraBuffer && this.device) {
            this.weatherParams[WeatherParamIndex.cameraHeading] = heading;
            this.weatherParams[WeatherParamIndex.cameraPitch] = pitch;
            this.device.queue.writeBuffer(this.extraBuffer, 0, this.weatherParams);
        }
    }

    public updateColorParams(params: Float32Array): void {
        if (this.extraBuffer && this.device) {
            this.weatherParams.set(params.slice(0, 6), 0);
            this.device.queue.writeBuffer(this.extraBuffer, 0, this.weatherParams);
        }
    }

    public updateWeatherAnimation(): void {
        if (!this.device || !this.extraBuffer) return;
        try {
            const time = (Date.now() - this.startTime) / 1000;
            this.weatherParams[WeatherParamIndex.time] = time % 10000.0;
            this.device.queue.writeBuffer(this.extraBuffer, 0, this.weatherParams);
        } catch (e) {
            // Ignore errors during weather-only updates
        }
    }

    private dispatch(commandEncoder: GPUCommandEncoder): void {
        if (!this.computeBindGroup || this.writeWidth <= 0 || this.writeHeight <= 0) return;

        this.device.queue.writeBuffer(
            this.computeUniformsBuffer,
            0,
            new Float32Array([this.weatherParams[WeatherParamIndex.time]!, 0, this.writeWidth, this.writeHeight])
        );

        const computePass = commandEncoder.beginComputePass();
        computePass.setPipeline(this.computePipeline);
        computePass.setBindGroup(0, this.computeBindGroup);
        computePass.dispatchWorkgroups(
            Math.ceil(this.writeWidth / WORKGROUP_SIZE),
            Math.ceil(this.writeHeight / WORKGROUP_SIZE)
        );
        computePass.end();
    }

    private blit(commandEncoder: GPUCommandEncoder): void {
        if (!this.blitBindGroup) return;
        const finalTextureView = this.context.getCurrentTexture().createView();
        const blitPass = commandEncoder.beginRenderPass({
            colorAttachments: [{
                view: finalTextureView,
                clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
                loadOp: 'clear' as GPULoadOp,
                storeOp: 'store' as GPUStoreOp,
            }],
        });
        blitPass.setPipeline(this.blitPipeline);
        blitPass.setBindGroup(0, this.blitBindGroup);
        blitPass.draw(3, 1, 0, 0);
        blitPass.end();
    }

    public renderWeatherOnly(intermediateTextureView: GPUTextureView): void {
        if (!this.device || !this.computePipeline) return;

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

            this.dispatch(commandEncoder);
            this.blit(commandEncoder);

            this.device.queue.submit([commandEncoder.finish()]);
        } catch (e) {
            // Suppress errors during weather-only rendering
        }
    }

    public renderPass(commandEncoder: GPUCommandEncoder): void {
        this.dispatch(commandEncoder);
        this.blit(commandEncoder);
    }

    public dispose(): void {
        try {
            if (this.extraBuffer) this.extraBuffer.destroy();
            if (this.computeUniformsBuffer) this.computeUniformsBuffer.destroy();
            if (this.noiseBuffer) this.noiseBuffer.destroy();
            if (this.dummyPlasmaBuffer) this.dummyPlasmaBuffer.destroy();
            if (this.writeTexture) this.writeTexture.destroy();
            if (this.dummyReadDepthTexture) this.dummyReadDepthTexture.destroy();
            if (this.dummyWriteDepthTexture) this.dummyWriteDepthTexture.destroy();
            if (this.dummyDataTextureA) this.dummyDataTextureA.destroy();
            if (this.dummyDataTextureB) this.dummyDataTextureB.destroy();
            if (this.dummyDataTextureC) this.dummyDataTextureC.destroy();
        } catch (e) {
            // ignore cleanup errors
        }
        this.extraBuffer = undefined as any;
        this.computeUniformsBuffer = undefined as any;
        this.noiseBuffer = undefined as any;
        this.writeTexture = undefined as any;
        this.computePipeline = undefined as any;
        this.computeBindGroup = undefined as any;
        this.blitPipeline = undefined as any;
        this.blitBindGroup = undefined as any;
    }
}
