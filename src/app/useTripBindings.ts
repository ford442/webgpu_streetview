import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useViewMode } from '../hooks/useViewMode';
import type { UseRoutePrefetchResult } from '../hooks/useRoutePrefetch';
import { prefersReducedMotion } from '../renderer/cinematicCameraFx';
import { getMapsCallBudget } from '../services/maps/callBudget';
import type { LatLng } from '../services/routing/RouteProvider';
import { RouteAnnouncer } from '../services/routing/routeAnnouncements';
import { distanceBetween, resampledWaypoints } from '../services/routing/routeGeometry';
import { buildRouteLinkUrl, readRouteLink } from '../services/routing/routeLink';
import {
  clearTrip,
  configureTripController,
  pauseDrive,
  planTrip,
  startDrive,
} from '../services/routing/tripController';
import { createConfiguredRouteProvider, resolveRoutingConfig, type RoutingConfig } from '../services/routing/routingConfig';
import { povStore } from '../state/povStore';
import { tripStore, useTripSelector, type TripStop } from '../state/tripStore';
import { signedAngleDiff } from '../utils/navigation';

/** Prefetch graph spacing for "Save for offline": one link lookup per 50 m. */
export const TRIP_OFFLINE_SPACING_M = 50;

/** A trip whose start is further than this from the car teleports there first. */
const LINK_ORIGIN_SNAP_M = 150;

/** Car body turn time toward the route after a hop (snaps under reduced motion). */
const CAR_HEADING_EASE_MS = 700;

export interface UseTripBindingsParams {
  panorama: google.maps.StreetViewPanorama | null;
  isConnected: boolean;
  isPanoramaReady: boolean;
  teleportSafe: (lat: number, lng: number) => Promise<void>;
  teleportToPanoSafe: (panoId: string) => Promise<void>;
  isCruiseMode: boolean;
  setIsCruiseMode: (on: boolean) => void;
  announce: (message: string) => void;
  routePrefetch: UseRoutePrefetchResult;
}

/** Props bag for TripPlannerPanel (minus isOpen/onClose owned by panels). */
export interface TripPanelBindings {
  routing: RoutingConfig;
  getOrigin: () => LatLng | null;
  onPlan: (stops: TripStop[]) => void;
  onDrive: () => void;
  onStop: () => void;
  onClear: () => void;
  onSaveOffline: () => void;
  offlineBusy: boolean;
  offlineError: string | null;
  isCruiseMode: boolean;
  getShareUrl: () => string | null;
}

function getPanoramaAt(target: LatLng): Promise<string | null> {
  if (typeof google === 'undefined' || !google.maps?.StreetViewService) return Promise.resolve(null);
  const service = new google.maps.StreetViewService();
  return new Promise((resolve) => {
    service.getPanorama(
      { location: target, radius: 50, source: google.maps.StreetViewSource?.OUTDOOR },
      (data, status) => {
        resolve(status === google.maps.StreetViewStatus.OK ? data?.location?.pano ?? null : null);
      },
    );
  });
}

/**
 * Wires the routed road trip into the app: the trip controller's side effects
 * (the one metered re-snap, the car body easing toward the route, spoken turn
 * cues), `?route=` boot links, offline prefetch of the route, and the planner
 * panel's actions. Cruise reads the active guide via `getActiveRouteGuide`.
 */
