import { lazy, Suspense } from 'react';
import type { TimeOfDay } from '../../hooks';
import type { AccessibilitySettings } from '../../hooks/useKeyboardShortcuts';
import type { Bookmark } from '../../hooks/useBookmarks';
import type { HistoryEntry } from '../../hooks/useLocationHistory';
import type { SnapshotMetadata, SnapshotShareResult } from '../../hooks/useSnapshots';
import type { ImageExportFormat } from '../../utils/imageExport';
import type { UseSharedSessionResult } from '../../hooks/useSharedSession';
import type { GlobeModeControls } from '../../hooks/useGlobeMode';
import type { TourPanelBindings } from '../useTourBindings';
import type { AppPanels } from '../useAppPanels';
import type { UseHistoricalExperienceResult } from '../useHistoricalExperience';
import type { RendererBackendInfo } from '../../components/RendererBackendIndicator';
import type { PerformanceMonitorState } from '../../hooks/usePerformanceMonitor';
import type { MemoryStats } from '../../utils/memoryProfiler';
import type { RouteGraphSummary } from '../../offline';
import AppToolbar from '../../components/AppToolbar';
import {
  BookmarkPanel,
  HistoryPanel,
  SnapshotGallery,
  ColorGradingPanel,
  WeatherPanel,
  AccessibilityPanel,
  HistoricalTimeline,
  TourPanel,
  SharedSessionPanel,
  PerformanceStatsOverlay,
  RendererBackendIndicator,
  ComparisonView,
} from '../../components';
import StorageManagementPanel from '../../components/StorageManagementPanel';

const GlobeView = lazy(() => import('../../components/GlobeView'));

export interface ConnectedChromeSession {
  viewMode: 'freelook' | 'car';
  toggleViewMode: () => void;
  isCruiseMode: boolean;
  setIsCruiseMode: React.Dispatch<React.SetStateAction<boolean>>;
  isPanoramaReady: boolean;
  isRadioPlaying: boolean;
  toggleRadio: () => void;
  sharedSession: UseSharedSessionResult;
  panorama: google.maps.StreetViewPanorama | null;
  heading: number;
  isTransitioning: boolean;
  teleportToPanoSafe: (panoId: string) => Promise<void>;
}

export interface ConnectedChromeBookmarks {
  bookmarks: Bookmark[];
  handleAddBookmark: (name: string) => void;
  removeBookmark: (id: string) => void;
  isBookmarkSyncing: boolean;
  bookmarkSyncError: string | null;
  loadCloudBookmarks: () => Promise<void>;
  saveBookmarkToCloud: (bookmarkId: string) => Promise<void>;
  removeCloudBookmark: (bookmarkId: string) => Promise<void>;
  syncAllToCloud: () => Promise<void>;
}

export interface ConnectedChromeHistory {
  history: HistoryEntry[];
  removeFromHistory: (id: string) => void;
  clearHistory: () => void;
}

export interface ConnectedChromeSnapshots {
  snapshots: SnapshotMetadata[];
  isOnline: boolean;
  hasServiceWorker: boolean;
  removeSnapshot: (id: string) => void;
  updateSnapshotName: (id: string, name: string) => void;
  downloadSnapshot: (snapshot: SnapshotMetadata, format: ImageExportFormat) => void;
  clearAllSnapshots: () => void;
  getSnapshotDeepLink: (snapshot: SnapshotMetadata) => string;
  shareSnapshot: (snapshot: SnapshotMetadata, format?: ImageExportFormat) => Promise<SnapshotShareResult>;
  onTeleport: (lat: number, lng: number, heading: number, pitch: number, panoId?: string) => void;
  onTakeSnapshot: () => void;
}

export interface ConnectedChromeEnvironment {
  vibrance: number;
  saturation: number;
  contrast: number;
  exposure: number;
  temperature: number;
  tint: number;
  headlightsOn: boolean;
  shaderEffectsEnabled: boolean;
  setVibrance: (v: number) => void;
  setSaturation: (v: number) => void;
  setContrast: (v: number) => void;
  setExposure: (v: number) => void;
  setTemperature: (v: number) => void;
  setTint: (v: number) => void;
  toggleHeadlights: () => void;
  setShaderEffectsEnabled: (v: boolean) => void;
  applyColorGradingPreset: (preset: string) => void;
  rainIntensity: number;
  snowIntensity: number;
  wind: number;
  fogDensity: number;
  wipersEnabled: boolean;
  timeOfDay: TimeOfDay;
  setRainIntensity: (v: number) => void;
  setSnowIntensity: (v: number) => void;
  setWind: (v: number) => void;
  setFogDensity: (v: number) => void;
  toggleWipers: () => void;
  applyTimeOfDayPreset: (preset: TimeOfDay) => void;
}

