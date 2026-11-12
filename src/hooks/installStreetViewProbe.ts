/**
 * `window.__STREETVIEW_PROBE__` — the DevTools / headless surface over the hold-pause probe
 * (`debug/streetViewProbe.ts`) and the engine counters that sit beside it. It reads the renderer,
 * trip, XR and call-budget modules, so it lives with the hooks that install it, not in `debug/` (#368).
 * See `scripts/hold-pause-probe.mjs`.
 */
import { streetViewProbe, type HoldTimelineEntry, type ProbeWarning } from '../debug/streetViewProbe';
import type { ScraperHealth } from '../debug/scraperHealth';
import { clearLateLatchStats, getLateLatchStats, type LateLatchStats, getXrPresentedFrames, isXrPresenting } from '../renderer';
import { getLastXrSupport, type XrSupport } from '../xr/xrSupport';
import { getMapsCallBudget, type MapsCallBudgetStats } from '../services/maps/callBudget';
import { povStore, tripProbeSnapshot } from '../state';
import { tripLibrary, type TripReplayState } from '../trip/tripLibrary';

declare global {
  interface Window {
    __STREETVIEW_PROBE__?: {
      getTimeline: () => HoldTimelineEntry[];
      getWarnings: () => ProbeWarning[];
      getScraperHealth: () => ScraperHealth;
      /** Session call meter (services/maps/callBudget.ts). */
      getCallBudget: () => MapsCallBudgetStats;
      /** Routed trip status / progress / re-snaps (state/tripStore.ts). */
      getTrip: () => ReturnType<typeof tripProbeSnapshot>;
      /** Trip recorder / replay (trip/tripLibrary.ts): recordings by id, the recording in progress, the replay. */
      getTripRecordings: () => {
        recordings: { id: string; hops: { panoId: string; panoDate: string | null; heading: number; pitch: number }[] }[];
        recordingId: string | null;
        replay: TripReplayState | null;
        /** The live view, to compare with a replayed hop. */
        pov: { heading: number; pitch: number; zoom: number; carHeading: number };
      };
      /** The frame tail (#331): `latchDeltaDeg` > 0 while looking, 0 at rest; mode, deferrals. */
      getLateLatch: () => LateLatchStats;
      /** WebXR cockpit (#331): what boot detected, whether a session presents, eye frames drawn. */
      getXr: () => { support: XrSupport | null; presenting: boolean; presentedFrames: number };
      enablePixelWatch: () => void;
      disablePixelWatch: () => void;
      clear: () => void;
    };
  }
}

export function installStreetViewProbe(): void {
  if (typeof window === 'undefined') return;
  window.__STREETVIEW_PROBE__ = {
    getTimeline: () => streetViewProbe.getTimeline(),
    getWarnings: () => streetViewProbe.getWarnings(),
    getScraperHealth: () => streetViewProbe.getScraperHealth(),
    getCallBudget: () => getMapsCallBudget().getStats(),
    getTrip: () => tripProbeSnapshot(),
    getTripRecordings: () => {
      const s = tripLibrary.get();
      return {
        recordings: s.recordings.map((r) => ({ id: r.id, hops: r.hops.map((h) => ({ panoId: h.panoId, panoDate: h.panoDate, heading: h.heading, pitch: h.pitch })) })),
        recordingId: s.recordingId,
        replay: s.replay,
        pov: (({ heading, pitch, zoom, carHeading }) => ({ heading, pitch, zoom, carHeading }))(povStore.get()),
      };
    },
    getLateLatch: () => getLateLatchStats(),
    getXr: () => ({ support: getLastXrSupport(), presenting: isXrPresenting(), presentedFrames: getXrPresentedFrames() }),
    enablePixelWatch: () => streetViewProbe.enablePixelWatch(),
    disablePixelWatch: () => streetViewProbe.disablePixelWatch(),
    clear: () => {
      streetViewProbe.clear();
      clearLateLatchStats();
    },
  };
}
