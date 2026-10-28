/**
 * Every debug / test global the app hangs on `window`, typed in one place,
 * and the `window.__SV__` namespace that reads them.
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
 * This is the only file under `src/` that casts `window` (`readWindowProperty`).
 */
import { hasFlag } from '../config/flags';
import { getUnhandledErrors, type UnhandledErrorStats } from '../app/unhandledRejection';
import { mapsCanvasSource, type FrameSourceStats } from '../renderer/frameSource/mapsCanvasSource';
import { perfStore, type FrameRateStats } from '../renderer/perfStore';
import type {
    RendererBackendPreference,
    RendererEffectIsolation,
    WeatherPostProcessMode,
} from '../renderer/RendererBackend';
import type { AdapterCapabilitySummary } from '../renderer/deviceCapabilities';
import type { WebGpuProbeRecord } from '../renderer/webgpuBootProbe';
import type { GpuChoresBreadcrumbs } from '../renderer/gpuChores/gpuChoresStatsStore';
import type { GpuPassTimings } from '../renderer/gpuPassTimingStore';
import type { SceneDepthStats } from '../renderer/depth/sceneDepthStatsStore';
import type { CabinRendererProbe } from '../car/interior/cabinRendererProbe';
import type { CabinAudioProbe } from '../car/audio/cabinAudioProbe';
import type { RearViewFeed } from '../car/rearViewFeed';
import type { PlaceSearchBudgetStats } from '../search/placeSearchBudget';

/** `window.streetViewRendererDebug` — read-only always, mutators only with `?debug`. */
export interface RendererDebugHandle {
    getBackend: () => {
        rendererType?: 'webgpu' | 'webgl';
        usingWebGPU?: boolean;
        usingWebGL?: boolean;
        rendererFallbackReason?: string;
    };
    getDebugOptions: () => { effectIsolation: RendererEffectIsolation; wireframe: boolean };
    getWeatherMode: () => WeatherPostProcessMode;
    getGpuChores: () => GpuChoresBreadcrumbs | null;
    setBackend?: (backend: RendererBackendPreference) => void;
    setEffectIsolation?: (effect: RendererEffectIsolation) => void;
    setWireframe?: (enabled: boolean) => void;
    setWeatherMode?: (mode: WeatherPostProcessMode) => void;
}

interface PlaceSearchKillSwitch {
    kill: () => void;
    getStats: () => PlaceSearchBudgetStats;
}

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
    readonly streetView: Window['__STREETVIEW_PROBE__'];
    readonly renderer: RendererDebugHandle | undefined;
    readonly placeSearch: PlaceSearchKillSwitch | undefined;
    readonly rearViewFeed: RearViewFeed | undefined;
    /** The Maps canvas frame source: fingerprint samples, shared hits, structure events. */
    readonly frameSource: FrameSourceStats;
    readonly perf: FrameRateStats;
    /** Unhandled promise rejections / errors since boot (`app/unhandledRejection.ts`). */
    readonly errors: UnhandledErrorStats;
    /** True when the page was opened with `?debug` (mutators installed). */
    readonly debug: boolean;
}

declare global {
    interface Window {
        __SV__?: SvDebug;
        /** Boot probe — set on WebGPU success and hard-fail (Chrome vs Edge brand + reason). */
        webgpuProbe?: WebGpuProbeRecord;
        rendererAdapterInfo?: AdapterCapabilitySummary;
        rendererGpuTimings?: GpuPassTimings;
        /** Cabin overlay backend (PR 2 of #249). Set when car mode constructs a renderer. */
        __CABIN_RENDERER_PROBE__?: CabinRendererProbe;
        /** Cabin audio engine (#321): the WASM DSP in the AudioWorklet, or its fallback. */
        __CABIN_AUDIO_PROBE__?: CabinAudioProbe;
        __GPU_CHORES__?: GpuChoresBreadcrumbs;
        __SCENE_DEPTH__?: SceneDepthStats;
        __PLACE_SEARCH__?: PlaceSearchKillSwitch;
        __REARVIEW_FEED__?: RearViewFeed;
        streetViewRendererDebug?: RendererDebugHandle;
        /** Internal: the Maps over-quota console guard is installed (survives HMR). */
        __mapsOverQuotaGuard?: boolean;
        /** Safari's prefixed Web Audio constructor. */
        webkitAudioContext?: typeof AudioContext;
    }
}

/** True with `?debug` (any value): install the debug mutators. */
export function isDebugMode(): boolean {
    return hasFlag('debug');
}

/** A `window` property only known by name at runtime (a CDN SDK's global). */
export function readWindowProperty(name: string): unknown {
    return typeof window === 'undefined' ? undefined : (window as unknown as Record<string, unknown>)[name];
}

/** Set (or with `undefined`, delete) a `window` property by name — test mocks of SDK globals. */
export function writeWindowProperty(name: string, value: unknown): void {
    if (typeof window === 'undefined') return;
    const record = window as unknown as Record<string, unknown>;
    if (value === undefined) delete record[name];
    else record[name] = value;
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
        get streetView() { return window.__STREETVIEW_PROBE__; },
        get renderer() { return window.streetViewRendererDebug; },
        get placeSearch() { return window.__PLACE_SEARCH__; },
        get rearViewFeed() { return window.__REARVIEW_FEED__; },
        get frameSource() { return mapsCanvasSource.stats(); },
        get perf() { return perfStore.get(); },
        get errors() { return getUnhandledErrors(); },
        debug,
    };
    Object.defineProperty(window, '__SV__', { value: sv, configurable: true, enumerable: false });
}
