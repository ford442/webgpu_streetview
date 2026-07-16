import { useState, useRef, useEffect, useCallback, lazy, Suspense } from 'react';
import StreetView, { type MapsLoadStatus } from './components/StreetView';
import WelcomeModal from './components/WelcomeModal';
import type { RendererBackendType } from './renderer/RendererBackend';
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
  PerformanceStatsOverlay,
  RendererBackendIndicator,
  WebGPUCanvas,
  LoadingOverlay,
  HistoricalTimeline,
  ComparisonView,
  TourPanel,
  SharedSessionPanel,
} from './components';

import { useHistoricalTimeline } from './hooks/useHistoricalTimeline';
import { useHistoricalCompare } from './hooks/useHistoricalCompare';
import { formatImageDate } from './utils/historicalImagery';

// Hooks
import { useBookmarks } from './hooks/useBookmarks';
import { useLocationHistory } from './hooks/useLocationHistory';
import { useSnapshots } from './hooks/useSnapshots';
import { useTours, type CurrentPOV } from './hooks/useTours';
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
import { useSharedSession } from './hooks/useSharedSession';
import AppToolbar from './components/AppToolbar';
import AppBanners from './components/AppBanners';
import BuildBadge from './components/BuildBadge';
import { getMemoryProfiler, MemoryStats } from './utils/memoryProfiler';
import { clearAuthFailure, loadMapsApi, onMapsAuthFailure, removeFailedBootstrap } from './services/maps/loader';

// GlobeView pulls in the CesiumJS globe overlay; lazy-load it as its own
// chunk so users who never leave FreeLook don't pay for it on first paint.
const GlobeView = lazy(() => import('./components/GlobeView'));

// Google Maps API Key resolution (matches go.1ink.us — baked into the JS bundle):
//  1. REACT_APP_MAPS_API_KEY — set at `npm run build` via .env.local / CI env var
//  2. __RUNTIME_MAPS_KEY_SENTINEL__ — replaced in the built bundle by deploy.py
//  3. window.MAPS_API_KEY — optional manual override via config.js (dev/emergency only)
// Never commit real keys. Production deploy: MAPS_API_KEY=... python deploy.py
const MAPS_KEY_DEPLOY_SENTINEL = '__RUNTIME_MAPS_KEY_SENTINEL__';

const PLACEHOLDER_MAPS_KEY_PATTERNS: RegExp[] = [
  /^your[_-]?(google[_-]?)?maps[_-]?api[_-]?key[_-]?(here)?$/i,
  /^YOUR_MAPS_API_KEY$/,
  /^__RUNTIME_MAPS_KEY_SENTINEL__$/,
  /^placeholder/i,
  /^<.*>$/,
  /replace/i,
];

function normalizeMapsKey(value: string | undefined): string {
  const trimmed = value?.trim() || '';
  return PLACEHOLDER_MAPS_KEY_PATTERNS.some(re => re.test(trimmed)) ? '' : trimmed;
}

function getConfiguredMapsKey(): string {
  return (
    normalizeMapsKey(process.env.REACT_APP_MAPS_API_KEY) ||
    normalizeMapsKey(MAPS_KEY_DEPLOY_SENTINEL) ||
    normalizeMapsKey(window.MAPS_API_KEY)
  );
}
const INITIAL_MAPS_KEY = getConfiguredMapsKey();
if (!INITIAL_MAPS_KEY) {
  console.warn(
    "[WebGPU StreetView] No Maps API key found at initial eval. " +
    "Set REACT_APP_MAPS_API_KEY in .env.local and rebuild, or deploy with " +
    "MAPS_API_KEY=... python deploy.py to bake the key into the bundle (go.1ink.us style)."
  );
}

/**
 * InnerApp - The actual app content that uses the providers.
 * This is separated so it can access the contexts.
 */
