import { useCallback, useEffect, useRef, useState } from 'react';
import type { EnvironmentSettingsState } from '../hooks/useEnvironmentSettings';
import type { SnapshotMetadata } from '../hooks/useSnapshots';
import { planTrip, tripOfflineGraphNode } from '../services/routing/tripController';
import { createConfiguredRouteProvider } from '../services/routing/routingConfig';
import { povStore } from '../state/povStore';
import { tripStore } from '../state/tripStore';
import { buildTripLinkUrl, decodeTripFile, encodeTripFile, readTripLink, tripFileName } from '../trip/tripFile';
import {
  deleteTripRecording,
  loadTripRecordings,
  saveTripRecording,
  tripLibrary,
} from '../trip/tripLibrary';
import { createTripRecorder, type TripRecorder } from '../trip/tripRecorder';
import { createMeteredPanoLookup, type TripReplayDeps } from '../trip/tripReplay';
import {
  configureTripReplay,
  pauseReplay,
  resumeReplay,
  seekReplay,
  startReplay,
  stopReplay,
} from '../trip/tripReplayController';
import { getHistoricalImagery, pickHistoricalEntryForYear } from '../utils/historicalImagery';

export interface UseTripRecordingParams {
  panorama: google.maps.StreetViewPanorama | null;
  isConnected: boolean;
  isPanoramaReady: boolean;
  teleportToPanoSafe: (panoId: string) => Promise<void>;
  env: EnvironmentSettingsState;
  setHeading: (heading: number) => void;
  setPitch: (pitch: number) => void;
  setZoom: (zoom: number) => void;
  setCarHeading: (heading: number) => void;
  /** The historical capture on screen, when the time machine picked one. */
  currentImageDate: string | null;
  snapshots: readonly SnapshotMetadata[];
  openTripPanel: () => void;
  /** Replay drives the pano itself: cruise is switched off when one starts. */
  setIsCruiseMode: (on: boolean) => void;
}

/**
 * Actions for the Trip panel's Recordings section. The recordings, recorder
 * and replay status come from `tripLibrary` (the section subscribes itself, so
 * a replayed hop never re-renders the shell).
 */
export interface TripRecordingBindings {
  /** Gallery snapshots, for the album thumbnails. */
  snapshots: readonly SnapshotMetadata[];
  importError: string | null;
  onReplay: (id: string) => void;
  onPauseReplay: () => void;
  onResumeReplay: () => void;
  onStopReplay: () => void;
  onSeekReplay: (index: number) => void;
  onExport: (id: string) => void;
  /** Copies (or returns) a `?trip=` link; null when the trip is too long and must be shared as a file. */
  onShareLink: (id: string) => Promise<string | null>;
  onImport: (file: File) => void;
  onDelete: (id: string) => void;
  onShowAlbum: (id: string | null) => void;
}

/**
 * Trip recordings in the app: the recorder (every routed drive), replay with
 * the app's teleport / POV / environment setters, `.svtrip` import/export,
 * `?trip=` boot links and the trip album.
 */
