import type { GpuPassTimer } from './gpuPassTimer';
import type { TextureLifecycle } from './textureLifecycle';
import type { WeatherPassTimingContext } from './weatherPostProcessorTypes';
import type { WeatherPostProcessMode } from './RendererBackend';
import type { Pass1TimingContext } from './streetViewPass';
import type { CabinCompositePass } from './cabinComposite';
import type { FrameContext, FramePassRegistry } from './framePasses/FramePassRegistry';
import type { FramePassId } from './passStatus';

export interface FramePassTimings {
    pass1?: Pass1TimingContext;
    weather?: WeatherPassTimingContext;
}

/**
 * Timestamp-query slots per pass id, fixed so the timing store can label the
 * spans it reads back. `present-fallback` stands in for weather and shares its
 * span; the blit span exists on the compute weather path only (the fragment
 * path writes the swap chain directly).
 */
export const TIMESTAMP_SLOTS: Partial<Record<FramePassId, readonly [number, number]>> = {
    streetview: [0, 1],
    weather: [2, 3],
    'present-fallback': [2, 3],
};
/** The compute weather path's blit-to-swap-chain span. */
export const COMPUTE_BLIT_TIMESTAMP_SLOTS = [4, 5] as const;

export function buildFramePassTimings(
    timer: GpuPassTimer | null,
    weatherPostProcessMode: WeatherPostProcessMode,
): FramePassTimings {
    if (!timer) return {};
    const isCompute = weatherPostProcessMode === 'compute';
    const [pass1Start, pass1End] = TIMESTAMP_SLOTS.streetview!;
    const [weatherStart, weatherEnd] = TIMESTAMP_SLOTS.weather!;
    return {
        pass1: { timer, startIndex: pass1Start, endIndex: pass1End },
        weather: {
            timer,
            weatherStartIndex: weatherStart,
            weatherEndIndex: weatherEnd,
            blitStartIndex: isCompute ? COMPUTE_BLIT_TIMESTAMP_SLOTS[0] : undefined,
            blitEndIndex: isCompute ? COMPUTE_BLIT_TIMESTAMP_SLOTS[1] : undefined,
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

export const FRAME_UNIFORM_FLOAT_COUNT = 8;

/**
 * Pack the pass-1 uniform buffer. 8 floats; must match `streetview.wgsl`.
 * Pass `out` to reuse one array across frames — `writeBuffer` copies it.
 */
export function packFrameUniforms(
    input: FrameUniformInput,
    out: Float32Array<ArrayBuffer> = new Float32Array(FRAME_UNIFORM_FLOAT_COUNT),
): Float32Array<ArrayBuffer> {
    out[0] = input.time;
    out[1] = input.zoom;
    out[2] = input.panX;
    out[3] = input.panY;
    out[4] = input.inlineTransitionProgress;
    out[5] = input.holdActive ? 1.0 : 0.0;
    out[6] = input.capturePan.x;
    out[7] = input.capturePan.y;
    return out;
}

export interface EncodeFrameOptions {
    device: GPUDevice;
    canvas: HTMLCanvasElement;
    textures: TextureLifecycle;
    uniformBuffer: GPUBuffer;
    uniforms: Float32Array<ArrayBuffer>;
    /** The frame's passes; only ready + enabled ones are encoded. */
    passes: FramePassRegistry;
    /** Per-frame context handed to every pass (`textures` and `timings` are filled in here). */
    frame: Omit<FrameContext, 'textures' | 'timings'>;
    /** Null unless the performance overlay wants timings this frame. */
    gpuPassTimer: GpuPassTimer | null;
    timings: FramePassTimings;
}

/**
 * The per-frame encode: **uniforms → registered passes in order → timestamp
 * resolve → submit**, on one encoder.
 *
 * The pass order lives in the registry (`framePasses/builtinPasses.ts`):
 * pass 1 → year-chip wipe → weather (or the present fallback) → cabin
 * composite. Weather reads the intermediate pass 1 just wrote; the cabin
 * composite loads the swap chain weather stored, which is what makes cinema and
 * snapshots one frame. The timestamp resolve must be the last thing encoded,
 * after every span it measures has been closed.
 *
 * Callers are responsible for the hold-pause guard — this function encodes
 * whatever texture state it is handed and never touches the live Maps canvas.
 */
export function encodeAndSubmitFrame(options: EncodeFrameOptions): FramePassId[] {
    const {
        device,
        canvas,
        textures,
        uniformBuffer,
        uniforms,
        passes,
        frame,
        gpuPassTimer,
        timings,
    } = options;

    device.queue.writeBuffer(uniformBuffer, 0, uniforms);
    textures.ensureIntermediateTexture(canvas.width, canvas.height);

    const commandEncoder = device.createCommandEncoder({ label: 'streetview-frame' });
    const encoded = passes.encode(commandEncoder, { ...frame, textures, timings });

    if (gpuPassTimer) {
        gpuPassTimer.resolveAndScheduleRead(commandEncoder);
    }

    device.queue.submit([commandEncoder.finish()]);
    return encoded;
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
