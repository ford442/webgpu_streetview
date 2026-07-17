/**
 * Phase 3 — route pre-download scaffolding.
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

/** Placeholder for future background prefetch worker integration (#134 tours). */
export async function prefetchRouteGraph(
  plan: RoutePrefetchPlan,
  _collectLinksAt: (waypoint: RoutePrefetchWaypoint) => Promise<PanoLinkSnapshot | null>,
  onProgress?: (progress: RoutePrefetchProgress) => void,
): Promise<number> {
  const snapshots: PanoLinkSnapshot[] = [];
  const totalSteps = plan.waypoints.length;

  for (let i = 0; i < plan.waypoints.length; i++) {
    const waypoint = plan.waypoints[i];
    onProgress?.({
      routeId: plan.routeId,
      totalSteps,
      completedSteps: i,
    });
    // Phase 3: wire to Street View link enumeration when route UI lands.
    void waypoint;
  }

  return savePrefetchedRoute(plan.routeId, snapshots);
}
