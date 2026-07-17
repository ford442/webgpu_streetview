import { useState, useRef, useEffect, useCallback, lazy, Suspense } from 'react';
import StreetView from '../components/StreetView';
import WelcomeModal from '../components/WelcomeModal';
import type { RendererBackendType } from '../renderer/RendererBackend';
import {
  useStreetView,
  useViewMode,
  useEnvironmentSettings,
  useAdvanceSafe,
  type TimeOfDay,
} from '../hooks';
import { MainView } from '../views';
import {
  BookmarkPanel,
  HistoryPanel,
  SnapshotGallery,
  ColorGradingPanel,
  WeatherPanel,
  AccessibilityPanel,
  PerformanceStatsOverlay,
  RendererBackendIndicator,
  WebGPUCanvas,
  LoadingOverlay,
  HistoricalTimeline,
  ComparisonView,
  TourPanel,
  SharedSessionPanel,
} from '../components';
import StorageManagementPanel from '../components/StorageManagementPanel';
import { useHistoricalTimeline } from '../hooks/useHistoricalTimeline';
import { useHistoricalCompare } from '../hooks/useHistoricalCompare';
import { useOfflineStatus } from '../hooks/useOfflineStatus';
import { useSharedSession } from '../hooks/useSharedSession';
import { migrateLocalStorageToIndexedDB } from '../offline/offlinePersistence';
import { formatImageDate } from '../utils/historicalImagery';
import { useBookmarks } from '../hooks/useBookmarks';
import { useLocationHistory } from '../hooks/useLocationHistory';
import { useSnapshots } from '../hooks/useSnapshots';
import { useTours, type CurrentPOV } from '../hooks/useTours';
import { useGlobeMode } from '../hooks/useGlobeMode';
import {
  useKeyboardShortcuts,
  useAnnouncer,
  loadAccessibilitySettings,
  AccessibilitySettings,
  SkipLink,
} from '../hooks/useKeyboardShortcuts';
import { useCruiseMode } from '../hooks/useCruiseMode';
import { useAutopilot } from '../hooks/useAutopilot';
import { buildAppKeyboardShortcuts } from '../hooks/useAppKeyboardShortcuts';
import { useGlobeTeleport } from '../hooks/useGlobeTeleport';
import AppToolbar from '../components/AppToolbar';
import AppBanners from '../components/AppBanners';
import BuildBadge from '../components/BuildBadge';
import { useAppPanels } from './useAppPanels';
import { useAppTelemetry } from './useAppTelemetry';
import { useMapsBootstrap } from './useMapsBootstrap';
import { buildMapsLoadingOverlay } from './mapsLoadingOverlay';

const GlobeView = lazy(() => import('../components/GlobeView'));

