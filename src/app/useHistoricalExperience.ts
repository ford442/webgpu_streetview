import { useHistoricalTimeline } from '../hooks/useHistoricalTimeline';
import { useHistoricalCompare } from '../hooks/useHistoricalCompare';
import type { HistoricalComparison } from '../hooks/useHistoricalCompare';
import type { HistoricalPanoEntry } from '../utils/historicalImagery';
import type { StreetViewRenderer } from '../renderer/RendererBackend';
import { resolveHistoricalAfterLabel } from './historicalExperience';

export interface UseHistoricalExperienceParams {
  panorama: google.maps.StreetViewPanorama | null;
  renderer: StreetViewRenderer | null;
  teleportToPanoSafe: (panoId: string) => Promise<void>;
  readyPromise: () => Promise<void>;
}

export interface UseHistoricalExperienceResult {
  historicalEntries: HistoricalPanoEntry[];
  isHistoricalLoading: boolean;
  historicalError: string | null;
  hasHistoricalTimeline: boolean;
  historicalCurrentIndex: number;
  historicalCurrentPanoId: string | null;
  compareHistorical: (entry: HistoricalPanoEntry) => Promise<void>;
  exitHistoricalCompare: () => void;
  historicalComparison: HistoricalComparison | null;
  isCapturingComparison: boolean;
  historicalAfterLabel: string;
}

/** Timeline + comparison wiring and after-label derivation for AppShell. */
export function useHistoricalExperience({
  panorama,
  renderer,
  teleportToPanoSafe,
  readyPromise,
}: UseHistoricalExperienceParams): UseHistoricalExperienceResult {
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

  const historicalAfterLabel = resolveHistoricalAfterLabel(
    historicalEntries,
    historicalCurrentPanoId,
  );

  return {
    historicalEntries,
    isHistoricalLoading,
    historicalError,
    hasHistoricalTimeline,
    historicalCurrentIndex,
    historicalCurrentPanoId,
    compareHistorical,
    exitHistoricalCompare,
    historicalComparison,
    isCapturingComparison,
    historicalAfterLabel,
  };
}
