import { useState } from 'react';

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
  isSharedSessionPanelOpen: boolean;
  setIsSharedSessionPanelOpen: (open: boolean) => void;
  isMapOpen: boolean;
  setIsMapOpen: (open: boolean) => void;
  isStoragePanelOpen: boolean;
  setIsStoragePanelOpen: (open: boolean) => void;
}

/** Panel visibility toggles shared by AppToolbar and keyboard shortcuts. */
export function useAppPanels(): AppPanels {
  const [isBookmarkPanelOpen, setIsBookmarkPanelOpen] = useState(false);
  const [isHistoryPanelOpen, setIsHistoryPanelOpen] = useState(false);
  const [isSnapshotGalleryOpen, setIsSnapshotGalleryOpen] = useState(false);
  const [isColorGradingPanelOpen, setIsColorGradingPanelOpen] = useState(false);
  const [isWeatherPanelOpen, setIsWeatherPanelOpen] = useState(false);
  const [isLooksPanelOpen, setIsLooksPanelOpen] = useState(false);
  const [isAccessibilityPanelOpen, setIsAccessibilityPanelOpen] = useState(false);
  const [isHistoricalTimelineOpen, setIsHistoricalTimelineOpen] = useState(false);
  const [isTourPanelOpen, setIsTourPanelOpen] = useState(false);
  const [isSharedSessionPanelOpen, setIsSharedSessionPanelOpen] = useState(false);
  const [isMapOpen, setIsMapOpen] = useState(false);
  const [isStoragePanelOpen, setIsStoragePanelOpen] = useState(false);

  return {
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
    isLooksPanelOpen,
    setIsLooksPanelOpen,
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
  };
}
