/**
 * src/services/radio/tripRadio.ts
 * When the cabin radio follows the trip: re-query for a local station only
 * after the car has moved more than 50 km from where it was last tuned, and
 * retune only when the best local station is in another region (country or
 * state) than the one playing — and never when the driver pinned a station.
 * Region comes from the stations' own metadata, so no reverse geocoding.
 */

import { getWasmModule } from '../../wasm';
import { JS_FALLBACK } from '../../wasm/jsFallback';

export const RADIO_REQUERY_DISTANCE_M = 50_000;

export interface TunedStation {
  id: string;
  country: string;
  state: string;
  /** Where the car was when this station was tuned. */
  lat: number;
  lng: number;
}

export function shouldRequeryRadio(
  tuned: Pick<TunedStation, 'lat' | 'lng'> | null,
  pos: { lat: number; lng: number },
  pinned: boolean,
): boolean {
  if (pinned || !tuned) return false;
  return (getWasmModule() ?? JS_FALLBACK).haversine(tuned.lat, tuned.lng, pos.lat, pos.lng) > RADIO_REQUERY_DISTANCE_M;
}

const norm = (s: string): string => s.trim().toLowerCase();

/** True when `candidate` is a different station in a different country or state. */
export function isRegionChange(
  current: Pick<TunedStation, 'id' | 'country' | 'state'>,
  candidate: { id: string; country: string; state: string },
): boolean {
  if (candidate.id === current.id) return false;
  if (!candidate.country && !candidate.state) return false;
  if (norm(candidate.country) !== norm(current.country)) return true;
  return Boolean(candidate.state) && norm(candidate.state) !== norm(current.state);
}
