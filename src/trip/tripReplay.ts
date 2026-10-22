/**
 * Plays a trip recording back: for each hop, look the recorded pano up by id
 * (one metered `getPanorama`, `tryConsume('panorama', 'replay')`), show it
 * through the hold-pause teleport, then restore the recorded view and the
 * user's environment settings. Cadence follows the recording, clamped so each
 * pano has time to load, and can be paused, resumed or scrubbed.
 *
 * A pano id pins one capture, so the same id is the same imagery date; the
 * lookup's `imageDate` is compared with the recorded one and fills it in when
 * the recording did not know it. A pano that no longer resolves is replaced
 * by the recorded year's capture nearby (`historicalImagery.ts`, its own
 * metered crawl) when the recording has a date, otherwise it is skipped —
 * both are counted, never silent.
 */

import { getMapsCallBudget, type MapsCallBudget } from '../services/maps/callBudget';
import { tripLibrary, type TripReplayState } from './tripLibrary';
import type { TripHop, TripRecording } from './tripRecording';

export const TRIP_REPLAY_SOURCE = 'replay';

/** Shortest time a replayed pano stays on screen (it has to load). */
export const REPLAY_MIN_GAP_MS = 1500;
/** Longest pause between replayed hops, however long the driver lingered. */
export const REPLAY_MAX_GAP_MS = 8000;

/** Duck-typed `google.maps.StreetViewService` for the by-id lookup. */
export interface ReplayStreetViewService {
  getPanorama(
    request: { pano: string },
    callback: (data: { imageDate?: string | null } | null, status: string) => void,
  ): void;
}

export type PanoLookup = (panoId: string) => Promise<{ imageDate: string | null } | null | 'budget'>;

/** The one `getPanorama` call site of replay: metered before it is made. */
export function createMeteredPanoLookup(
  service: ReplayStreetViewService,
  budget: MapsCallBudget = getMapsCallBudget(),
): PanoLookup {
  return (panoId) => {
    if (!budget.tryConsume('panorama', TRIP_REPLAY_SOURCE)) return Promise.resolve('budget');
    return new Promise((resolve) => {
      service.getPanorama({ pano: panoId }, (data, status) => {
        resolve(status === 'OK' && data ? { imageDate: data.imageDate ?? null } : null);
      });
    });
  };
}

export interface TripReplayDeps {
  lookupPano: PanoLookup;
  /** Show a pano (hold-pause `teleportToPanoSafe`). */
  showPano(panoId: string, hop: TripHop): Promise<void>;
  /** Restore heading / pitch / zoom / car heading. */
  applyView(hop: TripHop): void;
  /** Restore the weather, time of day, night intensity and look. */
  applyEnvironment(hop: TripHop): void;
  /** The recorded year's pano near a hop whose pano is gone (metered by its caller). */
  findPanoForYear?(hop: TripHop): Promise<string | null>;
  wait?(ms: number, signal: AbortSignal): Promise<void>;
}

export interface TripReplayOptions {
  /** Playback speed multiplier on the recorded cadence. */
  speed?: number;
  minGapMs?: number;
  maxGapMs?: number;
}

const defaultWait = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    const id = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(id);
      resolve();
    }, { once: true });
  });

export class TripReplay {
  readonly recording: TripRecording;
  /** Capture dates the lookups returned, by hop index. */
  readonly resolvedDates = new Map<number, string>();
  private readonly deps: TripReplayDeps;
  private readonly options: Required<TripReplayOptions>;
  private run: AbortController | null = null;
  private resumeGate: (() => void) | null = null;
  private paused = false;
  private index = 0;
  /** Hop already shown by a seek while paused (resuming must not look it up again). */
  private shownIndex: number | null = null;
  private waitAbort: AbortController | null = null;

  constructor(recording: TripRecording, deps: TripReplayDeps, options: TripReplayOptions = {}) {
    this.recording = recording;
    this.deps = deps;
    this.options = {
      speed: options.speed ?? 1,
      minGapMs: options.minGapMs ?? REPLAY_MIN_GAP_MS,
      maxGapMs: options.maxGapMs ?? REPLAY_MAX_GAP_MS,
    };
  }

