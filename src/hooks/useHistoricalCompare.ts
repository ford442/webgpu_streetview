import { useState, useCallback } from 'react';
import type { HistoricalPanoEntry } from '../utils/historicalImagery';
import type { StreetViewRenderer } from '../renderer/RendererBackend';
import { needsCabinOverlayLatch } from '../renderer/cabinComposite';

export interface HistoricalComparison {
  beforeUrl: string;
  afterUrl: string;
  beforeEntry: HistoricalPanoEntry;
  /** True when the "before" still is the composited frame (road + cabin). */
  beforeIncludesCabin: boolean;
  /** True when the "after" still is the composited frame (road + cabin). */
  afterIncludesCabin: boolean;
}

export interface CompareStill {
  url: string;
  includesCabin: boolean;
}

/**
 * One compare still: the presented frame. When the one-frame compositor drew
 * the cabin into it (`isCabinCompositedInFrame`), the cabin is already in the
 * swap chain and comes along; otherwise (free-look, `?cabin=webgl`, any other
 * compositor stand-down) the still is road-only and says so — the 2D latch and
 * any cabin crop stay out of compare.
 */
export function captureCompareStill(
  renderer: Pick<StreetViewRenderer, 'getCanvasDataURL' | 'isCabinCompositedInFrame'>,
): CompareStill {
  const includesCabin = !needsCabinOverlayLatch(renderer);
  return { url: renderer.getCanvasDataURL(), includesCabin };
}

export interface UseHistoricalCompareParams {
  renderer: StreetViewRenderer | null;
  teleportToPanoSafe: (panoId: string) => Promise<void>;
  readyPromise: () => Promise<void>;
  getCurrentPanoId: () => string | null;
}

/**
 * Before/after comparison as a single-GPU-context swipe overlay: captures the
 * presented WebGPU frame as "after" (road + cabin when the one-frame compositor
 * drew it, road-only otherwise — see `captureCompareStill`), hold-pause hops to the historical panorama,
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
        const after = captureCompareStill(renderer);

        await teleportToPanoSafe(entry.panoId);
        await readyPromise();
        // Let the release crossfade finish painting before reading the canvas back.
        await new Promise((resolve) => setTimeout(resolve, 300));
        const before = captureCompareStill(renderer);

        await teleportToPanoSafe(originalPanoId);
        await readyPromise();

        setComparison({
          beforeUrl: before.url,
          afterUrl: after.url,
          beforeEntry: entry,
          beforeIncludesCabin: before.includesCabin,
          afterIncludesCabin: after.includesCabin,
        });
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
