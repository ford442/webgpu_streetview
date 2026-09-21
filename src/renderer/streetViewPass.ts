import type { GpuPassTimer } from './gpuPassTimer';

/** Timestamp-query slots for pass 1, when the adapter supports them. */
export interface Pass1TimingContext {
    timer: GpuPassTimer;
    startIndex: number;
    endIndex: number;
}

/**
 * Pass 1 — the equirect panorama draw that turns the uploaded Maps frame into
 * the HDR intermediate the weather post-process reads.
 *
 * The bind group layout here is the contract `public/shaders/streetview.wgsl`
 * is written against: 0 sampler, 1 current frame, 2 uniforms, 3 previous frame
 * (transitions / hold-pause). Changing either side without the other produces
 * a pipeline-create failure at boot, not a visual glitch.
 */
export function createStreetViewBindGroupLayout(device: GPUDevice): GPUBindGroupLayout {
    return device.createBindGroupLayout({
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
}

/**
 * Fetch `streetview.wgsl` and build the pass-1 render pipeline.
 *
 * The shader is fetched rather than bundled so a WGSL edit is a static-asset
 * swap; a failed fetch is fatal and rejects, because there is no fallback draw.
 */
export async function createStreetViewPipeline(
    device: GPUDevice,
    intermediateFormat: GPUTextureFormat,
): Promise<GPURenderPipeline> {
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

    const shaderModule = device.createShaderModule({ code: shaderCode });
    const pipelineLayout = device.createPipelineLayout({
        bindGroupLayouts: [createStreetViewBindGroupLayout(device)],
    });

    return device.createRenderPipeline({
        layout: pipelineLayout,
        vertex: {
            module: shaderModule,
            entryPoint: 'vs_main',
        },
        fragment: {
            module: shaderModule,
            entryPoint: 'fs_main',
            targets: [{ format: intermediateFormat }],
        },
        primitive: { topology: 'triangle-strip' },
    });
}

/** Sampler used for every panorama read. Anisotropy follows the quality tier. */
export function buildSamplerDescriptor(maxAnisotropy: number): GPUSamplerDescriptor {
    return {
        magFilter: 'linear',
        minFilter: 'linear',
        mipmapFilter: 'linear',
        addressModeU: 'clamp-to-edge',
        addressModeV: 'clamp-to-edge',
        addressModeW: 'clamp-to-edge',
        maxAnisotropy,
    };
}

/**
 * Encode the plain pass-1 draw into `commandEncoder`.
 *
 * Only reached when the transition manager declined the frame — a transition
 * owns its own pass so it can sample both the current and previous textures.
 */
export function encodeStreetViewPass(
    commandEncoder: GPUCommandEncoder,
    targetView: GPUTextureView,
    pipeline: GPURenderPipeline,
    bindGroup: GPUBindGroup,
    timing?: Pass1TimingContext,
): void {
    const mainPass = commandEncoder.beginRenderPass({
        colorAttachments: [{
            view: targetView,
            clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
            loadOp: 'clear' as GPULoadOp,
            storeOp: 'store' as GPUStoreOp,
        }],
    });
    if (timing) {
        timing.timer.markPassStart(mainPass, timing.startIndex);
    }
    mainPass.setPipeline(pipeline);
    mainPass.setBindGroup(0, bindGroup);
    mainPass.draw(4, 1, 0, 0);
    if (timing) {
        timing.timer.markPassEnd(mainPass, timing.endIndex);
    }
    mainPass.end();
}
