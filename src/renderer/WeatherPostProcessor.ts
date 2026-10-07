import {
    WEATHER_PARAMS_BYTE_SIZE,
    WEATHER_PARAMS_FLOAT_COUNT,
    WeatherParamIndex,
} from './weatherUniformLayout';
import { createDefaultWeatherParams } from './packWeatherParams';
import {
    weatherPassTimestampWrites,
    type WeatherPostInitOptions,
    type WeatherPostProcessorLike,
    type WeatherPassTimingContext,
} from './weatherPostProcessorTypes';
import type { LutVolume } from './lut';
import {
    createIdentityLutTexture,
    createLookLutTexture,
    createLutBindGroup,
    createLutBindGroupLayout,
    createLutSampler,
} from './lutGpu';
import {
    assembleDualSourceWeatherShader,
    assembleExtendedToneMappingShader,
    deviceHasFeature,
    DUAL_SOURCE_PRECIP_BLEND,
} from './shaderFeatureVariants';
import { OPTIONAL_DEVICE_FEATURES } from './deviceCapabilities';
import { createTrackedBuffer, destroyTracked } from './gpuMemoryTracking';
import {
    createRenderPipelineChecked,
    createShaderModuleChecked,
    fetchShaderSource,
} from './gpuPipelineFactory';

// Must match NOISE_TILE_SIZE in src/wasm/wasmNoiseFeeder.ts and the
// `array<f32, 4096>` storage buffer declared in weather-post.wgsl.
const NOISE_TILE_SIZE = 64;
const NOISE_BUFFER_BYTES = NOISE_TILE_SIZE * NOISE_TILE_SIZE * 4;

export class WeatherPostProcessor implements WeatherPostProcessorLike {
    private device: GPUDevice;
    private context: GPUCanvasContext;

    private weatherPipeline: GPURenderPipeline | null = null;
    private weatherBindGroup: GPUBindGroup | null = null;
    private weatherParamsBuffer: GPUBuffer | null = null;
    private weatherSampler: GPUSampler | null = null;
    private noiseBuffer: GPUBuffer | null = null;
    private lutSampler: GPUSampler | null = null;
    private dummyLutTexture: GPUTexture | null = null;
    private lutTexture: GPUTexture | null = null;
    private lutBindGroupLayout: GPUBindGroupLayout | null = null;
    private lutBindGroup: GPUBindGroup | null = null;
    private weatherParams: Float32Array<ArrayBuffer> = new Float32Array(WEATHER_PARAMS_FLOAT_COUNT);
    private startTime: number = Date.now();
    private shaderEffectsEnabled: boolean = true;
    private dualSourcePrecip = false;
    /**
     * Setters only mark the block dirty; `flushWeatherParams` uploads it once,
     * right before a pass reads it — one `writeBuffer` per frame, not one per
     * setter (params, camera and time all change every frame).
     */
    private weatherParamsDirty = true;

    constructor(device: GPUDevice, context: GPUCanvasContext, _canvas: HTMLCanvasElement) {
        this.device = device;
        this.context = context;

        this.weatherSampler = this.device.createSampler({
            label: 'weather-post-sampler',
            magFilter: 'linear',
            minFilter: 'linear',
            addressModeU: 'clamp-to-edge',
            addressModeV: 'clamp-to-edge',
        });

        this.weatherParamsBuffer = createTrackedBuffer(this.device, {
            size: WEATHER_PARAMS_BYTE_SIZE,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        }, 'weather-weatherParamsBuffer');

        // Zero-initialized until the first WASM-computed tile lands — the
        // shader only samples it when wasmNoiseEnabled (params[35]) is set.
        this.noiseBuffer = createTrackedBuffer(this.device, {
            size: NOISE_BUFFER_BYTES,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        }, 'weather-noiseBuffer');

        this.weatherParams.set(createDefaultWeatherParams());
        this.lutSampler = createLutSampler(this.device);
        this.dummyLutTexture = createIdentityLutTexture(this.device);
        this.lutTexture = this.dummyLutTexture;
    }

