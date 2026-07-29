import { useCallback, useEffect, useState } from 'react';
import {
  createStreetViewLinkCollector,
  prefetchRouteGraph,
  offlineGetAllRouteGraphNodes,
  offlineGetRouteGraph,
  offlineListRouteGraphs,
  offlineDeleteRouteGraph,
  type RoutePrefetchProgress,
  type RoutePrefetchWaypoint,
  type RouteGraphNode,
  type RouteGraphSummary,
} from '../offline';

export interface UseRoutePrefetchResult {
  /** One summary row per prepared route graph (routeId, node count, last-cached time). */
  summaries: RouteGraphSummary[];
  /** routeId currently being prepared, if any. */
  busyRouteId: string | null;
  /** Latest progress event per routeId that has been prepared this session. */
  progressByRouteId: Record<string, RoutePrefetchProgress>;
  /** Human-readable error from the most recent prepare/delete attempt, if any. */
  error: string | null;
  /** Prefetch a live pano link graph for the given waypoints and persist it under routeId. */
  prepareOfflineGraph: (routeId: string, waypoints: RoutePrefetchWaypoint[]) => Promise<void>;
  /** Remove a previously prepared route graph. */
  deleteRouteGraph: (routeId: string) => Promise<void>;
  /** Re-read summaries from IndexedDB (e.g. after external changes). */
  refreshSummaries: () => Promise<void>;
  /** Nodes for one route graph, for consumers that need the raw link data (e.g. tour playback). */
  getRouteGraph: (routeId: string) => Promise<RouteGraphNode[]>;
  /** All prefetched nodes across every route, for consumers with no single "current route" (e.g. cruise mode). */
  loadAllCachedNodes: () => Promise<RouteGraphNode[]>;
}

/**
 * Orchestrates Phase 3 route-graph prefetching: runs a live `StreetViewService`
 * walk over a set of waypoints, persists pano IDs + link IDs (never imagery) to
 * IndexedDB, and exposes progress/summary state for UI (Tour panel, Storage panel).
 */
export function useRoutePrefetch(): UseRoutePrefetchResult {
  const [summaries, setSummaries] = useState<RouteGraphSummary[]>([]);
  const [busyRouteId, setBusyRouteId] = useState<string | null>(null);
  const [progressByRouteId, setProgressByRouteId] = useState<Record<string, RoutePrefetchProgress>>({});
  const [error, setError] = useState<string | null>(null);

  const refreshSummaries = useCallback(async () => {
    try {
      setSummaries(await offlineListRouteGraphs());
    } catch (err) {
      console.warn('[useRoutePrefetch] Failed to list route graphs', err);
    }
  }, []);

  useEffect(() => {
    void refreshSummaries();
  }, [refreshSummaries]);

  const prepareOfflineGraph = useCallback(
    async (routeId: string, waypoints: RoutePrefetchWaypoint[]) => {
      if (!navigator.onLine) {
        setError('Cannot prepare an offline route graph while offline — connect to the internet first.');
        return;
      }
      if (typeof google === 'undefined' || !google.maps?.StreetViewService) {
        setError('Street View is not ready yet — try again once the map has loaded.');
        return;
      }
      if (waypoints.length === 0) {
        setError('This route has no waypoints to prefetch.');
        return;
      }

      setError(null);
      setBusyRouteId(routeId);
      try {
        const collectLinksAt = createStreetViewLinkCollector(new google.maps.StreetViewService());
        await prefetchRouteGraph({ routeId, waypoints }, collectLinksAt, (progress) => {
          setProgressByRouteId((prev) => ({ ...prev, [routeId]: progress }));
        });
        await refreshSummaries();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to prepare offline route graph.');
      } finally {
        setBusyRouteId(null);
      }
    },
    [refreshSummaries],
  );

  const deleteRouteGraph = useCallback(
    async (routeId: string) => {
      try {
        await offlineDeleteRouteGraph(routeId);
        setProgressByRouteId((prev) => {
          if (!(routeId in prev)) return prev;
          const next = { ...prev };
          delete next[routeId];
          return next;
        });
        await refreshSummaries();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to delete offline route graph.');
      }
    },
    [refreshSummaries],
  );

  const getRouteGraph = useCallback((routeId: string) => offlineGetRouteGraph(routeId), []);
  const loadAllCachedNodes = useCallback(() => offlineGetAllRouteGraphNodes(), []);

  return {
    summaries,
    busyRouteId,
    progressByRouteId,
    error,
    prepareOfflineGraph,
    deleteRouteGraph,
    refreshSummaries,
    getRouteGraph,
    loadAllCachedNodes,
  };
}
