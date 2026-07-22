import { useRef, useCallback } from 'react';
import WelcomeModal from '../components/WelcomeModal';
import {
  useStreetView,
  useViewMode,
  useEnvironmentSettings,
  useAdvanceSafe,
} from '../hooks';
import { useOfflineStatus } from '../hooks/useOfflineStatus';
import { useSharedSession } from '../hooks/useSharedSession';
import { useBookmarks } from '../hooks/useBookmarks';
import { useLocationHistory } from '../hooks/useLocationHistory';
import { useSnapshots } from '../hooks/useSnapshots';
import { useGlobeMode } from '../hooks/useGlobeMode';
import { useKeyboardShortcuts, useAnnouncer, SkipLink } from '../hooks/useKeyboardShortcuts';
import { useCruiseMode } from '../hooks/useCruiseMode';
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
  const { viewMode, toggleViewMode } = useViewMode();
  const env = useEnvironmentSettings();
  const panels = useAppPanels();
  const { isOnline, hasServiceWorker } = useOfflineStatus();
  const sharedSession = useSharedSession();
  const { showPerformanceStats, setShowPerformanceStats, memoryStats, perfStats } = useAppTelemetry();
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
  const { snapshots, removeSnapshot, updateSnapshotName, downloadSnapshot, clearAllSnapshots } =
    useSnapshots();
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
  });

  const { isCruiseMode, setIsCruiseMode } = useCruiseMode({
    panorama,
    advanceSafe,
    mapsAuthFailed: maps.mapsAuthFailed,
    heading,
    isTransitioning,
    setNavPending: connection.setNavPending,
  });
  onAuthFailureRef.current = () => setIsCruiseMode(false);

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
      isTourPanelOpen: panels.isTourPanelOpen,
      setIsTourPanelOpen: panels.setIsTourPanelOpen,
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
    connection.isConnected && !connection.showWelcome,
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

      {connection.showWelcome && <WelcomeModal onStart={connection.handleStart} />}

      {connection.isConnected && (
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
            rendererBackendInfo: connection.rendererBackendInfo,
            navPending: connection.navPending,
            historicalAfterLabel: historical.historicalAfterLabel,
          }}
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
