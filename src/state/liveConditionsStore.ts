/**
 * Live local conditions toggle + status (opt-in, off by default).
 *
 * The weather panel writes `enabled`; `app/LiveConditionsDriver.tsx` fetches
 * and applies. `overridden` means the user moved a weather control after live
 * conditions applied — the driver then leaves the weather alone until the user
 * resumes (or toggles live conditions off and on).
 */
import { useSyncExternalStore } from 'react';
import { readFlag } from '../config/flags';
import type { LiveConditions, WeatherTarget } from '../services/conditions/openMeteo';

export type LiveConditionsStatus = 'off' | 'loading' | 'live' | 'overridden' | 'error';

export interface LiveConditionsState {
  readonly enabled: boolean;
  readonly status: LiveConditionsStatus;
  readonly conditions: LiveConditions | null;
  readonly target: WeatherTarget | null;
  readonly error: string | null;
}

const STORAGE_KEY = 'streetview.liveConditions';

function readPersistedEnabled(): boolean {
  const fromUrl = readFlag('liveWeather');
  if (fromUrl !== undefined) return fromUrl;
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function persistEnabled(enabled: boolean): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0');
  } catch {
    /* private mode: session-only */
  }
}

let state: LiveConditionsState = {
  enabled: false,
  status: 'off',
  conditions: null,
  target: null,
  error: null,
};
let hydrated = false;
const listeners = new Set<() => void>();

function hydrate(): void {
  if (hydrated) return;
  hydrated = true;
  const enabled = readPersistedEnabled();
  if (enabled) state = { ...state, enabled, status: 'loading' };
}

export const liveConditionsStore = {
  get(): LiveConditionsState {
    hydrate();
    return state;
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  update(patch: Partial<LiveConditionsState>): void {
    hydrate();
    const next = { ...state, ...patch };
    if ((Object.keys(next) as (keyof LiveConditionsState)[]).every((k) => next[k] === state[k])) return;
    state = next;
    for (const l of Array.from(listeners)) l();
  },
  /**
   * User toggle: persists, and clears any override. Re-enabling reuses the
   * conditions already fetched this session (the request policy still holds).
   */
  setEnabled(enabled: boolean): void {
    persistEnabled(enabled);
    liveConditionsStore.update(enabled
      ? { enabled, status: state.target ? 'live' : 'loading', error: null }
      : { enabled, status: 'off', error: null });
  },
  /** Re-apply live conditions after a manual override. */
  resume(): void {
    if (state.enabled && state.status === 'overridden') liveConditionsStore.update({ status: state.target ? 'live' : 'loading' });
  },
  /** Test-only. */
  resetForTests(next: Partial<LiveConditionsState> = {}): void {
    hydrated = true;
    state = { enabled: false, status: 'off', conditions: null, target: null, error: null, ...next };
    for (const l of Array.from(listeners)) l();
  },
};

export function useLiveConditions<T>(selector: (s: LiveConditionsState) => T): T {
  return useSyncExternalStore(
    liveConditionsStore.subscribe,
    () => selector(liveConditionsStore.get()),
    () => selector(liveConditionsStore.get()),
  );
}
