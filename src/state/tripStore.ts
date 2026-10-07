/**
 * The planned / active road trip, as an external store.
 *
 * Progress changes on every cruise hop and is read by the cabin centre display,
 * the planner panel, the announcer and the globe — so like `povStore` it lives
 * outside React context: writers call `tripStore.update(…)`, components
 * subscribe with `useTripSelector` (re-render only when their slice changes),
 * the cabin bridge reads `tripStore.get()` imperatively.
 */
import { useSyncExternalStore } from 'react';
import type { ActiveRoute, RoutedStep } from '../services/routing/routeGeometry';
import type { LatLng } from '../services/routing/RouteProvider';

export type TripStatus = 'idle' | 'planning' | 'ready' | 'driving' | 'arrived' | 'error';

export interface TripStop extends LatLng {
  label: string;
}

export interface TripProgress {
  alongM: number;
  crossM: number;
  remainingM: number;
  /** Index into `route.steps` of the next maneuver ahead (the arrive step at the end). */
  nextStepIndex: number;
  distanceToNextStepM: number;
  /** Seconds to arrival at the measured cruise pace (null until it is measured). */
  etaS: number | null;
  /** Along-track metres per second of driving time, smoothed. */
  avgSpeedMps: number | null;
}

export interface TripSummary {
  distanceM: number;
  elapsedS: number;
  resnaps: number;
  avgSpeedMps: number | null;
}

export interface TripState {
  readonly status: TripStatus;
  readonly stops: readonly TripStop[];
  readonly route: ActiveRoute | null;
  readonly error: string | null;
  readonly progress: TripProgress | null;
  readonly resnaps: number;
  readonly startedAt: number | null;
  readonly summary: TripSummary | null;
}

export const IDLE_TRIP: TripState = {
  status: 'idle',
  stops: [],
  route: null,
  error: null,
  progress: null,
  resnaps: 0,
  startedAt: null,
  summary: null,
};

export interface TripStore {
  get(): TripState;
  subscribe(listener: () => void): () => void;
  update(patch: Partial<TripState> | ((prev: TripState) => Partial<TripState>)): void;
  reset(next?: Partial<TripState>): void;
}

export function createTripStore(initial: Partial<TripState> = {}): TripStore {
  let state: TripState = { ...IDLE_TRIP, ...initial };
  const listeners = new Set<() => void>();

  const commit = (next: TripState): void => {
    const keys = Object.keys(next) as (keyof TripState)[];
    if (keys.every((k) => next[k] === state[k])) return;
    state = next;
    for (const l of Array.from(listeners)) l();
  };

  return {
    get: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    update(patch) {
      const p = typeof patch === 'function' ? patch(state) : patch;
      commit({ ...state, ...p });
    },
    reset(next = {}) {
      commit({ ...IDLE_TRIP, ...next });
    },
  };
}

export const tripStore = createTripStore();

/** Subscribe to a slice of the trip. The selector must return a stable value for an unchanged state. */
export function useTripSelector<T>(selector: (s: TripState) => T, store: TripStore = tripStore): T {
  return useSyncExternalStore(
    store.subscribe,
    () => selector(store.get()),
    () => selector(store.get()),
  );
}

/** The next maneuver ahead, or null without a route / progress. */
export function nextStep(state: TripState): RoutedStep | null {
  if (!state.route || !state.progress) return null;
  return state.route.steps[state.progress.nextStepIndex] ?? null;
}

/** Summary for the probe / e2e: small, serialisable. */
export function tripProbeSnapshot(state: TripState = tripStore.get()): {
  status: TripStatus;
  routeId: string | null;
  lengthM: number | null;
  alongM: number | null;
  crossM: number | null;
  resnaps: number;
  error: string | null;
} {
  return {
    status: state.status,
    routeId: state.route?.id ?? null,
    lengthM: state.route?.lengthM ?? null,
    alongM: state.progress?.alongM ?? null,
    crossM: state.progress?.crossM ?? null,
    resnaps: state.resnaps,
    error: state.error,
  };
}
