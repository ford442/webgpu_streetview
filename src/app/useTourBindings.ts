import { useCallback, useMemo } from 'react';
import { useTours, type CurrentPOV, type Tour, type TourWaypoint } from '../hooks/useTours';

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
}

/** Props bag consumed by TourPanel (minus isOpen/onClose owned by panels). */
export interface TourPanelBindings {
  tours: Tour[];
  isRecording: boolean;
  isPaused: boolean;
  draftWaypoints: TourWaypoint[];
  getCurrentPOV: () => CurrentPOV | null;
  currentLocationLabel: string;
  onStartRecording: (name: string, getCurrentPOV: () => CurrentPOV | null) => void;
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

  const tourPanelProps: TourPanelBindings = useMemo(
    () => ({
      tours: toursApi.tours,
      isRecording: toursApi.isRecording,
      isPaused: toursApi.isPaused,
      draftWaypoints: toursApi.draftWaypoints,
      getCurrentPOV,
      currentLocationLabel: locationName,
      onStartRecording: (name, getPOV) => toursApi.startRecording(name, getPOV),
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
    ],
  );

  return { getCurrentPOV, tourPanelProps };
}
