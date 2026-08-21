import { useRef, useCallback, useEffect, useMemo } from 'react';
import WelcomeModal from '../components/WelcomeModal';
import CinemaOverlay from '../components/CinemaOverlay';
import { parseDeepLinkParams } from '../utils/deepLink';
import {
  useStreetView,
  useViewMode,
  useEnvironmentSettings,
  useAdvanceSafe,
  useRoutePrefetch,
  usePlaceSearch,
} from '../hooks';
import { useOfflineStatus } from '../hooks/useOfflineStatus';
import { useSharedSession } from '../hooks/useSharedSession';
import { useBookmarks } from '../hooks/useBookmarks';
import { useLocationHistory } from '../hooks/useLocationHistory';
import { useSnapshots } from '../hooks/useSnapshots';
import { useGlobeMode } from '../hooks/useGlobeMode';
import { useKeyboardShortcuts, useAnnouncer, SkipLink } from '../hooks/useKeyboardShortcuts';
import { useCruiseMode } from '../hooks/useCruiseMode';
import { useCinemaMode } from '../hooks/useCinemaMode';
import { publishCruiseFlag } from '../hooks/CruiseFlagContext';
import { loadCarRuntime } from '../car/carRuntimeLoader';
import { vehicleManager } from '../car/VehicleManager';
import type { DirectorSnapshot } from '../hooks/useTours';
import type { TourDirectorKeyframe } from '../utils/tourDirector';
import { serializeWeatherPreset } from '../utils/weatherPresetSync';
import { useAutopilot } from '../hooks/useAutopilot';
import { buildAppKeyboardShortcuts } from '../hooks/useAppKeyboardShortcuts';
import { useGlobeTeleport } from '../hooks/useGlobeTeleport';
import AppBanners from '../components/AppBanners';
import BuildBadge from '../components/BuildBadge';
import { useAppPanels } from './useAppPanels';
import { useAppTelemetry } from './useAppTelemetry';
import { useMapsBootstrap } from './useMapsBootstrap';
import { buildMapsLoadingOverlay } from './mapsLoadingOverlay';
import { useSharedSessionSync } from './useSharedSessionSync';
import { useRadioAudio } from './useRadioAudio';
import { useHistoricalExperience } from './useHistoricalExperience';
import { useTourBindings } from './useTourBindings';
import { useAppAccessibility } from './useAppAccessibility';
import { useAppConnection } from './useAppConnection';
import { ConnectedChrome } from './shell/ConnectedChrome';
import { MapsAuthModal } from './shell/MapsAuthModal';
import { OfflineStatusToast } from './shell/OfflineStatusToast';
import { StreetViewStage } from './shell/StreetViewStage';
import { makePickerThumbDataUrl } from '../renderer/gpuChores/pickerThumb';

/** Cached car runtime for sync cruise gear hops once car mode has loaded. */
let carRuntimeModule: typeof import('../car/carModeRuntime') | null = null;
void loadCarRuntime().then((module) => {
  carRuntimeModule = module;
});