export function useTripBindings({
  panorama,
  isConnected,
  isPanoramaReady,
  teleportSafe,
  teleportToPanoSafe,
  isCruiseMode,
  setIsCruiseMode,
  announce,
  routePrefetch,
}: UseTripBindingsParams): TripPanelBindings {
  const { viewMode, headCoupling } = useViewMode();
  const live = useRef({ viewMode, headCoupling, teleportToPanoSafe, announce, setIsCruiseMode });
  live.current = { viewMode, headCoupling, teleportToPanoSafe, announce, setIsCruiseMode };

  const routing = useMemo(() => resolveRoutingConfig(), []);
  const provider = useMemo(() => createConfiguredRouteProvider(routing), [routing]);

  const getOrigin = useCallback((): LatLng | null => {
    const pos = panorama?.getPosition();
    return pos ? { lat: pos.lat(), lng: pos.lng() } : null;
  }, [panorama]);

  useEffect(() => {
    let raf = 0;
    const easeCarHeading = (target: number): void => {
      if (live.current.viewMode !== 'car') return;
      const start = povStore.get().carHeading;
      const delta = signedAngleDiff(target, start);
      if (Math.abs(delta) < 0.5) return;
      const rigid = live.current.headCoupling === 'rigid';
      const headStart = povStore.get().heading;
      const apply = (k: number): void => {
        povStore.setCarHeading(start + delta * k);
        if (rigid) povStore.setHeading(headStart + delta * k);
      };
      cancelAnimationFrame(raf);
      if (prefersReducedMotion()) {
        apply(1);
        return;
      }
      const t0 = performance.now();
      const step = (now: number): void => {
        const k = Math.min(1, (now - t0) / CAR_HEADING_EASE_MS);
        apply(1 - (1 - k) ** 3);
        if (k < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    };

    configureTripController({
      async resnapTo(target) {
        if (!getMapsCallBudget().tryConsume('panorama', 'route-resnap')) return false;
        const panoId = await getPanoramaAt(target);
        if (!panoId) return false;
        await live.current.teleportToPanoSafe(panoId);
        return true;
      },
      easeCarHeading,
    });

    const announcer = new RouteAnnouncer((m) => live.current.announce(m));
    const unsubscribe = tripStore.subscribe(() => announcer.update(tripStore.get()));
    return () => {
      cancelAnimationFrame(raf);
      unsubscribe();
      configureTripController(null);
    };
  }, []);

  const onPlan = useCallback((stops: TripStop[]) => {
    void planTrip(stops, provider);
  }, [provider]);

  // A trip planned elsewhere (a tour, a shared link) may start far from here:
  // go to its start through the hold-pause teleport first.
  const onDrive = useCallback(() => {
    const route = tripStore.get().route;
    const here = getOrigin();
    const start = route?.polyline[0];
    void (async () => {
      let from = here;
      if (start && (!here || distanceBetween(here, start) > LINK_ORIGIN_SNAP_M)) {
        await teleportSafe(start.lat, start.lng);
        from = start;
      }
      if (startDrive(from)) live.current.setIsCruiseMode(true);
    })();
  }, [getOrigin, teleportSafe]);

  const onStop = useCallback(() => {
    live.current.setIsCruiseMode(false);
    pauseDrive();
  }, []);

  const onClear = useCallback(() => {
    live.current.setIsCruiseMode(false);
    clearTrip();
  }, []);

  // `?route=` boot link: once the first pano is up, go to the origin (if it is
  // not already here) and plan. The driver presses Drive.
  const bootLinkHandled = useRef(false);
  useEffect(() => {
    if (bootLinkHandled.current || !isConnected || !isPanoramaReady) return;
    bootLinkHandled.current = true;
    const stops = readRouteLink();
    if (!stops) return;
    const here = getOrigin();
    const origin = stops[0]!;
    void (async () => {
      if (!here || distanceBetween(here, origin) > LINK_ORIGIN_SNAP_M) await teleportSafe(origin.lat, origin.lng);
      await planTrip(stops, provider);
    })();
  }, [isConnected, isPanoramaReady, getOrigin, teleportSafe, provider]);

  const route = useTripSelector((s) => s.route);
  const onSaveOffline = useCallback(() => {
    if (!route) return;
    void routePrefetch.prepareOfflineGraph(
      route.id,
      resampledWaypoints(route, TRIP_OFFLINE_SPACING_M).map((p) => ({ lat: p.lat, lng: p.lng })),
    );
  }, [route, routePrefetch]);

  const getShareUrl = useCallback((): string | null => {
    const stops = tripStore.get().stops;
    return stops.length >= 2 ? buildRouteLinkUrl(stops) : null;
  }, []);

  return {
    routing,
    getOrigin,
    onPlan,
    onDrive,
    onStop,
    onClear,
    onSaveOffline,
    offlineBusy: route !== null && routePrefetch.busyRouteId === route.id,
    offlineError: routePrefetch.error,
    isCruiseMode,
    getShareUrl,
  };
}
