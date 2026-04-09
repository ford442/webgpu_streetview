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
  useEnvironmentSettings
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

// Google Maps API Key
const GOOGLE_MAPS_KEY = "AIzaSyBNfAGRfS1TNlH0EmxNfegqTsiwzYk6reM";

/**
 * InnerApp - The actual app content that uses the providers.
 * This is separated so it can access the contexts.
 */
function InnerApp() {
  // Connect to contexts
  const { setCanvas, setPanorama, panorama, heading, pitch, canvas } = useStreetView();
  const { viewMode, toggleViewMode } = useViewMode();
  const {
    rainIntensity,
    wipersEnabled,
    toggleWipers,
    headlightsOn,
    toggleHeadlights,
    domeLightOn,
    toggleDomeLight,
    isRoofOpen,
    toggleRoof,
    timeOfDay,
    applyTimeOfDayPreset,
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
  const [isRadioPlaying, setIsRadioPlaying] = useState(false);
  const [isCruiseMode, setIsCruiseMode] = useState(false);
  
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
  const { history, addToHistory, removeFromHistory, clearHistory } = useLocationHistory();
  const { snapshots, addSnapshot, removeSnapshot, updateSnapshotName, downloadSnapshot, clearAllSnapshots } = useSnapshots();
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
  
  // Handlers
  const handleStart = () => {
    setShowWelcome(false);
    setIsConnected(true);
  };
  
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
          const modes: ('day' | 'sunset' | 'night')[] = ['day', 'sunset', 'night'];
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
            toggleDomeLight();
            announce(`Dome light ${domeLightOn ? 'off' : 'on'}`);
          } else {
            toggleHeadlights();
            announce(`Headlights ${headlightsOn ? 'off' : 'on'}`);
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

      {/* Global UI Panels */}
      {isConnected && (
        <>
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
              snowIntensity={0}
              wind={0}
              wipersEnabled={wipersEnabled}
              timeOfDay={timeOfDay}
              onRainIntensity={() => {}}
              onSnowIntensity={() => {}}
              onWind={() => {}}
              onToggleWipers={toggleWipers}
              onTimeOfDay={(v) => applyTimeOfDayPreset(v as any)}
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
          
          {/* Globe View - TODO: Add proper props */}
          {globeMode.isActive && (
            <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', background: '#000' }}>
              <button onClick={globeMode.deactivate}>Close Globe</button>
              <p>Globe view content</p>
            </div>
          )}
        </>
      )}

      {/* Hidden StreetView - kept in DOM for canvas scraping */}
      <div style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        zIndex: isConnected ? 0 : 2,
        opacity: isConnected ? 0 : 1,
        transition: 'opacity 0.5s ease-in-out'
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
        {isConnected && <MainView mapsApiKey={GOOGLE_MAPS_KEY} />}
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
