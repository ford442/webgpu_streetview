/**
 * "Save for offline" for a routed road trip: walk the Street View link graph
 * along the route and persist it, so the trip can be driven later with the
 * graph planner (`routeGraphNavigation.planOfflineHop`) and no network.
 *
 * The walk follows real links pano to pano, the way cruise does, so
 * consecutive nodes are linked in the saved graph (snapping a fixed grid of
 * points to the nearest pano leaves gaps the planner cannot cross). Every
 * lookup is one metered `getPanorama` (`tryConsume('panorama', 'trip-prefetch')`),
 * the total is estimated up front from the 10 m resample and capped there,
 * and the walk stops cleanly at the session cap — what was gathered is saved.
 *
 * Stored per pano: id, position, linked ids and their headings, capture date.
 * Never imagery (Maps ToS; `swPolicy.ts` never caches Google hosts).
 */

import { getMapsCallBudget, type MapsCallBudget } from '../services/maps/callBudget';
import { ROUTE_FOLLOW_DEFAULTS } from '../services/routing/routeFollow';
import {
  ROUTE_RESAMPLE_STEP_M,
  bearingBetween,
  pointAlong,
  projectOnRoute,
  type ActiveRoute,
} from '../services/routing/routeGeometry';
import type { LatLng } from '../services/routing/RouteProvider';
import { absoluteAngleDiff } from '../utils/navigation';
import { savePrefetchedRoute, type PanoLinkSnapshot } from './routePrefetch';

/** The call meter source every trip-prefetch lookup is counted under. */
export const TRIP_PREFETCH_SOURCE = 'trip-prefetch';

/** Head-room over the estimate before the walk stops on its own ("cap"). */
const CALL_CAP_FACTOR = 1.25;

/** Snap radius when the walk has to re-enter the route by location. */
const SNAP_RADIUS_M = 50;

/** A snap that lands on an already visited pano moves this much further on. */
const SNAP_SKIP_M = 20;

export type TripPrefetchRoute = Pick<ActiveRoute, 'id' | 'lengthM' | 'resampled' | 'flat' | 'cumulativeM'>;

export interface TripPrefetchEstimate {
  /** Expected lookups: one per pano, ~one per 10 m resample point. */
  calls: number;
  /** The walk never makes more than this many. */
  maxCalls: number;
}

/** What "Save for offline" will cost, shown before it starts. */
export function estimateTripPrefetch(route: Pick<ActiveRoute, 'resampled'>): TripPrefetchEstimate {
  const calls = Math.max(1, route.resampled.length / 2);
  return { calls, maxCalls: Math.ceil(calls * CALL_CAP_FACTOR) };
}

export interface TripPrefetchProgress {
  routeId: string;
  callsUsed: number;
  estimate: TripPrefetchEstimate;
  alongM: number;
  lengthM: number;
  nodes: number;
}

export type TripPrefetchStop =
  /** Reached the destination. */
  | 'complete'
  /** The session call meter refused a lookup. */
  | 'budget'
  /** Hit the walk's own `maxCalls`. */
  | 'cap'
  | 'aborted'
  /** No imagery near the route start. */
  | 'no-imagery';

export interface TripPrefetchResult {
  stop: TripPrefetchStop;
  nodes: number;
  callsUsed: number;
  /** How far along the route the saved graph reaches. */
  coveredM: number;
}

/** The slice of `google.maps.StreetViewPanoramaData` the walk reads. */
export interface TripPanoData {
  location?: { pano?: string | null; latLng?: { lat(): number; lng(): number } | null } | null;
  links?: Array<{ pano?: string | null; heading?: number | null } | null> | null;
  imageDate?: string | null;
}

/** Duck-typed `google.maps.StreetViewService` (tests inject a plain mock). */
export interface TripStreetViewService {
  getPanorama(
    request:
      | { location: LatLng; radius?: number; source?: 'default' | 'outdoor' | 'google' | null }
      | { pano: string },
    callback: (data: TripPanoData | null, status: string) => void,
  ): void;
}

export interface PrefetchTripGraphOptions {
  onProgress?: (progress: TripPrefetchProgress) => void;
  signal?: AbortSignal;
  budget?: MapsCallBudget;
  /** Persist the graph (default: IndexedDB via `savePrefetchedRoute`). */
  save?: (routeId: string, snapshots: PanoLinkSnapshot[]) => Promise<unknown>;
}