/** Main app layout: composition shell for feature controllers + chrome. */
export function AppShell() {
  const {
    setCanvas,
    setPanorama,
    panorama,
    heading,
    pitch,
    zoom,
    canvas,
    isTransitioning,
    isPanoramaReady,
    renderer,
    readyPromise,
    locationName,
    setHeading,
    setPitch,
    setZoom,
  } = useStreetView();
  const { advanceSafe, teleportSafe, teleportToPanoSafe, panoCache } = useAdvanceSafe();
  const routePrefetch = useRoutePrefetch();
  const { viewMode, toggleViewMode } = useViewMode();
  // Read by the cruise tick, which must see the live mode without re-arming.
  const viewModeRef = useRef(viewMode);
  viewModeRef.current = viewMode;
  const env = useEnvironmentSettings();
  const panels = useAppPanels();
  const { isOnline, hasServiceWorker } = useOfflineStatus();
  const sharedSession = useSharedSession();
  const { showPerformanceStats, setShowPerformanceStats, memoryStats, perfStats, gpuPassTimings, gpuChoresStats } = useAppTelemetry();
  const { announce } = useAnnouncer();
  const { accessibilitySettings, setAccessibilitySettings } = useAppAccessibility();
  const { audioRef, isRadioPlaying, setIsRadioPlaying, toggleRadio } = useRadioAudio();

  const onAuthFailureRef = useRef<() => void>(() => {});
  const maps = useMapsBootstrap({
    onAuthFailure: () => onAuthFailureRef.current(),
  });

  const connection = useAppConnection({
    canvas,
    mapsLoadStatus: maps.mapsLoadStatus,
    setMapsLoadStatus: maps.setMapsLoadStatus,
  });

  const cinema = useCinemaMode(connection.isConnected && !connection.showWelcome);
  const {
    isCinemaMode,
    letterbox,
    gradingLocked,
    toggleCinemaMode,
    exitCinemaMode,
    setLetterbox,
    setGradingLocked,
  } = cinema;

  const weatherPresetBroadcast = useMemo(
    () =>
      serializeWeatherPreset({
        timeOfDay: env.timeOfDay,
        rainIntensity: env.rainIntensity,
        snowIntensity: env.snowIntensity,
        fogDensity: env.fogDensity,
      }),
    [env.timeOfDay, env.rainIntensity, env.snowIntensity, env.fogDensity],
  );

  const getDirectorSnapshot = useCallback((): DirectorSnapshot | null => ({
    timeOfDay: env.timeOfDay,
    vehicle: vehicleManager.getCurrentVehicle(),
    rainIntensity: env.rainIntensity,
    snowIntensity: env.snowIntensity,
    fogDensity: env.fogDensity,
  }), [env.timeOfDay, env.rainIntensity, env.snowIntensity, env.fogDensity]);

  const applyDirectorKeyframe = useCallback(
    (frame: TourDirectorKeyframe) => {
      if (frame.timeOfDay) env.applyTimeOfDayPreset(frame.timeOfDay);
      if (frame.rainIntensity !== undefined) env.setRainIntensity(frame.rainIntensity);
      if (frame.snowIntensity !== undefined) env.setSnowIntensity(frame.snowIntensity);
      if (frame.fogDensity !== undefined) env.setFogDensity(frame.fogDensity);
      if (frame.colorGradingPreset) env.applyColorGradingPreset(frame.colorGradingPreset);
      if (frame.vehicle) vehicleManager.setVehicle(frame.vehicle);
    },
    [env],
  );

  const {
    bookmarks,
    addBookmark,
    removeBookmark,
    isSyncing: isBookmarkSyncing,
    syncError: bookmarkSyncError,
    loadCloudBookmarks,
    saveBookmarkToCloud,
    removeCloudBookmark,
    syncAllToCloud,
  } = useBookmarks();
  const { history, removeFromHistory, clearHistory } = useLocationHistory();
  const {
    snapshots,
    addSnapshot,
    removeSnapshot,
    updateSnapshotName,
    downloadSnapshot,
    clearAllSnapshots,
    getSnapshotDeepLink,
    shareSnapshot,
  } = useSnapshots();
  const globeMode = useGlobeMode();

  const historical = useHistoricalExperience({
    panorama,
    renderer,
    teleportToPanoSafe,
    readyPromise,
  });

  useSharedSessionSync({
    sharedSession,
    panorama,
    heading,
    pitch,
    zoom,
    viewMode,
    teleportToPanoSafe,
    setHeading,
    setPitch,
    setZoom,
    weatherPreset: weatherPresetBroadcast,
    applyTimeOfDayPreset: env.applyTimeOfDayPreset,
    setRainIntensity: env.setRainIntensity,
    setSnowIntensity: env.setSnowIntensity,
    setFogDensity: env.setFogDensity,
  });

  const { tourPanelProps } = useTourBindings({
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
    panoCacheFetch: panoCache.fetch,
    getDirectorSnapshot,
    applyDirectorKeyframe,
  });

  const { isCruiseMode, setIsCruiseMode } = useCruiseMode({
    panorama,
    advanceSafe,
    mapsAuthFailed: maps.mapsAuthFailed,
    heading,
    isTransitioning,
    setNavPending: connection.setNavPending,
    loadOfflineRouteGraphNodes: routePrefetch.loadAllCachedNodes,
    // In car mode the gearshift is the speed selector: P/N park cruise, D
    // keeps the classic single hop, 2/3 chain extra hops per tick. Free-look
    // has no gearbox, so it always cruises one hop at a time.
    hopsPerTick: () => (viewModeRef.current === 'car' ? (carRuntimeModule?.getGearHopCount() ?? 1) : 1),
  });
  onAuthFailureRef.current = () => setIsCruiseMode(false);

  useEffect(() => {
    publishCruiseFlag(isCruiseMode);
    return () => publishCruiseFlag(false);
  }, [isCruiseMode]);

  const handleAddBookmark = useCallback(
    (name: string) => {
      if (!panorama) return;
      const position = panorama.getPosition();
      if (!position) return;
      addBookmark({
        name,
        lat: position.lat(),
        lng: position.lng(),
        heading,
        pitch,
      });
    },
    [panorama, addBookmark, heading, pitch],
  );

  const handleTakeSnapshot = useCallback(() => {
    if (!panorama || !renderer) return;
    const position = panorama.getPosition();
    if (!position) return;
    const output = renderer.getOutputCanvas?.();
    const chores = renderer.getGpuChores?.();
    const thumbnailDataUrl = output
      ? makePickerThumbDataUrl(
          output,
          chores
            ? (rgba, w, h, dw, dh) => chores.downsampleRgba(rgba, w, h, dw, dh)
            : undefined,
        ) ?? undefined
      : undefined;
    addSnapshot({
      name: locationName || `Snapshot ${new Date().toLocaleString()}`,
      dataUrl: renderer.getCanvasDataURL(),
      thumbnailDataUrl,
      lat: position.lat(),
      lng: position.lng(),
      heading,
      pitch,
      zoom,
      locationName,
      panoId: panorama.getPano() || undefined,
    });
  }, [panorama, renderer, addSnapshot, heading, pitch, zoom, locationName]);

  const handleSnapshotTeleport = useCallback(
    async (lat: number, lng: number, targetHeading: number, targetPitch: number, panoId?: string) => {
      if (panoId) {
        await teleportToPanoSafe(panoId);
      } else {
        await teleportSafe(lat, lng, targetHeading, targetPitch);
      }
      setHeading(targetHeading);
      setPitch(targetPitch);
    },
    [teleportToPanoSafe, teleportSafe, setHeading, setPitch],
  );

  // Consume `?lat=&lng=&heading=&pitch=&zoom=&pano=` deep-link params once Maps/panorama are ready.
  const deepLinkConsumedRef = useRef(false);
  useEffect(() => {
    if (deepLinkConsumedRef.current) return;
    if (!connection.isConnected || !panorama || !isPanoramaReady) return;
    deepLinkConsumedRef.current = true;

    const params = parseDeepLinkParams();
    if (!params) return;

    (async () => {
      try {
        if (params.panoId) {
          await teleportToPanoSafe(params.panoId);
        } else {
          await teleportSafe(params.lat, params.lng, params.heading, params.pitch);
        }
        setHeading(params.heading);
        setPitch(params.pitch);
        setZoom(params.zoom);
      } catch (error) {
        console.warn('[deepLink] Failed to apply deep link params:', error);
      }
    })();
  }, [
    connection.isConnected,
    panorama,
    isPanoramaReady,
    teleportToPanoSafe,
    teleportSafe,
    setHeading,
    setPitch,
    setZoom,
  ]);

  const getCurrentPosition = useCallback(() => {
    const pos = panorama?.getPosition();
    if (!pos) return null;
    return { lat: pos.lat(), lng: pos.lng() };
  }, [panorama]);

  const placeSearch = usePlaceSearch({
    teleportSafe,
    teleportToPanoSafe,
    getCurrentPosition,
    heading,
    pitch,
    zoom,
  });

  const handleGlobeTeleport = useGlobeTeleport({
    teleportSafe,
    applyTimeOfDayPreset: env.applyTimeOfDayPreset,
    applyColorGradingPreset: env.applyColorGradingPreset,
    globeMode,
    audioRef,
    setNavPending: connection.setNavPending,
    setIsRadioPlaying,
  });

  const { handleStartJourney } = useAutopilot({
    teleportSafe,
    handleGlobeTeleport,
    panoCache,
    isTransitioning,
    setNavPending: connection.setNavPending,
  });

  useKeyboardShortcuts(
    buildAppKeyboardShortcuts({
      showPerformanceStats,
      setShowPerformanceStats,
      timeOfDay: env.timeOfDay,
      applyTimeOfDayPreset: env.applyTimeOfDayPreset,
      isRadioPlaying,
      toggleRadio,
      isMapOpen: panels.isMapOpen,
      setIsMapOpen: panels.setIsMapOpen,
      isBookmarkPanelOpen: panels.isBookmarkPanelOpen,
      setIsBookmarkPanelOpen: panels.setIsBookmarkPanelOpen,
      isHistoryPanelOpen: panels.isHistoryPanelOpen,
      setIsHistoryPanelOpen: panels.setIsHistoryPanelOpen,
      isSnapshotGalleryOpen: panels.isSnapshotGalleryOpen,
      setIsSnapshotGalleryOpen: panels.setIsSnapshotGalleryOpen,
      isColorGradingPanelOpen: panels.isColorGradingPanelOpen,
      setIsColorGradingPanelOpen: panels.setIsColorGradingPanelOpen,
      isAccessibilityPanelOpen: panels.isAccessibilityPanelOpen,
      setIsAccessibilityPanelOpen: panels.setIsAccessibilityPanelOpen,
      isWeatherPanelOpen: panels.isWeatherPanelOpen,
      setIsWeatherPanelOpen: panels.setIsWeatherPanelOpen,
      isLooksPanelOpen: panels.isLooksPanelOpen,
      setIsLooksPanelOpen: panels.setIsLooksPanelOpen,
      isTourPanelOpen: panels.isTourPanelOpen,
      setIsTourPanelOpen: panels.setIsTourPanelOpen,
      isCinemaMode,
      toggleCinemaMode,
      exitCinemaMode,
      viewMode,
      toggleViewMode,
      wipersEnabled: env.wipersEnabled,
      toggleWipers: env.toggleWipers,
      headlightsOn: env.headlightsOn,
      toggleHeadlights: env.toggleHeadlights,
      toggleDomeLight: env.toggleDomeLight,
      isRoofOpen: env.isRoofOpen,
      toggleRoof: env.toggleRoof,
      isCruiseMode,
      setIsCruiseMode,
      globeMode,
      announce,
    }),
    connection.isConnected && !connection.showWelcome && !isCinemaMode,
  );

  const mapsLoadingOverlay = buildMapsLoadingOverlay({
    isConnected: connection.isConnected,
    effectiveMapsKey: maps.effectiveMapsKey,
    mapsLoadStatus: maps.mapsLoadStatus,
    isRetryingMapsAuth: maps.isRetryingMapsAuth,
    webgpuStatus: connection.webgpuStatus,
    isCanvasReady: connection.isCanvasReady,
    canvasError: maps.canvasError,
    mapsAuthError: maps.mapsAuthError,
    scraperHealth: maps.scraperHealth,
    handleRetryMapsAuth: maps.handleRetryMapsAuth,
    webgpuFailureReason:
      connection.rendererBackendInfo?.fallbackReason ||
      (typeof window !== 'undefined' ? window.webgpuProbe?.reason : undefined) ||
      null,
  });

  return (
    <div
      id="app-container"
      style={{
        position: 'relative',
        width: '100vw',
        height: '100vh',
        overflow: 'hidden',
        padding: 0,
        margin: 0,
        backgroundColor: '#000',
      }}
    >
      <SkipLink targetId="main-content">Skip to main content</SkipLink>

      <AppBanners
        showMissingKeyBanner={maps.showMissingKeyBanner}
        setShowMissingKeyBanner={maps.setShowMissingKeyBanner}
        showAuthFailedBanner={maps.showAuthFailedBanner}
        setShowAuthFailedBanner={maps.setShowAuthFailedBanner}
        isRecoveringMapsAuth={maps.isRetryingMapsAuth}
        scrapeLost={
          maps.scraperHealth.everStable && maps.scraperHealth.status === 'lost'
        }
        scrapeLostDetail={maps.scraperHealth.lastErrorDetail}
      />

      <OfflineStatusToast visible={connection.isConnected && !isOnline} />

      <MapsAuthModal
        open={maps.mapsAuthFailed}
        mapsAuthError={maps.mapsAuthError}
        isRetryingMapsAuth={maps.isRetryingMapsAuth}
        onRetry={maps.handleRetryMapsAuth}
        onDismiss={maps.dismissAuthBlock}
      />

      {connection.showWelcome && <WelcomeModal onStart={connection.handleStart} search={placeSearch} />}

      {connection.isConnected && !isCinemaMode && (
        <ConnectedChrome
          panels={panels}
          session={{
            viewMode,
            toggleViewMode,
            isCruiseMode,
            setIsCruiseMode,
            isPanoramaReady,
            isRadioPlaying,
            toggleRadio,
            sharedSession,
            panorama,
            heading,
            isTransitioning,
            teleportToPanoSafe,
          }}
          bookmarks={{
            bookmarks,
            handleAddBookmark,
            removeBookmark,
            isBookmarkSyncing,
            bookmarkSyncError,
            loadCloudBookmarks,
            saveBookmarkToCloud,
            removeCloudBookmark,
            syncAllToCloud,
          }}
          history={{ history, removeFromHistory, clearHistory }}
          snapshots={{
            snapshots,
            isOnline,
            hasServiceWorker,
            removeSnapshot,
            updateSnapshotName,
            downloadSnapshot,
            clearAllSnapshots,
            getSnapshotDeepLink,
            shareSnapshot,
            onTeleport: handleSnapshotTeleport,
            onTakeSnapshot: handleTakeSnapshot,
          }}
          environment={env}
          historical={historical}
          accessibilitySettings={accessibilitySettings}
          setAccessibilitySettings={setAccessibilitySettings}
          tourPanelProps={tourPanelProps}
          globe={{
            globeMode,
            effectiveMapsKey: maps.effectiveMapsKey,
            handleGlobeTeleport,
            handleStartJourney,
          }}
          overlays={{
            showPerformanceStats,
            setShowPerformanceStats,
            perfStats,
            memoryStats: memoryStats || undefined,
            gpuPassTimings,
            gpuChoresStats,
            rendererBackendInfo: connection.rendererBackendInfo,
            navPending: connection.navPending,
            historicalAfterLabel: historical.historicalAfterLabel,
          }}
          offlineRoutes={{
            summaries: routePrefetch.summaries,
            onDelete: (routeId) => void routePrefetch.deleteRouteGraph(routeId),
            onRefresh: () => void routePrefetch.refreshSummaries(),
          }}
          search={placeSearch}
        />
      )}

      {connection.isConnected && isCinemaMode && (
        <CinemaOverlay
          visible={isCinemaMode}
          letterbox={letterbox}
          onToggleLetterbox={() => setLetterbox(!letterbox)}
          gradingLocked={gradingLocked}
          onToggleGradingLock={() => setGradingLocked(!gradingLocked)}
          renderer={renderer}
          onExit={exitCinemaMode}
          onTakeSnapshot={handleTakeSnapshot}
        />
      )}

      <StreetViewStage
        maps={maps}
        connection={connection}
        setCanvas={setCanvas}
        setPanorama={setPanorama}
        mapsLoadingOverlay={mapsLoadingOverlay}
      />

      <BuildBadge />
    </div>
  );
}
