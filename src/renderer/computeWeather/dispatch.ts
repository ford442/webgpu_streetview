import type { WeatherPassTimingContext } from '../weatherPostProcessorTypes';
import { WORKGROUP_SIZE } from './constants';

/**
 * Command recording for the compute weather pass. Pure with respect to GPU
 * state: everything these take is resolved by the caller, so ordering is
 * visible in one place rather than spread across the owning class.
 */

export interface WeatherPassArgs {
    pipeline: GPUComputePipeline;
    bindGroup: GPUBindGroup;
    lutBindGroup: GPUBindGroup | null;
    width: number;
    height: number;
    timing?: WeatherPassTimingContext | undefined;
}

/** The main weather compute dispatch, over a WORKGROUP_SIZE² grid. */
export function recordWeatherPass(
    commandEncoder: GPUCommandEncoder,
    { pipeline, bindGroup, lutBindGroup, width, height, timing }: WeatherPassArgs,
): void {
    const computePass = commandEncoder.beginComputePass();
    if (timing) {
        timing.timer.markPassStart(computePass, timing.weatherStartIndex);
    }
    computePass.setPipeline(pipeline);
    computePass.setBindGroup(0, bindGroup);
    if (lutBindGroup) computePass.setBindGroup(1, lutBindGroup);
    computePass.dispatchWorkgroups(
        Math.ceil(width / WORKGROUP_SIZE),
        Math.ceil(height / WORKGROUP_SIZE),
    );
    if (timing) {
        timing.timer.markPassEnd(computePass, timing.weatherEndIndex);
    }
    computePass.end();
}

export interface BlitPassArgs {
    pipeline: GPURenderPipeline;
    bindGroup: GPUBindGroup;
    targetView: GPUTextureView;
    timing?: WeatherPassTimingContext | undefined;
}

/** Fullscreen-triangle blit of the storage texture onto the swap chain. */
export function recordBlitPass(
    commandEncoder: GPUCommandEncoder,
    { pipeline, bindGroup, targetView, timing }: BlitPassArgs,
): void {
    const blitPass = commandEncoder.beginRenderPass({
        colorAttachments: [{
            view: targetView,
            clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
            loadOp: 'clear' as GPULoadOp,
            storeOp: 'store' as GPUStoreOp,
        }],
    });
    const timed = timing?.blitStartIndex !== undefined && timing.blitEndIndex !== undefined;
    if (timed) {
        timing!.timer.markPassStart(blitPass, timing!.blitStartIndex!);
    }
    blitPass.setPipeline(pipeline);
    blitPass.setBindGroup(0, bindGroup);
    blitPass.draw(3, 1, 0, 0);
    if (timed) {
        timing!.timer.markPassEnd(blitPass, timing!.blitEndIndex!);
    }
    blitPass.end();
}

/**
 * Copy this frame's output into the colour-history texture for the next
 * frame's temporal pass. No-op unless history is on and a real target exists.
 *
 * @returns true when a copy was recorded — the caller uses this to mark
 *          history primed and rebuild the bind group.
 */
export function recordColorHistoryCopy(
    commandEncoder: GPUCommandEncoder,
    args: {
        enabled: boolean;
        writeTexture: GPUTexture | null;
        colorHistoryTexture: GPUTexture | null;
        width: number;
        height: number;
    },
): boolean {
    if (
        !args.enabled
        || !args.writeTexture
        || !args.colorHistoryTexture
        || args.width < 1
        || args.height < 1
    ) {
        return false;
    }
    commandEncoder.copyTextureToTexture(
        { texture: args.writeTexture },
        { texture: args.colorHistoryTexture },
        [args.width, args.height],
    );
    return true;
}

/** Clear the intermediate before a weather-only (no panorama upload) frame. */
export function recordIntermediateClear(
    commandEncoder: GPUCommandEncoder,
    intermediateTextureView: GPUTextureView,
): void {
    const clearPass = commandEncoder.beginRenderPass({
        colorAttachments: [{
            view: intermediateTextureView,
            clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
            loadOp: 'clear' as GPULoadOp,
            storeOp: 'store' as GPUStoreOp,
        }],
    });
    clearPass.end();
}
