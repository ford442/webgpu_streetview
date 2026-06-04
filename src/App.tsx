import React, { useState, useRef, useEffect, useCallback } from 'react';
import StreetView from './components/StreetView';
import WelcomeModal from './components/WelcomeModal';
import './style.css';

// Providers
import {
  StreetViewProvider,
  ViewModeProvider,
  EnvironmentSettingsProvider,
  useStreetView,
  useViewMode,
  useEnvironmentSettings,
  useAdvanceSafe,
  type TimeOfDay,
} from './hooks';

// Views
import { MainView } from './views';

// Components
import {
  BookmarkPanel,
  HistoryPanel,
  SnapshotGallery,
  ColorGradingPanel,
  WeatherPanel,
  AccessibilityPanel,
  GlobeView,
  PerformanceStatsOverlay,
  WebGPUCanvas,
} from './components';
import { ErrorDisplay } from './components/LoadingOverlay';

// Hooks
import { useBookmarks } from './hooks/useBookmarks';
import { useLocationHistory } from './hooks/useLocationHistory';
import { useSnapshots } from './hooks/useSnapshots';
import { useGlobeMode } from './hooks/useGlobeMode';
import {
  useKeyboardShortcuts,
  useAnnouncer,
  loadAccessibilitySettings,
  AccessibilitySettings,
  SkipLink,
} from './hooks/useKeyboardShortcuts';
import { usePerformanceMonitor } from './hooks/usePerformanceMonitor';
import { useCruiseMode } from './hooks/useCruiseMode';
import { useAutopilot } from './hooks/useAutopilot';
import { buildAppKeyboardShortcuts } from './hooks/useAppKeyboardShortcuts';
import { useGlobeTeleport } from './hooks/useGlobeTeleport';
import AppToolbar from './components/AppToolbar';
import AppBanners from './components/AppBanners';
import { getMemoryProfiler, MemoryStats } from './utils/memoryProfiler';
import { onMapsAuthFailure } from './services/maps/loader';


// Google Maps API Key resolution (in priority order):
//  1. window.MAPS_API_KEY  — set at runtime via public/config.js (no rebuild needed)
//  2. REACT_APP_MAPS_API_KEY — baked in at build time via .env.local / CI env var
// Never commit real keys. See public/config.js and README for deployment instructions.
//
// NOTE: We use a small state + poller below so a slightly delayed config.js
// (race on some deploys / CDNs) still gets picked up without requiring a full
// page reload. See issues #84 and #85.
function getInitialMapsKey(): string {
  return (window.MAPS_API_KEY?.trim() || process.env.REACT_APP_MAPS_API_KEY || "").trim();
}
const INITIAL_MAPS_KEY = getInitialMapsKey();
if (!INITIAL_MAPS_KEY) {
  console.warn(
    "[WebGPU StreetView] No Maps API key found at initial eval. " +
    "Set window.MAPS_API_KEY in public/config.js (preferred) or set " +
    "REACT_APP_MAPS_API_KEY in .env.local and rebuild. " +
    "A poller will retry for late-arriving runtime keys."
  );
}

/**
 * InnerApp - The actual app content that uses the providers.
 * This is separated so it can access the contexts.
 */