export function useTripRecording(params: UseTripRecordingParams): TripRecordingBindings {
  const live = useRef(params);
  live.current = params;
  const recorderRef = useRef<TripRecorder | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  useEffect(() => {
    loadTripRecordings().catch((err) => console.warn('[trip] Failed to load recordings', err));
  }, []);

  // Recorder: lives for the shell; samples read the latest props through `live`.
  useEffect(() => {
    const recorder = createTripRecorder({
      sample() {
        const { panorama, env, currentImageDate } = live.current;
        const panoId = panorama?.getPano();
        const pos = panorama?.getPosition();
        if (!panoId || !pos) return null;
        const { heading, pitch, zoom, carHeading } = povStore.get();
        return {
          panoId,
          panoDate: tripOfflineGraphNode(panoId)?.imageDate ?? currentImageDate ?? null,
          lat: pos.lat(),
          lng: pos.lng(),
          heading,
          pitch,
          zoom,
          carHeading,
          weather: {
            rain: env.rainIntensity,
            snow: env.snowIntensity,
            wind: env.wind,
            fog: env.fogDensity,
            timeOfDay: env.timeOfDay,
          },
          look: env.activeLookId,
          nightIntensity: env.nightIntensity,
        };
      },
      persist: saveTripRecording,
    });
    recorderRef.current = recorder;
    return () => {
      recorder.dispose();
      recorderRef.current = null;
    };
  }, []);

  // Snapshots taken while recording go into that trip's album.
  const seenSnapshots = useRef<Set<string> | null>(null);
  useEffect(() => {
    const ids = new Set(params.snapshots.map((s) => s.id));
    const seen = seenSnapshots.current;
    seenSnapshots.current = ids;
    if (!seen) return;
    for (const s of params.snapshots) {
      if (seen.has(s.id)) continue;
      recorderRef.current?.noteStill({ snapshotId: s.id, name: s.name, lat: s.lat, lng: s.lng, panoId: s.panoId ?? null });
    }
  }, [params.snapshots]);

  // Replay side effects, read fresh per replay.
  useEffect(() => {
    configureTripReplay((): TripReplayDeps | null => {
      if (typeof google === 'undefined' || !google.maps?.StreetViewService) return null;
      return {
        lookupPano: createMeteredPanoLookup(new google.maps.StreetViewService()),
        showPano: (panoId) => live.current.teleportToPanoSafe(panoId),
        applyView(hop) {
          const p = live.current;
          p.setHeading(hop.heading);
          p.setPitch(hop.pitch);
          p.setZoom(hop.zoom);
          p.setCarHeading(hop.carHeading);
        },
        applyEnvironment(hop) {
          const { env } = live.current;
          env.setRainIntensity(hop.weather.rain);
          env.setSnowIntensity(hop.weather.snow);
          env.setWind(hop.weather.wind);
          env.setFogDensity(hop.weather.fog);
          if (env.timeOfDay !== hop.weather.timeOfDay) env.setTimeOfDay(hop.weather.timeOfDay);
          env.setNightIntensity(hop.nightIntensity);
          if (hop.look && hop.look !== env.activeLookId) env.applyLookPack(hop.look);
        },
        async findPanoForYear(hop) {
          const entries = await getHistoricalImagery(hop.lat, hop.lng);
          return pickHistoricalEntryForYear(entries, hop.panoDate?.slice(0, 4))?.panoId ?? null;
        },
      };
    });
    return () => {
      stopReplay();
      configureTripReplay(null);
    };
  }, []);

  // `?trip=` boot link: keep the recording, plan its route, open the panel.
  // Replaying it is the viewer's choice (it is metered on their quota).
  const bootHandled = useRef(false);
  useEffect(() => {
    if (bootHandled.current || !params.isConnected || !params.isPanoramaReady) return;
    bootHandled.current = true;
    void (async () => {
      const recording = await readTripLink();
      if (!recording) return;
      await saveTripRecording(recording);
      tripLibrary.update({ albumId: recording.id });
      live.current.openTripPanel();
      if (tripStore.get().route?.id !== recording.routeId) {
        await planTrip(recording.stops, createConfiguredRouteProvider());
      }
    })();
  }, [params.isConnected, params.isPanoramaReady]);

  const onReplay = useCallback((id: string) => {
    const recording = tripLibrary.find(id);
    if (!recording) return;
    live.current.setIsCruiseMode(false);
    if (!startReplay(recording)) {
      setImportError('Street View is not ready yet — try again once the map has loaded.');
    }
  }, []);

  const onExport = useCallback((id: string) => {
    const recording = tripLibrary.find(id);
    if (!recording) return;
    void encodeTripFile(recording).then((blob) => {
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = tripFileName(recording);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    });
  }, []);

  const onShareLink = useCallback(async (id: string): Promise<string | null> => {
    const recording = tripLibrary.find(id);
    return recording ? buildTripLinkUrl(recording) : null;
  }, []);

  const onImport = useCallback((file: File) => {
    setImportError(null);
    void decodeTripFile(file).then(async (recording) => {
      if (!recording) {
        setImportError('That file is not a road trip recording this app can read.');
        return;
      }
      await saveTripRecording(recording);
      tripLibrary.update({ albumId: recording.id });
    });
  }, []);

  const onDelete = useCallback((id: string) => {
    if (tripLibrary.get().replay?.recordingId === id) stopReplay();
    void deleteTripRecording(id);
  }, []);

  const onShowAlbum = useCallback((id: string | null) => tripLibrary.update({ albumId: id }), []);

  return {
    snapshots: params.snapshots,
    importError,
    onReplay,
    onPauseReplay: pauseReplay,
    onResumeReplay: resumeReplay,
    onStopReplay: stopReplay,
    onSeekReplay: seekReplay,
    onExport,
    onShareLink,
    onImport,
    onDelete,
    onShowAlbum,
  };
}
