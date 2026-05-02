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
import { getMemoryProfiler, MemoryStats } from './utils/memoryProfiler';
import { getTimeOfDayForLocation, getColorPresetForTimeOfDay } from './utils/geoTimeUtils';
import { getTopStationForLocation } from './services/radioBrowserService';


// Google Maps API Key
const GOOGLE_MAPS_KEY = "AIzaSyBNfAGRfS1TNlH0EmxNfegqTsiwzYk6reM";

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
  const [isCruiseMode, setIsCruiseMode] = useState(false);
  const [isCanvasReady, setIsCanvasReady] = useState(false); // Track if Google Maps canvas is ready
  const [navPending, setNavPending] = useState(false);
  
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
  
  // Handlers
  const handleStart = () => {
    setShowWelcome(false);
    setIsConnected(true);
  };
  

  // Cruise mode auto-advance — use a ref for heading to avoid restarting the interval on every pan
  const cruiseHeadingRef = useRef(heading);
  cruiseHeadingRef.current = heading;
  const cruiseIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const useTransitionRef = useRef(isTransitioning);
  useTransitionRef.current = isTransitioning;
  
  useEffect(() => {
    if (!isCruiseMode || !panorama || !advance) {
      if (cruiseIntervalRef.current) {
        clearInterval(cruiseIntervalRef.current);
        cruiseIntervalRef.current = null;
      }
      return;
    }
    const hop = async () => {
      // Skip if currently transitioning between locations
      if (useTransitionRef.current) {
        console.log('[CruiseMode] Skipping hop - still transitioning');
        return;
      }
      // Safe advance — waits for current pano to be ready before moving
      setNavPending(true);
      try {
        await advanceSafe('forward', undefined, cruiseHeadingRef.current);
      } finally {
        setNavPending(false);
      }
    };
    cruiseIntervalRef.current = setInterval(hop, 3000);
    return () => {
      if (cruiseIntervalRef.current) clearInterval(cruiseIntervalRef.current);
      cruiseIntervalRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCruiseMode, panorama, advance, advanceSafe]);

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
  
  // Globe teleport with auto-lighting (Phase 4) and auto-radio (Phase 3)
  const handleGlobeTeleport = useCallback(async (lat: number, lng: number) => {
    // Teleport the Street View panorama safely
    setNavPending(true);
    try {
      await teleportSafe(lat, lng);
    } finally {
      setNavPending(false);
    }

    // Phase 4: Auto-lighting based on destination's real-world time
    try {
      const timePreset = getTimeOfDayForLocation(lat, lng);
      applyTimeOfDayPreset(timePreset);
      const colorPreset = getColorPresetForTimeOfDay(timePreset);
      applyColorGradingPreset(colorPreset);
    } catch (err) {
      console.warn('[GlobeTeleport] Auto-lighting failed:', err);
    }

    // Phase 3: Auto-tune radio to local station
    getTopStationForLocation(lat, lng).then(station => {
      if (station && audioRef.current) {
        audioRef.current.src = station.urlResolved || station.url;
        audioRef.current.play().catch(() => {});
        setIsRadioPlaying(true);
        console.log(`[GlobeTeleport] Tuned to: ${station.name} (${station.country})`);
      }
    }).catch(err => {
      console.warn('[GlobeTeleport] Auto-radio failed:', err);
    });

    // Deactivate globe after teleport
    globeMode.deactivate();
  }, [teleportSafe, applyTimeOfDayPreset, applyColorGradingPreset, globeMode]);

  // Phase 5: Waypoint autopilot
  // Interval chosen to allow Street View panorama to load between jumps.
  // Shorter values risk showing loading spinners; longer values feel sluggish.
  const WAYPOINT_INTERVAL_MS = 5000;
  const autopilotRef = useRef<NodeJS.Timeout | null>(null);
  const autopilotTransitionRef = useRef(isTransitioning);
  autopilotTransitionRef.current = isTransitioning;
  
  const handleStartJourney = useCallback(async (waypoints: { lat: number; lng: number }[]) => {
    if (waypoints.length === 0) return;

    // Pre-fetch all waypoints (fire-and-forget)
    waypoints.forEach(wp => panoCache.fetch(wp.lat, wp.lng).catch(() => {}));

    // Teleport to first waypoint with auto-lighting/radio effects
    await handleGlobeTeleport(waypoints[0].lat, waypoints[0].lng);

    // Set up autopilot: advance through remaining waypoints
    if (waypoints.length > 1) {
      let idx = 1;
      autopilotRef.current = setInterval(async () => {
        if (idx >= waypoints.length) {
          if (autopilotRef.current) clearInterval(autopilotRef.current);
          autopilotRef.current = null;
          return;
        }
        // Respect transition pause before moving to next waypoint
        if (autopilotTransitionRef.current) {
          console.log('[Autopilot] Waiting for transition pause before next waypoint');
          return;
        }
        const wp = waypoints[idx];
        setNavPending(true);
        try {
          await teleportSafe(wp.lat, wp.lng);
        } catch (err) {
          console.warn(`[Autopilot] Failed to teleport to waypoint ${idx}:`, err);
        } finally {
          setNavPending(false);
        }
        idx++;
      }, WAYPOINT_INTERVAL_MS);
    }
  }, [handleGlobeTeleport, panoCache, teleportSafe]);

  // Cleanup autopilot on unmount
  useEffect(() => {
    return () => {
      if (autopilotRef.current) clearInterval(autopilotRef.current);
    };
  }, []);

  // Keyboard shortcuts
  useKeyboardShortcuts(
    [
      {
        key: 'F9',
        description: 'Toggle performance stats overlay',
        action: () => {
          setShowPerformanceStats(!showPerformanceStats);
          announce(`Performance stats ${!showPerformanceStats ? 'shown' : 'hidden'}`);
        },
      },
      {
        key: 'n',
        description: 'Toggle night mode',
        action: () => {
          const modes: TimeOfDay[] = ['day', 'sunrise', 'sunset', 'night'];
          const currentIndex = modes.indexOf(timeOfDay);
          const nextMode = modes[(currentIndex + 1) % modes.length];
          applyTimeOfDayPreset(nextMode);
          announce(`Night mode: ${nextMode}`);
        },
      },
      {
        key: 'm',
        description: 'Toggle radio',
        action: () => {
          toggleRadio();
          announce(`Radio ${!isRadioPlaying ? 'on' : 'off'}`);
        },
      },
      {
        key: 'g',
        description: 'Toggle GPS map',
        action: () => {
          setIsMapOpen(!isMapOpen);
          announce(`Map ${!isMapOpen ? 'opened' : 'closed'}`);
        },
      },
      {
        key: 'b',
        description: 'Toggle bookmarks',
        action: () => {
          setIsBookmarkPanelOpen(!isBookmarkPanelOpen);
          setIsHistoryPanelOpen(false);
          setIsSnapshotGalleryOpen(false);
          announce(`Bookmarks ${!isBookmarkPanelOpen ? 'opened' : 'closed'}`);
        },
      },
      {
        key: 'h',
        description: 'Toggle history (free look) or control mode (car)',
        action: () => {
          if (viewMode === 'car') {
            // In car mode, H toggles control mode - handled by CarInputHandler
            announce('Toggle control mode');
          } else {
            setIsHistoryPanelOpen(!isHistoryPanelOpen);
            setIsBookmarkPanelOpen(false);
            setIsSnapshotGalleryOpen(false);
            announce(`History ${!isHistoryPanelOpen ? 'opened' : 'closed'}`);
          }
        },
      },
      {
        key: 's',
        description: 'Toggle snapshot gallery',
        action: () => {
          setIsSnapshotGalleryOpen(!isSnapshotGalleryOpen);
          setIsBookmarkPanelOpen(false);
          setIsHistoryPanelOpen(false);
          announce(`Gallery ${!isSnapshotGalleryOpen ? 'opened' : 'closed'}`);
        },
      },
      {
        key: 'e',
        description: 'Toggle color grading',
        action: () => {
          setIsColorGradingPanelOpen(!isColorGradingPanelOpen);
          setIsBookmarkPanelOpen(false);
          setIsHistoryPanelOpen(false);
          setIsSnapshotGalleryOpen(false);
          announce(`Color grading ${!isColorGradingPanelOpen ? 'opened' : 'closed'}`);
        },
      },
      {
        key: 'a',
        description: 'Toggle accessibility panel',
        action: () => {
          setIsAccessibilityPanelOpen(!isAccessibilityPanelOpen);
          announce(`Accessibility panel ${!isAccessibilityPanelOpen ? 'opened' : 'closed'}`);
        },
      },
      {
        key: 'c',
        description: 'Toggle car mode',
        action: () => {
          toggleViewMode();
          announce(viewMode === 'car' ? 'Free look mode' : 'Car mode enabled');
        },
      },
      {
        key: 'w',
        description: 'Toggle wipers',
        action: () => {
          if (rainIntensity > 0 || wipersEnabled) {
            toggleWipers();
            announce(`Wipers ${!wipersEnabled ? 'on' : 'off'}`);
          }
        },
      },
      {
        key: 'l',
        description: 'Toggle dome light (car) / headlights (free look)',
        action: () => {
          if (viewMode === 'car') {
            const newState = toggleDomeLight();
            announce(`Dome light ${newState ? 'on' : 'off'}`);
          } else {
            const newState = toggleHeadlights();
            announce(`Headlights ${newState ? 'on' : 'off'}`);
          }
        },
      },
      {
        key: 'o',
        description: 'Toggle roof',
        action: () => {
          toggleRoof();
          announce(`Roof ${!isRoofOpen ? 'open' : 'closed'}`);
        },
      },
      {
        key: 'r',
        description: 'Toggle cruise mode',
        action: () => {
          setIsCruiseMode(!isCruiseMode);
          announce(`Cruise mode ${!isCruiseMode ? 'on' : 'off'}`);
        },
      },
      {
        key: 'G',
        modifier: 'shift',
        description: 'Toggle Globe Mode',
        action: () => {
          globeMode.toggle();
          announce(`Globe mode ${globeMode.transition === 'active' ? 'off' : 'on'}`);
        },
      },
      {
        key: 'Escape',
        description: 'Close panels',
        action: () => {
          if (globeMode.isActive) { globeMode.deactivate(); return; }
          if (isWeatherPanelOpen) { setIsWeatherPanelOpen(false); return; }
          if (isAccessibilityPanelOpen) setIsAccessibilityPanelOpen(false);
          else if (isBookmarkPanelOpen) setIsBookmarkPanelOpen(false);
          else if (isHistoryPanelOpen) setIsHistoryPanelOpen(false);
          else if (isSnapshotGalleryOpen) setIsSnapshotGalleryOpen(false);
          else if (isColorGradingPanelOpen) setIsColorGradingPanelOpen(false);
          else if (isMapOpen) setIsMapOpen(false);
        },
        preventDefault: false,
      },
    ],
    isConnected && !showWelcome
  );
  
  return (
    <div id="app-container" style={{ position: 'relative', width: '100vw', height: '100vh', overflow: 'hidden', padding: 0, margin: 0, backgroundColor: '#000' }}>
      {/* Skip link for keyboard navigation */}
      <SkipLink targetId="main-content">Skip to main content</SkipLink>
      
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
          {/* Floating Toolbar — top-right HUD */}
          <div
            style={{
              position: 'absolute',
              top: 16,
              right: 16,
              zIndex: 10,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-end',
              gap: 8,
              pointerEvents: 'auto',
            }}
            onMouseDown={e => e.stopPropagation()}
            onClick={e => e.stopPropagation()}
          >
            <button
              className={`control-btn${isCruiseMode ? ' disconnect' : ''}`}
              disabled={!isPanoramaReady}
              style={{ backgroundColor: isCruiseMode ? 'rgba(46,125,50,0.85)' : undefined, minWidth: 110, opacity: isPanoramaReady ? 1 : 0.5 }}
              onClick={e => { e.stopPropagation(); setIsCruiseMode(!isCruiseMode); }}
            >
              Cruise: {isCruiseMode ? 'ON' : 'OFF'}
            </button>
            <button
              className={`control-btn${isRadioPlaying ? ' disconnect' : ''}`}
              style={{ backgroundColor: isRadioPlaying ? 'rgba(255,71,87,0.85)' : undefined, minWidth: 110 }}
              onClick={e => { e.stopPropagation(); toggleRadio(); }}
            >
              Radio: {isRadioPlaying ? 'ON' : 'OFF'}
            </button>
            <button
              className="control-btn"
              style={{ minWidth: 110 }}
              onClick={e => { e.stopPropagation(); setIsSnapshotGalleryOpen(!isSnapshotGalleryOpen); }}
            >
              📷 Gallery
            </button>
            <button
              className={`control-btn${isBookmarkPanelOpen ? ' disconnect' : ''}`}
              style={{ minWidth: 110 }}
              onClick={e => { e.stopPropagation(); setIsBookmarkPanelOpen(!isBookmarkPanelOpen); setIsHistoryPanelOpen(false); setIsSnapshotGalleryOpen(false); }}
            >
              🔖 Bookmarks
            </button>
            <button
              className={`control-btn${isHistoryPanelOpen ? ' disconnect' : ''}`}
              style={{ minWidth: 110 }}
              onClick={e => { e.stopPropagation(); setIsHistoryPanelOpen(!isHistoryPanelOpen); setIsBookmarkPanelOpen(false); setIsSnapshotGalleryOpen(false); }}
            >
              🕒 History
            </button>
            <button
              className={`control-btn${isColorGradingPanelOpen ? ' disconnect' : ''}`}
              style={{ minWidth: 110 }}
              onClick={e => { e.stopPropagation(); setIsColorGradingPanelOpen(!isColorGradingPanelOpen); setIsBookmarkPanelOpen(false); setIsHistoryPanelOpen(false); setIsSnapshotGalleryOpen(false); }}
            >
              🎨 Color
            </button>
            <button
              className={`control-btn${isWeatherPanelOpen ? ' disconnect' : ''}`}
              style={{ minWidth: 110 }}
              onClick={e => { e.stopPropagation(); setIsWeatherPanelOpen(!isWeatherPanelOpen); }}
            >
              🌧 Weather
            </button>
            <button
              className="control-btn"
              style={{ minWidth: 110 }}
              onClick={e => { e.stopPropagation(); toggleViewMode(); }}
            >
              {viewMode === 'car' ? '🚶 Free Look' : '🚗 Car Mode'}
            </button>
            <button
              className="control-btn"
              style={{ minWidth: 110 }}
              onClick={e => { e.stopPropagation(); globeMode.toggle(); }}
            >
              🌍 Globe
            </button>
          </div>

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
              mapsApiKey={GOOGLE_MAPS_KEY}
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
          apiKey={GOOGLE_MAPS_KEY}
          initialPosition={{ lat: 39.2575004, lng: -121.021821 }}
          onCanvasReady={setCanvas}
          onPanoramaReady={(pano) => {
            setPanorama(pano);
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
        {isConnected && isCanvasReady && webgpuStatus !== 'initializing' && <MainView mapsApiKey={GOOGLE_MAPS_KEY} />}
        
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
