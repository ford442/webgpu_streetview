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
import { useSyncExternalStore } from 'react';
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

let state: SceneDepthOptIn | null = null;
const listeners = new Set<() => void>();

export const sceneDepthStore = {
    get(): SceneDepthOptIn {
        if (!state) state = readInitial();
        return state;
    },
    subscribe(listener: () => void): () => void {
        listeners.add(listener);
        return () => {
            listeners.delete(listener);
        };
    },
    /** The panel toggle: persists (best effort) and applies from the next frame. */
    setEnabled(enabled: boolean): void {
        const current = sceneDepthStore.get();
        try {
            if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0');
        } catch {
            /* private mode: session-only */
        }
        if (current.enabled === enabled) return;
        state = { ...current, enabled };
        for (const l of Array.from(listeners)) l();
    },
    /** Test-only. */
    resetForTests(next?: SceneDepthOptIn): void {
        state = next ?? null;
        for (const l of Array.from(listeners)) l();
    },
};

export function useSceneDepthOptIn<T>(selector: (s: SceneDepthOptIn) => T): T {
    return useSyncExternalStore(
        sceneDepthStore.subscribe,
        () => selector(sceneDepthStore.get()),
        () => selector(sceneDepthStore.get()),
    );
}
