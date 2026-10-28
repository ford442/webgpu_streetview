import { useMemo } from 'react';
import { isPanelOpen, setPanelOpen, usePanelsState, type PanelId } from '../state/panelsStore';

export interface AppPanels {
  isBookmarkPanelOpen: boolean;
  setIsBookmarkPanelOpen: (open: boolean) => void;
  isHistoryPanelOpen: boolean;
  setIsHistoryPanelOpen: (open: boolean) => void;
  isSnapshotGalleryOpen: boolean;
  setIsSnapshotGalleryOpen: (open: boolean) => void;
  isColorGradingPanelOpen: boolean;
  setIsColorGradingPanelOpen: (open: boolean) => void;
  isWeatherPanelOpen: boolean;
  setIsWeatherPanelOpen: (open: boolean) => void;
  isLooksPanelOpen: boolean;
  setIsLooksPanelOpen: (open: boolean) => void;
  isAccessibilityPanelOpen: boolean;
  setIsAccessibilityPanelOpen: (open: boolean) => void;
  isHistoricalTimelineOpen: boolean;
  setIsHistoricalTimelineOpen: (open: boolean) => void;
  isTourPanelOpen: boolean;
  setIsTourPanelOpen: (open: boolean) => void;
  isTripPanelOpen: boolean;
  setIsTripPanelOpen: (open: boolean) => void;
  isSharedSessionPanelOpen: boolean;
  setIsSharedSessionPanelOpen: (open: boolean) => void;
  isMapOpen: boolean;
  setIsMapOpen: (open: boolean) => void;
  isStoragePanelOpen: boolean;
  setIsStoragePanelOpen: (open: boolean) => void;
  showPerformanceStats: boolean;
  setShowPerformanceStats: (open: boolean) => void;
}

/** `AppPanels` field name → store id. */
const FIELDS: ReadonlyArray<readonly [open: keyof AppPanels, set: keyof AppPanels, id: PanelId]> = [
  ['isBookmarkPanelOpen', 'setIsBookmarkPanelOpen', 'bookmarks'],
  ['isHistoryPanelOpen', 'setIsHistoryPanelOpen', 'history'],
  ['isSnapshotGalleryOpen', 'setIsSnapshotGalleryOpen', 'snapshots'],
  ['isColorGradingPanelOpen', 'setIsColorGradingPanelOpen', 'colorGrading'],
  ['isWeatherPanelOpen', 'setIsWeatherPanelOpen', 'weather'],
  ['isLooksPanelOpen', 'setIsLooksPanelOpen', 'looks'],
  ['isAccessibilityPanelOpen', 'setIsAccessibilityPanelOpen', 'accessibility'],
  ['isHistoricalTimelineOpen', 'setIsHistoricalTimelineOpen', 'historicalTimeline'],
  ['isTourPanelOpen', 'setIsTourPanelOpen', 'tour'],
  ['isTripPanelOpen', 'setIsTripPanelOpen', 'trip'],
  ['isSharedSessionPanelOpen', 'setIsSharedSessionPanelOpen', 'sharedSession'],
  ['isMapOpen', 'setIsMapOpen', 'map'],
  ['isStoragePanelOpen', 'setIsStoragePanelOpen', 'storage'],
  ['showPerformanceStats', 'setShowPerformanceStats', 'performance'],
];

/**
 * A stable, live view of `panelsStore` that does not subscribe: the flags are
 * getters read at call time. For `AppShell`, which only opens panels and must
 * not re-render when one toggles.
 */
const LIVE_PANELS: AppPanels = (() => {
  const view = {} as Record<string, unknown>;
  for (const [open, set, id] of FIELDS) {
    Object.defineProperty(view, open, { get: () => isPanelOpen(id), enumerable: true });
    view[set] = (next: boolean) => setPanelOpen(id, next);
  }
  return view as unknown as AppPanels;
})();

export function useAppPanels(): AppPanels {
  return LIVE_PANELS;
}

/** The panels as plain values, re-rendering on every toggle (toolbar, shortcuts, chrome). */
export function usePanelsSnapshot(): AppPanels {
  const state = usePanelsState();
  return useMemo(() => {
    const snapshot = {} as Record<string, unknown>;
    for (const [open, set, id] of FIELDS) {
      snapshot[open] = state[id];
      snapshot[set] = LIVE_PANELS[set];
    }
    return snapshot as unknown as AppPanels;
  }, [state]);
}