/** Main app layout: toolbar, panels, Street View scraper, WebGPU canvas, and views. */
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
  const {
    rainIntensity,
    setRainIntensity,
    snowIntensity,
    setSnowIntensity,
    wind,
    setWind,
    wipersEnabled,
    toggleWipers,
    headlightsOn,
    toggleHeadlights,
    toggleDomeLight,
    isRoofOpen,
    toggleRoof,
    timeOfDay,
    applyTimeOfDayPreset,
    fogDensity,
    setFogDensity,
    vibrance,
    setVibrance,
    saturation,
    setSaturation,
    contrast,
    setContrast,
    exposure,
    setExposure,
    temperature,
    setTemperature,
    tint,
    setTint,
    shaderEffectsEnabled,
    setShaderEffectsEnabled,
    applyColorGradingPreset,
  } = useEnvironmentSettings();

  const panels = useAppPanels();
  const {
    isBookmarkPanelOpen,
    setIsBookmarkPanelOpen,
    isHistoryPanelOpen,
    setIsHistoryPanelOpen,
    isSnapshotGalleryOpen,
    setIsSnapshotGalleryOpen,
    isColorGradingPanelOpen,
    setIsColorGradingPanelOpen,
    isWeatherPanelOpen,
    setIsWeatherPanelOpen,
    isAccessibilityPanelOpen,
    setIsAccessibilityPanelOpen,
    isHistoricalTimelineOpen,
    setIsHistoricalTimelineOpen,
    isTourPanelOpen,
    setIsTourPanelOpen,
    isSharedSessionPanelOpen,
    setIsSharedSessionPanelOpen,
    isMapOpen,
    setIsMapOpen,
    isStoragePanelOpen,
    setIsStoragePanelOpen,
  } = panels;

  const { isOnline, hasServiceWorker } = useOfflineStatus();
  const sharedSession = useSharedSession();
  const sharedSessionLastAppliedPanoRef = useRef<string | null>(null);

  const { showPerformanceStats, setShowPerformanceStats, memoryStats, perfStats } = useAppTelemetry();

  const onAuthFailureRef = useRef<() => void>(() => {});
  const maps = useMapsBootstrap({
    onAuthFailure: () => onAuthFailureRef.current(),
  });
  const {
    effectiveMapsKey,
    mapsLoadStatus,
    setMapsLoadStatus,
    mapsAuthFailed,
    mapsAuthError,
    isRetryingMapsAuth,
    showMissingKeyBanner,
    setShowMissingKeyBanner,
    showAuthFailedBanner,
    setShowAuthFailedBanner,
    canvasError,
    setCanvasError,
    scraperRef,
    handleMapsStatusChange,
    handleRetryMapsAuth,
    dismissAuthBlock,
  } = maps;

  const [showWelcome, setShowWelcome] = useState(true);
  const [isConnected, setIsConnected] = useState(false);
  const [webGPUAvailable, setWebGPUAvailable] = useState(true);
  const [webgpuStatus, setWebgpuStatus] = useState<'initializing' | 'ready' | 'fallback'>('initializing');
  const [rendererBackendInfo, setRendererBackendInfo] = useState<{
    backendType: RendererBackendType | null;
    fallbackReason?: string;
  } | null>(null);
  const [isRadioPlaying, setIsRadioPlaying] = useState(false);
  const [isCanvasReady, setIsCanvasReady] = useState(false);
  const [navPending, setNavPending] = useState(false);
  const [accessibilitySettings, setAccessibilitySettings] = useState<AccessibilitySettings>(() =>
    loadAccessibilitySettings(),
  );

  const { announce } = useAnnouncer();

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
  const { snapshots, removeSnapshot, updateSnapshotName, downloadSnapshot, clearAllSnapshots } = useSnapshots();
  const {
    tours,
    isRecording: isTourRecording,
    isPaused: isTourPaused,
    draftWaypoints: tourDraftWaypoints,
    startRecording: startTourRecording,
    pauseRecording: pauseTourRecording,
    resumeRecording: resumeTourRecording,
    stopRecording: stopTourRecording,
    cancelRecording: cancelTourRecording,
    addWaypointFromCurrent: addTourWaypoint,
    deleteTour,
    renameTour,
    updateTourSettings,
    downloadTourJson,
    downloadTourKml,
    importTourFromJson,
  } = useTours();
  const globeMode = useGlobeMode();

  const {
    entries: historicalEntries,
    isLoading: isHistoricalLoading,
    error: historicalError,
    hasTimeline: hasHistoricalTimeline,
    currentIndex: historicalCurrentIndex,
    currentPanoId: historicalCurrentPanoId,
  } = useHistoricalTimeline(panorama);
  const {
    compare: compareHistorical,
    exitCompare: exitHistoricalCompare,
    comparison: historicalComparison,
    isCapturing: isCapturingComparison,
  } = useHistoricalCompare({
    renderer,
    teleportToPanoSafe,
    readyPromise,
    getCurrentPanoId: () => panorama?.getPano() || null,
  });
  const historicalAfterEntry = historicalEntries.find((e) => e.panoId === historicalCurrentPanoId);
  const historicalAfterLabel = historicalAfterEntry ? formatImageDate(historicalAfterEntry.imageDate) : 'Current';

  // Shared Exploration Sessions — host broadcasts POV at 10Hz to connected guests.
  useEffect(() => {
    if (sharedSession.role !== 'host' || !sharedSession.isConnected) return;
    const interval = setInterval(() => {
      if (!panorama) return;
      const panoId = panorama.getPano();
      const pos = panorama.getPosition();
      if (!panoId || !pos) return;
      sharedSession.broadcastState({
        panoId,
        position: { lat: pos.lat(), lng: pos.lng() },
        pov: { heading, pitch, zoom },
        viewMode,
      });
    }, 100);
    return () => clearInterval(interval);
  }, [sharedSession.role, sharedSession.isConnected, sharedSession.broadcastState, panorama, heading, pitch, zoom, viewMode]);

  // Shared Exploration Sessions — guests follow the host's POV as it arrives.
  useEffect(() => {
    if (sharedSession.role !== 'guest') return;
    const state = sharedSession.latestState;
    if (!state) return;

    const currentPanoId = panorama?.getPano();
    if (state.panoId && state.panoId !== currentPanoId && state.panoId !== sharedSessionLastAppliedPanoRef.current) {
      sharedSessionLastAppliedPanoRef.current = state.panoId;
      teleportToPanoSafe(state.panoId);
    }
    setHeading(state.pov.heading);
    setPitch(state.pov.pitch);
    setZoom(state.pov.zoom);
  }, [sharedSession.role, sharedSession.latestState, panorama, teleportToPanoSafe, setHeading, setPitch, setZoom]);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const audioSourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const geocoderRef = useRef<google.maps.Geocoder | null>(null);

  const handleWebGPUStatus = useCallback((available: boolean) => {
    setWebGPUAvailable(available);
    setWebgpuStatus(available ? 'ready' : 'fallback');
  }, []);
  const handleBackendInfo = useCallback(
    (info: { backendType: RendererBackendType | null; fallbackReason?: string }) => {
      setRendererBackendInfo(info);
    },
    [],
  );

  useEffect(() => {
    void migrateLocalStorageToIndexedDB().catch((err) => {
      console.warn('[Offline] IndexedDB migration skipped:', err);
    });
  }, []);

  useEffect(() => {
    if (!audioRef.current) {
      const el = new Audio('https://stream.zeno.fm/ywcmn7hpha0uv');
      el.crossOrigin = 'anonymous';
      audioRef.current = el;
    }
    return () => {
      audioCtxRef.current?.close();
    };
  }, []);

  useEffect(() => {
    document.body.classList.toggle('high-contrast', accessibilitySettings.highContrast);
    document.body.classList.toggle('reduced-motion', accessibilitySettings.reducedMotion);
    document.body.classList.toggle('large-text', accessibilitySettings.largeText);
    document.body.classList.toggle('keyboard-only-mode', accessibilitySettings.keyboardOnlyMode);
  }, [accessibilitySettings]);

  useEffect(() => {
    if (canvas && !isCanvasReady) {
      setIsCanvasReady(true);
      console.log('[App] Canvas is ready');
    }
  }, [canvas, isCanvasReady]);

  useEffect(() => {
    if (
      isCanvasReady &&
      webgpuStatus !== 'initializing' &&
      mapsLoadStatus !== 'api-error' &&
      mapsLoadStatus !== 'canvas-timeout'
    ) {
      setMapsLoadStatus('rendering');
    }
  }, [isCanvasReady, mapsLoadStatus, webgpuStatus, setMapsLoadStatus]);

  const handleStart = () => {
    setShowWelcome(false);
    setIsConnected(true);
  };

  const { isCruiseMode, setIsCruiseMode } = useCruiseMode({
    panorama,
    advanceSafe,
    mapsAuthFailed,
    heading,
    isTransitioning,
    setNavPending,
  });

  onAuthFailureRef.current = () => setIsCruiseMode(false);

  const toggleRadio = () => {
    if (!audioRef.current) return;
    if (isRadioPlaying) {
      audioRef.current.pause();
    } else {
      if (!audioCtxRef.current) {
        const ctx = new AudioContext();
        audioCtxRef.current = ctx;
        if (!audioSourceRef.current) {
          audioSourceRef.current = ctx.createMediaElementSource(audioRef.current);
          audioSourceRef.current.connect(ctx.destination);
        }
      }
      if (audioCtxRef.current.state === 'suspended') {
        audioCtxRef.current.resume();
      }
      audioRef.current.play().catch((e) => console.error('Audio play failed:', e));
    }
    setIsRadioPlaying(!isRadioPlaying);
  };

  const handleAddBookmark = (name: string) => {
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
  };

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

  const handleGlobeTeleport = useGlobeTeleport({
    teleportSafe,
    applyTimeOfDayPreset,
    applyColorGradingPreset,
    globeMode,
    audioRef,
    setNavPending,
    setIsRadioPlaying,
  });

  const { handleStartJourney } = useAutopilot({
    teleportSafe,
    handleGlobeTeleport,
    panoCache,
    isTransitioning,
    setNavPending,
  });

  const shortcuts = buildAppKeyboardShortcuts({
    showPerformanceStats,
    setShowPerformanceStats,
    timeOfDay,
    applyTimeOfDayPreset,
    isRadioPlaying,
    toggleRadio,
    isMapOpen,
    setIsMapOpen,
    isBookmarkPanelOpen,
    setIsBookmarkPanelOpen,
    isHistoryPanelOpen,
    setIsHistoryPanelOpen,
    isSnapshotGalleryOpen,
    setIsSnapshotGalleryOpen,
    isColorGradingPanelOpen,
    setIsColorGradingPanelOpen,
    isAccessibilityPanelOpen,
    setIsAccessibilityPanelOpen,
    isWeatherPanelOpen,
    setIsWeatherPanelOpen,
    isTourPanelOpen,
    setIsTourPanelOpen,
    viewMode,
    toggleViewMode,
    rainIntensity,
    wipersEnabled,
    toggleWipers,
    headlightsOn,
    toggleHeadlights,
    toggleDomeLight,
    isRoofOpen,
    toggleRoof,
    isCruiseMode,
    setIsCruiseMode,
    globeMode,
    announce,
  });

  useKeyboardShortcuts(shortcuts, isConnected && !showWelcome);

  const mapsLoadingOverlay = buildMapsLoadingOverlay({
    isConnected,
    effectiveMapsKey,
    mapsLoadStatus,
    isRetryingMapsAuth,
    webgpuStatus,
    isCanvasReady,
    canvasError,
    mapsAuthError,
    handleRetryMapsAuth,
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
        showMissingKeyBanner={showMissingKeyBanner}
        setShowMissingKeyBanner={setShowMissingKeyBanner}
        showAuthFailedBanner={showAuthFailedBanner}
        setShowAuthFailedBanner={setShowAuthFailedBanner}
        isRecoveringMapsAuth={isRetryingMapsAuth}
      />

      {isConnected && !isOnline && (
        <div
          role="status"
          style={{
            position: 'fixed',
            top: 12,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 2400,
            background: 'rgba(255,152,0,0.92)',
            color: '#111',
            padding: '8px 16px',
            borderRadius: 999,
            fontSize: 13,
            fontWeight: 600,
            fontFamily: 'system-ui, sans-serif',
            boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
          }}
        >
          Offline — saved snapshots, bookmarks, and tours remain available
        </div>
      )}

      {mapsAuthFailed && (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="maps-auth-error-title"
          aria-describedby="maps-auth-error-description"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 2500,
            background: 'rgba(0,0,0,0.82)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
            color: '#fff',
            fontFamily: 'system-ui, sans-serif',
          }}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <div
            style={{
              width: 'min(560px, 100%)',
              background: 'linear-gradient(145deg, rgba(32,12,12,0.98), rgba(10,10,10,0.98))',
              border: '1px solid rgba(255,120,120,0.55)',
              borderRadius: 16,
              boxShadow: '0 24px 80px rgba(0,0,0,0.55)',
              padding: 28,
            }}
          >
            <div
              style={{
                fontSize: 13,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                color: '#ffb3b3',
                marginBottom: 10,
              }}
            >
              Maps authentication failed
            </div>
            <h2 id="maps-auth-error-title" style={{ margin: '0 0 12px', fontSize: 28, lineHeight: 1.1 }}>
              Google Maps API key error
            </h2>
            <p
              id="maps-auth-error-description"
              style={{ margin: '0 0 16px', lineHeight: 1.5, color: 'rgba(255,255,255,0.88)' }}
            >
              {mapsAuthError ||
                'Google Maps API key error — check referrer restrictions and billing in Google Cloud Console.'}
            </p>
            <div
              style={{
                background: 'rgba(255,255,255,0.08)',
                borderRadius: 10,
                padding: 12,
                fontSize: 13,
                lineHeight: 1.45,
                marginBottom: 20,
              }}
            >
              Verify that this host is whitelisted under HTTP referrer restrictions, billing is enabled, and the Maps
              JavaScript API plus Street View dependencies are enabled for the key.
            </div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <button
                onClick={handleRetryMapsAuth}
                disabled={isRetryingMapsAuth}
                style={{
                  background: isRetryingMapsAuth ? 'rgba(255,255,255,0.22)' : '#ff6b6b',
                  border: 0,
                  borderRadius: 8,
                  color: '#fff',
                  cursor: isRetryingMapsAuth ? 'wait' : 'pointer',
                  fontWeight: 700,
                  padding: '10px 16px',
                }}
              >
                {isRetryingMapsAuth ? 'Retrying…' : 'Retry Maps'}
              </button>
              <button
                onClick={() => window.location.reload()}
                style={{
                  background: 'transparent',
                  border: '1px solid rgba(255,255,255,0.5)',
                  borderRadius: 8,
                  color: '#fff',
                  cursor: 'pointer',
                  padding: '10px 16px',
                }}
              >
                Reload page
              </button>
              <button
                onClick={dismissAuthBlock}
                style={{
                  background: 'transparent',
                  border: '1px solid rgba(255,255,255,0.35)',
                  borderRadius: 8,
                  color: 'rgba(255,255,255,0.7)',
                  cursor: 'pointer',
                  padding: '10px 16px',
                  fontSize: '13px',
                }}
                title="Clear error overlay (use if key was fixed externally; canvas may now load)"
              >
                Dismiss block
              </button>
            </div>
          </div>
        </div>
      )}

      {showWelcome && <WelcomeModal onStart={handleStart} />}

      {isConnected && showPerformanceStats && (
        <PerformanceStatsOverlay
          fpsStats={perfStats}
          memoryStats={memoryStats || undefined}
          position="top-left"
          visible={true}
          showMemory={true}
          onToggle={() => setShowPerformanceStats(false)}
        />
      )}

      {isConnected && <RendererBackendIndicator backendInfo={rendererBackendInfo} />}

      {isConnected && navPending && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'rgba(0,0,0,0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 999,
            color: '#4CAF50',
            fontSize: '1.2rem',
            fontFamily: 'system-ui, sans-serif',
            pointerEvents: 'none',
          }}
        >
          Loading next view…
        </div>
      )}

      {isConnected && historicalComparison && (
        <ComparisonView
          beforeUrl={historicalComparison.beforeUrl}
          afterUrl={historicalComparison.afterUrl}
          beforeEntry={historicalComparison.beforeEntry}
          afterLabel={historicalAfterLabel}
          onClose={exitHistoricalCompare}
        />
      )}

      {isConnected && (
        <>
          <AppToolbar
            isCruiseMode={isCruiseMode}
            setIsCruiseMode={setIsCruiseMode}
            isPanoramaReady={isPanoramaReady}
            isRadioPlaying={isRadioPlaying}
            toggleRadio={toggleRadio}
            isSnapshotGalleryOpen={isSnapshotGalleryOpen}
            setIsSnapshotGalleryOpen={setIsSnapshotGalleryOpen}
            isBookmarkPanelOpen={isBookmarkPanelOpen}
            setIsBookmarkPanelOpen={setIsBookmarkPanelOpen}
            isHistoryPanelOpen={isHistoryPanelOpen}
            setIsHistoryPanelOpen={setIsHistoryPanelOpen}
            isColorGradingPanelOpen={isColorGradingPanelOpen}
            setIsColorGradingPanelOpen={setIsColorGradingPanelOpen}
            isWeatherPanelOpen={isWeatherPanelOpen}
            setIsWeatherPanelOpen={setIsWeatherPanelOpen}
            isHistoricalTimelineOpen={isHistoricalTimelineOpen}
            setIsHistoricalTimelineOpen={setIsHistoricalTimelineOpen}
            isTourPanelOpen={isTourPanelOpen}
            setIsTourPanelOpen={setIsTourPanelOpen}
            isSharedSessionPanelOpen={isSharedSessionPanelOpen}
            setIsSharedSessionPanelOpen={setIsSharedSessionPanelOpen}
            isSharedSessionActive={sharedSession.isConnected}
            isStoragePanelOpen={isStoragePanelOpen}
            setIsStoragePanelOpen={setIsStoragePanelOpen}
            viewMode={viewMode}
            toggleViewMode={toggleViewMode}
            onGlobeToggle={globeMode.toggle}
          />

          {isSharedSessionPanelOpen && (
            <SharedSessionPanel
              isOpen={isSharedSessionPanelOpen}
              onClose={() => setIsSharedSessionPanelOpen(false)}
              role={sharedSession.role}
              status={sharedSession.status}
              error={sharedSession.error}
              inviteCode={sharedSession.inviteCode}
              joinCode={sharedSession.joinCode}
              isConnected={sharedSession.isConnected}
              onStartHosting={sharedSession.startHosting}
              onAdmitGuest={sharedSession.admitGuest}
              onJoinWithInviteCode={sharedSession.joinWithInviteCode}
              onLeave={sharedSession.leaveSession}
            />
          )}

          {isBookmarkPanelOpen && panorama && (
            <BookmarkPanel
              bookmarks={bookmarks}
              currentCoords={(() => {
                const pos = panorama.getPosition();
                return pos ? { lat: pos.lat(), lng: pos.lng() } : { lat: 0, lng: 0 };
              })()}
              onTeleport={(_lat, _lng, _h, _p) => {}}
              onAddBookmark={handleAddBookmark}
              onRemoveBookmark={removeBookmark}
              onClose={() => setIsBookmarkPanelOpen(false)}
              isOpen={isBookmarkPanelOpen}
              isSyncing={isBookmarkSyncing}
              syncError={bookmarkSyncError}
              onLoadCloudBookmarks={loadCloudBookmarks}
              onSaveBookmarkToCloud={saveBookmarkToCloud}
              onRemoveCloudBookmark={removeCloudBookmark}
              onSyncAllToCloud={syncAllToCloud}
            />
          )}

          {isHistoryPanelOpen && (
            <HistoryPanel
              history={history}
              onTeleport={(lat, lng, h, p) => {
                console.log('Teleport to:', lat, lng, h, p);
              }}
              onRemoveEntry={removeFromHistory}
              onClearHistory={clearHistory}
              onClose={() => setIsHistoryPanelOpen(false)}
              isOpen={isHistoryPanelOpen}
            />
          )}

          {isSnapshotGalleryOpen && (
            <SnapshotGallery
              snapshots={snapshots}
              isOffline={!isOnline}
              onRemoveSnapshot={removeSnapshot}
              onUpdateName={updateSnapshotName}
              onDownload={downloadSnapshot}
              onTeleport={(lat, lng, h, p) => {
                console.log('Teleport to:', lat, lng, h, p);
              }}
              onClose={() => setIsSnapshotGalleryOpen(false)}
              onClearAll={clearAllSnapshots}
              isOpen={isSnapshotGalleryOpen}
            />
          )}

          {isColorGradingPanelOpen && (
            <ColorGradingPanel
              vibrance={vibrance}
              saturation={saturation}
              contrast={contrast}
              exposure={exposure}
              temperature={temperature}
              tint={tint}
              nightIntensity={0}
              headlightsOn={headlightsOn}
              highBeam={false}
              shaderEffectsEnabled={shaderEffectsEnabled}
              onVibranceChange={setVibrance}
              onSaturationChange={setSaturation}
              onContrastChange={setContrast}
              onExposureChange={setExposure}
              onTemperatureChange={setTemperature}
              onTintChange={setTint}
              onNightIntensityChange={() => {}}
              onToggleHeadlights={toggleHeadlights}
              onToggleHighBeam={() => {}}
              onToggleShaderEffects={() => setShaderEffectsEnabled(!shaderEffectsEnabled)}
              onPreset={applyColorGradingPreset}
              onClose={() => setIsColorGradingPanelOpen(false)}
              isOpen={isColorGradingPanelOpen}
            />
          )}

          {isWeatherPanelOpen && (
            <WeatherPanel
              rainIntensity={rainIntensity}
              snowIntensity={snowIntensity}
              wind={wind}
              fogDensity={fogDensity}
              wipersEnabled={wipersEnabled}
              timeOfDay={timeOfDay}
              onRainIntensity={setRainIntensity}
              onSnowIntensity={setSnowIntensity}
              onWind={setWind}
              onFogDensity={setFogDensity}
              onToggleWipers={toggleWipers}
              onTimeOfDay={(v) => applyTimeOfDayPreset(v as TimeOfDay)}
              onClose={() => setIsWeatherPanelOpen(false)}
              isOpen={isWeatherPanelOpen}
            />
          )}

          {isHistoricalTimelineOpen && (
            <HistoricalTimeline
              isOpen={isHistoricalTimelineOpen}
              onClose={() => setIsHistoricalTimelineOpen(false)}
              entries={historicalEntries}
              isLoading={isHistoricalLoading}
              error={historicalError}
              hasTimeline={hasHistoricalTimeline}
              currentIndex={historicalCurrentIndex}
              isTransitioning={isTransitioning || isCapturingComparison}
              onSelectDate={(entry) => teleportToPanoSafe(entry.panoId)}
              onCompare={compareHistorical}
              isComparing={!!historicalComparison}
              onExitCompare={exitHistoricalCompare}
            />
          )}

          {isAccessibilityPanelOpen && (
            <AccessibilityPanel
              isOpen={isAccessibilityPanelOpen}
              settings={accessibilitySettings}
              onSettingsChange={setAccessibilitySettings}
              onClose={() => setIsAccessibilityPanelOpen(false)}
            />
          )}

          {isStoragePanelOpen && (
            <StorageManagementPanel
              isOpen={isStoragePanelOpen}
              onClose={() => setIsStoragePanelOpen(false)}
              isOnline={isOnline}
              hasServiceWorker={hasServiceWorker}
            />
          )}

          {isTourPanelOpen && (
            <TourPanel
              isOpen={isTourPanelOpen}
              onClose={() => setIsTourPanelOpen(false)}
              tours={tours}
              isRecording={isTourRecording}
              isPaused={isTourPaused}
              draftWaypoints={tourDraftWaypoints}
              getCurrentPOV={getCurrentPOV}
              currentLocationLabel={locationName}
              onStartRecording={(name, getPOV) => startTourRecording(name, getPOV)}
              onPauseRecording={pauseTourRecording}
              onResumeRecording={resumeTourRecording}
              onStopRecording={stopTourRecording}
              onCancelRecording={cancelTourRecording}
              onAddWaypoint={addTourWaypoint}
              onDeleteTour={deleteTour}
              onRenameTour={renameTour}
              onUpdateTourSettings={updateTourSettings}
              onDownloadTourJson={downloadTourJson}
              onDownloadTourKml={downloadTourKml}
              onImportTourFromJson={importTourFromJson}
              teleportToPano={teleportToPanoSafe}
              setHeading={setHeading}
              setPitch={setPitch}
              setZoom={setZoom}
              isPanoramaReady={isPanoramaReady}
            />
          )}

          {globeMode.transition === 'loading' && (
            <div
              style={{
                position: 'fixed',
                inset: 0,
                zIndex: 500,
                background: 'rgba(0,0,0,0.85)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#fff',
                fontFamily: 'system-ui, sans-serif',
              }}
            >
              <div
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: '50%',
                  border: '4px solid rgba(255,255,255,0.15)',
                  borderTopColor: '#4CAF50',
                  animation: 'spin 0.8s linear infinite',
                  marginBottom: 20,
                }}
              />
              <div style={{ fontSize: 16, opacity: 0.85 }}>Loading Globe…</div>
              <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
            </div>
          )}
          {globeMode.isVisible && (
            <Suspense fallback={null}>
              <GlobeView
                transition={globeMode.transition}
                currentLat={panorama?.getPosition()?.lat() ?? 39.2575}
                currentLng={panorama?.getPosition()?.lng() ?? -121.0218}
                currentHeading={heading}
                pois={history.slice(0, 30).map((h) => ({
                  lat: h.lat,
                  lng: h.lng,
                  label: h.locationName || `${h.lat.toFixed(2)}, ${h.lng.toFixed(2)}`,
                }))}
                bookmarks={bookmarks.map((b) => ({
                  id: b.id,
                  name: b.name,
                  lat: b.lat,
                  lng: b.lng,
                  heading: b.heading,
                  pitch: b.pitch,
                }))}
                mapsApiKey={effectiveMapsKey}
                onTeleportRequest={handleGlobeTeleport}
                onEnterComplete={globeMode.onEnterComplete}
                onExitComplete={globeMode.onExitComplete}
                onStartJourney={handleStartJourney}
              />
            </Suspense>
          )}
        </>
      )}

      <div
        ref={scraperRef}
        className="streetview-scraper"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          zIndex: isConnected && webGPUAvailable ? 0 : 2,
          opacity: 1,
          pointerEvents: isConnected && webGPUAvailable ? 'none' : 'auto',
        }}
      >
        <StreetView
          apiKey={effectiveMapsKey}
          initialPosition={{ lat: 37.86926, lng: -122.254811 }}
          onCanvasReady={setCanvas}
          onError={setCanvasError}
          onStatusChange={handleMapsStatusChange}
          onPanoramaReady={(pano) => {
            setPanorama(pano);
            setCanvasError(null);
            if (!geocoderRef.current) {
              geocoderRef.current = new google.maps.Geocoder();
            }
          }}
        />
      </div>

      {isConnected && isCanvasReady && (
        <WebGPUCanvas onWebGPUStatus={handleWebGPUStatus} onBackendInfo={handleBackendInfo} />
      )}

      <div
        id="main-content"
        role="main"
        aria-label="Street View Canvas"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          zIndex: 1,
        }}
      >
        {isConnected && isCanvasReady && webgpuStatus !== 'initializing' && (
          <MainView mapsApiKey={effectiveMapsKey} />
        )}

        {mapsLoadingOverlay && (
          <LoadingOverlay
            isVisible={mapsLoadingOverlay.isVisible}
            message={mapsLoadingOverlay.message}
            progress={mapsLoadingOverlay.progress}
            error={mapsLoadingOverlay.error}
            retryable={mapsLoadingOverlay.retryable}
            onRetry={mapsLoadingOverlay.onRetry}
            size="fullscreen"
          />
        )}
      </div>
      <BuildBadge />
    </div>
  );
}
