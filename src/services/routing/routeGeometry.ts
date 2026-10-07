/**
 * src/services/routing/routeGeometry.ts
 * The drivable form of a planned route: the provider's polyline plus what
 * route following needs per hop — cumulative vertex distances, a 10 m resample
 * for look-ahead / prefetch, and each step's along-track position.
 *
 * All geometry goes through the WASM kernels (`polyline_resample`,
 * `polyline_project`, `batch_haversine`, `initial_bearing`) or their JS twin
 * when the binary has not loaded — never a TypeScript re-derivation.
 */

import { getWasmModule, type StreetViewWasmAPI } from '../../wasm';
import { JS_FALLBACK } from '../../wasm/jsFallback';
import type { LatLng, Route, RouteStep } from './RouteProvider';

/** Resample spacing; Street View panoramas sit ~5–15 m apart on a road. */
export const ROUTE_RESAMPLE_STEP_M = 10;

export interface RoutedStep extends RouteStep {
  /** Where the maneuver sits along the route, in metres from the origin. */
  alongM: number;
}

export interface ActiveRoute {
  /** Stable for the same stops — keys prefetch graphs and shared sessions. */
  id: string;
  providerId: string;
  /** The stops the route was planned through (origin first). */
  stops: LatLng[];
  polyline: LatLng[];
  /** `polyline` as lat, lng, lat, lng, … for the kernels. */
  flat: Float64Array;
  /** Along-track distance of each polyline vertex. */
  cumulativeM: Float64Array;
  /** Geometric length (what along-track distances are measured against). */
  lengthM: number;
  /** Evenly spaced points every {@link ROUTE_RESAMPLE_STEP_M} metres. */
  resampled: Float64Array;
  /** Provider's road distance and driving duration (for the ETA). */
  distanceM: number;
  durationS: number;
  steps: RoutedStep[];
}

export interface RouteProjection {
  alongM: number;
  /** Signed: + is right of the direction of travel. */
  crossM: number;
}

function geo(): StreetViewWasmAPI {
  return getWasmModule() ?? JS_FALLBACK;
}

function flatten(points: readonly LatLng[]): Float64Array {
  const flat = new Float64Array(points.length * 2);
  points.forEach((p, i) => {
    flat[i * 2] = p.lat;
    flat[i * 2 + 1] = p.lng;
  });
  return flat;
}

/** Route id for a list of stops: 5-decimal (~1 m) coordinates, joined. */
export function routeIdForStops(stops: readonly LatLng[]): string {
  return `route:${stops.map((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join(';')}`;
}

/** Index of the last vertex at or before `alongM` (binary search). */
function vertexAtOrBefore(cumulative: Float64Array, alongM: number): number {
  let lo = 0;
  let hi = cumulative.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (cumulative[mid]! <= alongM) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * Project onto the part of the route between `fromM` and `toM` along it. The
 * window keeps progress monotone on routes that double back on themselves —
 * an out-and-back street would otherwise snap to whichever leg is nearer.
 */
export function projectInWindow(
  route: Pick<ActiveRoute, 'flat' | 'cumulativeM'>,
  pos: LatLng,
  fromM: number,
  toM: number,
): RouteProjection {
  const n = route.cumulativeM.length;
  const i0 = vertexAtOrBefore(route.cumulativeM, Math.max(0, fromM));
  const i1 = Math.min(n - 1, vertexAtOrBefore(route.cumulativeM, toM) + 1);
  const sub = route.flat.subarray(i0 * 2, (Math.max(i1, i0 + 1) + 1) * 2);
  const p = geo().polylineProject(sub, pos.lat, pos.lng);
  return { alongM: route.cumulativeM[i0]! + p.alongMeters, crossM: p.crossMeters };
}

/**
 * Where `pos` is on the route. With a `hintAlongM` (last known progress) the
 * search stays near it unless the position is clearly elsewhere (a re-snap or
 * a teleport), in which case the whole route is searched.
 */
export function projectOnRoute(route: ActiveRoute, pos: LatLng, hintAlongM?: number | null): RouteProjection {
  if (hintAlongM == null) return projectInWindow(route, pos, 0, route.lengthM);
  const near = projectInWindow(route, pos, hintAlongM - 150, hintAlongM + 400);
  if (Math.abs(near.crossM) <= 60) return near;
  const whole = projectInWindow(route, pos, 0, route.lengthM);
  return Math.abs(whole.crossM) + 20 < Math.abs(near.crossM) ? whole : near;
}

/** The resampled route point nearest `alongM` metres from the origin. */
export function pointAlong(route: Pick<ActiveRoute, 'resampled'>, alongM: number): LatLng {
  const count = route.resampled.length / 2;
  const i = Math.max(0, Math.min(count - 1, Math.round(alongM / ROUTE_RESAMPLE_STEP_M)));
  return { lat: route.resampled[i * 2]!, lng: route.resampled[i * 2 + 1]! };
}

export function bearingBetween(from: LatLng, to: LatLng): number {
  return geo().initialBearing(from.lat, from.lng, to.lat, to.lng);
}

export function distanceBetween(a: LatLng, b: LatLng): number {
  return geo().haversine(a.lat, a.lng, b.lat, b.lng);
}

export function buildActiveRoute(route: Route, meta: { stops: LatLng[]; providerId: string }): ActiveRoute {
  const flat = flatten(route.polyline);
  const segments = new Float64Array(Math.max(0, route.polyline.length - 1));
  const lengthM = geo().batchHaversine(flat, segments);
  const cumulativeM = new Float64Array(route.polyline.length);
  for (let i = 1; i < cumulativeM.length; i++) cumulativeM[i] = cumulativeM[i - 1]! + segments[i - 1]!;

  const base = { flat, cumulativeM };
  let prevAlong = 0;
  const steps: RoutedStep[] = route.steps.map((step, i) => {
    let alongM: number;
    if (step.maneuver === 'depart' && i === 0) alongM = 0;
    else if (step.maneuver === 'arrive' && i === route.steps.length - 1) alongM = lengthM;
    else alongM = projectInWindow(base, step.location, prevAlong, lengthM).alongM;
    prevAlong = alongM;
    return { ...step, alongM };
  });

  return {
    id: routeIdForStops(meta.stops),
    providerId: meta.providerId,
    stops: meta.stops,
    polyline: route.polyline,
    flat,
    cumulativeM,
    lengthM,
    resampled: geo().polylineResample(flat, ROUTE_RESAMPLE_STEP_M),
    distanceM: route.distanceM,
    durationS: route.durationS,
    steps,
  };
}

/** The resampled polyline as waypoints, thinned to every `everyM` metres. */
export function resampledWaypoints(route: Pick<ActiveRoute, 'resampled'>, everyM: number): LatLng[] {
  const stride = Math.max(1, Math.round(everyM / ROUTE_RESAMPLE_STEP_M));
  const count = route.resampled.length / 2;
  const out: LatLng[] = [];
  for (let i = 0; i < count; i += stride) out.push({ lat: route.resampled[i * 2]!, lng: route.resampled[i * 2 + 1]! });
  const last = { lat: route.resampled[(count - 1) * 2]!, lng: route.resampled[(count - 1) * 2 + 1]! };
  const tail = out[out.length - 1];
  if (count > 0 && (!tail || tail.lat !== last.lat || tail.lng !== last.lng)) out.push(last);
  return out;
}