  /** Start (or restart) from `fromIndex`; resolves when the replay ends or is stopped. */
  async play(fromIndex = 0): Promise<TripReplayState['status']> {
    this.run?.abort();
    const run = new AbortController();
    this.run = run;
    this.paused = false;
    this.index = Math.max(0, Math.min(this.recording.hops.length - 1, Math.floor(fromIndex)));
    const prior = tripLibrary.get().replay;
    const keep = prior?.recordingId === this.recording.id;
    tripLibrary.update({
      replay: {
        recordingId: this.recording.id,
        status: 'playing',
        index: this.index,
        total: this.recording.hops.length,
        callsUsed: keep ? prior.callsUsed : 0,
        substituted: keep ? prior.substituted : 0,
        skipped: keep ? prior.skipped : 0,
        dateMismatches: keep ? prior.dateMismatches : 0,
        shownPanoIds: keep ? prior.shownPanoIds : [],
        message: null,
      },
      albumId: this.recording.id,
    });

    const { hops } = this.recording;
    const wait = this.deps.wait ?? defaultWait;
    while (this.index < hops.length) {
      if (run.signal.aborted) return 'stopped';
      if (this.paused) {
        await new Promise<void>((resolve) => {
          this.resumeGate = resolve;
          run.signal.addEventListener('abort', () => resolve(), { once: true });
        });
        continue;
      }
      const i = this.index;
      const outcome = this.shownIndex === i ? 'shown' : await this.showHop(i, run.signal);
      this.shownIndex = null;
      if (run.signal.aborted) return 'stopped';
      if (outcome === 'budget') {
        this.stopForBudget();
        return 'budget';
      }
      const next = hops[i + 1];
      if (next && this.index === i) {
        const gap = (next.t - hops[i]!.t) / this.options.speed;
        const waitAbort = new AbortController();
        this.waitAbort = waitAbort;
        run.signal.addEventListener('abort', () => waitAbort.abort(), { once: true });
        await wait(Math.min(this.options.maxGapMs, Math.max(this.options.minGapMs, gap)), waitAbort.signal);
        this.waitAbort = null;
      }
      if (this.index === i) this.index = i + 1;
    }
    tripLibrary.updateReplay({ status: 'done', index: hops.length - 1 });
    this.run = null;
    return 'done';
  }

  pause(): void {
    if (!this.run || this.paused) return;
    this.paused = true;
    tripLibrary.updateReplay({ status: 'paused' });
  }

  resume(): void {
    if (!this.run || !this.paused) return;
    this.paused = false;
    tripLibrary.updateReplay({ status: 'playing' });
    this.resumeGate?.();
    this.resumeGate = null;
  }

  /** Jump to a hop. Playing carries on from there; paused shows it and stays paused. */
  seek(index: number): void {
    const i = Math.max(0, Math.min(this.recording.hops.length - 1, Math.floor(index)));
    const run = this.run;
    if (!run) {
      void this.play(i);
      return;
    }
    this.index = i;
    tripLibrary.updateReplay({ index: i });
    this.waitAbort?.abort();
    if (this.paused) {
      this.shownIndex = i;
      void this.showHop(i, run.signal).then((outcome) => {
        if (outcome === 'budget') this.stopForBudget();
      });
    }
  }

  private stopForBudget(): void {
    this.run?.abort();
    this.run = null;
    this.paused = false;
    tripLibrary.updateReplay({
      status: 'budget',
      message: 'Stopped: the session call meter has no panorama lookups left.',
    });
  }

  stop(): void {
    this.run?.abort();
    this.run = null;
    this.paused = false;
    tripLibrary.updateReplay({ status: 'stopped' });
  }

  private async showHop(i: number, signal: AbortSignal): Promise<'shown' | 'skipped' | 'budget'> {
    const hop = this.recording.hops[i]!;
    tripLibrary.updateReplay({ index: i });
    const found = await this.deps.lookupPano(hop.panoId);
    if (found === 'budget') return 'budget';
    const replay = tripLibrary.get().replay;
    if (replay) tripLibrary.updateReplay({ callsUsed: replay.callsUsed + 1 });
    if (signal.aborted) return 'skipped';

    let panoId: string | null = hop.panoId;
    if (found) {
      if (found.imageDate) {
        this.resolvedDates.set(i, found.imageDate);
        if (hop.panoDate && hop.panoDate !== found.imageDate) {
          const r = tripLibrary.get().replay!;
          tripLibrary.updateReplay({ dateMismatches: r.dateMismatches + 1 });
        }
      }
    } else {
      panoId = hop.panoDate && this.deps.findPanoForYear ? await this.deps.findPanoForYear(hop) : null;
      const r = tripLibrary.get().replay!;
      if (panoId) tripLibrary.updateReplay({ substituted: r.substituted + 1 });
      else tripLibrary.updateReplay({ skipped: r.skipped + 1 });
    }
    if (signal.aborted) return 'skipped';
    if (!panoId) return 'skipped';
    await this.deps.showPano(panoId, hop);
    if (signal.aborted) return 'skipped';
    const shown = tripLibrary.get().replay;
    if (shown) tripLibrary.updateReplay({ shownPanoIds: [...shown.shownPanoIds, panoId] });
    this.deps.applyView(hop);
    this.deps.applyEnvironment(hop);
    return 'shown';
  }
}