export interface ConnectedChromeGlobe {
  globeMode: GlobeModeControls;
  effectiveMapsKey: string;
  handleGlobeTeleport: (lat: number, lng: number) => void | Promise<void>;
  handleStartJourney: (waypoints: { lat: number; lng: number }[]) => void | Promise<void>;
}

export interface ConnectedChromeOfflineRoutes {
  summaries: RouteGraphSummary[];
  onDelete: (routeId: string) => void;
  onRefresh: () => void;
}

export interface ConnectedChromeOverlays {
  showPerformanceStats: boolean;
  setShowPerformanceStats: (show: boolean) => void;
  perfStats: PerformanceMonitorState;
  memoryStats?: MemoryStats;
  rendererBackendInfo: RendererBackendInfo | null;
  navPending: boolean;
  historicalAfterLabel: string;
}

export interface ConnectedChromeProps {
  panels: AppPanels;
  session: ConnectedChromeSession;
  bookmarks: ConnectedChromeBookmarks;
  history: ConnectedChromeHistory;
  snapshots: ConnectedChromeSnapshots;
  environment: ConnectedChromeEnvironment;
  historical: UseHistoricalExperienceResult;
  accessibilitySettings: AccessibilitySettings;
  setAccessibilitySettings: React.Dispatch<React.SetStateAction<AccessibilitySettings>>;
  tourPanelProps: TourPanelBindings;
  globe: ConnectedChromeGlobe;
  overlays: ConnectedChromeOverlays;
  offlineRoutes: ConnectedChromeOfflineRoutes;
}