function InnerApp() {
  // Connect to contexts
  const { setCanvas, setPanorama, panorama, heading, pitch, zoom, canvas, isTransitioning, isPanoramaReady, renderer, readyPromise, locationName, setHeading, setPitch, setZoom } = useStreetView();
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

  // Local UI state
  const [showWelcome, setShowWelcome] = useState(true);
  const [isConnected, setIsConnected] = useState(false);
  const [isMapOpen, setIsMapOpen] = useState(false);
  const [webGPUAvailable, setWebGPUAvailable] = useState(true);
  const [webgpuStatus, setWebgpuStatus] = useState<'initializing' | 'ready' | 'fallback'>('initializing');
  const [rendererBackendInfo, setRendererBackendInfo] = useState<{ backendType: RendererBackendType | null; fallbackReason?: string } | null>(null);

  const handleWebGPUStatus = useCallback((available: boolean) => {
    setWebGPUAvailable(available);
    setWebgpuStatus(available ? 'ready' : 'fallback');
  }, []);
  const handleBackendInfo = useCallback((info: { backendType: RendererBackendType | null; fallbackReason?: string }) => {
    setRendererBackendInfo(info);
  }, []);
  const handleMapsStatusChange = useCallback((status: MapsLoadStatus) => {
    setMapsLoadStatus(status);
    if (status !== 'api-error' && status !== 'canvas-timeout') {
      setCanvasError(null);
      // Auto-clear previous auth failure state on any successful progress.
      // This removes the hard "blocking" after a key is corrected (runtime config,
      // deploy, or manual retry) so Street View rendering can resume without reload.
      // The onMapsAuthFailure listener may still fire for truly bad keys; this only
      // clears when we have positive evidence the current key is working.
      setMapsAuthFailed(false);
      setMapsAuthError(null);
      setShowAuthFailedBanner(false);
      if (status === 'api-ready' || status === 'canvas-ready' || status === 'rendering') {
        clearAuthFailure(getConfiguredMapsKey());
      }
      if (status === 'canvas-ready' || status === 'rendering') {
        setIsRetryingMapsAuth(false);
      }
    }
  }, []);
  const [isRadioPlaying, setIsRadioPlaying] = useState(false);
  const [isCanvasReady, setIsCanvasReady] = useState(false); // Track if Google Maps canvas is ready
  const [canvasError, setCanvasError] = useState<string | null>(null);
  const [mapsLoadStatus, setMapsLoadStatus] = useState<MapsLoadStatus>(INITIAL_MAPS_KEY ? 'idle' : 'api-error');
  const [navPending, setNavPending] = useState(false);

  // Maps API auth/key status
  const [mapsAuthFailed, setMapsAuthFailed] = useState(false);
  const [mapsAuthError, setMapsAuthError] = useState<string | null>(null);
  const [isRetryingMapsAuth, setIsRetryingMapsAuth] = useState(false);
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
  const [isHistoricalTimelineOpen, setIsHistoricalTimelineOpen] = useState(false);
  const [isTourPanelOpen, setIsTourPanelOpen] = useState(false);
  const [isSharedSessionPanelOpen, setIsSharedSessionPanelOpen] = useState(false);
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
  const sharedSession = useSharedSession();
  const sharedSessionLastAppliedPanoRef = useRef<string | null>(null);

  // Historical Timeline ("time travel") — scrub through capture dates near the current location.
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

  // Audio ref for radio
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const audioSourceRef = useRef<MediaElementAudioSourceNode | null>(null);

  const geocoderRef = useRef<google.maps.Geocoder | null>(null);
  // Ref for the always-present hidden scraper wrapper so we can attach a
  // secondary live suppressor (defense in depth for any nodes Google injects
  // at the .streetview-scraper level rather than only inside panoRef).
  const scraperRef = useRef<HTMLDivElement | null>(null);

  // Initialize audio — wire through AudioContext so the stream is capturable
  // and available for future canvas+audio recording (fixes silent audio export).
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

  useEffect(() => {
    if (isCanvasReady && webgpuStatus !== 'initializing' && mapsLoadStatus !== 'api-error' && mapsLoadStatus !== 'canvas-timeout') {
      setMapsLoadStatus('rendering');
    }
  }, [isCanvasReady, mapsLoadStatus, webgpuStatus]);

  // Reactive key poller / listener: recovers from config.js race (#84) and allows
  // a valid runtime key that arrives after initial bundle eval to initialize Maps.
  // Complements the reset logic in StreetView.tsx (#85).
  useEffect(() => {
    let stopped = false;
    const syncKey = () => {
      if (stopped) return;
      const k = getConfiguredMapsKey();
      if (k && k !== effectiveMapsKey) {
        console.log('[App] Late Maps API key detected — updating effective key');
        clearAuthFailure();
        removeFailedBootstrap();
        setEffectiveMapsKey(k);
        setMapsLoadStatus('loading-api');
        setIsRetryingMapsAuth(Boolean(effectiveMapsKey || mapsAuthFailed));
        setShowMissingKeyBanner(false);
        // Always clear prior auth-failure state for a *new* key. This ensures that
        // after an API key vulnerability/bug was present (and gm_authFailure fired),
        // a corrected runtime key (config.js, deploy, etc) will allow full recovery
        // of Street View rendering. The auth listener will re-set failed=true only if
        // the *new* key itself triggers gm_authFailure.
        setMapsAuthFailed(false);
        setMapsAuthError(null);
        setShowAuthFailedBanner(false);
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
    const unsubscribe = onMapsAuthFailure((event) => {
      const currentKey = getConfiguredMapsKey() || effectiveMapsKey;
      if (event.key && currentKey && event.key !== currentKey) {
        console.warn('[App] Ignoring stale Maps auth failure for a previous key');
        return;
      }
      setMapsAuthFailed(true);
      setIsRetryingMapsAuth(false);
      setMapsAuthError('Google Maps API key error — check referrer restrictions, billing, and enabled APIs in Google Cloud Console.');
      setMapsLoadStatus('api-error');
      setShowAuthFailedBanner(true);
      // Auto-disable cruise mode on auth failure — prevents indefinite error spam
      setIsCruiseMode(false);
      // Remove Google's injected error UI from the hidden scraper so it can't flash.
      // (The primary defense is now the always-on MutationObserver + sweeps inside
      // StreetView.tsx + expanded CSS. This is the legacy one-shot path.)
      const errSel = '.streetview-scraper [class*="gm-err"], .streetview-scraper .gm-err-container, .streetview-scraper .gm-err-content, .streetview-scraper .gm-err-icon, .streetview-scraper .gm-err-title, .streetview-scraper .gm-err-message, .streetview-scraper [aria-label*="Google Maps" i]';
      document.querySelectorAll(errSel).forEach((el) => {
        const he = el as HTMLElement;
        he.style.setProperty('display', 'none', 'important');
        he.style.setProperty('visibility', 'hidden', 'important');
        he.style.setProperty('opacity', '0', 'important');
        if (he.parentNode) { try { he.parentNode.removeChild(he); } catch {} }
      });
      console.error('[App] Maps API auth failure — cruise mode disabled');
    });
    return unsubscribe;
  }, [effectiveMapsKey]); // eslint-disable-line react-hooks/exhaustive-deps -- setIsCruiseMode is stable from useCruiseMode; auth filtering must follow effective key

  // Secondary live suppressor on the .streetview-scraper wrapper itself (defense-in-depth).
  // Complements the one inside StreetView (which targets the actual pano container
  // Google writes errors into). This catches any sibling/outer injections and ensures
  // that even if the pano effect hasn't attached yet, the class-named container is watched.
  useEffect(() => {
    let mo: MutationObserver | null = null;
    const run = () => {
      const root = scraperRef.current || document.querySelector('.streetview-scraper');
      if (!root) return;
      const sel = '[class*="gm-err"], .gm-err-container, [aria-label*="Google" i]';
      root.querySelectorAll(sel).forEach((n) => {
        const e = n as HTMLElement;
        e.style.setProperty('display', 'none', 'important');
        e.style.setProperty('visibility', 'hidden', 'important');
        e.style.setProperty('opacity', '0', 'important');
        if (e.parentNode) { try { e.parentNode.removeChild(e); } catch {} }
      });
    };
    // Attach when possible (the div is always rendered once connected)
    const t = setTimeout(() => {
      const root = scraperRef.current || document.querySelector('.streetview-scraper');
      if (root) {
        run();
        mo = new MutationObserver(run);
        mo.observe(root, { childList: true, subtree: true });
      }
    }, 50);
    return () => { clearTimeout(t); if (mo) mo.disconnect(); };
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

  const handleRetryMapsAuth = useCallback(() => {
    const nextKey = getConfiguredMapsKey();
    if (!nextKey) {
      setMapsAuthError('No Google Maps API key is configured. Set REACT_APP_MAPS_API_KEY in .env.local and rebuild, or deploy with MAPS_API_KEY=... python deploy.py.');
      setMapsLoadStatus('api-error');
      setShowMissingKeyBanner(true);
      return;
    }

    setIsRetryingMapsAuth(true);
    clearAuthFailure(nextKey);
    setMapsLoadStatus('loading-api');
    setMapsAuthFailed(false);
    setMapsAuthError(null);
    setShowAuthFailedBanner(false);
    setShowMissingKeyBanner(false);
    setEffectiveMapsKey(nextKey);
    removeFailedBootstrap();

    loadMapsApi(nextKey)
      .catch((err) => {
        setIsRetryingMapsAuth(false);
        setMapsAuthFailed(true);
        setMapsLoadStatus('api-error');
        setShowAuthFailedBanner(true);
        setMapsAuthError(err instanceof Error ? err.message : 'Google Maps API key error — retry failed.');
      });
  }, []);

  const toggleRadio = () => {
    if (!audioRef.current) return;
    if (isRadioPlaying) {
      audioRef.current.pause();
    } else {
      // Create AudioContext on first user gesture (browser policy requires this).
      // Wiring through AudioContext makes the stream capturable for recording.
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
      audioRef.current.play().catch(e => console.error('Audio play failed:', e));
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

  const mapsLoadingOverlay = (() => {
    if (!isConnected) return null;
    // Do not early-return on mapsAuthFailed here: we want the standard LoadingOverlay
    // (with its api-error state + retry button) to be available as a non-modal path.
    // The hard full-screen mapsAuthFailed dialog below is the legacy "blocker".
    // With the auto-clear logic above, a good key will transition us out of failed
    // and into normal loading/rendering states.

    if (!effectiveMapsKey) {
      return {
        isVisible: true,
        message: '',
        error: 'No Google Maps API key is configured. Set REACT_APP_MAPS_API_KEY in .env.local and rebuild, or deploy with MAPS_API_KEY=... python deploy.py.',
        retryable: true,
        onRetry: handleRetryMapsAuth,
      };
    }

    switch (mapsLoadStatus) {
      case 'loading-api':
        return { isVisible: true, message: isRetryingMapsAuth ? 'Retrying with new key...' : 'Connecting to Google Maps...', progress: isRetryingMapsAuth ? 20 : 15 };
      case 'api-ready':
        return { isVisible: true, message: isRetryingMapsAuth ? 'New key accepted. Preparing Street View...' : 'Google Maps connected. Preparing Street View...', progress: 35 };
      case 'loading-panorama':
        return { isVisible: true, message: 'Loading Street View...', progress: 55 };
      case 'canvas-ready':
        return { isVisible: webgpuStatus === 'initializing', message: 'Preparing WebGPU renderer...', progress: 85 };
      case 'canvas-timeout':
        return {
          isVisible: true,
          message: '',
          error: canvasError || 'Street View unavailable at this location.',
          retryable: true,
          onRetry: () => window.location.reload(),
        };
      case 'api-error':
        return {
          isVisible: true,
          message: '',
          error: mapsAuthError || canvasError || 'Failed to load Google Maps API. Please check your API key and network connection.',
          retryable: true,
          onRetry: handleRetryMapsAuth,
        };
      case 'idle':
        return { isVisible: !isCanvasReady, message: 'Preparing Maps connection...', progress: 5 };
      case 'rendering':
      default:
        return { isVisible: false, message: '' };
    }
  })();
  
  return (
    <div id="app-container" style={{ position: 'relative', width: '100vw', height: '100vh', overflow: 'hidden', padding: 0, margin: 0, backgroundColor: '#000' }}>
      {/* Skip link for keyboard navigation */}
      <SkipLink targetId="main-content">Skip to main content</SkipLink>

      <AppBanners
        showMissingKeyBanner={showMissingKeyBanner}
        setShowMissingKeyBanner={setShowMissingKeyBanner}
        showAuthFailedBanner={showAuthFailedBanner}
        setShowAuthFailedBanner={setShowAuthFailedBanner}
        isRecoveringMapsAuth={isRetryingMapsAuth}
      />

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
          onMouseDown={e => e.stopPropagation()}
          onClick={e => e.stopPropagation()}
          onKeyDown={e => e.stopPropagation()}
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
            <div style={{ fontSize: 13, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#ffb3b3', marginBottom: 10 }}>
              Maps authentication failed
            </div>
            {/* The "Dismiss block" button (below) + auto-clear on good status/key change
                means this full-screen dialog is no longer a hard permanent block once
                the key problem (referrer, billing, or prior vulnerability) is resolved.
                Rendering recovery for Street View mode is the goal of the follow-up issues. */}
            <h2 id="maps-auth-error-title" style={{ margin: '0 0 12px', fontSize: 28, lineHeight: 1.1 }}>
              Google Maps API key error
            </h2>
            <p id="maps-auth-error-description" style={{ margin: '0 0 16px', lineHeight: 1.5, color: 'rgba(255,255,255,0.88)' }}>
              {mapsAuthError || 'Google Maps API key error — check referrer restrictions and billing in Google Cloud Console.'}
            </p>
            <div style={{ background: 'rgba(255,255,255,0.08)', borderRadius: 10, padding: 12, fontSize: 13, lineHeight: 1.45, marginBottom: 20 }}>
              Verify that this host is whitelisted under HTTP referrer restrictions, billing is enabled, and the Maps JavaScript API plus Street View dependencies are enabled for the key.
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
                onClick={() => {
                  // Emergency escape hatch: clear the auth-failed block so that if
                  // the key was corrected out-of-band (config.js updated on server,
                  // new deploy, etc.) the StreetView init + WebGPU render can proceed
                  // without waiting for the loadMapsApi promise roundtrip.
                  // This removes the remaining hard API-key blocking UI.
                  setMapsAuthFailed(false);
                  setMapsAuthError(null);
                  setShowAuthFailedBanner(true); // keep soft banner for awareness
                }}
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

      {/* Renderer backend indicator (corner chip, expandable) */}
      {isConnected && <RendererBackendIndicator backendInfo={rendererBackendInfo} />}

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

      {/* Historical Imagery comparison — before/after swipe overlay */}
      {isConnected && historicalComparison && (
        <ComparisonView
          beforeUrl={historicalComparison.beforeUrl}
          afterUrl={historicalComparison.afterUrl}
          beforeEntry={historicalComparison.beforeEntry}
          afterLabel={historicalAfterLabel}
          onClose={exitHistoricalCompare}
        />
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
            isHistoricalTimelineOpen={isHistoricalTimelineOpen}
            setIsHistoricalTimelineOpen={setIsHistoricalTimelineOpen}
            isTourPanelOpen={isTourPanelOpen}
            setIsTourPanelOpen={setIsTourPanelOpen}
            isSharedSessionPanelOpen={isSharedSessionPanelOpen}
            setIsSharedSessionPanelOpen={setIsSharedSessionPanelOpen}
            isSharedSessionActive={sharedSession.isConnected}
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
              onTeleport={(_lat, _lng, _h, _p) => {
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
          
          {/* Shared Session Panel — multiplayer road trip host/join controls */}
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
          
          {/* Historical Timeline — scrub through capture dates near the current location */}
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

          {/* Accessibility Panel */}
          {isAccessibilityPanelOpen && (
            <AccessibilityPanel
              isOpen={isAccessibilityPanelOpen}
              settings={accessibilitySettings}
              onSettingsChange={setAccessibilitySettings}
              onClose={() => setIsAccessibilityPanelOpen(false)}
            />
          )}
          
          {/* Tour Panel — record/play shareable Street View tours */}
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
            <Suspense fallback={null}>
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
            </Suspense>
          )}
        </>
      )}

      {/* Hidden StreetView - kept in DOM for canvas scraping */}
      {/* When WebGPU is active, pushed behind the WebGPU canvas via zIndex (0 vs 1). */}
      {/* opacity must stay at 1 — Google Maps stops updating its canvas at low opacity. */}
      {/* When WebGPU fails, promoted to zIndex 2 as visible fallback. */}
      <div
        ref={scraperRef}
        className="streetview-scraper"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          zIndex: (isConnected && webGPUAvailable) ? 0 : 2,
          opacity: 1,
          pointerEvents: (isConnected && webGPUAvailable) ? 'none' : 'auto'
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

      {/* Global WebGPU canvas - never unmounts, lives behind the views */}
      {isConnected && isCanvasReady && (
        <WebGPUCanvas onWebGPUStatus={handleWebGPUStatus} onBackendInfo={handleBackendInfo} />
      )}

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
