/**
 * Session circuit for Maps JS Geocoding REQUEST_DENIED.
 * Never logs the API key. Enabling Geocoding on a Compute Engine credential
 * does not authorize the browser Maps JS key (HTTP referrers).
 */

import { createStore, useStore } from '../state/createStore';

export const GEOCODE_DENIED_STATUS = 'REQUEST_DENIED';

export const GEOCODE_DENIED_MESSAGE =
  'Geocoding REQUEST_DENIED — enable Geocoding API on the HTTP-referrer browser key (https://test.1ink.us/* and https://go.1ink.us/*), not a Compute Engine credential. Address lookup is disabled this session.';

const store = createStore(false);

export function isGeocodeDenied(): boolean {
  return store.get();
}

export const subscribeGeocodeDenied = store.subscribe;

/** Record a Geocoder status. Only REQUEST_DENIED trips the session circuit. */
export function noteGeocodeStatus(status: string): boolean {
  if (status !== GEOCODE_DENIED_STATUS) return store.get();
  if (!store.get()) {
    console.warn(GEOCODE_DENIED_MESSAGE);
    store.set(true);
  }
  return true;
}

export function useGeocodeDenied(): boolean {
  return useStore(store, (denied) => denied);
}

/** Test-only: clear the session circuit. */
export function resetGeocodeAuthForTests(): void {
  store.set(false);
}
