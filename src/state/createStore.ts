/**
 * The one external-store primitive. Hot state (POV, cabin head pose, trips,
 * frame stats) lives outside React so per-frame writers never re-render the
 * tree; components read it through `useStore(store, selector)`, which only
 * re-renders when the selected value changes (`Object.is`).
 *
 * `get()` returns the current snapshot object, replaced (never mutated) on a
 * change — what `useSyncExternalStore` needs. A `set` that changes nothing
 * (same object, or a shallow-equal patch) does not notify.
 */
import { useSyncExternalStore } from 'react';

export interface Store<T> {
    get(): T;
    /** Replace the snapshot (or derive it from the previous one). */
    set(next: T | ((prev: T) => T)): void;
    subscribe(listener: () => void): () => void;
}

/** True when every own key of `a` and `b` is `Object.is`-equal. */
function shallowEqual<T>(a: T, b: T): boolean {
    if (Object.is(a, b)) return true;
    if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
    const ka = Object.keys(a);
    if (ka.length !== Object.keys(b).length) return false;
    return ka.every((k) => Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

export function createStore<T>(initial: T): Store<T> {
    let state = initial;
    const listeners = new Set<() => void>();
    return {
        get: () => state,
        set(next) {
            const value = typeof next === 'function' ? (next as (prev: T) => T)(state) : next;
            if (shallowEqual(value, state)) return;
            state = value;
            // Copy so a listener that unsubscribes mid-notify cannot skip a peer.
            for (const listener of Array.from(listeners)) listener();
        },
        subscribe(listener) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
    };
}

/** Subscribe a component to `selector(store.get())`. */
export function useStore<T, S>(store: Pick<Store<T>, 'get' | 'subscribe'>, selector: (state: T) => S): S {
    const read = () => selector(store.get());
    return useSyncExternalStore(store.subscribe, read, read);
}