function InnerApp() {
  // Connect to contexts
  const { setCanvas, setPanorama, panorama, heading, pitch, canvas, advance, isTransitioning, isPanoramaReady } = useStreetView();
  const { advanceSafe, teleportSafe, panoCache } = useAdvanceSafe();
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

  // Local UI state
  const [showWelcome, setShowWelcome] = useState(true);
  const [isConnected, setIsConnected] = useState(false);
  const [isMapOpen, setIsMapOpen] = useState(false);
  const [webGPUAvailable, setWebGPUAvailable] = useState(true);
  const [webgpuStatus, setWebgpuStatus] = useState<'initializing' | 'ready' | 'fallback'>('initializing');

  const handleWebGPUStatus = useCallback((available: boolean) => {
    setWebGPUAvailable(available);
    setWebgpuStatus(available ? 'ready' : 'fallback');
  }, []);
  const [isRadioPlaying, setIsRadioPlaying] = useState(false);
  const [isCanvasReady, setIsCanvasReady] = useState(false); // Track if Google Maps canvas is ready
  const [canvasError, setCanvasError] = useState<string | null>(null);
  const [navPending, setNavPending] = useState(false);

  // Maps API auth/key status
  const [mapsAuthFailed, setMapsAuthFailed] = useState(false);
  const [effectiveMapsKey, setEffectiveMapsKey] = useState<string>(INITIAL_MAPS_KEY);
  const [showMissingKeyBanner, setShowMissingKeyBanner] = useState(!INITIAL_MAPS_KEY);
  const [showAuthFailedBanner, setShowAuthFailedBanner] = useState(false);
  
  // Panel visibility
  const [isBookmarkPanelOpen, setIsBookmarkPanelOpen] = useState(false);
  const [isHistoryPanelOpen, setIsHistoryPanelOpen] = useState(false);
  const [isSnapshotGalleryOpen, setIsSnapshotGalleryOpen] = useState(false);
  const [isColorGradingPanelOpen, setIsColorGradingPanelOpen] = useState(false);
  const [isWeatherPanelOpen, setIsWeatherPanelOpen] = useState(false);
  const [isAccessibilityPanelOpen, setIsAccessibilityPanelOpen] = useState(false);
  const [showPerformanceStats, setShowPerformanceStats] = useState(false);
  
  // Accessibility
  const [accessibilitySettings, setAccessibilitySettings] = useState<AccessibilitySettings>(() =>
    loadAccessibilitySettings()
  );
  const { announce } = useAnnouncer();
  
  // Performance
  const [memoryStats, setMemoryStats] = useState<MemoryStats | null>(null);
  const { stats: perfStats } = usePerformanceMonitor({
    targetFPS: 60,
    sampleSize: 60,
    warningThreshold: 45,
    criticalThreshold: 30,
    enableAdaptiveQuality: true
  });
  
  // Feature hooks
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
  const globeMode = useGlobeMode();
  
  // Audio ref for radio
  const audioRef = useRef<HTMLAudioElement | null>(null);
  
  // Directions service
  const directionsServiceRef = useRef<google.maps.DirectionsService | null>(null);
  const geocoderRef = useRef<google.maps.Geocoder | null>(null);
  
  // Initialize audio
  useEffect(() => {
    if (!audioRef.current) {
      audioRef.current = new Audio('https://stream.zeno.fm/ywcmn7hpha0uv');
      audioRef.current.crossOrigin = "anonymous";
    }
  }, []);
  
  // Apply accessibility classes
  useEffect(() => {
    document.body.classList.toggle('high-contrast', accessibilitySettings.highContrast);
    document.body.classList.toggle('reduced-motion', accessibilitySettings.reducedMotion);
    document.body.classList.toggle('large-text', accessibilitySettings.largeText);
    document.body.classList.toggle('keyboard-only-mode', accessibilitySettings.keyboardOnlyMode);
  }, [accessibilitySettings]);
  
  // Memory profiling
  useEffect(() => {
    if (!showPerformanceStats) return;
    const memoryProfiler = getMemoryProfiler();
    const interval = setInterval(() => {
      memoryProfiler.snapshot();
      setMemoryStats(memoryProfiler.getStats());
    }, 1000);
    return () => clearInterval(interval);
  }, [showPerformanceStats]);
  
  // Track when Google Maps canvas is ready
  useEffect(() => {
    if (canvas && !isCanvasReady) {
      setIsCanvasReady(true);
      console.log('[App] Canvas is ready');
    }
  }, [canvas, isCanvasReady]);

  // Reactive key poller / listener: recovers from config.js race (#84) and allows
  // a valid runtime key that arrives after initial bundle eval to initialize Maps.
  // Complements the reset logic in StreetView.tsx (#85).
  useEffect(() => {
    let stopped = false;
    const syncKey = () => {
      if (stopped) return;
      const k = (window.MAPS_API_KEY?.trim() || process.env.REACT_APP_MAPS_API_KEY || '').trim();
      if (k && k !== effectiveMapsKey) {
        console.log('[App] Late Maps API key detected — updating effective key');
        setEffectiveMapsKey(k);
        setShowMissingKeyBanner(false);
        // If we previously showed auth failure for the empty key, clear it so the
        // new key can be tried (user may still get auth error if the key itself is bad).
        if (!mapsAuthFailed) {
          setShowAuthFailedBanner(false);
        }
      }
    };
    // Poll briefly (covers slow script / some CDN timings)
    const iv = setInterval(syncKey, 120);
    // Also react to a custom event some setups can dispatch after injecting config
    const onKeyReady = () => syncKey();
    window.addEventListener('maps-api-key-ready', onKeyReady);
    // Initial sync in case it became available between eval and mount
    syncKey();
    return () => {
      stopped = true;
      clearInterval(iv);
      window.removeEventListener('maps-api-key-ready', onKeyReady);
    };
  }, [effectiveMapsKey, mapsAuthFailed]);

  // Subscribe to Maps API auth failures (invalid key, referrer-blocked, billing disabled)
  useEffect(() => {
    const unsubscribe = onMapsAuthFailure(() => {
      setMapsAuthFailed(true);
      setShowAuthFailedBanner(true);
      // Auto-disable cruise mode on auth failure — prevents indefinite error spam
      setIsCruiseMode(false);
      console.error('[App] Maps API auth failure — cruise mode disabled');
    });
    return unsubscribe;
  }, []);
  
  // Handlers
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

  const toggleRadio = () => {
    if (!audioRef.current) return;
    if (isRadioPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play().catch(e => console.error("Audio play failed:", e));
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
  
  return (
    <div id="app-container" style={{ position: 'relative', width: '100vw', height: '100vh', overflow: 'hidden', padding: 0, margin: 0, backgroundColor: '#000' }}>
      {/* Skip link for keyboard navigation */}
      <SkipLink targetId="main-content">Skip to main content</SkipLink>

      <AppBanners
        showMissingKeyBanner={showMissingKeyBanner}
        setShowMissingKeyBanner={setShowMissingKeyBanner}
        showAuthFailedBanner={showAuthFailedBanner}
        setShowAuthFailedBanner={setShowAuthFailedBanner}
      />
      
      {showWelcome && <WelcomeModal onStart={handleStart} />}

      {/* Performance Stats Overlay */}
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

      {/* Navigation pending overlay */}
      {isConnected && navPending && (
        <div style={{
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
        }}>
          Loading next view…
        </div>
      )}

      {/* Global UI Panels */}
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
            viewMode={viewMode}
            toggleViewMode={toggleViewMode}
            onGlobeToggle={globeMode.toggle}
          />

          {/* Bookmark Panel */}
          {isBookmarkPanelOpen && panorama && (
            <BookmarkPanel
              bookmarks={bookmarks}
              currentCoords={(() => {
                const pos = panorama.getPosition();
                return pos ? { lat: pos.lat(), lng: pos.lng() } : { lat: 0, lng: 0 };
              })()}
              onTeleport={(lat, lng, h, p) => {
                // Teleport via StreetView context
              }}
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
          
          {/* History Panel */}
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
          
          {/* Snapshot Gallery */}
          {isSnapshotGalleryOpen && (
            <SnapshotGallery
              snapshots={snapshots}
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
          
          {/* Color Grading Panel */}
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
          
          {/* Weather Panel */}
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
          
          {/* Accessibility Panel */}
          {isAccessibilityPanelOpen && (
            <AccessibilityPanel
              isOpen={isAccessibilityPanelOpen}
              settings={accessibilitySettings}
              onSettingsChange={setAccessibilitySettings}
              onClose={() => setIsAccessibilityPanelOpen(false)}
            />
          )}
          
          {/* Globe View — CesiumJS 3D globe overlay */}
          {/* Show a loading screen while Cesium SDK downloads from CDN */}
          {globeMode.transition === 'loading' && (
            <div style={{
              position: 'fixed', inset: 0, zIndex: 500,
              background: 'rgba(0,0,0,0.85)', display: 'flex',
              flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              color: '#fff', fontFamily: 'system-ui, sans-serif',
            }}>
              <div style={{
                width: 48, height: 48, borderRadius: '50%',
                border: '4px solid rgba(255,255,255,0.15)',
                borderTopColor: '#4CAF50',
                animation: 'spin 0.8s linear infinite', marginBottom: 20,
              }} />
              <div style={{ fontSize: 16, opacity: 0.85 }}>Loading Globe…</div>
              <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
            </div>
          )}
          {globeMode.isVisible && (
            <GlobeView
              transition={globeMode.transition}
              currentLat={panorama?.getPosition()?.lat() ?? 39.2575}
              currentLng={panorama?.getPosition()?.lng() ?? -121.0218}
              currentHeading={heading}
              pois={history.slice(0, 30).map(h => ({
                lat: h.lat,
                lng: h.lng,
                label: h.locationName || `${h.lat.toFixed(2)}, ${h.lng.toFixed(2)}`,
              }))}
              bookmarks={bookmarks.map(b => ({
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
          )}
        </>
      )}

      {/* Hidden StreetView - kept in DOM for canvas scraping */}
      {/* When WebGPU is active, pushed behind the WebGPU canvas via zIndex (0 vs 1). */}
      {/* opacity must stay at 1 — Google Maps stops updating its canvas at low opacity. */}
      {/* When WebGPU fails, promoted to zIndex 2 as visible fallback. */}
      <div style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        zIndex: (isConnected && webGPUAvailable) ? 0 : 2,
        opacity: 1,
        pointerEvents: (isConnected && webGPUAvailable) ? 'none' : 'auto'
      }}>
        <StreetView
          apiKey={effectiveMapsKey}
          initialPosition={{ lat: 37.86926, lng: -122.254811 }}
          onCanvasReady={setCanvas}
          onError={setCanvasError}
          onPanoramaReady={(pano) => {
            setPanorama(pano);
            setCanvasError(null);
            if (!directionsServiceRef.current) {
              directionsServiceRef.current = new google.maps.DirectionsService();
            }
            if (!geocoderRef.current) {
              geocoderRef.current = new google.maps.Geocoder();
            }
          }}
        />
      </div>

      {/* Global WebGPU canvas - never unmounts, lives behind the views */}
      {isConnected && isCanvasReady && <WebGPUCanvas onWebGPUStatus={handleWebGPUStatus} />}

      {/* Main View - switches between FreeLookView and CarModeView */}
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
          zIndex: 1
        }}
      >
        {isConnected && isCanvasReady && webgpuStatus !== 'initializing' && <MainView mapsApiKey={effectiveMapsKey} />}
        
        {/* Show loading screen while waiting for canvas or WebGPU init */}
        {isConnected && (!isCanvasReady || webgpuStatus === 'initializing') && (
          <div style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            backgroundColor: '#000',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1
          }}>
            {canvasError ? (
              <ErrorDisplay
                message={canvasError}
                retryable={true}
                onRetry={() => window.location.reload()}
              />
            ) : (
              <>
                <div style={{
                  color: '#4CAF50',
                  fontSize: '18px',
                  marginBottom: '20px',
                  fontFamily: 'sans-serif'
                }}>
                  Loading Street View...
                </div>
                <div style={{
                  width: '40px',
                  height: '40px',
                  border: '4px solid rgba(255, 255, 255, 0.1)',
                  borderTopColor: '#4CAF50',
                  borderRadius: '50%',
                  animation: 'spin 0.8s linear infinite'
                }} />
                <style>{`
                  @keyframes spin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                  }
                `}</style>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * App - Root component that wraps everything in providers.
 */
function App() {
  return (
    <StreetViewProvider>
      <ViewModeProvider>
        <EnvironmentSettingsProvider>
          <InnerApp />
        </EnvironmentSettingsProvider>
      </ViewModeProvider>
    </StreetViewProvider>
  );
}

export default App;
