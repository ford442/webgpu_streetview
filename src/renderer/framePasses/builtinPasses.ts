/**
 * The shipped passes, as `FramePass` registrations. Each is a thin adapter over
 * the class that already owns the pass — the encode bodies are the ones
 * `frameLoop.encodeAndSubmitFrame` used to call inline, in the same order, so
 * a frame is byte-identical to the pre-registry one.
 *
 * | order | id | owner |
 * |---|---|---|
 * | 100 | `streetview` (required) | `streetViewPass.ts` / `TransitionManager` |
 * | 200 | `historical-wipe` | `HistoricalWipePass` |
 * | 300 | `weather` | `WeatherPostProcessor` / `ComputeWeatherPostProcessor` |
 * | 310 | `present-fallback` (lazy) | `PresentFallbackPostProcessor` — only when weather failed |
 * | 400 | `cabin-composite` | `CabinCompositePass` |
 */
import { createStreetViewPipeline, encodeStreetViewPass } from '../streetViewPass';
import { encodeCabinComposite } from '../frameLoop';
import type { TransitionManager } from '../TransitionManager';
import type { HistoricalWipePass } from '../HistoricalWipePass';
import type { CabinCompositePass } from '../cabinComposite';
import type { WeatherPostInitOptions, WeatherPostProcessorLike } from '../weatherPostProcessorTypes';
import type { FramePass } from './FramePassRegistry';

export const PASS_ORDER = {
    streetview: 100,
    historicalWipe: 200,
    weather: 300,
    presentFallback: 310,
    cabinComposite: 400,
} as const;

export interface StreetViewPassDeps {
    device: GPUDevice;
    intermediateFormat: GPUTextureFormat;
    onPipeline: (pipeline: GPURenderPipeline) => void;
    getPipeline: () => GPURenderPipeline | undefined;
    getTransitionManager: () => TransitionManager | undefined;
}

/** Pass 1: the transition manager's crossfade if one is running, else the plain panorama draw. */
export function createStreetViewFramePass(deps: StreetViewPassDeps): FramePass {
    return {
        id: 'streetview',
        order: PASS_ORDER.streetview,
        required: true,
        async init() {
            deps.onPipeline(await createStreetViewPipeline(deps.device, deps.intermediateFormat));
        },
        enabled: () => !!deps.getPipeline(),
        encode(encoder, { textures, timings }) {
            const pipeline = deps.getPipeline()!;
            const didTransition = deps.getTransitionManager()?.renderTransitionPass(
                encoder,
                textures.intermediateTextureView,
                textures.videoTexture!,
                pipeline,
                textures.bindGroup,
                timings.pass1,
            );
            if (!didTransition) {
                encodeStreetViewPass(
                    encoder,
                    textures.intermediateTextureView,
                    pipeline,
                    textures.bindGroup,
                    timings.pass1,
                );
            }
        },
        destroy() {},
    };
}

export interface HistoricalWipePassDeps {
    pass: HistoricalWipePass;
    intermediateFormat: GPUTextureFormat;
    /** This frame's wipe, or null — `Renderer` returns null while a hold is active. */
    resolve: () => { pass: HistoricalWipePass; before: GPUTexture | undefined } | null;
}

/** The year-chip wipe over pass 1, from the hold-pause snapshot. */
export function createHistoricalWipeFramePass(deps: HistoricalWipePassDeps): FramePass {
    return {
        id: 'historical-wipe',
        order: PASS_ORDER.historicalWipe,
        init: () => deps.pass.init(deps.intermediateFormat),
        enabled: () => deps.resolve() !== null,
        encode(encoder, { textures }) {
            const wipe = deps.resolve();
            wipe?.pass.encode(encoder, textures.intermediateTextureView, wipe.before);
        },
        destroy: () => deps.pass.dispose(),
    };
}

export interface WeatherPassDeps {
    id: 'weather' | 'present-fallback';
    processor: WeatherPostProcessorLike;
    presentationFormat: GPUTextureFormat;
    initOptions?: WeatherPostInitOptions;
    lazy?: boolean;
}

/**
 * Weather (or, when weather failed validation, the present fallback): reads the
 * intermediate pass 1 wrote and writes the swap chain. Shares the weather
 * timestamp slots — only one of the two ever encodes.
 */
export function createWeatherFramePass(deps: WeatherPassDeps): FramePass {
    return {
        id: deps.id,
        order: deps.id === 'weather' ? PASS_ORDER.weather : PASS_ORDER.presentFallback,
        lazy: deps.lazy,
        init: () => deps.processor.init(deps.presentationFormat, deps.initOptions),
        enabled: () => true,
        encode: (encoder, { timings }) => deps.processor.renderPass(encoder, timings.weather),
        destroy: () => deps.processor.dispose(),
    };
}

export interface CabinCompositePassDeps {
    pass: CabinCompositePass;
    presentationFormat: GPUTextureFormat;
    /** The pass with this frame's cabin source applied, or null when it is unavailable. */
    resolve: () => CabinCompositePass | null;
}

/** Car mode's cabin texture over the swap chain weather just wrote. */
export function createCabinCompositeFramePass(deps: CabinCompositePassDeps): FramePass {
    return {
        id: 'cabin-composite',
        order: PASS_ORDER.cabinComposite,
        init: () => deps.pass.init(deps.presentationFormat),
        enabled: () => deps.resolve() !== null,
        encode(encoder, { getSwapChainView }) {
            encodeCabinComposite(encoder, deps.resolve(), getSwapChainView);
        },
        destroy: () => deps.pass.dispose(),
    };
}
