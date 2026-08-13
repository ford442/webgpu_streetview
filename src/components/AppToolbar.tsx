import React from 'react';
import PlaceSearchBar from './PlaceSearchBar';
import type { UsePlaceSearchResult } from '../hooks/usePlaceSearch';

export interface AppToolbarProps {
  isCruiseMode: boolean;
  setIsCruiseMode: (v: boolean) => void;
  isPanoramaReady: boolean;
  isRadioPlaying: boolean;
  toggleRadio: () => void;
  isSnapshotGalleryOpen: boolean;
  setIsSnapshotGalleryOpen: (v: boolean) => void;
  onTakeSnapshot: () => void;
  isBookmarkPanelOpen: boolean;
  setIsBookmarkPanelOpen: (v: boolean) => void;
  isHistoryPanelOpen: boolean;
  setIsHistoryPanelOpen: (v: boolean) => void;
  isColorGradingPanelOpen: boolean;
  setIsColorGradingPanelOpen: (v: boolean) => void;
  isWeatherPanelOpen: boolean;
  setIsWeatherPanelOpen: (v: boolean) => void;
  isLooksPanelOpen: boolean;
  setIsLooksPanelOpen: (v: boolean) => void;
  isHistoricalTimelineOpen: boolean;
  setIsHistoricalTimelineOpen: (v: boolean) => void;
  isTourPanelOpen: boolean;
  setIsTourPanelOpen: (v: boolean) => void;
  isSharedSessionPanelOpen: boolean;
  setIsSharedSessionPanelOpen: (v: boolean) => void;
  isSharedSessionActive: boolean;
  isStoragePanelOpen: boolean;
  setIsStoragePanelOpen: (v: boolean) => void;
  viewMode: 'freelook' | 'car';
  toggleViewMode: () => void;
  onGlobeToggle: () => void;
  search?: UsePlaceSearchResult;
}

const AppToolbar: React.FC<AppToolbarProps> = ({
  isCruiseMode,
  setIsCruiseMode,
  isPanoramaReady,
  isRadioPlaying,
  toggleRadio,
  isSnapshotGalleryOpen,
  setIsSnapshotGalleryOpen,
  onTakeSnapshot,
  isBookmarkPanelOpen,
  setIsBookmarkPanelOpen,
  isHistoryPanelOpen,
  setIsHistoryPanelOpen,
  isColorGradingPanelOpen,
  setIsColorGradingPanelOpen,
  isWeatherPanelOpen,
  setIsWeatherPanelOpen,
  isLooksPanelOpen,
  setIsLooksPanelOpen,
  isHistoricalTimelineOpen,
  setIsHistoricalTimelineOpen,
  isTourPanelOpen,
  setIsTourPanelOpen,
  isSharedSessionPanelOpen,
  setIsSharedSessionPanelOpen,
  isSharedSessionActive,
  isStoragePanelOpen,
  setIsStoragePanelOpen,
  viewMode,
  toggleViewMode,
  onGlobeToggle,
  search,
}) => {
  return (
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
      {search && <PlaceSearchBar search={search} compact />}
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
        onClick={e => { e.stopPropagation(); onTakeSnapshot(); }}
      >
        📸 Snapshot
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
        className={`control-btn${isLooksPanelOpen ? ' disconnect' : ''}`}
        style={{ minWidth: 110 }}
        onClick={e => { e.stopPropagation(); setIsLooksPanelOpen(!isLooksPanelOpen); }}
      >
        🎞 Looks
      </button>
      <button
        className={`control-btn${isHistoricalTimelineOpen ? ' disconnect' : ''}`}
        style={{ minWidth: 110 }}
        onClick={e => { e.stopPropagation(); setIsHistoricalTimelineOpen(!isHistoricalTimelineOpen); }}
      >
        🕰 Time Travel
      </button>
      <button
        className={`control-btn${isTourPanelOpen ? ' disconnect' : ''}`}
        style={{ minWidth: 110 }}
        onClick={e => { e.stopPropagation(); setIsTourPanelOpen(!isTourPanelOpen); }}
      >
        🗺 Tours
      </button>
      <button
        className={`control-btn${isSharedSessionPanelOpen || isSharedSessionActive ? ' disconnect' : ''}`}
        style={{ minWidth: 110, backgroundColor: isSharedSessionActive ? 'rgba(46,125,50,0.85)' : undefined }}
        onClick={e => { e.stopPropagation(); setIsSharedSessionPanelOpen(!isSharedSessionPanelOpen); }}
      >
        🧑‍🤝‍🧑 Road Trip
      </button>
      <button
        className={`control-btn${isStoragePanelOpen ? ' disconnect' : ''}`}
        style={{ minWidth: 110 }}
        onClick={e => { e.stopPropagation(); setIsStoragePanelOpen(!isStoragePanelOpen); }}
      >
        💾 Offline
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
        onClick={e => { e.stopPropagation(); onGlobeToggle(); }}
      >
        🌍 Globe
      </button>
    </div>
  );
};

export default AppToolbar;
