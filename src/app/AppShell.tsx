import { useRef, useCallback, useEffect } from 'react';
import WelcomeModal from '../components/WelcomeModal';
import { getWindAudio } from '../effects/WindAudio';
import {
  useStreetView,
  useViewMode,
  useEnvironmentSettings,
  useAdvanceSafe,
  useRoutePrefetch,
  usePlaceSearch,
  useVehicleSettings,
} from '../hooks';
import { useOfflineStatus } from '../hooks/useOfflineStatus';
import { useLocationHistory } from '../hooks/useLocationHistory';
import { useGlobeMode } from '../hooks/useGlobeMode';
import { useAnnouncer } from '../hooks/useKeyboardShortcuts';
import { useCruiseMode } from '../hooks/useCruiseMode';
import { useCinemaMode } from '../hooks/useCinemaMode';
import { publishCruiseFlag } from '../hooks/CruiseFlagContext';
import { loadCarRuntime } from '../car/carRuntimeLoader';
import { vehicleManager, type VehicleType } from '../car/VehicleManager';
import { useAutopilot } from '../hooks/useAutopilot';
import { useGlobeTeleport } from '../hooks/useGlobeTeleport';
import BuildBadge from '../components/BuildBadge';
import { getCarRuntime } from './carRuntimeCache';
import { useAppPanels } from './useAppPanels';
import { useAppTelemetry } from './useAppTelemetry';
import { useMapsBootstrap } from './useMapsBootstrap';
import { useAppSharedSession } from './useAppSharedSession';
import { useRadioAudio } from './useRadioAudio';
import { useHistoricalExperience } from './useHistoricalExperience';
import { useTourBindings } from './useTourBindings';
import { useAppAccessibility } from './useAppAccessibility';
import { useAppConnection } from './useAppConnection';
import { useAppBookmarks } from './useAppBookmarks';
import { useAppCapture } from './useAppCapture';
import { useAppDirector } from './useAppDirector';
import { useAppBootLinks } from './useAppBootLinks';
import { useAppShortcuts } from './useAppShortcuts';
import { ConnectedChrome } from './shell/ConnectedChrome';
import { CinemaLayer } from './shell/CinemaLayer';
import { ShellNotices } from './shell/ShellNotices';
import { StreetViewStage } from './shell/StreetViewStage';

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
  const { viewMode, toggleViewMode, setViewMode, carHeading, setCarHeading } = useViewMode();
  // Read by the cruise tick, which must see the live mode without re-arming.
  const viewModeRef = useRef(viewMode);
  viewModeRef.current = viewMode;
  const { currentVehicle } = useVehicleSettings();
  const env = useEnvironmentSettings();
  const panels = useAppPanels();
  const { isOnline, hasServiceWorker } = useOfflineStatus();
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
  const { isCinemaMode } = cinema;

  const { weatherPresetBroadcast, getDirectorSnapshot, applyDirectorKeyframe } = useAppDirector(env);

  useEffect(() => {
    getWindAudio().setHeadingPan(heading, carHeading);
  }, [heading, carHeading]);

  const bookmarks = useAppBookmarks(panorama, heading, pitch);
  const { history, removeFromHistory, clearHistory } = useLocationHistory();
  const globeMode = useGlobeMode();

  const historical = useHistoricalExperience({
    panorama,
    renderer,
    teleportToPanoSafe,
    readyPromise,
  });

  const currentImageDate =
    historical.historicalCurrentIndex >= 0
      ? historical.historicalEntries[historical.historicalCurrentIndex]?.imageDate ?? null
      : null;

  const capture = useAppCapture({
    panorama,
    renderer,
    viewMode,
    heading,
    pitch,
    zoom,
    locationName,
    currentImageDate,
    lookId: env.activeLookId,
    vehicleType: currentVehicle,
    teleportSafe,
    teleportToPanoSafe,
    setHeading,
    setPitch,
  });

  const setSessionVehicle = useCallback((type: VehicleType) => {
    vehicleManager.setVehicle(type);
    void loadCarRuntime().then((m) => m.setVehicleType(type));
  }, []);

  const sharedSession = useAppSharedSession({
    env,
    panorama,
    heading,
    pitch,
    zoom,
    viewMode,
    carHeading,
    vehicleType: currentVehicle,
    imageDate: currentImageDate,
    weatherPreset: weatherPresetBroadcast,
    hdr: connection.webgpuStatus === 'ready',
    teleportToPanoSafe,
    setHeading,
    setPitch,
    setZoom,
    setViewMode,
    setCarHeading,
    setSessionVehicle,
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
    hopsPerTick: () => (viewModeRef.current === 'car' ? (getCarRuntime()?.getGearHopCount() ?? 1) : 1),
  });
  onAuthFailureRef.current = () => setIsCruiseMode(false);

  useEffect(() => {
    publishCruiseFlag(isCruiseMode);
    return () => publishCruiseFlag(false);
  }, [isCruiseMode]);

  useAppBootLinks({
    isConnected: connection.isConnected,
    panorama,
    isPanoramaReady,
    historicalEntries: historical.historicalEntries,
    isHistoricalLoading: historical.isHistoricalLoading,
    teleportSafe,
    teleportToPanoSafe,
    setHeading,
    setPitch,
    setZoom,
    setSessionVehicle,
  });

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

  useAppShortcuts({
    panels,
    env,
    globeMode,
    viewMode,
    toggleViewMode,
    isCruiseMode,
    setIsCruiseMode,
    isCinemaMode,
    toggleCinemaMode: cinema.toggleCinemaMode,
    exitCinemaMode: cinema.exitCinemaMode,
    isRadioPlaying,
    toggleRadio,
    showPerformanceStats,
    setShowPerformanceStats,
    announce,
    enabled: connection.isConnected && !connection.showWelcome && !isCinemaMode,
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
      <ShellNotices maps={maps} isConnected={connection.isConnected} isOnline={isOnline} />

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
          bookmarks={bookmarks}
          history={{ history, removeFromHistory, clearHistory }}
          snapshots={{ ...capture.gallery, isOnline, hasServiceWorker }}
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

      {connection.isConnected && (
        <CinemaLayer
          cinema={cinema}
          renderer={renderer}
          panorama={panorama}
          heading={heading}
          pitch={pitch}
          zoom={zoom}
          lookId={env.activeLookId}
          vehicleType={currentVehicle}
          imageDate={currentImageDate}
          cabinOverlay={capture.cabinOverlay}
          onTakeSnapshot={capture.handleTakeSnapshot}
        />
      )}

      <StreetViewStage
        maps={maps}
        connection={connection}
        setCanvas={setCanvas}
        setPanorama={setPanorama}
      />

      <BuildBadge />
    </div>
  );
}
