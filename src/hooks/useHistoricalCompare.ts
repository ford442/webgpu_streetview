import { useState, useCallback } from 'react';
import type { HistoricalPanoEntry } from '../utils/historicalImagery';
import type { StreetViewRenderer } from '../renderer/RendererBackend';

export interface HistoricalComparison {
  beforeUrl: string;
  afterUrl: string;
  beforeEntry: HistoricalPanoEntry;
}

export interface UseHistoricalCompareParams {
  renderer: StreetViewRenderer | null;
  teleportToPanoSafe: (panoId: string) => Promise<void>;
  readyPromise: () => Promise<void>;
  getCurrentPanoId: () => string | null;
}

/**
 * Before/after comparison as a single-GPU-context swipe overlay: captures the
 * live WebGPU canvas as "after", hold-pause hops to the historical panorama,
 * captures it as "before", then hops straight back — no second live render
 * context is ever created (the dual-context path from the feature plan is a
 * separate, deferred piece of work; see docs/feature_expansion_plan.md §2.2).
 */
export function useHistoricalCompare({
  renderer,
  teleportToPanoSafe,
  readyPromise,
  getCurrentPanoId,
}: UseHistoricalCompareParams) {
  const [comparison, setComparison] = useState<HistoricalComparison | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);

  const compare = useCallback(
    async (entry: HistoricalPanoEntry) => {
      if (!renderer) {
        setCaptureError('Renderer not ready for comparison capture.');
        return;
      }
      const originalPanoId = getCurrentPanoId();
      if (!originalPanoId || originalPanoId === entry.panoId) return;

      setIsCapturing(true);
      setCaptureError(null);
      try {
        const afterUrl = renderer.getCanvasDataURL();

        await teleportToPanoSafe(entry.panoId);
        await readyPromise();
        // Let the release crossfade finish painting before reading the canvas back.
        await new Promise((resolve) => setTimeout(resolve, 300));
        const beforeUrl = renderer.getCanvasDataURL();

        await teleportToPanoSafe(originalPanoId);
        await readyPromise();

        setComparison({ beforeUrl, afterUrl, beforeEntry: entry });
      } catch (e) {
        setCaptureError(e instanceof Error ? e.message : 'Failed to capture comparison');
      } finally {
        setIsCapturing(false);
      }
    },
    [renderer, teleportToPanoSafe, readyPromise, getCurrentPanoId]
  );

  const exitCompare = useCallback(() => {
    setComparison(null);
    setCaptureError(null);
  }, []);

  return { compare, exitCompare, comparison, isCapturing, captureError };
}
