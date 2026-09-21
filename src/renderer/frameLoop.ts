import type { GpuPassTimer } from './gpuPassTimer';
import type { TransitionManager } from './TransitionManager';
import type { TextureLifecycle } from './textureLifecycle';
import type { WeatherPostProcessorLike, WeatherPassTimingContext } from './weatherPostProcessorTypes';
import type { WeatherPostProcessMode } from './RendererBackend';
import { encodeStreetViewPass, type Pass1TimingContext } from './streetViewPass';
import type { CabinCompositePass } from './cabinComposite';

export interface FramePassTimings {
    pass1?: Pass1TimingContext;
    weather?: WeatherPassTimingContext;
}

/**
 * Timestamp-query slot assignment, fixed so the timing store can label the
 * spans it reads back: 0/1 pass 1, 2/3 weather, 4/5 the compute blit (compute
 * mode only — the fragment path writes the swap chain directly).
 */
export function buildFramePassTimings(
    timer: GpuPassTimer | null,
    weatherPostProcessMode: WeatherPostProcessMode,
): FramePassTimings {
    if (!timer) return {};
    const isCompute = weatherPostProcessMode === 'compute';
    return {
        pass1: { timer, startIndex: 0, endIndex: 1 },
        weather: {
            timer,
            weatherStartIndex: 2,
            weatherEndIndex: 3,
            blitStartIndex: isCompute ? 4 : undefined,
            blitEndIndex: isCompute ? 5 : undefined,
        },
    };
}

export interface FrameUniformInput {
    /** Seconds since renderer start — drives shader-side animation. */
    time: number;
    zoom: number;
    /** Normalized pan, derived from heading/pitch. */
    panX: number;
    panY: number;
    inlineTransitionProgress: number;
    holdActive: boolean;
    capturePan: { x: number; y: number };
}

/** Pack the pass-1 uniform buffer. 8 floats; must match `streetview.wgsl`. */
export function packFrameUniforms(input: FrameUniformInput): Float32Array {
    return new Float32Array([
        input.time,
        input.zoom,
        input.panX,
        input.panY,
        input.inlineTransitionProgress,
        input.holdActive ? 1.0 : 0.0,
        input.capturePan.x,
        input.capturePan.y,
    ]);
}

export interface EncodeFrameOptions {
    device: GPUDevice;
    canvas: HTMLCanvasElement;
    textures: TextureLifecycle;
    pipeline: GPURenderPipeline;
    uniformBuffer: GPUBuffer;
    uniforms: Float32Array;
    transitionManager: TransitionManager | undefined;
    weatherPostProcessor: WeatherPostProcessorLike | undefined;
    /**
     * Car mode's cabin, as a texture on this same device. Encoded last, over
     * the swap chain the weather pass just wrote. Undefined / inactive in
     * free-look and on the `?cabin=webgl` hatch, where the pass is skipped and
     * the frame is byte-identical to the pre-compositor one.
     */
    cabinComposite?: CabinCompositePass | null;
    /** The swap-chain view for this frame, so the composite loads what weather stored. */
    getSwapChainView?: () => GPUTextureView | null;
    gpuPassTimer: GpuPassTimer | null;
    timings: FramePassTimings;
}

/**
 * The per-frame encode order, in one place: **pass 1 → weather → timestamp
 * resolve → submit**.
 *
 * Pass 1 is either the transition manager's own crossfade pass or the plain
 * panorama draw; weather always reads the HDR intermediate pass 1 just wrote,
 * so the two can never be reordered. In car mode the cabin composite follows
 * weather on the same swap-chain view (`loadOp: 'load'`), which is what makes
 * cinema and snapshots one frame. The timestamp resolve must be the last thing
 * encoded, after every span it measures has been closed.
 *
 * Callers are responsible for the hold-pause guard — this function encodes
 * whatever texture state it is handed and never touches the live Maps canvas.
 */
export function encodeAndSubmitFrame(options: EncodeFrameOptions): void {
    const {
        device,
        canvas,
        textures,
        pipeline,
        uniformBuffer,
        uniforms,
        transitionManager,
        weatherPostProcessor,
        cabinComposite,
        getSwapChainView,
        gpuPassTimer,
        timings,
    } = options;

    device.queue.writeBuffer(uniformBuffer, 0, uniforms);
    textures.ensureIntermediateTexture(canvas.width, canvas.height);

    const commandEncoder = device.createCommandEncoder();

    const didTransition = transitionManager?.renderTransitionPass(
        commandEncoder,
        textures.intermediateTextureView,
        textures.videoTexture!,
        pipeline,
        textures.bindGroup,
        timings.pass1,
    );

    if (!didTransition) {
        encodeStreetViewPass(
            commandEncoder,
            textures.intermediateTextureView,
            pipeline,
            textures.bindGroup,
            timings.pass1,
        );
    }

    weatherPostProcessor?.renderPass(commandEncoder, timings.weather);

    encodeCabinComposite(commandEncoder, cabinComposite, getSwapChainView);

    if (gpuPassTimer) {
        gpuPassTimer.resolveAndScheduleRead(commandEncoder);
    }

    device.queue.submit([commandEncoder.finish()]);
}

/**
 * Draw the cabin over the road frame, if car mode published one. Split out so
 * both encode paths (`encodeAndSubmitFrame` and the weather-only encoder in the
 * post-processors' `renderWeatherOnly`) go through the same guard.
 *
 * A failure here must never take the road frame down — the composite is the
 * overlay, and dropping it degrades to the pre-compositor look for one frame.
 */
export function encodeCabinComposite(
    commandEncoder: GPUCommandEncoder,
    cabinComposite: CabinCompositePass | null | undefined,
    getSwapChainView: (() => GPUTextureView | null) | undefined,
): boolean {
    if (!cabinComposite || !getSwapChainView || !cabinComposite.isReady()) return false;
    try {
        const view = getSwapChainView();
        if (!view) return false;
        return cabinComposite.encode(commandEncoder, view);
    } catch (e) {
        console.warn('[frameLoop] cabin composite pass skipped this frame:', e);
        return false;
    }
}
