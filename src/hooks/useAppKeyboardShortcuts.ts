import { type KeyboardShortcut } from './useKeyboardShortcuts';
import type { TimeOfDay } from './useEnvironmentSettings';

export interface UseAppKeyboardShortcutsOptions {
  showPerformanceStats: boolean;
  setShowPerformanceStats: (v: boolean) => void;
  timeOfDay: TimeOfDay;
  applyTimeOfDayPreset: (mode: TimeOfDay) => void;
  isRadioPlaying: boolean;
  toggleRadio: () => void;
  isMapOpen: boolean;
  setIsMapOpen: (v: boolean) => void;
  isBookmarkPanelOpen: boolean;
  setIsBookmarkPanelOpen: (v: boolean) => void;
  isHistoryPanelOpen: boolean;
  setIsHistoryPanelOpen: (v: boolean) => void;
  isSnapshotGalleryOpen: boolean;
  setIsSnapshotGalleryOpen: (v: boolean) => void;
  isColorGradingPanelOpen: boolean;
  setIsColorGradingPanelOpen: (v: boolean) => void;
  isAccessibilityPanelOpen: boolean;
  setIsAccessibilityPanelOpen: (v: boolean) => void;
  isWeatherPanelOpen: boolean;
  setIsWeatherPanelOpen: (v: boolean) => void;
  isTourPanelOpen: boolean;
  setIsTourPanelOpen: (v: boolean) => void;
  viewMode: 'freelook' | 'car';
  toggleViewMode: () => void;
  rainIntensity: number;
  wipersEnabled: boolean;
  toggleWipers: () => void;
  headlightsOn: boolean;
  toggleHeadlights: () => boolean;
  toggleDomeLight: () => boolean;
  isRoofOpen: boolean;
  toggleRoof: () => void;
  isCruiseMode: boolean;
  setIsCruiseMode: (v: boolean) => void;
  globeMode: {
    isActive: boolean;
    transition: string;
    toggle: () => void;
    deactivate: () => void;
  };
  announce: (msg: string) => void;
}

export function buildAppKeyboardShortcuts(options: UseAppKeyboardShortcutsOptions): KeyboardShortcut[] {
  const {
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
    toggleHeadlights,
    toggleDomeLight,
    isRoofOpen,
    toggleRoof,
    isCruiseMode,
    setIsCruiseMode,
    globeMode,
    announce,
  } = options;

  return [
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
        // Modulo of modes.length is always a valid index.
        const nextMode = modes[(currentIndex + 1) % modes.length]!;
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
      key: 't',
      description: 'Toggle tour panel',
      action: () => {
        setIsTourPanelOpen(!isTourPanelOpen);
        announce(`Tour panel ${!isTourPanelOpen ? 'opened' : 'closed'}`);
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
        else if (isTourPanelOpen) setIsTourPanelOpen(false);
        else if (isMapOpen) setIsMapOpen(false);
      },
      preventDefault: false,
    },
  ];
}
