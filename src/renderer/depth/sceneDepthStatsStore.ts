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
    | 'failed';

export interface SceneDepthStats {
    state: SceneDepthState;
    /** Why it failed (also on `webgpuProbe.passes.depth`). */
    reason: string | null;
    variant: DepthModelVariant | null;
    /** The depth device has `shader-f16` (and so runs the f16 model). */
    shaderF16: boolean | null;
    adapter: string | null;
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
    downloadedBytes: 0,
    downloadTotal: 0,
    fromCache: null,
    createMs: null,
    inferenceMs: null,
    cadenceHz: 0,
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
