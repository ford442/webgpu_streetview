import { formatImageDate, type HistoricalPanoEntry } from '../utils/historicalImagery';
import {
  isReducedMotionRequested,
  resolveHistoricalReveal,
  wipeDirectionForHop,
  type HistoricalReveal,
} from '../renderer/historicalWipe';

/**
 * Label for the "after" side of a historical comparison overlay.
 * Falls back to "Current" when the live pano is not in the timeline.
 */
export function resolveHistoricalAfterLabel(
  entries: HistoricalPanoEntry[],
  currentPanoId: string | null | undefined,
): string {
  if (!currentPanoId) return 'Current';
  const entry = entries.find((e) => e.panoId === currentPanoId);
  return entry ? formatImageDate(entry.imageDate) : 'Current';
}

/**
 * How a year-chip hop reveals its capture: a wipe whose direction follows the
 * strip's chronology, or a cut when the OS or the app asks for reduced motion.
 * `currentIndex` < 0 means the live pano is not a chip; the strip then treats
 * the newest chip as on screen, and so does this.
 */
export function resolveYearChipReveal(
  entries: HistoricalPanoEntry[],
  currentIndex: number,
  target: HistoricalPanoEntry,
  appReducedMotion: boolean,
  systemReducedMotion: () => boolean = isReducedMotionRequested,
): HistoricalReveal {
  const from = currentIndex >= 0 ? currentIndex : entries.length - 1;
  const to = entries.findIndex((e) => e.panoId === target.panoId);
  return resolveHistoricalReveal({
    reducedMotion: appReducedMotion || systemReducedMotion(),
    direction: wipeDirectionForHop(from, to < 0 ? from : to),
  });
}

/** Whether each compare still already contains the cabin (one-frame compositor). */
export interface CompareStillScope {
  beforeIncludesCabin: boolean;
  afterIncludesCabin: boolean;
}

/**
 * The scope line under the compare chips. Before any compare has been taken
 * (`null`) it states the rule; after, it states what the pair actually holds.
 * A cabin is never cropped in — a still has it only if the presented frame did.
 */
export function compareStillScopeLabel(scope: CompareStillScope | null): string {
  if (!scope) {
    return 'Compare stills are the frame on screen: with the cabin when car mode draws it in-frame, road view only otherwise.';
  }
  if (scope.beforeIncludesCabin && scope.afterIncludesCabin) {
    return 'Compare stills include the cabin, as drawn in the frame.';
  }
  if (!scope.beforeIncludesCabin && !scope.afterIncludesCabin) {
    return 'Compare stills show the road view only (no cabin).';
  }
  return 'One compare still includes the cabin; the other shows the road view only.';
}
