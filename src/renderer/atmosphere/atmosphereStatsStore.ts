/**
 * What the atmosphere pass is doing, for `window.__ATMOSPHERE__` (Playwright /
 * DevTools). Written only by `AtmosphereController`; an external store, so
 * nothing re-renders per frame.
 */
import { createStore } from '../../state';

type AtmosphereState = 'off' | 'loading' | 'ready' | 'failed';

export interface AtmosphereStats {
    state: AtmosphereState;
    reason: string | null;
    /** Full rebuilds (medium changed: all four LUTs). */
    mediumBuilds: number;
    /** Sun-only rebuilds (sky view + aerial perspective). */
    sunBuilds: number;
    /** Sun elevation the current LUTs were built for, degrees. */
    sunElevationDeg: number | null;
    /** Visibility the medium was derived from, km (after the C++ clamp / default). */
    visibilityKm: number | null;
    turbidity: number | null;
    /** The CPU reference's sun colour at that elevation (linear RGB, white sun). */
    sunColor: [number, number, number] | null;
}

const INITIAL: AtmosphereStats = {
    state: 'off',
    reason: null,
    mediumBuilds: 0,
    sunBuilds: 0,
    sunElevationDeg: null,
    visibilityKm: null,
    turbidity: null,
    sunColor: null,
};

const store = createStore<AtmosphereStats>({ ...INITIAL });

function publishToWindow(): void {
    if (typeof window !== 'undefined') window.__ATMOSPHERE__ = store.get();
}
store.subscribe(publishToWindow);

export function getAtmosphereStats(): AtmosphereStats {
    return store.get();
}

export function setAtmosphereStats(patch: Partial<AtmosphereStats>): void {
    store.set((current) => ({ ...current, ...patch }));
}

export function resetAtmosphereStats(): void {
    store.set({ ...INITIAL });
    publishToWindow();
}

declare global {
    interface Window {
        __ATMOSPHERE__?: AtmosphereStats;
    }
}
