import { BLIT_SHADER } from './constants';

/**
 * Pipeline and bind-group construction for the compute weather pass.
 *
 * The 13-entry layout mirrors `image_video_effects` so the same WGSL can be
 * shared; the binding numbers are load-bearing and must stay in step with
 * `public/shaders/weather-post-compute.wgsl`.
 */

/** Binding indices for the weather compute group — the contract with the WGSL. */
export const WeatherBinding = {
    filteringSampler: 0,
    intermediate: 1,
    writeTexture: 2,
    computeUniforms: 3,
    depthRead: 4,
    nonFilteringSampler: 5,
    depthWrite: 6,
    /** Half-res particle density splat (read). */
    particleDensity: 7,
    /** Compact particle state (write). */
    particleState: 8,
    /** Previous-frame colour for temporal history. */
    colorHistory: 9,
    weatherParams: 10,
    comparisonSampler: 11,
    /** WASM fBm noise tile (#128). */
    noiseTile: 12,
} as const;

export function createComputeBindGroupLayout(device: GPUDevice): GPUBindGroupLayout {
    return device.createBindGroupLayout({
        entries: [
            { binding: 0, visibility: GPUShaderStage.COMPUTE, sampler: { type: 'filtering' } },
            { binding: 1, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float' } },
            { binding: 2, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'rgba32float' } },
            { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
            // 4 (r32float depth) is 32-bit float — see the note above binding 9.
            { binding: 4, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float' } },
            { binding: 5, visibility: GPUShaderStage.COMPUTE, sampler: { type: 'non-filtering' } },
            { binding: 6, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'r32float' } },
            { binding: 7, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float' } },
            { binding: 8, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'rgba32float' } },
            // 4/7/9 carry r32float / rgba32float, whose sample type is
            // `unfilterable-float` unless the optional `float32-filterable`
            // feature is enabled — and `deviceInit.ts` only requests that when
            // the adapter happens to offer it. Declaring them `'float'` would
            // therefore fail bind-group validation on any adapter without it.
            // The shader only ever reads all three with `textureLoad`, which
            // does not filter, so `unfilterable-float` is both correct and
            // sufficient. Do not "simplify" these back to `'float'`.
            { binding: 9, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float' } },
            { binding: 10, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
            { binding: 11, visibility: GPUShaderStage.COMPUTE, sampler: { type: 'comparison' } },
            { binding: 12, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        ],
    });
}

/**
 * Fetch `weather-post-compute.wgsl` and build the main compute pipeline.
 * A missing shader is fatal here (unlike the particle shader, which degrades)
 * — without it there is no weather pass at all.
 */
export async function createWeatherComputePipeline(
    device: GPUDevice,
    shaderUrl: string,
    lutBindGroupLayout: GPUBindGroupLayout,
): Promise<GPUComputePipeline> {
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

    const computeModule = device.createShaderModule({ code: shaderCode });
    return device.createComputePipeline({
        layout: device.createPipelineLayout({
            bindGroupLayouts: [createComputeBindGroupLayout(device), lutBindGroupLayout],
        }),
        compute: { module: computeModule, entryPoint: 'main' },
    });
}

export function createBlitPipeline(
    device: GPUDevice,
    presentationFormat: GPUTextureFormat,
): GPURenderPipeline {
    const blitModule = device.createShaderModule({ code: BLIT_SHADER });
    const blitBindGroupLayout = device.createBindGroupLayout({
        entries: [
            { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } },
        ],
    });
    return device.createRenderPipeline({
        layout: device.createPipelineLayout({ bindGroupLayouts: [blitBindGroupLayout] }),
        vertex: { module: blitModule, entryPoint: 'vs_main' },
        fragment: { module: blitModule, entryPoint: 'fs_main', targets: [{ format: presentationFormat }] },
        primitive: { topology: 'triangle-list' },
    });
}

/** Everything binding 0-12 needs, resolved by the caller. */
export interface WeatherBindGroupResources {
    filteringSampler: GPUSampler;
    intermediateView: GPUTextureView;
    writeTexture: GPUTexture;
    computeUniformsBuffer: GPUBuffer;
    depthReadTexture: GPUTexture;
    nonFilteringSampler: GPUSampler;
    depthWriteTexture: GPUTexture;
    densityView: GPUTextureView;
    particleStateWriteView: GPUTextureView;
    colorHistoryView: GPUTextureView;
    extraBuffer: GPUBuffer;
    comparisonSampler: GPUSampler;
    noiseBuffer: GPUBuffer;
}

export function createWeatherBindGroup(
    device: GPUDevice,
    pipeline: GPUComputePipeline,
    r: WeatherBindGroupResources,
): GPUBindGroup {
    return device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
            { binding: WeatherBinding.filteringSampler, resource: r.filteringSampler },
            { binding: WeatherBinding.intermediate, resource: r.intermediateView },
            { binding: WeatherBinding.writeTexture, resource: r.writeTexture.createView() },
            { binding: WeatherBinding.computeUniforms, resource: { buffer: r.computeUniformsBuffer } },
            { binding: WeatherBinding.depthRead, resource: r.depthReadTexture.createView() },
            { binding: WeatherBinding.nonFilteringSampler, resource: r.nonFilteringSampler },
            { binding: WeatherBinding.depthWrite, resource: r.depthWriteTexture.createView() },
            { binding: WeatherBinding.particleDensity, resource: r.densityView },
            { binding: WeatherBinding.particleState, resource: r.particleStateWriteView },
            { binding: WeatherBinding.colorHistory, resource: r.colorHistoryView },
            { binding: WeatherBinding.weatherParams, resource: { buffer: r.extraBuffer } },
            { binding: WeatherBinding.comparisonSampler, resource: r.comparisonSampler },
            { binding: WeatherBinding.noiseTile, resource: { buffer: r.noiseBuffer } },
        ],
    });
}

export function createBlitBindGroup(
    device: GPUDevice,
    pipeline: GPURenderPipeline,
    writeTexture: GPUTexture,
): GPUBindGroup {
    return device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: writeTexture.createView() },
        ],
    });
}
