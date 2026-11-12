/**
 * What the scene-depth pass is doing, for the performance overlay, the weather
 * panel's toggle and `window.__SCENE_DEPTH__` (Playwright / DevTools). Written
 * only by `DepthController`; an external store, so a 5 Hz stats update never
 * re-renders anything that is not subscribed to it.
 */
import { createStore, useStore } from '../../state/createStore';
import type { DepthModelVariant } from './depthModel';

type SceneDepthState =
    /** Off: not opted in, or the quality preset's weight is 0. */
    | 'off'
    /** Downloading the runtime / model, or building the session. */
    | 'loading'
    | 'ready'
    /** The Worker's device was lost: a new Worker loads after a capped backoff (#367). */
    | 'recovering'
    | 'failed';

export interface SceneDepthStats {
    state: SceneDepthState;
    /** Why it failed (also on `webgpuProbe.passes.depth`). */
    reason: string | null;
    variant: DepthModelVariant | null;
    /** The depth device has `shader-f16` (and so runs the f16 model). */
    shaderF16: boolean | null;
    adapter: string | null;
    /** The power preference the Worker's adapter was requested with (the road's policy, #367). */
    powerPreference: GPUPowerPreference | null;
    /** The Worker landed on a different physical adapter than the road, after its one retry. */
    adapterMismatch: boolean;
    /** Device losses recovered from without a toggle, this session. */
    recoveries: number;
    /** Attempt number of the recovery in progress (or the last one); 0 = never lost. */
    recoveryAttempt: number;
    /** Why the Worker's device was last lost. */
    lastLossReason: string | null;
    downloadedBytes: number;
    downloadTotal: number;
    /** The model came from the Cache API bucket this session — nothing downloaded. */
    fromCache: boolean | null;
    /** Session create time (graph optimisation + weight upload), ms. */
    createMs: number | null;
    /** Last inference, ms (preprocess + `session.run` + readback, in the Worker). */
    inferenceMs: number | null;
    /** Inferences per second over the last 5 s — 0 while the view is still. */
    cadenceHz: number;
    /**
     * An inference took over `DEPTH_SLOW_DEVICE_MS` (SwiftShader): only a new
     * pano re-infers from then on (`depthScheduler.ts`).
     */
    slowDevice: boolean;
    inferences: number;
    inputWidth: number;
    inputHeight: number;
    /** Weight actually applied this frame (preset × confidence). */
    appliedBlend: number;
    /** Bumped per depth map uploaded. */
    generation: number;
}

const INITIAL: SceneDepthStats = {
    state: 'off',
    reason: null,
    variant: null,
    shaderF16: null,
    adapter: null,
    powerPreference: null,
    adapterMismatch: false,
    recoveries: 0,
    recoveryAttempt: 0,
    lastLossReason: null,
    downloadedBytes: 0,
    downloadTotal: 0,
    fromCache: null,
    createMs: null,
    inferenceMs: null,
    cadenceHz: 0,
    slowDevice: false,
    inferences: 0,
    inputWidth: 0,
    inputHeight: 0,
    appliedBlend: 0,
    generation: 0,
};

const store = createStore<SceneDepthStats>({ ...INITIAL });

function publishToWindow(): void {
    if (typeof window !== 'undefined') {
        window.__SCENE_DEPTH__ = store.get();
    }
}
store.subscribe(publishToWindow);

export function getSceneDepthStats(): SceneDepthStats {
    return store.get();
}

export function setSceneDepthStats(patch: Partial<SceneDepthStats>): void {
    store.set((current) => ({ ...current, ...patch }));
}

export function resetSceneDepthStats(): void {
    store.set({ ...INITIAL });
    publishToWindow();
}

export function useSceneDepthStats<T>(selector: (s: SceneDepthStats) => T): T {
    return useStore(store, selector);
}

/** The live controller's device-loss trigger (#367); null while no depth pass exists. */
let loseDeviceHook: (() => boolean) | null = null;

/** `DepthController` registers its trigger here (the newest controller wins). */
export function setSceneDepthLoseDeviceHook(hook: () => boolean): void {
    loseDeviceHook = hook;
}

/** On dispose: clear the trigger, unless a newer controller has already replaced it. */
export function clearSceneDepthLoseDeviceHook(hook: () => boolean): void {
    if (loseDeviceHook === hook) loseDeviceHook = null;
}

/**
 * `?debug` → `__SV__.renderer.loseDepthDevice()`: destroy the depth Worker's
 * device so the recovery path can be watched. False when depth is not ready.
 */
export function debugLoseSceneDepthDevice(): boolean {
    return loseDeviceHook?.() ?? false;
}