/** Toolbar + feature panels + globe, shown once the user is connected. */
export function ConnectedChrome({
  panels,
  session,
  bookmarks: bm,
  history: hist,
  snapshots: snaps,
  environment: env,
  historical,
  accessibilitySettings,
  setAccessibilitySettings,
  tourPanelProps,
  globe,
  overlays,
  offlineRoutes,
}: ConnectedChromeProps) {
  const {
    viewMode,
    toggleViewMode,
    isCruiseMode,
    setIsCruiseMode,
    isPanoramaReady,
    isRadioPlaying,
    toggleRadio,
    sharedSession,
    panorama,
    heading,
    isTransitioning,
    teleportToPanoSafe,
  } = session;
  const { globeMode, effectiveMapsKey, handleGlobeTeleport, handleStartJourney } = globe;

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
    isStoragePanelOpen,
    setIsStoragePanelOpen,
  } = panels;

  return (
    <>
      {overlays.showPerformanceStats && (
        <PerformanceStatsOverlay
          fpsStats={overlays.perfStats}
          memoryStats={overlays.memoryStats}
          position="top-left"
          visible={true}
          showMemory={true}
          onToggle={() => overlays.setShowPerformanceStats(false)}
        />
      )}

      <RendererBackendIndicator backendInfo={overlays.rendererBackendInfo} />

      {overlays.navPending && (
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

      {historical.historicalComparison && (
        <ComparisonView
          beforeUrl={historical.historicalComparison.beforeUrl}
          afterUrl={historical.historicalComparison.afterUrl}
          beforeEntry={historical.historicalComparison.beforeEntry}
          afterLabel={overlays.historicalAfterLabel}
          onClose={historical.exitHistoricalCompare}
        />
      )}

      <AppToolbar
        isCruiseMode={isCruiseMode}
        setIsCruiseMode={setIsCruiseMode}
        isPanoramaReady={isPanoramaReady}
        isRadioPlaying={isRadioPlaying}
        toggleRadio={toggleRadio}
        isSnapshotGalleryOpen={isSnapshotGalleryOpen}
        setIsSnapshotGalleryOpen={setIsSnapshotGalleryOpen}
        onTakeSnapshot={snaps.onTakeSnapshot}
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
          roomCode={sharedSession.roomCode}
          participants={sharedSession.participants}
          isConnected={sharedSession.isConnected}
          onCreateRoom={sharedSession.createRoom}
          onJoinRoom={sharedSession.joinRoom}
          onLeave={sharedSession.leaveSession}
        />
      )}

      {isBookmarkPanelOpen && (
        <BookmarkPanel
          bookmarks={bm.bookmarks}
          currentCoords={(() => {
            const pos = panorama?.getPosition();
            return pos ? { lat: pos.lat(), lng: pos.lng() } : { lat: 0, lng: 0 };
          })()}
          onTeleport={(_lat, _lng, _h, _p) => {}}
          onAddBookmark={bm.handleAddBookmark}
          onRemoveBookmark={bm.removeBookmark}
          onClose={() => setIsBookmarkPanelOpen(false)}
          isOpen={isBookmarkPanelOpen}
          isSyncing={bm.isBookmarkSyncing}
          syncError={bm.bookmarkSyncError}
          onLoadCloudBookmarks={bm.loadCloudBookmarks}
          onSaveBookmarkToCloud={bm.saveBookmarkToCloud}
          onRemoveCloudBookmark={bm.removeCloudBookmark}
          onSyncAllToCloud={bm.syncAllToCloud}
        />
      )}

      {isHistoryPanelOpen && (
        <HistoryPanel
          history={hist.history}
          onTeleport={(lat, lng, h, p) => {
            console.log('Teleport to:', lat, lng, h, p);
          }}
          onRemoveEntry={hist.removeFromHistory}
          onClearHistory={hist.clearHistory}
          onClose={() => setIsHistoryPanelOpen(false)}
          isOpen={isHistoryPanelOpen}
        />
      )}

      {isSnapshotGalleryOpen && (
        <SnapshotGallery
          snapshots={snaps.snapshots}
          isOffline={!snaps.isOnline}
          onRemoveSnapshot={snaps.removeSnapshot}
          onUpdateName={snaps.updateSnapshotName}
          onDownload={snaps.downloadSnapshot}
          onShare={snaps.shareSnapshot}
          onCopyLink={snaps.getSnapshotDeepLink}
          onTeleport={snaps.onTeleport}
          onClose={() => setIsSnapshotGalleryOpen(false)}
          onClearAll={snaps.clearAllSnapshots}
          isOpen={isSnapshotGalleryOpen}
        />
      )}

      {isColorGradingPanelOpen && (
        <ColorGradingPanel
          vibrance={env.vibrance}
          saturation={env.saturation}
          contrast={env.contrast}
          exposure={env.exposure}
          temperature={env.temperature}
          tint={env.tint}
          nightIntensity={0}
          headlightsOn={env.headlightsOn}
          highBeam={false}
          shaderEffectsEnabled={env.shaderEffectsEnabled}
          onVibranceChange={env.setVibrance}
          onSaturationChange={env.setSaturation}
          onContrastChange={env.setContrast}
          onExposureChange={env.setExposure}
          onTemperatureChange={env.setTemperature}
          onTintChange={env.setTint}
          onNightIntensityChange={() => {}}
          onToggleHeadlights={env.toggleHeadlights}
          onToggleHighBeam={() => {}}
          onToggleShaderEffects={() => env.setShaderEffectsEnabled(!env.shaderEffectsEnabled)}
          onPreset={env.applyColorGradingPreset}
          onClose={() => setIsColorGradingPanelOpen(false)}
          isOpen={isColorGradingPanelOpen}
        />
      )}

      {isWeatherPanelOpen && (
        <WeatherPanel
          rainIntensity={env.rainIntensity}
          snowIntensity={env.snowIntensity}
          wind={env.wind}
          fogDensity={env.fogDensity}
          wipersEnabled={env.wipersEnabled}
          timeOfDay={env.timeOfDay}
          onRainIntensity={env.setRainIntensity}
          onSnowIntensity={env.setSnowIntensity}
          onWind={env.setWind}
          onFogDensity={env.setFogDensity}
          onToggleWipers={env.toggleWipers}
          onTimeOfDay={(v) => env.applyTimeOfDayPreset(v as TimeOfDay)}
          onClose={() => setIsWeatherPanelOpen(false)}
          isOpen={isWeatherPanelOpen}
        />
      )}

      {isHistoricalTimelineOpen && (
        <HistoricalTimeline
          isOpen={isHistoricalTimelineOpen}
          onClose={() => setIsHistoricalTimelineOpen(false)}
          entries={historical.historicalEntries}
          isLoading={historical.isHistoricalLoading}
          error={historical.historicalError}
          hasTimeline={historical.hasHistoricalTimeline}
          currentIndex={historical.historicalCurrentIndex}
          isTransitioning={isTransitioning || historical.isCapturingComparison}
          onSelectDate={(entry) => teleportToPanoSafe(entry.panoId)}
          onCompare={historical.compareHistorical}
          isComparing={!!historical.historicalComparison}
          onExitCompare={historical.exitHistoricalCompare}
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
          isOnline={snaps.isOnline}
          hasServiceWorker={snaps.hasServiceWorker}
          routeGraphSummaries={offlineRoutes.summaries}
          onDeleteRouteGraph={offlineRoutes.onDelete}
          onRefreshRouteGraphs={offlineRoutes.onRefresh}
        />
      )}

      {isTourPanelOpen && (
        <TourPanel
          isOpen={isTourPanelOpen}
          onClose={() => setIsTourPanelOpen(false)}
          {...tourPanelProps}
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
            pois={hist.history.map((h) => ({
              lat: h.lat,
              lng: h.lng,
              label: h.locationName || `${h.lat.toFixed(2)}, ${h.lng.toFixed(2)}`,
            }))}
            bookmarks={bm.bookmarks.map((b) => ({
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
  );
}