function toSnapshot(data: TripPanoData | null, status: string): PanoLinkSnapshot | null {
  if (status !== 'OK' || !data?.location?.pano || !data.location.latLng) return null;
  const linkPanoIds: string[] = [];
  const linkHeadings: number[] = [];
  for (const link of data.links ?? []) {
    if (typeof link?.pano !== 'string') continue;
    linkPanoIds.push(link.pano);
    linkHeadings.push(typeof link.heading === 'number' ? link.heading : Number.NaN);
  }
  return {
    panoId: data.location.pano,
    lat: data.location.latLng.lat(),
    lng: data.location.latLng.lng(),
    linkPanoIds,
    linkHeadings,
    ...(data.imageDate ? { imageDate: data.imageDate } : {}),
  };
}

export async function prefetchTripGraph(
  route: TripPrefetchRoute,
  service: TripStreetViewService,
  options: PrefetchTripGraphOptions = {},
): Promise<TripPrefetchResult> {
  const budget = options.budget ?? getMapsCallBudget();
  const estimate = estimateTripPrefetch(route);
  const visited = new Map<string, PanoLinkSnapshot>();
  let callsUsed = 0;
  let alongM = 0;
  let stop: TripPrefetchStop | null = null;

  const report = (): void => options.onProgress?.({
    routeId: route.id,
    callsUsed,
    estimate,
    alongM: Math.min(alongM, route.lengthM),
    lengthM: route.lengthM,
    nodes: visited.size,
  });

  /** One metered lookup; null with `stop` set when the walk must end. */
  const lookup = async (request: Parameters<TripStreetViewService['getPanorama']>[0]): Promise<PanoLinkSnapshot | null> => {
    if (options.signal?.aborted) {
      stop = 'aborted';
      return null;
    }
    if (callsUsed >= estimate.maxCalls) {
      stop = 'cap';
      return null;
    }
    if (!budget.tryConsume('panorama', TRIP_PREFETCH_SOURCE)) {
      stop = 'budget';
      return null;
    }
    callsUsed += 1;
    const snapshot = await new Promise<PanoLinkSnapshot | null>((resolve) => {
      service.getPanorama(request, (data, status) => resolve(toSnapshot(data, status)));
    });
    if (snapshot) visited.set(snapshot.panoId, snapshot);
    report();
    return snapshot;
  };

  const snapAt = (m: number): Promise<PanoLinkSnapshot | null> =>
    lookup({ location: pointAlong(route, m), radius: SNAP_RADIUS_M, source: 'outdoor' });

  /** Re-enter the route at or after `fromM` on a pano not visited yet. */
  const resnap = async (fromM: number): Promise<PanoLinkSnapshot | null> => {
    for (let m = fromM; m < route.lengthM + ROUTE_RESAMPLE_STEP_M && stop === null; m += SNAP_SKIP_M) {
      alongM = Math.max(alongM, m);
      const before = visited.size;
      const snap = await snapAt(m);
      if (snap && visited.size > before) return snap;
    }
    return null;
  };

  const { lookaheadM, offRouteCrossM, maxLinkDeviationDeg, arrivalM } = ROUTE_FOLLOW_DEFAULTS;
  let current = await resnap(0);
  if (!current && stop === null) stop = 'no-imagery';

  while (current && stop === null) {
    const proj = projectOnRoute(route, current, alongM);
    alongM = Math.max(alongM, proj.alongM);
    if (route.lengthM - alongM <= arrivalM) {
      stop = 'complete';
      break;
    }

    // Same choice as RouteFollower.planHop: the link that tracks the route.
    const targetBearing = bearingBetween(current, pointAlong(route, alongM + lookaheadM));
    let bestId: string | null = null;
    let bestDiff = maxLinkDeviationDeg;
    current.linkPanoIds.forEach((id, k) => {
      const heading = current!.linkHeadings?.[k];
      if (visited.has(id) || heading === undefined || !Number.isFinite(heading)) return;
      const diff = absoluteAngleDiff(targetBearing, heading);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestId = id;
      }
    });

    let next: PanoLinkSnapshot | null = null;
    if (bestId !== null) {
      next = await lookup({ pano: bestId });
      if (next && Math.abs(projectOnRoute(route, next, alongM).crossM) > offRouteCrossM) next = null;
    }
    current = next ?? (stop === null ? await resnap(alongM + SNAP_SKIP_M) : null);
    if (!current && stop === null) stop = 'complete';
  }

  const snapshots = Array.from(visited.values());
  if (snapshots.length > 0) await (options.save ?? savePrefetchedRoute)(route.id, snapshots);
  report();
  return { stop: stop ?? 'complete', nodes: snapshots.length, callsUsed, coveredM: Math.min(alongM, route.lengthM) };
}
