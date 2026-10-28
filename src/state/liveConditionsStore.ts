/**
 * Live local conditions toggle + status (opt-in, off by default).
 *
 * The weather panel writes `enabled`; `app/LiveConditionsDriver.tsx` fetches
 * and applies. `overridden` means the user moved a weather control after live
 * conditions applied — the driver then leaves the weather alone until the user
 * resumes (or toggles live conditions off and on).
 */
import { createStore, useStore } from './createStore';
import { readFlag } from '../config/flags';
import type { LiveConditions, WeatherTarget } from '../services/conditions/openMeteo';

type LiveConditionsStatus = 'off' | 'loading' | 'live' | 'overridden' | 'error';

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

const OFF: LiveConditionsState = {
  enabled: false,
  status: 'off',
  conditions: null,
  target: null,
  error: null,
};
const store = createStore<LiveConditionsState>(OFF);
let hydrated = false;

/** The persisted toggle is read on first use, not at import. */
function hydrate(): LiveConditionsState {
  if (!hydrated) {
    hydrated = true;
    if (readPersistedEnabled()) store.set((s) => ({ ...s, enabled: true, status: 'loading' }));
  }
  return store.get();
}

export const liveConditionsStore = {
  get: hydrate,
  subscribe: store.subscribe,
  update(patch: Partial<LiveConditionsState>): void {
    store.set({ ...hydrate(), ...patch });
  },
  /**
   * User toggle: persists, and clears any override. Re-enabling reuses the
   * conditions already fetched this session (the request policy still holds).
   */
  setEnabled(enabled: boolean): void {
    persistEnabled(enabled);
    const state = hydrate();
    liveConditionsStore.update(enabled
      ? { enabled, status: state.target ? 'live' : 'loading', error: null }
      : { enabled, status: 'off', error: null });
  },
  /** Re-apply live conditions after a manual override. */
  resume(): void {
    const state = hydrate();
    if (state.enabled && state.status === 'overridden') liveConditionsStore.update({ status: state.target ? 'live' : 'loading' });
  },
  /** Test-only. */
  resetForTests(next: Partial<LiveConditionsState> = {}): void {
    hydrated = true;
    store.set({ ...OFF, ...next });
  },
};

export function useLiveConditions<T>(selector: (s: LiveConditionsState) => T): T {
  return useStore(liveConditionsStore, selector);
}
