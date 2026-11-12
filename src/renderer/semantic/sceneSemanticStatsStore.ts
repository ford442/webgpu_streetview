/**
 * What the semantic layer is doing (#352), for the weather panel and
 * `window.__SCENE_SEMANTIC__` (Playwright / DevTools). Written only by
 * `SemanticController`; an external store, so a 5 Hz update re-renders only
 * subscribers.
 */
import { createStore, useStore } from '../../state';
import type { SemanticClassName } from './semanticClasses';

type SceneSemanticState =
    /** Not opted in, scene depth off, or the preset's weight is 0. */
    | 'off'
    | 'loading'
    | 'ready'
    | 'failed';

export interface SceneSemanticStats {
    state: SceneSemanticState;
    reason: string | null;
    downloadedBytes: number;
    downloadTotal: number;
    fromCache: boolean | null;
    createMs: number | null;
    /** Last semantic run (session + decode, in the Worker), ms. */
    inferenceMs: number | null;
    inferences: number;
    /** Failed semantic runs (the depth half of those inferences was kept). */
    failures: number;
    width: number;
    height: number;
    /** Share of the last map labelled each class. */
    histogram: Record<SemanticClassName, number> | null;
    meanConfidence: number | null;
    /** The photo's mean sky colour (0–1, the frame's encoding) under the last map; null without sky. */
    skyColor: [number, number, number] | null;
    /** Sky lower edge of the last map (map-space Y), null without enough sky. */
    skyEdgeY: number | null;
    /** Weight actually applied this frame (preset × confidence). */
    appliedBlend: number;
    generation: number;
}

const INITIAL: SceneSemanticStats = {
    state: 'off',
    reason: null,
    downloadedBytes: 0,
    downloadTotal: 0,
    fromCache: null,
    createMs: null,
    inferenceMs: null,
    inferences: 0,
    failures: 0,
    width: 0,
    height: 0,
    histogram: null,
    meanConfidence: null,
    skyColor: null,
    skyEdgeY: null,
    appliedBlend: 0,
    generation: 0,
};

const store = createStore<SceneSemanticStats>({ ...INITIAL });

function publishToWindow(): void {
    if (typeof window !== 'undefined') {
        window.__SCENE_SEMANTIC__ = store.get();
    }
}
store.subscribe(publishToWindow);

export function getSceneSemanticStats(): SceneSemanticStats {
    return store.get();
}

export function setSceneSemanticStats(patch: Partial<SceneSemanticStats>): void {
    store.set((current) => ({ ...current, ...patch }));
}

export function resetSceneSemanticStats(): void {
    store.set({ ...INITIAL });
    publishToWindow();
}

export function useSceneSemanticStats<T>(selector: (s: SceneSemanticStats) => T): T {
    return useStore(store, selector);
}

declare global {
    interface Window {
        __SCENE_SEMANTIC__?: SceneSemanticStats;
    }
}
