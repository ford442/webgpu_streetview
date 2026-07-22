import { formatImageDate, type HistoricalPanoEntry } from '../utils/historicalImagery';

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
