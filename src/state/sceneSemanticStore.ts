/**
 * Semantic scene layer opt-in (#352). Off by default: switching it on
 * downloads the segmentation model once (~12 MB) on top of scene depth, whose
 * pipeline it shares — so it only runs while scene depth is on too. The
 * weather panel's toggle writes it; `?semantic=on|off` overrides it for the
 * session.
 *
 * Per-frame readers (`frameDriver`) call `sceneSemanticStore.get()`; the panel
 * subscribes with `useSceneSemanticOptIn`. What the layer is doing lives in
 * `renderer/semantic/sceneSemanticStatsStore.ts`.
 */
import { createStore, useStore } from './createStore';
import { readFlag } from '../config/flags';

export interface SceneSemanticOptIn {
    readonly enabled: boolean;
    /** `?semantic` set it this session. */
    readonly fromUrl: boolean;
}

const STORAGE_KEY = 'streetview.sceneSemantic';

function readInitial(): SceneSemanticOptIn {
    const fromUrl = readFlag('semantic');
    if (fromUrl !== undefined) return { enabled: fromUrl, fromUrl: true };
    try {
        return {
            enabled: typeof localStorage !== 'undefined' && localStorage.getItem(STORAGE_KEY) === '1',
            fromUrl: false,
        };
    } catch {
        return { enabled: false, fromUrl: false };
    }
}

/** null until first read: the URL / storage are read lazily, not at import. */
const store = createStore<SceneSemanticOptIn | null>(null);

export const sceneSemanticStore = {
    get(): SceneSemanticOptIn {
        const current = store.get();
        if (current) return current;
        const initial = readInitial();
        store.set(initial);
        return initial;
    },
    subscribe: store.subscribe,
    /** The panel toggle: persists (best effort) and applies from the next frame. */
    setEnabled(enabled: boolean): void {
        const current = sceneSemanticStore.get();
        try {
            if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0');
        } catch {
            /* private mode: session-only */
        }
        if (current.enabled === enabled) return;
        store.set({ ...current, enabled });
    },
    /** Test-only. */
    resetForTests(next?: SceneSemanticOptIn): void {
        store.set(next ?? null);
    },
};

export function useSceneSemanticOptIn<T>(selector: (s: SceneSemanticOptIn) => T): T {
    return useStore(sceneSemanticStore, selector);
}
