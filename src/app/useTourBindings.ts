import { useCallback, useMemo } from 'react';
import { useTours, type CurrentPOV, type DirectorSnapshot, type Tour, type TourWaypoint } from '../hooks/useTours';
import type { UseRoutePrefetchResult } from '../hooks/useRoutePrefetch';
import type { RouteGraphNode, RouteGraphSummary, RoutePrefetchProgress } from '../offline';

export interface UseTourBindingsParams {
  panorama: google.maps.StreetViewPanorama | null;
  heading: number;
  pitch: number;
  zoom: number;
  locationName: string;
  teleportToPanoSafe: (panoId: string) => Promise<void>;
  setHeading: (heading: number) => void;
  setPitch: (pitch: number) => void;
  setZoom: (zoom: number) => void;
  isPanoramaReady: boolean;
  routePrefetch: UseRoutePrefetchResult;
  panoCacheFetch: (lat: number, lng: number) => Promise<unknown>;
  /** Optional director-track snapshot for session recording. */
  getDirectorSnapshot?: () => DirectorSnapshot | null;
  /** Apply director keyframe during tour playback. */
  applyDirectorKeyframe?: (frame: import('../utils/tourDirector').TourDirectorKeyframe) => void;
}

/** Props bag consumed by TourPanel (minus isOpen/onClose owned by panels). */
export interface TourPanelBindings {
  tours: Tour[];
  isRecording: boolean;
  isPaused: boolean;
  draftWaypoints: TourWaypoint[];
  getCurrentPOV: () => CurrentPOV | null;
  currentLocationLabel: string;
  onStartRecording: (
    name: string,
    getCurrentPOV: () => CurrentPOV | null,
    getDirectorSnapshot?: () => DirectorSnapshot | null,
  ) => void;
  onPauseRecording: () => void;
  onResumeRecording: () => void;
  onStopRecording: (name: string) => void;
  onCancelRecording: () => void;
  onAddWaypoint: (dwellTimeMs: number, annotation?: string) => void;
  onDeleteTour: (id: string) => void;
  onRenameTour: (id: string, name: string) => void;
  onUpdateTourSettings: (
    id: string,
    updates: Partial<Pick<Tour, 'transitionType' | 'autoPlaySpeed' | 'description'>>,
  ) => void;
  onDownloadTourJson: (tour: Tour) => void;
  onDownloadTourKml: (tour: Tour) => void;
  onImportTourFromJson: (jsonText: string) => void;
  teleportToPano: (panoId: string) => Promise<void>;
  setHeading: (heading: number) => void;
  setPitch: (pitch: number) => void;
  setZoom: (zoom: number) => void;
  isPanoramaReady: boolean;
  /** Offline route-graph prefetch (Phase 3): one summary per prepared tour. */
  routeGraphSummaries: RouteGraphSummary[];
  routeGraphBusyId: string | null;
  routeGraphProgress: Record<string, RoutePrefetchProgress>;
  routeGraphError: string | null;
  onPrepareOfflineGraph: (tour: Tour) => void;
  onDeleteRouteGraph: (routeId: string) => void;
  getRouteGraph: (routeId: string) => Promise<RouteGraphNode[]>;
  panoCacheFetch: (lat: number, lng: number) => Promise<unknown>;
  applyDirectorKeyframe?: (frame: import('../utils/tourDirector').TourDirectorKeyframe) => void;
}

export interface UseTourBindingsResult {
  getCurrentPOV: () => CurrentPOV | null;
  tourPanelProps: TourPanelBindings;
}

/**
 * Tour recording UI bridge: getCurrentPOV + TourPanel prop object.
 * Domain CRUD stays in useTours.
 */
export function useTourBindings({
  panorama,
  heading,
  pitch,
  zoom,
  locationName,
  teleportToPanoSafe,
  setHeading,
  setPitch,
  setZoom,
  isPanoramaReady,
  routePrefetch,
  panoCacheFetch,
  getDirectorSnapshot,
  applyDirectorKeyframe,
}: UseTourBindingsParams): UseTourBindingsResult {
  const toursApi = useTours();

  const getCurrentPOV = useCallback((): CurrentPOV | null => {
    if (!panorama) return null;
    const pos = panorama.getPosition();
    const panoId = panorama.getPano();
    if (!pos || !panoId) return null;
    return {
      panoId,
      position: { lat: pos.lat(), lng: pos.lng() },
      pov: { heading, pitch, zoom },
    };
  }, [panorama, heading, pitch, zoom]);

  const onPrepareOfflineGraph = useCallback(
    (tour: Tour) => {
      void routePrefetch.prepareOfflineGraph(
        tour.id,
        tour.waypoints.map((wp) => ({ lat: wp.position.lat, lng: wp.position.lng, label: wp.annotation })),
      );
    },
    [routePrefetch],
  );

  const onDeleteRouteGraph = useCallback(
    (routeId: string) => {
      void routePrefetch.deleteRouteGraph(routeId);
    },
    [routePrefetch],
  );

  const tourPanelProps: TourPanelBindings = useMemo(
    () => ({
      tours: toursApi.tours,
      isRecording: toursApi.isRecording,
      isPaused: toursApi.isPaused,
      draftWaypoints: toursApi.draftWaypoints,
      getCurrentPOV,
      currentLocationLabel: locationName,
      onStartRecording: (name, getPOV) =>
        toursApi.startRecording(name, getPOV, 0, getDirectorSnapshot),
      onPauseRecording: toursApi.pauseRecording,
      onResumeRecording: toursApi.resumeRecording,
      onStopRecording: (name) => {
        toursApi.stopRecording(name);
      },
      onCancelRecording: toursApi.cancelRecording,
      onAddWaypoint: toursApi.addWaypointFromCurrent,
      onDeleteTour: toursApi.deleteTour,
      onRenameTour: toursApi.renameTour,
      onUpdateTourSettings: toursApi.updateTourSettings,
      onDownloadTourJson: toursApi.downloadTourJson,
      onDownloadTourKml: toursApi.downloadTourKml,
      onImportTourFromJson: toursApi.importTourFromJson,
      teleportToPano: teleportToPanoSafe,
      setHeading,
      setPitch,
      setZoom,
      isPanoramaReady,
      routeGraphSummaries: routePrefetch.summaries,
      routeGraphBusyId: routePrefetch.busyRouteId,
      routeGraphProgress: routePrefetch.progressByRouteId,
      routeGraphError: routePrefetch.error,
      onPrepareOfflineGraph,
      onDeleteRouteGraph,
      getRouteGraph: routePrefetch.getRouteGraph,
      panoCacheFetch,
      applyDirectorKeyframe,
    }),
    [
      toursApi,
      getCurrentPOV,
      locationName,
      teleportToPanoSafe,
      setHeading,
      setPitch,
      setZoom,
      isPanoramaReady,
      routePrefetch.summaries,
      routePrefetch.busyRouteId,
      routePrefetch.progressByRouteId,
      routePrefetch.error,
      routePrefetch.getRouteGraph,
      onPrepareOfflineGraph,
      onDeleteRouteGraph,
      panoCacheFetch,
      getDirectorSnapshot,
      applyDirectorKeyframe,
    ],
  );

  return { getCurrentPOV, tourPanelProps };
}
