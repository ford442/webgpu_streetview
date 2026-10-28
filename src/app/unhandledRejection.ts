/**
 * Count what escapes every `.catch`: unhandled promise rejections and uncaught
 * errors. The type-aware lint (`no-floating-promises`) keeps app code from
 * dropping promises, but a rejection from a library or a `void` call still
 * lands here. The count is on `window.__SV__.errors` and the backend chip.
 */
import { createStore, useStore } from '../state/createStore';

export interface UnhandledErrorStats {
    rejections: number;
    errors: number;
    /** The most recent one, `String(reason)` truncated. */
    last: string | null;
}

const NONE: UnhandledErrorStats = { rejections: 0, errors: 0, last: null };
const store = createStore<UnhandledErrorStats>(NONE);
const MAX_MESSAGE = 200;

function describe(reason: unknown): string {
    const text = reason instanceof Error ? `${reason.name}: ${reason.message}` : String(reason);
    return text.length > MAX_MESSAGE ? `${text.slice(0, MAX_MESSAGE)}…` : text;
}

export function noteUnhandled(kind: 'rejection' | 'error', reason: unknown): void {
    store.set((s) => ({
        rejections: s.rejections + (kind === 'rejection' ? 1 : 0),
        errors: s.errors + (kind === 'error' ? 1 : 0),
        last: describe(reason),
    }));
}

export function getUnhandledErrors(): UnhandledErrorStats {
    return store.get();
}

export function useUnhandledErrors(): UnhandledErrorStats {
    return useStore(store, (s) => s);
}

let installed = false;

/** Listen on `window` once. Returns the uninstall (tests). */
export function installUnhandledRejectionCounter(target: Window = window): () => void {
    if (installed) return () => {};
    installed = true;
    const onRejection = (event: PromiseRejectionEvent) => noteUnhandled('rejection', event.reason);
    const onError = (event: ErrorEvent) => noteUnhandled('error', event.error ?? event.message);
    target.addEventListener('unhandledrejection', onRejection);
    target.addEventListener('error', onError);
    return () => {
        installed = false;
        target.removeEventListener('unhandledrejection', onRejection);
        target.removeEventListener('error', onError);
    };
}

export function resetUnhandledErrorsForTests(): void {
    store.set(NONE);
}
