/**
 * src/services/routing/routeLink.ts
 * `?route=lat,lng;lat,lng[;…]` — a shareable routed trip. Only the stops
 * travel in the link (5 decimals ≈ 1 m); the receiver plans the road route
 * itself, so a link never carries provider data.
 */

import { readFlag } from '../../config/flags';
import type { TripStop } from '../../state/tripStore';
import { isValidLatLng, type LatLng } from './RouteProvider';
import { OSRM_MAX_WAYPOINTS } from './osrmProvider';

export const ROUTE_LINK_PARAM = 'route';

export function encodeRouteStops(stops: readonly LatLng[]): string {
  return stops.map((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join(';');
}

/** Default labels for stops that arrive without names (links, shared sessions). */
export function labelStops(points: readonly LatLng[], labels?: readonly (string | undefined)[]): TripStop[] {
  return points.map((p, i) => ({
    lat: p.lat,
    lng: p.lng,
    label: labels?.[i]
      || (i === 0 ? 'Start' : i === points.length - 1 ? 'Destination' : `Via ${i}`),
  }));
}

/** Parse a route payload; null unless it holds 2…OSRM_MAX_WAYPOINTS valid points. */
export function decodeRouteStops(raw: string | null | undefined): TripStop[] | null {
  if (!raw) return null;
  const parts = raw.split(';').map((s) => s.trim()).filter(Boolean);
  if (parts.length < 2 || parts.length > OSRM_MAX_WAYPOINTS) return null;
  const points: LatLng[] = [];
  for (const part of parts) {
    const [a, b, extra] = part.split(',');
    if (extra !== undefined || a === undefined || b === undefined) return null;
    const p = { lat: Number(a), lng: Number(b) };
    if (a.trim() === '' || b.trim() === '' || !isValidLatLng(p)) return null;
    points.push(p);
  }
  return labelStops(points);
}

/** The `?route=` stops of the current page, if any. */
export function readRouteLink(search?: string): TripStop[] | null {
  return decodeRouteStops(readFlag('route', search));
}

/** A link to this page that reproduces the trip (other query params kept). */
export function buildRouteLinkUrl(stops: readonly LatLng[], base: string = window.location.href): string {
  const url = new URL(base);
  url.searchParams.set(ROUTE_LINK_PARAM, encodeRouteStops(stops));
  return url.toString();
}

/**
 * Parse a typed stop: "55.9533, -3.1883" (lat, lng). Returns null for
 * anything else — free text goes through place search instead.
 */
export function parseLatLngText(text: string): LatLng | null {
  const m = text.trim().match(/^(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const p = { lat: Number(m[1]), lng: Number(m[2]) };
  return isValidLatLng(p) ? p : null;
}
