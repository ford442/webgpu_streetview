/**
 * The `window.__SV__` namespace over every debug / test global the app hangs on `window`.
 * Each global is declared (typed) by the module that publishes it; this file only reads them,
 * so it sits above the engine and car layers and nothing below imports it (#368).
 *
 * `__SV__` is the surface to use: a Playwright helper or the nightly probe
 * reads `window.__SV__.probe`, `.cabin`, `.frameSource`, `.errors`, … The old
 * top-level names (`webgpuProbe`, `__CABIN_RENDERER_PROBE__`, `__GPU_CHORES__`,
 * …) are still where the publishers write — and so still readable — for one
 * release, for the e2e specs and `scripts/hold-pause-probe.mjs`; `__SV__`'s
 * getters read through to them.
 *
 * Mutators that change what renders or reload the page (`setBackend`,
 * `setWeatherMode`, `setEffectIsolation`, `setWireframe`) are installed only
 * with `?debug`. The billing kill switches (`__PLACE_SEARCH__.kill`,
 * `__REARVIEW_FEED__.kill`) stay unconditional — they only ever stop spend,
 * and `BILLING_SAFETY_CHECKLIST.md` documents them as always available.
 *
 */
import { isDebugMode } from '../debug/windowAccess';
import { getUnhandledErrors, type UnhandledErrorStats } from '../debug/unhandledRejection';
import { mapsCanvasSource, type FrameSourceStats, perfStore, type FrameRateStats } from '../renderer';
import type { RendererDebugHandle, AdapterCapabilitySummary, WebGpuProbeRecord, GpuChoresBreadcrumbs, GpuPassTimings, SceneDepthStats, SceneSemanticStats } from '../renderer';
import type { CabinRendererProbe } from '../debug/probeTypes';
import type { CabinAudioProbe } from '../car/eager';
import type { RearViewFeed } from '../car';
import type { PlaceSearchKillSwitch } from '../search/placeSearchBudget';
import { getRuntimeContexts, type RuntimeContexts } from '../runtime/contexts';

/**
 * The typed namespace. Every field is a live getter.
 * @public — the type Playwright helpers and the nightly probe read `__SV__` as.
 */
export interface SvDebug {
    readonly probe: WebGpuProbeRecord | undefined;
    readonly adapter: AdapterCapabilitySummary | undefined;
    readonly cabin: CabinRendererProbe | undefined;
    readonly cabinAudio: CabinAudioProbe | undefined;
    readonly gpuChores: GpuChoresBreadcrumbs | undefined;
    readonly gpuTimings: GpuPassTimings | undefined;
    readonly sceneDepth: SceneDepthStats | undefined;
    /** Semantic scene layer (#352): state, timings, class histogram. */
    readonly sceneSemantic: SceneSemanticStats | undefined;
    readonly streetView: Window['__STREETVIEW_PROBE__'];
    readonly renderer: RendererDebugHandle | undefined;
    readonly placeSearch: PlaceSearchKillSwitch | undefined;
    readonly rearViewFeed: RearViewFeed | undefined;
    /** The Maps canvas frame source: fingerprint samples, shared hits, structure events. */
    readonly frameSource: FrameSourceStats;
    readonly perf: FrameRateStats;
    /** Unhandled promise rejections / errors since boot (`app/unhandledRejection.ts`). */
    readonly errors: UnhandledErrorStats;
    /** The capability manifest (#361): GPU, display, audio, isolation, storage, power. */
    readonly contexts: Readonly<RuntimeContexts>;
    /** True when the page was opened with `?debug` (mutators installed). */
    readonly debug: boolean;
}

declare global {
    interface Window {
        __SV__?: SvDebug;
    }
}

/** Define `window.__SV__` once. Idempotent; a no-op outside a browser. */
export function installSvGlobals(): void {
    if (typeof window === 'undefined' || window.__SV__) return;
    const debug = isDebugMode();
    const sv: SvDebug = {
        get probe() { return window.webgpuProbe; },
        get adapter() { return window.rendererAdapterInfo; },
        get cabin() { return window.__CABIN_RENDERER_PROBE__ ?? window.webgpuProbe?.cabin; },
        get cabinAudio() { return window.__CABIN_AUDIO_PROBE__; },
        get gpuChores() { return window.__GPU_CHORES__; },
        get gpuTimings() { return window.rendererGpuTimings; },
        get sceneDepth() { return window.__SCENE_DEPTH__; },
        get sceneSemantic() { return window.__SCENE_SEMANTIC__; },
        get streetView() { return window.__STREETVIEW_PROBE__; },
        get renderer() { return window.streetViewRendererDebug; },
        get placeSearch() { return window.__PLACE_SEARCH__; },
        get rearViewFeed() { return window.__REARVIEW_FEED__; },
        get frameSource() { return mapsCanvasSource.stats(); },
        get perf() { return perfStore.get(); },
        get errors() { return getUnhandledErrors(); },
        get contexts() { return getRuntimeContexts(); },
        debug,
    };
    Object.defineProperty(window, '__SV__', { value: sv, configurable: true, enumerable: false });
}
