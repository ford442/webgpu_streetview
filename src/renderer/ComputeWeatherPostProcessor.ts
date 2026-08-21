import {
    WEATHER_PARAMS_BYTE_SIZE,
    WEATHER_PARAMS_FLOAT_COUNT,
    WeatherParamIndex,
} from './weatherUniformLayout';
import { createDefaultWeatherParams } from './packWeatherParams';
import type { WeatherPostProcessorLike, WeatherPassTimingContext } from './weatherPostProcessorTypes';
import { PARTICLE_DENSITY_SCALE, PARTICLE_MAX_DT } from './weatherParticles';
import type { LutVolume } from './lut';
import {
    createIdentityLutTexture,
    createLookLutTexture,
    createLutBindGroup,
    createLutBindGroupLayout,
    createLutSampler,
} from './lutGpu';

// Must match NOISE_TILE_SIZE in src/wasm/wasmNoiseFeeder.ts and the storage
// buffer declared in weather-post.wgsl. The compute variant binds this tile at
// binding 12 (the image_video_effects `plasmaBuffer` slot), where the shader
// reads it as 1024 vec4s — 4096 floats, exactly one 64x64 tile.
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
 * Two of the image_video_effects storage surfaces carry real data: binding 6
 * receives a full-res view-depth proxy each dispatch, and binding 12 carries
 * the WASM noise tile (#128) that drives dust turbulence — an fBm tile on this
 * path, where the fragment path gets a single octave (see
 * src/wasm/wasmNoiseFeeder.ts and docs/WASM_BRIDGE.md). Bindings 7/8 hold
 * GPU precipitation when `updateParticleSeeds` has run: 7 is a half-res
 * density splat (`texture_2d` read), 8 is the compact particle-state write
 * target. See docs/RENDERER_FALLBACK.md and docs/GRAPHICS.md.
 */
export class ComputeWeatherPostProcessor implements WeatherPostProcessorLike {
    private device: GPUDevice;
    private context: GPUCanvasContext;

    private computePipeline: GPUComputePipeline | null = null;
    private computeBindGroup: GPUBindGroup | null = null;
    private blitPipeline: GPURenderPipeline | null = null;
    private blitBindGroup: GPUBindGroup | null = null;

    private extraBuffer: GPUBuffer | null = null;
    private computeUniformsBuffer: GPUBuffer | null = null;
    private noiseBuffer: GPUBuffer | null = null;
    private writeTexture: GPUTexture | null = null;
    /** Full-res r32float view-depth proxy — ping-pong pair for temporal fog (binding 4 read / 6 write). */
    private depthTextures: [GPUTexture | null, GPUTexture | null] = [null, null];
    private depthReadIndex: 0 | 1 = 0;
    private depthWriteIndex: 1 | 0 = 1;
    private writeWidth: number = 0;
    private writeHeight: number = 0;

    private filteringSampler: GPUSampler | null = null;
    private nonFilteringSampler: GPUSampler | null = null;
    private comparisonSampler: GPUSampler | null = null;
    // Dummy 1x1 resources for unused image_video_effects slots. Binding 9
    // (dataTextureC) stays a dummy. Bindings 7/8 start as dummies and are
    // replaced by real particle textures after updateParticleSeeds().
    private dummyDataTextureA: GPUTexture | null = null;
    private dummyDataTextureB: GPUTexture | null = null;
    private dummyDataTextureC: GPUTexture | null = null;

    private particleStates: [GPUTexture | null, GPUTexture | null] = [null, null];
    private particleReadIndex: 0 | 1 = 0;
    private particleWriteIndex: 1 | 0 = 1;
    private particleGridWidth = 0;
    private particleGridHeight = 0;
    private particleDensity: GPUTexture | null = null;
    private particleDensityWidth = 0;
    private particleDensityHeight = 0;
    private particlesEnabled = false;

    private particleUniformsBuffer: GPUBuffer | null = null;
    private particleBindGroupLayout: GPUBindGroupLayout | null = null;
    private integratePipeline: GPUComputePipeline | null = null;
    private clearDensityPipeline: GPUComputePipeline | null = null;
    private splatPipeline: GPUComputePipeline | null = null;
    private lastParticleTime = 0;

    private lutSampler: GPUSampler | null = null;
    private dummyLutTexture: GPUTexture | null = null;
    private lutTexture: GPUTexture | null = null;
    private lutBindGroupLayout: GPUBindGroupLayout | null = null;
    private lutBindGroup: GPUBindGroup | null = null;
    private colorHistoryTexture: GPUTexture | null = null;
    private historyReady = false;
    private temporalHistoryEnabled = false;

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
            size: WEATHER_PARAMS_BYTE_SIZE,
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

        this.dummyDataTextureC = this.device.createTexture({
            size: [1, 1],
            format: 'rgba8unorm',
            usage: GPUTextureUsage.TEXTURE_BINDING,
        });
        // Binding 7 is a readable rgba32float (density). Binding 8 is a
        // write-only storage texture (particle state).
        this.dummyDataTextureA = this.device.createTexture({
            size: [1, 1],
            format: 'rgba32float',
            usage: GPUTextureUsage.TEXTURE_BINDING,
        });
        this.dummyDataTextureB = this.device.createTexture({
            size: [1, 1],
            format: 'rgba32float',
            usage: GPUTextureUsage.STORAGE_BINDING,
        });
        this.particleUniformsBuffer = this.device.createBuffer({
            size: 32,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        this.weatherParams.set(createDefaultWeatherParams());
        this.device.queue.writeBuffer(this.extraBuffer, 0, this.weatherParams);
        this.lutSampler = createLutSampler(this.device);
        this.dummyLutTexture = createIdentityLutTexture(this.device);
        this.lutTexture = this.dummyLutTexture;
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
                { binding: 7, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float' } },
                { binding: 8, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'rgba32float' } },
                { binding: 9, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float' } },
                { binding: 10, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
                { binding: 11, visibility: GPUShaderStage.COMPUTE, sampler: { type: 'comparison' } },
                { binding: 12, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
            ],
        });

        this.lutBindGroupLayout = createLutBindGroupLayout(this.device, GPUShaderStage.COMPUTE);
        this.computePipeline = this.device.createComputePipeline({
            layout: this.device.createPipelineLayout({
                bindGroupLayouts: [computeBindGroupLayout, this.lutBindGroupLayout],
            }),
            compute: { module: computeModule, entryPoint: 'main' },
        });
        this.rebuildLutBindGroup();

        await this.initParticlePipelines();

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

    private async initParticlePipelines(): Promise<void> {
        const shaderUrl = `${process.env.PUBLIC_URL || '/'}/shaders/weather-particles.wgsl`;
        let shaderCode: string;
        try {
            const response = await fetch(shaderUrl);
            if (!response.ok) {
                console.warn(`[Renderer] Particle shader missing (${response.status}); GPU precipitation disabled`);
                return;
            }
            shaderCode = await response.text();
        } catch (error) {
            console.warn('[Renderer] Failed to load weather-particles.wgsl; GPU precipitation disabled', error);
            return;
        }

        const module = this.device.createShaderModule({ code: shaderCode });
        this.particleBindGroupLayout = this.device.createBindGroupLayout({
            entries: [
                { binding: 0, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float' } },
                { binding: 1, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'rgba32float' } },
                { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
                { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
            ],
        });
        const layout = this.device.createPipelineLayout({
            bindGroupLayouts: [this.particleBindGroupLayout],
        });
        this.integratePipeline = this.device.createComputePipeline({
            layout,
            compute: { module, entryPoint: 'integrate' },
        });
        this.clearDensityPipeline = this.device.createComputePipeline({
            layout,
            compute: { module, entryPoint: 'clear_density' },
        });
        this.splatPipeline = this.device.createComputePipeline({
            layout,
            compute: { module, entryPoint: 'splat' },
        });
    }

    private ensureWriteTexture(width: number, height: number): void {
        if (this.writeTexture && this.writeWidth === width && this.writeHeight === height) return;
        if (this.writeTexture) this.writeTexture.destroy();
        for (let i = 0; i < 2; i++) {
            if (this.depthTextures[i]) this.depthTextures[i]!.destroy();
            this.depthTextures[i] = null;
        }

        this.writeWidth = width;
        this.writeHeight = height;
        const size: [number, number] = [Math.max(1, width), Math.max(1, height)];
        this.writeTexture = this.device.createTexture({
            size,
            format: 'rgba32float',
            usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC,
        });
        if (this.colorHistoryTexture) this.colorHistoryTexture.destroy();
        this.colorHistoryTexture = this.device.createTexture({
            size,
            format: 'rgba32float',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
        });
        this.historyReady = false;
        const depthUsage = GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING;
        this.depthTextures[0] = this.device.createTexture({ size, format: 'r32float', usage: depthUsage });
        this.depthTextures[1] = this.device.createTexture({ size, format: 'r32float', usage: depthUsage });
        this.depthReadIndex = 0;
        this.depthWriteIndex = 1;
        this.ensureParticleDensityTexture();
    }

    private ensureParticleDensityTexture(): void {
        const width = Math.max(1, Math.ceil(this.writeWidth * PARTICLE_DENSITY_SCALE));
        const height = Math.max(1, Math.ceil(this.writeHeight * PARTICLE_DENSITY_SCALE));
        if (
            this.particleDensity
            && this.particleDensityWidth === width
            && this.particleDensityHeight === height
        ) {
            return;
        }
        if (this.particleDensity) this.particleDensity.destroy();
        this.particleDensityWidth = width;
        this.particleDensityHeight = height;
        this.particleDensity = this.device.createTexture({
            size: [width, height],
            format: 'rgba32float',
            usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
        });
    }

    private ensureParticleStateTextures(gridW: number, gridH: number): void {
        if (
            this.particleStates[0]
            && this.particleStates[1]
            && this.particleGridWidth === gridW
            && this.particleGridHeight === gridH
        ) {
            return;
        }
        for (let i = 0; i < 2; i++) {
            if (this.particleStates[i]) this.particleStates[i]!.destroy();
            this.particleStates[i] = null;
        }
        this.particleGridWidth = gridW;
        this.particleGridHeight = gridH;
        const usage = GPUTextureUsage.STORAGE_BINDING
            | GPUTextureUsage.TEXTURE_BINDING
            | GPUTextureUsage.COPY_DST;
        this.particleStates[0] = this.device.createTexture({
            size: [gridW, gridH],
            format: 'rgba32float',
            usage,
        });
        this.particleStates[1] = this.device.createTexture({
            size: [gridW, gridH],
            format: 'rgba32float',
            usage,
        });
        this.particleReadIndex = 0;
        this.particleWriteIndex = 1;
    }

    private getParticleRead(): GPUTexture | null {
        return this.particleStates[this.particleReadIndex];
    }

    private getParticleWrite(): GPUTexture | null {
        return this.particleStates[this.particleWriteIndex];
    }

    private swapParticlePingPong(): void {
        const nextRead = this.particleWriteIndex;
        this.particleWriteIndex = this.particleReadIndex;
        this.particleReadIndex = nextRead;
    }

    private getDepthReadTexture(): GPUTexture | null {
        return this.depthTextures[this.depthReadIndex];
    }

    private getDepthWriteTexture(): GPUTexture | null {
        return this.depthTextures[this.depthWriteIndex];
    }

    private swapDepthPingPong(): void {
        const nextRead = this.depthWriteIndex;
        this.depthWriteIndex = this.depthReadIndex;
        this.depthReadIndex = nextRead;
    }

    private rebuildComputeBindGroup(intermediateTextureView: GPUTextureView): void {
        if (this.particlesEnabled) {
            this.ensureParticleDensityTexture();
        }
        const depthRead = this.getDepthReadTexture();
        const depthWrite = this.getDepthWriteTexture();
        if (
            !this.computePipeline
            || !this.blitPipeline
            || !this.writeTexture
            || !depthRead
            || !depthWrite
            || !this.extraBuffer
            || !this.computeUniformsBuffer
            || !this.filteringSampler
            || !this.nonFilteringSampler
            || !this.comparisonSampler
            || !this.dummyDataTextureA
            || !this.dummyDataTextureB
            || !this.dummyDataTextureC
            || !this.noiseBuffer
        ) {
            return;
        }

        this.computeBindGroup = this.device.createBindGroup({
            layout: this.computePipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: this.filteringSampler },
                { binding: 1, resource: intermediateTextureView },
                { binding: 2, resource: this.writeTexture.createView() },
                { binding: 3, resource: { buffer: this.computeUniformsBuffer } },
                { binding: 4, resource: depthRead.createView() },
                { binding: 5, resource: this.nonFilteringSampler },
                { binding: 6, resource: depthWrite.createView() },
                { binding: 7, resource: this.getDensityView() },
                { binding: 8, resource: this.getParticleStateWriteView() },
                { binding: 9, resource: this.getColorHistoryView() },
                { binding: 10, resource: { buffer: this.extraBuffer } },
                { binding: 11, resource: this.comparisonSampler },
                { binding: 12, resource: { buffer: this.noiseBuffer } },
            ],
        });

        this.blitBindGroup = this.device.createBindGroup({
            layout: this.blitPipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: this.writeTexture.createView() },
            ],
        });
    }

    private getColorHistoryView(): GPUTextureView {
        if (
            this.temporalHistoryEnabled
            && this.historyReady
            && this.colorHistoryTexture
        ) {
            return this.colorHistoryTexture.createView();
        }
        return this.dummyDataTextureC!.createView();
    }

    private rebuildLutBindGroup(): void {
        if (!this.lutBindGroupLayout || !this.lutSampler || !this.lutTexture) return;
        this.lutBindGroup = createLutBindGroup(
            this.device,
            this.lutBindGroupLayout,
            this.lutTexture,
            this.lutSampler,
        );
    }

    public setLookLut(volume: LutVolume | null): void {
        if (this.lutTexture && this.lutTexture !== this.dummyLutTexture) {
            this.lutTexture.destroy();
        }
        this.lutTexture = volume
            ? createLookLutTexture(this.device, volume)
            : this.dummyLutTexture;
        this.rebuildLutBindGroup();
    }

    public setTemporalHistoryEnabled(enabled: boolean): void {
        if (this.temporalHistoryEnabled === enabled) return;
        this.temporalHistoryEnabled = enabled;
        if (!enabled) this.historyReady = false;
        if (this.lastIntermediateView) this.rebuildComputeBindGroup(this.lastIntermediateView);
    }

    public updateWeatherBindGroup(intermediateTextureView: GPUTextureView, width?: number, height?: number): void {
        if (
            !this.computePipeline
            || !this.blitPipeline
            || !intermediateTextureView
            || !this.extraBuffer
            || !this.computeUniformsBuffer
            || !this.filteringSampler
            || !this.nonFilteringSampler
            || !this.comparisonSampler
            || !this.dummyDataTextureA
            || !this.dummyDataTextureB
            || !this.dummyDataTextureC
            || !this.noiseBuffer
        ) {
            return;
        }

        this.ensureWriteTexture(width || 1, height || 1);
        if (!this.writeTexture) return;

        this.lastIntermediateView = intermediateTextureView;
        this.rebuildComputeBindGroup(intermediateTextureView);
    }

    public updateNoiseBuffer(tile: Float32Array): void {
        if (!this.noiseBuffer || !this.device) return;
        this.device.queue.writeBuffer(this.noiseBuffer, 0, tile);
    }

    /**
     * Upload WASM particle seeds (4 floats/particle) into the compact state
     * textures. Enables bindings 7/8 for subsequent dispatches. `seeds.length`
     * must be `width * height * 4`.
     */
    public updateParticleSeeds(seeds: Float32Array, width: number, height: number): void {
        if (!this.device || width < 1 || height < 1) return;
        if (seeds.length < width * height * 4) return;
        this.ensureParticleStateTextures(width, height);
        const read = this.particleStates[0];
        const write = this.particleStates[1];
        if (!read || !write) return;
        const bytesPerRow = width * 16;
        const layout = { bytesPerRow, rowsPerImage: height };
        const size = { width, height };
        this.device.queue.writeTexture({ texture: read }, seeds, layout, size);
        this.device.queue.writeTexture({ texture: write }, seeds, layout, size);
        this.particlesEnabled = true;
        this.lastParticleTime = this.weatherParams[WeatherParamIndex.time] ?? 0;
        if (this.lastIntermediateView) {
            this.rebuildComputeBindGroup(this.lastIntermediateView);
        }
    }

    /** True when bindings 7/8 are the real particle textures (not 1×1 dummies). */
    public areParticleTexturesActive(): boolean {
        return this.particlesEnabled
            && this.particleGridWidth > 1
            && this.particleGridHeight > 1
            && this.particleDensityWidth > 1
            && this.particleDensityHeight > 1;
    }

    private getDensityView(): GPUTextureView {
        if (this.particlesEnabled && this.particleDensity) {
            return this.particleDensity.createView();
        }
        return this.dummyDataTextureA!.createView();
    }

    private getParticleStateWriteView(): GPUTextureView {
        const write = this.getParticleWrite();
        if (this.particlesEnabled && write) {
            return write.createView();
        }
        return this.dummyDataTextureB!.createView();
    }

    private swapParticlePingPongIfActive(): void {
        if (!this.particlesEnabled) return;
        this.swapParticlePingPong();
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
            this.weatherParams.set(params.subarray(0, Math.min(WEATHER_PARAMS_FLOAT_COUNT, params.length)));
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

    private lastIntermediateView: GPUTextureView | null = null;

    private dispatch(commandEncoder: GPUCommandEncoder, timing?: WeatherPassTimingContext): void {
        if (
            !this.computeBindGroup
            || !this.computePipeline
            || !this.computeUniformsBuffer
            || this.writeWidth <= 0
            || this.writeHeight <= 0
        ) {
            return;
        }

        this.device.queue.writeBuffer(
            this.computeUniformsBuffer,
            0,
            new Float32Array([this.weatherParams[WeatherParamIndex.time]!, 0, this.writeWidth, this.writeHeight])
        );

        const particlesRan = this.dispatchParticles(commandEncoder);

        const computePass = commandEncoder.beginComputePass();
        if (timing) {
            timing.timer.markPassStart(computePass, timing.weatherStartIndex);
        }
        computePass.setPipeline(this.computePipeline);
        computePass.setBindGroup(0, this.computeBindGroup);
        if (this.lutBindGroup) computePass.setBindGroup(1, this.lutBindGroup);
        computePass.dispatchWorkgroups(
            Math.ceil(this.writeWidth / WORKGROUP_SIZE),
            Math.ceil(this.writeHeight / WORKGROUP_SIZE)
        );
        if (timing) {
            timing.timer.markPassEnd(computePass, timing.weatherEndIndex);
        }
        computePass.end();

        this.swapDepthPingPong();
        if (particlesRan) {
            this.swapParticlePingPongIfActive();
        }
        if (this.lastIntermediateView) {
            this.rebuildComputeBindGroup(this.lastIntermediateView);
        }
    }

    private dispatchParticles(commandEncoder: GPUCommandEncoder): boolean {
        const read = this.getParticleRead();
        const write = this.getParticleWrite();
        if (
            !this.particlesEnabled
            || !read
            || !write
            || !this.particleDensity
            || !this.extraBuffer
            || !this.particleUniformsBuffer
            || !this.particleBindGroupLayout
            || !this.integratePipeline
            || !this.clearDensityPipeline
            || !this.splatPipeline
        ) {
            return false;
        }

        const precip =
            (this.weatherParams[WeatherParamIndex.rainIntensity] ?? 0)
            + (this.weatherParams[WeatherParamIndex.snowIntensity] ?? 0);
        if (precip < 0.001) return false;

        const time = this.weatherParams[WeatherParamIndex.time] ?? 0;
        let dt = time - this.lastParticleTime;
        if (dt < 0) dt = 0;
        dt = Math.min(dt, PARTICLE_MAX_DT);
        this.lastParticleTime = time;

        this.ensureParticleDensityTexture();
        if (!this.particleDensity) return false;

        const uniforms = new Float32Array([
            dt,
            this.particleGridWidth,
            this.particleGridHeight,
            0,
            this.particleDensityWidth,
            this.particleDensityHeight,
            0,
            0,
        ]);
        this.device.queue.writeBuffer(this.particleUniformsBuffer, 0, uniforms);

        const makeGroup = (src: GPUTexture, dst: GPUTexture): GPUBindGroup =>
            this.device.createBindGroup({
                layout: this.particleBindGroupLayout!,
                entries: [
                    { binding: 0, resource: src.createView() },
                    { binding: 1, resource: dst.createView() },
                    { binding: 2, resource: { buffer: this.extraBuffer! } },
                    { binding: 3, resource: { buffer: this.particleUniformsBuffer! } },
                ],
            });

        const clearGroup = makeGroup(read, this.particleDensity);
        const integrateGroup = makeGroup(read, write);
        const splatGroup = makeGroup(write, this.particleDensity);

        const gridX = Math.ceil(this.particleGridWidth / WORKGROUP_SIZE);
        const gridY = Math.ceil(this.particleGridHeight / WORKGROUP_SIZE);
        const densX = Math.ceil(this.particleDensityWidth / WORKGROUP_SIZE);
        const densY = Math.ceil(this.particleDensityHeight / WORKGROUP_SIZE);

        const clearPass = commandEncoder.beginComputePass();
        clearPass.setPipeline(this.clearDensityPipeline);
        clearPass.setBindGroup(0, clearGroup);
        clearPass.dispatchWorkgroups(densX, densY);
        clearPass.end();

        const integratePass = commandEncoder.beginComputePass();
        integratePass.setPipeline(this.integratePipeline);
        integratePass.setBindGroup(0, integrateGroup);
        integratePass.dispatchWorkgroups(gridX, gridY);
        integratePass.end();

        const splatPass = commandEncoder.beginComputePass();
        splatPass.setPipeline(this.splatPipeline);
        splatPass.setBindGroup(0, splatGroup);
        splatPass.dispatchWorkgroups(gridX, gridY);
        splatPass.end();
        return true;
    }

    private blit(commandEncoder: GPUCommandEncoder, timing?: WeatherPassTimingContext): void {
        if (!this.blitBindGroup || !this.blitPipeline) return;
        const finalTextureView = this.context.getCurrentTexture().createView();
        const blitPass = commandEncoder.beginRenderPass({
            colorAttachments: [{
                view: finalTextureView,
                clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
                loadOp: 'clear' as GPULoadOp,
                storeOp: 'store' as GPUStoreOp,
            }],
        });
        if (timing?.blitStartIndex !== undefined && timing.blitEndIndex !== undefined) {
            timing.timer.markPassStart(blitPass, timing.blitStartIndex);
        }
        blitPass.setPipeline(this.blitPipeline);
        blitPass.setBindGroup(0, this.blitBindGroup);
        blitPass.draw(3, 1, 0, 0);
        if (timing?.blitStartIndex !== undefined && timing.blitEndIndex !== undefined) {
            timing.timer.markPassEnd(blitPass, timing.blitEndIndex);
        }
        blitPass.end();
        this.copyColorHistory(commandEncoder);
    }

    private copyColorHistory(commandEncoder: GPUCommandEncoder): void {
        if (
            !this.temporalHistoryEnabled
            || !this.writeTexture
            || !this.colorHistoryTexture
            || this.writeWidth < 1
            || this.writeHeight < 1
        ) {
            return;
        }
        commandEncoder.copyTextureToTexture(
            { texture: this.writeTexture },
            { texture: this.colorHistoryTexture },
            [this.writeWidth, this.writeHeight],
        );
        this.historyReady = true;
        if (this.lastIntermediateView) {
            this.rebuildComputeBindGroup(this.lastIntermediateView);
        }
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

    public renderPass(commandEncoder: GPUCommandEncoder, timing?: WeatherPassTimingContext): void {
        this.dispatch(commandEncoder, timing);
        this.blit(commandEncoder, timing);
    }

    public dispose(): void {
        try {
            if (this.extraBuffer) this.extraBuffer.destroy();
            if (this.computeUniformsBuffer) this.computeUniformsBuffer.destroy();
            if (this.noiseBuffer) this.noiseBuffer.destroy();
            if (this.writeTexture) this.writeTexture.destroy();
            if (this.colorHistoryTexture) this.colorHistoryTexture.destroy();
            for (let i = 0; i < 2; i++) {
                if (this.depthTextures[i]) this.depthTextures[i]!.destroy();
            }
            for (let i = 0; i < 2; i++) {
                if (this.particleStates[i]) this.particleStates[i]!.destroy();
            }
            if (this.particleDensity) this.particleDensity.destroy();
            if (this.particleUniformsBuffer) this.particleUniformsBuffer.destroy();
            if (this.dummyDataTextureA) this.dummyDataTextureA.destroy();
            if (this.dummyDataTextureB) this.dummyDataTextureB.destroy();
            if (this.dummyDataTextureC) this.dummyDataTextureC.destroy();
            if (this.lutTexture && this.lutTexture !== this.dummyLutTexture) this.lutTexture.destroy();
            if (this.dummyLutTexture) this.dummyLutTexture.destroy();
        } catch (e) {
            // ignore cleanup errors
        }
        this.extraBuffer = null;
        this.computeUniformsBuffer = null;
        this.noiseBuffer = null;
        this.writeTexture = null;
        this.colorHistoryTexture = null;
        this.lutTexture = null;
        this.dummyLutTexture = null;
        this.lutBindGroup = null;
        this.lutBindGroupLayout = null;
        this.historyReady = false;
        this.depthTextures = [null, null];
        this.particleStates = [null, null];
        this.particleDensity = null;
        this.particleUniformsBuffer = null;
        this.particleBindGroupLayout = null;
        this.integratePipeline = null;
        this.clearDensityPipeline = null;
        this.splatPipeline = null;
        this.particlesEnabled = false;
        this.computePipeline = null;
        this.computeBindGroup = null;
        this.blitPipeline = null;
        this.blitBindGroup = null;
        this.filteringSampler = null;
        this.nonFilteringSampler = null;
        this.comparisonSampler = null;
        this.dummyDataTextureA = null;
        this.dummyDataTextureB = null;
        this.dummyDataTextureC = null;
    }
}
