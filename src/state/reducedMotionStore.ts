/**
 * Reduced motion, as the frame path reads it: the OS media query (kept live by
 * a `matchMedia` change listener) or the app's accessibility setting (written
 * by `useAppAccessibility`, which also mirrors it onto `body.reduced-motion`
 * for CSS). Per-frame readers call `isReducedMotion()` — no DOM access.
 */
import { createStore } from './createStore';

export interface ReducedMotionState {
    /** `(prefers-reduced-motion: reduce)` right now. */
    readonly os: boolean;
    /** The app's accessibility toggle. */
    readonly app: boolean;
}

const QUERY = '(prefers-reduced-motion: reduce)';

function mediaQuery(): MediaQueryList | null {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null;
    try {
        return window.matchMedia(QUERY);
    } catch {
        return null;
    }
}

export const reducedMotionStore = createStore<ReducedMotionState>({ os: false, app: false });

let listening = false;

/** Start following the OS query (idempotent; the first read does it). */
function follow(): void {
    if (listening) return;
    listening = true;
    const query = mediaQuery();
    if (!query) return;
    reducedMotionStore.set((s) => ({ ...s, os: query.matches }));
    query.addEventListener?.('change', (event) => {
        reducedMotionStore.set((s) => ({ ...s, os: event.matches }));
    });
}

export function isReducedMotion(): boolean {
    follow();
    const s = reducedMotionStore.get();
    return s.os || s.app;
}

export function setAppReducedMotion(app: boolean): void {
    follow();
    reducedMotionStore.set((s) => ({ ...s, app }));
}

/** Test-only: forget the listener and the state. */
export function resetReducedMotionForTests(): void {
    listening = false;
    reducedMotionStore.set({ os: false, app: false });
}
