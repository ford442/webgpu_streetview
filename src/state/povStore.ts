/**
 * Hot point-of-view state (view heading/pitch/zoom + car body heading).
 *
 * These change on every pointermove / key repeat / cruise tick. Keeping them in
 * React context re-rendered the whole app shell per mouse event, so they live in
 * a tiny external store instead:
 *
 * - writers (input handlers, tours, shared sessions) call `povStore.setHeading(…)`
 * - per-frame readers (renderer, cabin, audio) call `povStore.get()` imperatively
 * - React components subscribe with a selector (`usePovSelector`), optionally
 *   rate-limited (`useThrottledPov`) — a compass does not need 60 Hz.
 *
 * Values are normalised on write: heading/carHeading wrap to [0, 360), pitch
 * clamps to ±90°, zoom to [1, 3]. `get()` returns a stable snapshot object that
 * is replaced only when a field actually changes (safe for useSyncExternalStore).
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

export interface Pov {
  readonly heading: number;
  readonly pitch: number;
  readonly zoom: number;
  /** Car body heading — independent of the head-look `heading`. */
  readonly carHeading: number;
}

export type PovUpdate = number | ((prev: number) => number);

export const DEFAULT_POV: Pov = { heading: 34, pitch: 10, zoom: 1, carHeading: 34 };

const wrap360 = (v: number): number => ((v % 360) + 360) % 360;
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export interface PovStore {
  get(): Pov;
  subscribe(listener: () => void): () => void;
  setHeading(value: PovUpdate): void;
  setPitch(value: PovUpdate): void;
  setZoom(value: PovUpdate): void;
  setCarHeading(value: PovUpdate): void;
  /** Replace the whole POV (provider mount / tests). Always notifies if anything changed. */
  reset(next?: Partial<Pov>): void;
}

export function createPovStore(initial: Partial<Pov> = {}): PovStore {
  let state: Pov = normalize({ ...DEFAULT_POV, ...initial });
  const listeners = new Set<() => void>();

  function normalize(p: Pov): Pov {
    return {
      heading: wrap360(p.heading),
      pitch: clamp(p.pitch, -90, 90),
      zoom: clamp(p.zoom, 1, 3),
      carHeading: wrap360(p.carHeading),
    };
  }

  function commit(next: Pov): void {
    const n = normalize(next);
    if (
      n.heading === state.heading &&
      n.pitch === state.pitch &&
      n.zoom === state.zoom &&
      n.carHeading === state.carHeading
    ) {
      return;
    }
    state = n;
    // Copy so a listener that unsubscribes mid-notify cannot skip a peer.
    for (const l of Array.from(listeners)) l();
  }

  const resolve = (value: PovUpdate, prev: number): number =>
    typeof value === 'function' ? value(prev) : value;

  return {
    get: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setHeading: (v) => commit({ ...state, heading: resolve(v, state.heading) }),
    setPitch: (v) => commit({ ...state, pitch: resolve(v, state.pitch) }),
    setZoom: (v) => commit({ ...state, zoom: resolve(v, state.zoom) }),
    setCarHeading: (v) => commit({ ...state, carHeading: resolve(v, state.carHeading) }),
    reset: (next = {}) => commit({ ...DEFAULT_POV, ...next }),
  };
}

/** The app-wide store. One Street View per page, like `window.__STREETVIEW_PROBE__`. */
export const povStore: PovStore = createPovStore();

/** Subscribe a component to a derived slice. Re-renders only when the selected value changes (Object.is). */
export function usePovSelector<T>(selector: (pov: Pov) => T, store: PovStore = povStore): T {
  return useSyncExternalStore(
    store.subscribe,
    () => selector(store.get()),
    () => selector(store.get()),
  );
}

/**
 * Like `usePovSelector` but updates at most `maxHz` times per second (trailing
 * edge, so the final value always lands). For HUD-style readouts.
 */
export function useThrottledPov<T>(
  selector: (pov: Pov) => T,
  maxHz = 10,
  store: PovStore = povStore,
): T {
  const [value, setValue] = useState<T>(() => selector(store.get()));
  const selectorRef = useRef(selector);
  selectorRef.current = selector;

  useEffect(() => {
    const interval = 1000 / Math.max(1, maxHz);
    let last = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const flush = () => {
      timer = null;
      last = Date.now();
      const next = selectorRef.current(store.get());
      setValue((prev) => (Object.is(prev, next) ? prev : next));
    };
    const onChange = () => {
      if (timer !== null) return;
      const wait = Math.max(0, interval - (Date.now() - last));
      timer = setTimeout(flush, wait);
    };

    flush(); // catch up with anything written between render and effect
    const unsubscribe = store.subscribe(onChange);
    return () => {
      unsubscribe();
      if (timer !== null) clearTimeout(timer);
    };
  }, [store, maxHz]);

  return value;
}

/**
 * Run `onChange` with the selected value now and whenever it changes — without
 * re-rendering the host component. For pushing POV into imperative sinks
 * (audio, the car runtime) from a React tree.
 */
export function usePovEffect<T>(
  selector: (pov: Pov) => T,
  onChange: (value: T) => void,
  options: { immediate?: boolean; store?: PovStore } = {},
): void {
  const { immediate = true, store = povStore } = options;
  const selectorRef = useRef(selector);
  selectorRef.current = selector;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    let prev = selectorRef.current(store.get());
    if (immediate) onChangeRef.current(prev);
    return store.subscribe(() => {
      const next = selectorRef.current(store.get());
      if (Object.is(next, prev)) return;
      prev = next;
      onChangeRef.current(next);
    });
  }, [store, immediate]);
}
