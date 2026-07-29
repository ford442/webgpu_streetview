/**
 * Phase 3 — route pre-download.
 * Enumerates panorama link graphs along a planned route for offline link-walking.
 * Does NOT download Google tile imagery (Maps ToS).
 */

import { offlineSaveRouteGraph, type RouteGraphNode } from './offlineStore';

export interface RoutePrefetchWaypoint {
  lat: number;
  lng: number;
  label?: string;
}

export interface RoutePrefetchPlan {
  routeId: string;
  waypoints: RoutePrefetchWaypoint[];
}

export interface RoutePrefetchProgress {
  routeId: string;
  totalSteps: number;
  completedSteps: number;
  currentPanoId?: string;
}

export interface PanoLinkSnapshot {
  panoId: string;
  lat: number;
  lng: number;
  linkPanoIds: string[];
}

/**
 * Build a navigation graph from visited panorama link snapshots.
 * Callers supply link data gathered online via `google.maps.StreetViewPanorama.getLinks()`.
 */
export function buildRouteGraphNodes(
  _routeId: string,
  snapshots: PanoLinkSnapshot[],
): Omit<RouteGraphNode, 'routeId' | 'cachedAt'>[] {
  return snapshots.map((snap) => ({
    panoId: snap.panoId,
    linkPanoIds: [...snap.linkPanoIds],
    lat: snap.lat,
    lng: snap.lng,
  }));
}

/** Persist a prefetched route graph (metadata + link IDs only). */
export async function savePrefetchedRoute(
  routeId: string,
  snapshots: PanoLinkSnapshot[],
): Promise<number> {
  const nodes = buildRouteGraphNodes(routeId, snapshots);
  await offlineSaveRouteGraph(routeId, nodes);
  return nodes.length;
}

/**
 * Walk a planned route, collecting panorama link data at each waypoint and
 * persisting the resulting graph. `collectLinksAt` is supplied by the caller
 * (see `createStreetViewLinkCollector`) so this module has no direct
 * `google.maps` runtime dependency and stays unit-testable with a mock.
 * A waypoint that fails to resolve (offline, no imagery nearby) is skipped
 * rather than aborting the whole prefetch.
 */
export async function prefetchRouteGraph(
  plan: RoutePrefetchPlan,
  collectLinksAt: (waypoint: RoutePrefetchWaypoint) => Promise<PanoLinkSnapshot | null>,
  onProgress?: (progress: RoutePrefetchProgress) => void,
): Promise<number> {
  const snapshots = new Map<string, PanoLinkSnapshot>();
  const totalSteps = plan.waypoints.length;

  for (let i = 0; i < plan.waypoints.length; i++) {
    const waypoint = plan.waypoints[i]!;
    let snapshot: PanoLinkSnapshot | null = null;
    try {
      snapshot = await collectLinksAt(waypoint);
    } catch (err) {
      console.warn(`[routePrefetch] Failed to collect links for waypoint ${i}`, err);
    }
    if (snapshot) {
      snapshots.set(snapshot.panoId, snapshot);
    }
    onProgress?.({
      routeId: plan.routeId,
      totalSteps,
      completedSteps: i + 1,
      currentPanoId: snapshot?.panoId,
    });
  }

  return savePrefetchedRoute(plan.routeId, Array.from(snapshots.values()));
}

/**
 * Minimal duck-typed shape of `google.maps.StreetViewService` — kept
 * decoupled from the real Maps typings so tests can inject a plain mock
 * without loading the Maps JS API.
 */
export interface StreetViewServiceLike {
  getPanorama(
    request: {
      location: { lat: number; lng: number };
      radius?: number;
      source?: 'default' | 'outdoor' | 'google' | null;
    },
    callback: (
      data: {
        location?: { pano?: string | null; latLng?: { lat(): number; lng(): number } | null } | null;
        links?: Array<{ pano?: string | null } | null> | null;
      } | null,
      status: string,
    ) => void,
  ): void;
}

export interface CreateStreetViewLinkCollectorOptions {
  /** Search radius in meters used to snap a waypoint to the nearest panorama. */
  radiusMeters?: number;
}

const DEFAULT_SEARCH_RADIUS_METERS = 50;

/**
 * Build a `collectLinksAt` function backed by a live `StreetViewService`.
 * Snaps each waypoint to the nearest panorama and reads its link graph —
 * never touches tile imagery, only pano IDs / coordinates / link IDs.
 */
export function createStreetViewLinkCollector(
  service: StreetViewServiceLike,
  options: CreateStreetViewLinkCollectorOptions = {},
): (waypoint: RoutePrefetchWaypoint) => Promise<PanoLinkSnapshot | null> {
  const radius = options.radiusMeters ?? DEFAULT_SEARCH_RADIUS_METERS;

  return (waypoint) =>
    new Promise((resolve) => {
      service.getPanorama(
        { location: { lat: waypoint.lat, lng: waypoint.lng }, radius, source: 'outdoor' },
        (data, status) => {
          if (status !== 'OK' || !data?.location?.pano || !data.location.latLng) {
            resolve(null);
            return;
          }
          const linkPanoIds = (data.links ?? [])
            .map((link) => link?.pano)
            .filter((pano): pano is string => typeof pano === 'string');
          resolve({
            panoId: data.location.pano,
            lat: data.location.latLng.lat(),
            lng: data.location.latLng.lng(),
            linkPanoIds,
          });
        },
      );
    });
}