    public async init(
        presentationFormat: GPUTextureFormat,
        options: WeatherPostInitOptions = {},
    ): Promise<void> {
        const shaderUrl = `${process.env.PUBLIC_URL || '/'}/shaders/weather-post.wgsl`;
        let shaderCode: string;
        try {
            shaderCode = await fetchShaderSource(shaderUrl, 'weather-post.wgsl');
        } catch (error) {
            console.error(`[Renderer] Failed to load weather-post shader from ${shaderUrl}:`, error);
            throw error;
        }

        // Output-referred grade first: it rewrites the `aces_tonemap` body, which
        // the dual-source assembler never touches, so the two stay independent.
        shaderCode = assembleExtendedToneMappingShader(
            shaderCode,
            options.canvasToneMapping ?? 'standard',
        );

        this.dualSourcePrecip = deviceHasFeature(this.device, OPTIONAL_DEVICE_FEATURES.dualSourceBlending);
        if (this.dualSourcePrecip) {
            shaderCode = assembleDualSourceWeatherShader(shaderCode);
        }

        const shaderModule = await createShaderModuleChecked(this.device, {
            label: 'weather-post.wgsl',
            code: shaderCode,
        });

        const bindGroupLayout = this.device.createBindGroupLayout({
            label: 'weather-post-bind-group-layout',
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

        this.lutBindGroupLayout = createLutBindGroupLayout(this.device, GPUShaderStage.FRAGMENT);
        const pipelineLayout = this.device.createPipelineLayout({
            label: 'weather-post-pipeline-layout',
            bindGroupLayouts: [bindGroupLayout, this.lutBindGroupLayout],
        });

        this.weatherPipeline = await createRenderPipelineChecked(this.device, {
            label: 'weather-post-pipeline',
            layout: pipelineLayout,
            vertex: {
                module: shaderModule,
                entryPoint: 'vs_main',
            },
            fragment: {
                module: shaderModule,
                entryPoint: 'fs_main',
                targets: this.dualSourcePrecip
                    ? [{ format: presentationFormat as GPUTextureFormat, blend: DUAL_SOURCE_PRECIP_BLEND }]
                    : [{ format: presentationFormat as GPUTextureFormat }],
            },
            primitive: { topology: 'triangle-list' },
        });

        this.rebuildLutBindGroup();
    }

    public updateWeatherBindGroup(intermediateTextureView: GPUTextureView, _width?: number, _height?: number): void {
        if (!this.weatherPipeline || !intermediateTextureView || !this.weatherSampler || !this.weatherParamsBuffer || !this.noiseBuffer) {
            return;
        }

        this.weatherBindGroup = this.device.createBindGroup({
            label: 'weather-post-bind-group',
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
    public updateNoiseBuffer(tile: Float32Array<ArrayBuffer>): void {
        if (!this.noiseBuffer || !this.device) return;
        this.device.queue.writeBuffer(this.noiseBuffer, 0, tile);
    }

    public updateParticleSeeds(_seeds: Float32Array<ArrayBuffer>, _width: number, _height: number): void {
        // Fragment weather path stays procedural — GPU particles are compute-only.
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

    public setTemporalHistoryEnabled(_enabled: boolean): void {
        // TAA/DOF history is compute-only.
    }

    public setShaderEffects(enabled: boolean): void {
        this.shaderEffectsEnabled = enabled;
        if (this.weatherParamsBuffer && this.device) {
            this.weatherParams[WeatherParamIndex.shaderEffectsEnabled] = enabled ? 1.0 : 0.0;
            this.weatherParamsDirty = true;
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

    public updateWeatherParams(params: Float32Array<ArrayBuffer>): void {
        if (this.weatherParamsBuffer && this.device) {
            this.weatherParams.set(params.subarray(0, Math.min(WEATHER_PARAMS_FLOAT_COUNT, params.length)));
            this.weatherParamsDirty = true;
        }
    }

    public updateCameraParams(heading: number, pitch: number): void {
        if (this.weatherParamsBuffer && this.device) {
            this.weatherParams[WeatherParamIndex.cameraHeading] = heading;
            this.weatherParams[WeatherParamIndex.cameraPitch] = pitch;
            this.weatherParamsDirty = true;
        }
    }

    public updateColorParams(params: Float32Array<ArrayBuffer>): void {
        if (this.weatherParamsBuffer && this.device) {
            this.weatherParams.set(params.slice(0, 6), 0);
            this.weatherParamsDirty = true;
        }
    }

    public updateWeatherAnimation(): void {
        if (!this.device || !this.weatherParamsBuffer) return;
        try {
            const time = (Date.now() - this.startTime) / 1000;
            this.weatherParams[WeatherParamIndex.time] = time % 10000.0;
            this.weatherParamsDirty = true;
        } catch {
            // Ignore errors during weather-only updates
        }
    }

    private flushWeatherParams(): void {
        if (!this.weatherParamsDirty || !this.weatherParamsBuffer) return;
        this.device.queue.writeBuffer(this.weatherParamsBuffer, 0, this.weatherParams);
        this.weatherParamsDirty = false;
    }

    public renderWeatherOnly(
        intermediateTextureView: GPUTextureView,
        afterWeather?: (commandEncoder: GPUCommandEncoder) => void,
    ): void {
        if (!this.device || !this.weatherPipeline || !this.weatherBindGroup) return;

        try {
            this.updateWeatherAnimation();
            this.flushWeatherParams();

            const commandEncoder = this.device.createCommandEncoder({ label: 'weather-only-frame' });

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
            if (this.lutBindGroup) postPass.setBindGroup(1, this.lutBindGroup);
            postPass.draw(3, 1, 0, 0);
            postPass.end();

            afterWeather?.(commandEncoder);

            this.device.queue.submit([commandEncoder.finish()]);
        } catch {
            // Suppress errors during weather-only rendering
        }
    }

    public renderPass(commandEncoder: GPUCommandEncoder, timing?: WeatherPassTimingContext): void {
        if (!this.weatherPipeline || !this.weatherBindGroup) return;
        this.flushWeatherParams();
        const finalTextureView = this.context.getCurrentTexture().createView();
        const postPass = commandEncoder.beginRenderPass({
            colorAttachments: [{
                view: finalTextureView,
                clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
                loadOp: 'clear' as GPULoadOp,
                storeOp: 'store' as GPUStoreOp,
            }],
            timestampWrites: weatherPassTimestampWrites(timing),
        });
        if (timing) {
            timing.timer.markPassStart(postPass, timing.weatherStartIndex);
        }
        postPass.setPipeline(this.weatherPipeline);
        postPass.setBindGroup(0, this.weatherBindGroup);
        if (this.lutBindGroup) postPass.setBindGroup(1, this.lutBindGroup);
        postPass.draw(3, 1, 0, 0);
        if (timing) {
            timing.timer.markPassEnd(postPass, timing.weatherEndIndex);
        }
        postPass.end();
    }

    public dispose(): void {
        try {
            destroyTracked(this.weatherParamsBuffer);
            destroyTracked(this.noiseBuffer);
            if (this.lutTexture && this.lutTexture !== this.dummyLutTexture) this.lutTexture.destroy();
            if (this.dummyLutTexture) this.dummyLutTexture.destroy();
        } catch {
            // ignore cleanup errors
        }
        this.weatherParamsBuffer = null;
        this.noiseBuffer = null;
        this.weatherPipeline = null;
        this.weatherBindGroup = null;
        this.weatherSampler = null;
        this.lutSampler = null;
        this.lutTexture = null;
        this.dummyLutTexture = null;
        this.lutBindGroup = null;
        this.lutBindGroupLayout = null;
    }
}
