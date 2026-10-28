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
 * | 350 | `upscale` (lazy) | `upscale/UpscalePass` — only below render scale 1 |
 * | 380 | `reproject` (lazy, tail) | `reproject/ReprojectPass` — late latch / stereo (#331) |
 * | 400 | `cabin-composite` (last) | `CabinCompositePass` |
 */
import { createStreetViewPipeline, encodeStreetViewPass } from '../streetViewPass';
import { resolveSceneDepthBindGroup } from '../depth/sceneDepthBinding';
import { encodeCabinComposite } from '../frameLoop';
import type { TransitionManager } from '../TransitionManager';
import type { HistoricalWipePass } from '../HistoricalWipePass';
import type { CabinCompositePass } from '../cabinComposite';
import type { UpscalePass } from '../upscale/UpscalePass';
import type { ReprojectPass } from '../reproject/ReprojectPass';
import type { WeatherPostInitOptions, WeatherPostProcessorLike } from '../weatherPostProcessorTypes';
import type { FramePass } from './FramePassRegistry';

const PASS_ORDER = {
    streetview: 100,
    historicalWipe: 200,
    weather: 300,
    presentFallback: 310,
    upscale: 350,
    reproject: 380,
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
        encode(encoder, { textures, timings, aux }) {
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
                    resolveSceneDepthBindGroup(deps.device, aux),
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
 * intermediate pass 1 wrote and writes the swap chain — or, below render scale
 * 1, the upscale pass's road target. Shares the weather timestamp slots — only
 * one of the two ever encodes.
 */
export function createWeatherFramePass(deps: WeatherPassDeps): FramePass {
    return {
        id: deps.id,
        order: deps.id === 'weather' ? PASS_ORDER.weather : PASS_ORDER.presentFallback,
        lazy: deps.lazy,
        init: () => deps.processor.init(deps.presentationFormat, deps.initOptions),
        enabled: () => true,
        encode(encoder, { timings, aux, roadTarget }) {
            // Kept on the processor too: `renderWeatherOnly` frames encode
            // outside the registry and bind whatever depth was last current.
            deps.processor.setSceneDepth(aux.depth ?? null);
            deps.processor.renderPass(encoder, timings.weather, roadTarget);
        },
        destroy: () => deps.processor.dispose(),
    };
}

export interface UpscalePassDeps {
    pass: UpscalePass;
    presentationFormat: GPUTextureFormat;
    /** RCAS's limiter ceiling: 1 on SDR, the extended tone-mapping headroom on `?hdr`. */
    peak: number;
}

/**
 * The scaled road frame → the swap chain (#329). Lazy — `Renderer` builds it
 * the first time a scale below 1 is requested — and enabled only below scale
 * 1, so at scale 1 a frame encodes exactly the pre-#329 passes.
 */
export function createUpscaleFramePass(deps: UpscalePassDeps): FramePass {
    return {
        id: 'upscale',
        order: PASS_ORDER.upscale,
        lazy: true,
        init: () => deps.pass.init(deps.presentationFormat, { peak: deps.peak }),
        enabled: ({ renderScale }) => renderScale.scale < 1,
        encode(encoder, { getSwapChainView, presentTarget, renderScale, timings }) {
            const view = presentTarget ?? getSwapChainView();
            if (!view) return;
            deps.pass.encode(encoder, view, renderScale.outputWidth, renderScale.outputHeight, timings.upscale);
        },
        destroy: () => deps.pass.dispose(),
    };
}

export interface ReprojectPassDeps {
    pass: ReprojectPass;
    presentationFormat: GPUTextureFormat;
    device: GPUDevice;
}

/**
 * The split frame's tail (#331): the present source → the swap chain, re-aimed
 * at the POV read at tail time and, in stereo, as two eyes. Lazy — built the
 * first time a tail is wanted — and encoded only in the tail. `Renderer`
 * writes slot 0's uniforms before it encodes the tail.
 */
export function createReprojectFramePass(deps: ReprojectPassDeps): FramePass {
    return {
        id: 'reproject',
        order: PASS_ORDER.reproject,
        lazy: true,
        phase: 'tail',
        init: () => deps.pass.init(deps.presentationFormat),
        enabled: () => true,
        encode(encoder, { getSwapChainView, aux }) {
            const view = getSwapChainView();
            if (!view) return;
            deps.pass.encode(encoder, view, resolveSceneDepthBindGroup(deps.device, aux));
        },
        destroy: () => deps.pass.dispose(),
    };
}

export interface CabinCompositePassDeps {
    pass: CabinCompositePass;
    presentationFormat: GPUTextureFormat;
    /** The pass with this frame's cabin source applied, or null when it is unavailable. */
    resolve: () => CabinCompositePass | null;
    /**
     * True when the frame presents two eyes side by side (`?stereo=sbs`). A
     * stereo cabin (`cabinStereoRequest`) maps 1:1; a mono one — the WebGL
     * hatch, or the frame before the cabin picked the request up — is drawn
     * into each half, at zero parallax, where the convergence plane sits
     * (`reprojectMath.DEFAULT_CONVERGENCE_METRES`, about the dash).
     */
    sideBySide?: () => boolean;
}

/**
 * Car mode's cabin texture over whatever presents: the swap chain weather just
 * wrote, or — in a split frame — the one the reproject tail just wrote, so the
 * cabin rendered after the road (same display frame) is the one shown.
 */
export function createCabinCompositeFramePass(deps: CabinCompositePassDeps): FramePass {
    return {
        id: 'cabin-composite',
        order: PASS_ORDER.cabinComposite,
        phase: 'last',
        init: () => deps.pass.init(deps.presentationFormat),
        enabled: () => deps.resolve() !== null,
        encode(encoder, { getSwapChainView, renderScale }) {
            const pass = deps.resolve();
            // A stereo cabin is already side by side, like the road: 1:1.
            if (!deps.sideBySide?.() || pass?.getLayout() === 'sbs') {
                encodeCabinComposite(encoder, pass, getSwapChainView);
                return;
            }
            const half = renderScale.outputWidth / 2;
            const height = renderScale.outputHeight;
            for (const x of [0, half]) {
                encodeCabinComposite(encoder, pass, getSwapChainView, { x, y: 0, width: half, height });
            }
        },
        destroy: () => deps.pass.dispose(),
    };
}
