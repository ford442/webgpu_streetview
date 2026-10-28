/**
 * Scene depth opt-in (#320). Off by default: switching it on downloads the
 * depth runtime + model once (~25 MB), so it is the user's call — the weather
 * panel's toggle writes it, `?depth=on|off` overrides it for the session.
 *
 * Per-frame readers (`WebGPUCanvas`) call `sceneDepthStore.get()`; the panel
 * subscribes with `useSceneDepthOptIn`. What the pass is actually doing
 * (loading, ready, failed, timings) lives in
 * `renderer/depth/sceneDepthStatsStore.ts`.
 */
import { createStore, useStore } from './createStore';
import { readFlag } from '../config/flags';

export interface SceneDepthOptIn {
    readonly enabled: boolean;
    /** `?depth` set it this session — the toggle still works, but is not what boot used. */
    readonly fromUrl: boolean;
}

const STORAGE_KEY = 'streetview.sceneDepth';

function readInitial(): SceneDepthOptIn {
    const fromUrl = readFlag('depth');
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
const store = createStore<SceneDepthOptIn | null>(null);

export const sceneDepthStore = {
    get(): SceneDepthOptIn {
        const current = store.get();
        if (current) return current;
        const initial = readInitial();
        store.set(initial);
        return initial;
    },
    subscribe: store.subscribe,
    /** The panel toggle: persists (best effort) and applies from the next frame. */
    setEnabled(enabled: boolean): void {
        const current = sceneDepthStore.get();
        try {
            if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0');
        } catch {
            /* private mode: session-only */
        }
        if (current.enabled === enabled) return;
        store.set({ ...current, enabled });
    },
    /** Test-only. */
    resetForTests(next?: SceneDepthOptIn): void {
        store.set(next ?? null);
    },
};

export function useSceneDepthOptIn<T>(selector: (s: SceneDepthOptIn) => T): T {
    return useStore(sceneDepthStore, selector);
}
