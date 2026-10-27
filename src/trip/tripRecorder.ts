/**
 * Records a routed road trip hop by hop.
 *
 * Subscribes to `tripStore`: a drive starting is a new recording (resuming the
 * same route continues it), every progress update — the trip controller
 * writes one after each cruise hop — samples the current pano, and arrival or
 * clearing the trip finishes it. A hop is appended only when the pano changed.
 *
 * What a hop captures comes from the injected `sample()` (the app reads the
 * panorama, `povStore` and the environment settings); this module has no
 * Maps, React or DOM dependency, so a whole trip can be recorded in a test.
 */

import { tripStore, type TripState, type TripStore } from '../state/tripStore';
import { tripLibrary } from './tripLibrary';
import {
  MAX_TRIP_HOPS,
  MAX_TRIP_STILLS,
  TRIP_FORMAT_VERSION,
  type TripHop,
  type TripRecording,
  type TripStill,
} from './tripRecording';

export type TripHopSample = Omit<TripHop, 't'>;

export interface TripRecorderDeps {
  /** The pano and view right now, or null when there is no pano yet. */
  sample(): TripHopSample | null;
  /** Persist a recording (on finish, on pause and every `flushEvery` hops). */
  persist(recording: TripRecording): Promise<void>;
  store?: TripStore;
  now?(): number;
  maxHops?: number;
  flushEvery?: number;
}

export interface TripRecorder {
  /** A snapshot was taken: list it in the album of the recording in progress. */
  noteStill(still: Omit<TripStill, 't'>): void;
  /** The recording in progress, if any. */
  current(): TripRecording | null;
  dispose(): void;
}

const MIN_HOPS_TO_KEEP = 2;

function tripName(s: TripState): string {
  const from = s.stops[0]?.label || 'Start';
  const to = s.stops[s.stops.length - 1]?.label || 'Destination';
  return `${from} → ${to}`;
}

export function createTripRecorder(deps: TripRecorderDeps): TripRecorder {
  const store = deps.store ?? tripStore;
  const now = deps.now ?? (() => Date.now());
  const maxHops = deps.maxHops ?? MAX_TRIP_HOPS;
  const flushEvery = deps.flushEvery ?? 25;

  let rec: TripRecording | null = null;
  let startedAt = 0;
  let sinceFlush = 0;
  let prev: TripState = store.get();

  const flush = (): void => {
    if (!rec || rec.hops.length < MIN_HOPS_TO_KEEP) return;
    sinceFlush = 0;
    const snapshot: TripRecording = { ...rec, hops: [...rec.hops], stills: [...rec.stills] };
    deps.persist(snapshot).catch((err) => console.warn('[tripRecorder] Failed to save the recording', err));
  };

  const appendHop = (): void => {
    if (!rec) return;
    const sample = deps.sample();
    if (!sample) return;
    const last = rec.hops[rec.hops.length - 1];
    if (last && last.panoId === sample.panoId) return;
    if (rec.hops.length >= maxHops) {
      rec.truncated = true;
      return;
    }
    const t = Math.max(0, now() - startedAt);
    rec.hops.push({ ...sample, t });
    rec.durationMs = t;
    sinceFlush += 1;
    if (sinceFlush >= flushEvery) flush();
  };

  const start = (s: TripState): void => {
    startedAt = now();
    sinceFlush = 0;
    rec = {
      version: TRIP_FORMAT_VERSION,
      id: `trip-${startedAt.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      name: tripName(s),
      createdAt: new Date(startedAt).toISOString(),
      routeId: s.route!.id,
      stops: s.stops.map((stop) => ({ ...stop })),
      hops: [],
      stills: [],
      durationMs: 0,
      truncated: false,
    };
    tripLibrary.update({ recordingId: rec.id });
    appendHop();
  };

  const finish = (): void => {
    if (!rec) return;
    flush();
    rec = null;
    tripLibrary.update({ recordingId: null });
  };

  const onChange = (): void => {
    const s = store.get();
    const before = prev;
    prev = s;
    const routeId = s.route?.id ?? null;
    if (rec && routeId !== rec.routeId) finish();

    if (s.status === 'driving') {
      if (before.status !== 'driving') {
        // A paused drive of the same route carries on in the same recording.
        if (rec) appendHop();
        else if (s.route) start(s);
      } else if (s.progress !== before.progress) {
        appendHop();
      }
      return;
    }
    if (!rec) return;
    if (s.status === 'arrived') {
      appendHop();
      finish();
    } else if (s.status === 'ready') {
      flush();
    } else {
      finish();
    }
  };

  const unsubscribe = store.subscribe(onChange);

  return {
    noteStill(still) {
      if (!rec || rec.stills.length >= MAX_TRIP_STILLS) return;
      rec.stills.push({ ...still, t: Math.max(0, now() - startedAt) });
    },
    current: () => rec,
    dispose() {
      unsubscribe();
      finish();
    },
  };
}
