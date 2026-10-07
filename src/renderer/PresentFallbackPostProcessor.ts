import {
    weatherPassTimestampWrites,
    type WeatherPassTimingContext,
    type WeatherPostProcessorLike,
} from './weatherPostProcessorTypes';
import { createRenderPipelineChecked, createShaderModuleChecked } from './gpuPipelineFactory';

/**
 * Pass 1's HDR intermediate → swap chain, ACES-tonemapped, nothing else.
 *
 * The same Narkowicz ACES fit as `weather-post.wgsl`'s `aces_tonemap`, so a
 * frame presented through this fallback has the road's exposure, just no
 * weather or grade on it. Inline (not a fetched `.wgsl`) on purpose: it is the
 * thing that must still compile when a shipped shader does not.
 */
export const PRESENT_FALLBACK_WGSL = /* wgsl */ `
@group(0) @binding(0) var hdrFrame: texture_2d<f32>;
@group(0) @binding(1) var hdrSampler: sampler;

struct VertexOut {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> VertexOut {
    var corners = array<vec2<f32>, 3>(vec2<f32>(-1.0, -1.0), vec2<f32>(3.0, -1.0), vec2<f32>(-1.0, 3.0));
    let p = corners[vertexIndex];
    var out: VertexOut;
    out.position = vec4<f32>(p, 0.0, 1.0);
    out.uv = vec2<f32>(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5);
    return out;
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4<f32> {
    let c = max(textureSampleLevel(hdrFrame, hdrSampler, in.uv, 0.0).rgb, vec3<f32>(0.0));
    let mapped = clamp((c * (2.51 * c + 0.03)) / (c * (2.43 * c + 0.59) + 0.14), vec3<f32>(0.0), vec3<f32>(1.0));
    return vec4<f32>(mapped, 1.0);
}
`;

/**
 * The weather slot's stand-in when the weather pass fails validation.
 *
 * Without it, a broken `weather-post.wgsl` (or compute variant) leaves nothing
 * that writes the swap chain, and the whole renderer has to hard-fail even
 * though pass 1 is perfectly healthy. With it, the probe reports
 * `passes.weather: failed` and `passes['present-fallback']: ready`, and the road
 * keeps presenting — ungraded, but there.
 *
 * Every weather-parameter setter is a no-op: there is nothing to drive.
 */
export class PresentFallbackPostProcessor implements WeatherPostProcessorLike {
    private pipeline: GPURenderPipeline | null = null;
    private sampler: GPUSampler | null = null;
    private bindGroup: GPUBindGroup | null = null;
    private camera = { heading: 0, pitch: 0 };
    private shaderEffectsEnabled = true;

    constructor(
        private readonly device: GPUDevice,
        private readonly context: GPUCanvasContext,
    ) {}

    public async init(presentationFormat: GPUTextureFormat): Promise<void> {
        const module = await createShaderModuleChecked(this.device, {
            label: 'present-fallback',
            code: PRESENT_FALLBACK_WGSL,
        });
        this.pipeline = await createRenderPipelineChecked(this.device, {
            label: 'present-fallback-pipeline',
            layout: 'auto',
            vertex: { module, entryPoint: 'vs_main' },
            fragment: { module, entryPoint: 'fs_main', targets: [{ format: presentationFormat }] },
            primitive: { topology: 'triangle-list' },
        });
        this.sampler = this.device.createSampler({
            label: 'present-fallback-sampler',
            magFilter: 'linear',
            minFilter: 'linear',
            addressModeU: 'clamp-to-edge',
            addressModeV: 'clamp-to-edge',
        });
    }

    public updateWeatherBindGroup(intermediateTextureView: GPUTextureView): void {
        if (!this.pipeline || !this.sampler || !intermediateTextureView) return;
        this.bindGroup = this.device.createBindGroup({
            label: 'present-fallback-bind-group',
            layout: this.pipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: intermediateTextureView },
                { binding: 1, resource: this.sampler },
            ],
        });
    }

    public renderPass(commandEncoder: GPUCommandEncoder, timing?: WeatherPassTimingContext): void {
        if (!this.pipeline || !this.bindGroup) return;
        const pass = commandEncoder.beginRenderPass({
            label: 'present-fallback',
            colorAttachments: [{
                view: this.context.getCurrentTexture().createView(),
                clearValue: { r: 0, g: 0, b: 0, a: 1 },
                loadOp: 'clear',
                storeOp: 'store',
            }],
            timestampWrites: weatherPassTimestampWrites(timing),
        });
        if (timing) timing.timer.markPassStart(pass, timing.weatherStartIndex);
        pass.setPipeline(this.pipeline);
        pass.setBindGroup(0, this.bindGroup);
        pass.draw(3, 1, 0, 0);
        if (timing) timing.timer.markPassEnd(pass, timing.weatherEndIndex);
        pass.end();
    }

    public renderWeatherOnly(
        intermediateTextureView: GPUTextureView,
        afterWeather?: (commandEncoder: GPUCommandEncoder) => void,
    ): void {
        if (!this.pipeline) return;
        try {
            const encoder = this.device.createCommandEncoder({ label: 'present-fallback-weather-only' });
            // No panorama this frame: present the cleared intermediate (black).
            encoder.beginRenderPass({
                label: 'present-fallback-clear',
                colorAttachments: [{
                    view: intermediateTextureView,
                    clearValue: { r: 0, g: 0, b: 0, a: 1 },
                    loadOp: 'clear',
                    storeOp: 'store',
                }],
            }).end();
            this.renderPass(encoder);
            afterWeather?.(encoder);
            this.device.queue.submit([encoder.finish()]);
        } catch {
            // Same contract as the weather post-processors: never throw per frame.
        }
    }

    public updateNoiseBuffer(): void {}
    public updateParticleSeeds(): void {}
    public setLookLut(): void {}
    public setTemporalHistoryEnabled(): void {}
    public updateWeatherParams(): void {}
    public updateColorParams(): void {}
    public updateWeatherAnimation(): void {}

    public setShaderEffects(enabled: boolean): void {
        this.shaderEffectsEnabled = enabled;
    }

    public getShaderEffectsEnabled(): boolean {
        return this.shaderEffectsEnabled;
    }

    public updateCameraParams(heading: number, pitch: number): void {
        this.camera = { heading, pitch };
    }

    public getCameraParams(): { heading: number; pitch: number } {
        return this.camera;
    }

    public dispose(): void {
        this.pipeline = null;
        this.sampler = null;
        this.bindGroup = null;
    }
}
