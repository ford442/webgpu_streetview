import { describe, expect, it, beforeEach, vi } from 'vitest';
import { buildAppKeyboardShortcuts } from '../useAppKeyboardShortcuts';
import { noteGeocodeStatus, resetGeocodeAuthForTests } from '../../search/geocodeAuth';
import type { TimeOfDay } from '../useEnvironmentSettings';

function baseOptions(overrides: Partial<Parameters<typeof buildAppKeyboardShortcuts>[0]> = {}) {
  const announce = vi.fn();
  const setIsCruiseMode = vi.fn();
  const options = {
    showPerformanceStats: false,
    setShowPerformanceStats: () => {},
    timeOfDay: 'day' as TimeOfDay,
    applyTimeOfDayPreset: () => {},
    isRadioPlaying: false,
    toggleRadio: () => {},
    isMapOpen: false,
    setIsMapOpen: () => {},
    isBookmarkPanelOpen: false,
    setIsBookmarkPanelOpen: () => {},
    isHistoryPanelOpen: false,
    setIsHistoryPanelOpen: () => {},
    isSnapshotGalleryOpen: false,
    setIsSnapshotGalleryOpen: () => {},
    isColorGradingPanelOpen: false,
    setIsColorGradingPanelOpen: () => {},
    isAccessibilityPanelOpen: false,
    setIsAccessibilityPanelOpen: () => {},
    isWeatherPanelOpen: false,
    setIsWeatherPanelOpen: () => {},
    isLooksPanelOpen: false,
    setIsLooksPanelOpen: () => {},
    isTourPanelOpen: false,
    setIsTourPanelOpen: () => {},
    isCinemaMode: false,
    toggleCinemaMode: () => {},
    exitCinemaMode: () => {},
    viewMode: 'freelook' as const,
    toggleViewMode: () => {},
    wipersEnabled: false,
    toggleWipers: () => {},
    headlightsOn: false,
    toggleHeadlights: () => false,
    toggleDomeLight: () => false,
    isRoofOpen: false,
    toggleRoof: () => {},
    isCruiseMode: false,
    setIsCruiseMode,
    globeMode: {
      isActive: false,
      isEngaged: false,
      transition: '',
      toggle: () => {},
      cancel: () => {},
      deactivate: () => {},
    },
    announce,
    ...overrides,
  };
  return { announce, setIsCruiseMode, options };
}

describe('cruise shortcut vs geocode denied', () => {
  beforeEach(() => {
    resetGeocodeAuthForTests();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('does not engage cruise when Geocoding is REQUEST_DENIED', () => {
    noteGeocodeStatus('REQUEST_DENIED');
    const { announce, setIsCruiseMode, options } = baseOptions();
    const shortcuts = buildAppKeyboardShortcuts(options);
    const cruise = shortcuts.find((s) => s.key === 'r');
    cruise?.action();
    expect(setIsCruiseMode).not.toHaveBeenCalled();
    expect(announce).toHaveBeenCalledWith(expect.stringMatching(/Cruise unavailable/i));
  });

  it('still allows turning cruise off', () => {
    noteGeocodeStatus('REQUEST_DENIED');
    const { setIsCruiseMode, options } = baseOptions({ isCruiseMode: true });
    const shortcuts = buildAppKeyboardShortcuts(options);
    const cruise = shortcuts.find((s) => s.key === 'r');
    cruise?.action();
    expect(setIsCruiseMode).toHaveBeenCalledWith(false);
  });
});
