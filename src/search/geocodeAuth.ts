/**
 * Session circuit for Maps JS Geocoding REQUEST_DENIED.
 * Never logs the API key. Enabling Geocoding on a Compute Engine credential
 * does not authorize the browser Maps JS key (HTTP referrers).
 */

import { useSyncExternalStore } from 'react';

export const GEOCODE_DENIED_STATUS = 'REQUEST_DENIED';

export const GEOCODE_DENIED_MESSAGE =
  'Geocoding REQUEST_DENIED — enable Geocoding API on the HTTP-referrer browser key (https://test.1ink.us/* and https://go.1ink.us/*), not a Compute Engine credential. Address lookup is disabled this session.';

let denied = false;
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((fn) => fn());
}

export function isGeocodeDenied(): boolean {
  return denied;
}

export function subscribeGeocodeDenied(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Record a Geocoder status. Only REQUEST_DENIED trips the session circuit. */
export function noteGeocodeStatus(status: string): boolean {
  if (status !== GEOCODE_DENIED_STATUS) return denied;
  if (!denied) {
    denied = true;
    console.warn(GEOCODE_DENIED_MESSAGE);
    emit();
  }
  return true;
}

export function getGeocodeDeniedSnapshot(): boolean {
  return denied;
}

export function useGeocodeDenied(): boolean {
  return useSyncExternalStore(subscribeGeocodeDenied, getGeocodeDeniedSnapshot, () => false);
}

/** Test-only: clear the session circuit. */
export function resetGeocodeAuthForTests(): void {
  denied = false;
  emit();
}
