/**
 * Saved trip recordings and the live recorder / replay status, as an external
 * store (like `tripStore`): the recorder and replay update it outside React,
 * the Trip panel and the coverage map subscribe with `useTripLibrary`.
 *
 * Recordings persist in the `tripRecordings` IndexedDB store, keyed by id.
 */

import { useSyncExternalStore } from 'react';
import { offlineDelete, offlineGet, offlineListKeys, offlineSet } from '../offline/offlineStore';
import { parseTripRecording, type TripRecording } from './tripRecording';

type TripReplayStatus = 'playing' | 'paused' | 'done' | 'stopped' | 'budget' | 'error';

export interface TripReplayState {
  recordingId: string;
  status: TripReplayStatus;
  /** Index of the hop on screen (or being loaded). */
  index: number;
  total: number;
  /** Metered `getPanorama` lookups this replay has made. */
  callsUsed: number;
  /** Hops whose pano no longer resolved and were replaced by the recorded year's pano nearby. */
  substituted: number;
  /** Hops that could not be shown at all. */
  skipped: number;
  /** Panos whose looked-up capture date differs from the recorded one. */
  dateMismatches: number;
  /** Panos actually shown, in order (what an e2e compares with the recording). */
  shownPanoIds: readonly string[];
  message: string | null;
}

export interface TripLibraryState {
  readonly recordings: readonly TripRecording[];
  /** Id of the recording being written right now. */
  readonly recordingId: string | null;
  readonly replay: TripReplayState | null;
  /** Recording whose route and stills the coverage map shows. */
  readonly albumId: string | null;
}

const EMPTY: TripLibraryState = { recordings: [], recordingId: null, replay: null, albumId: null };

let state: TripLibraryState = EMPTY;
const listeners = new Set<() => void>();

function commit(next: TripLibraryState): void {
  state = next;
  for (const l of Array.from(listeners)) l();
}

export const tripLibrary = {
  get: (): TripLibraryState => state,
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  update(patch: Partial<TripLibraryState>): void {
    commit({ ...state, ...patch });
  },
  updateReplay(patch: Partial<TripReplayState>): void {
    if (state.replay) commit({ ...state, replay: { ...state.replay, ...patch } });
  },
  /** Insert or replace a recording in the list (newest first). */
  upsert(recording: TripRecording): void {
    const rest = state.recordings.filter((r) => r.id !== recording.id);
    commit({ ...state, recordings: [recording, ...rest].sort((a, b) => b.createdAt.localeCompare(a.createdAt)) });
  },
  remove(id: string): void {
    commit({
      ...state,
      recordings: state.recordings.filter((r) => r.id !== id),
      albumId: state.albumId === id ? null : state.albumId,
    });
  },
  find(id: string | null): TripRecording | null {
    return id ? state.recordings.find((r) => r.id === id) ?? null : null;
  },
  resetForTests(): void {
    commit(EMPTY);
  },
};

export function useTripLibrary<T>(selector: (s: TripLibraryState) => T): T {
  return useSyncExternalStore(
    tripLibrary.subscribe,
    () => selector(tripLibrary.get()),
    () => selector(tripLibrary.get()),
  );
}

/** Load every saved recording into the library (invalid rows are skipped). */
export async function loadTripRecordings(): Promise<void> {
  const keys = await offlineListKeys('tripRecordings');
  const rows = await Promise.all(keys.map((key) => offlineGet<unknown>('tripRecordings', key)));
  const recordings = rows
    .map((row) => parseTripRecording(row))
    .filter((r): r is TripRecording => r !== null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  tripLibrary.update({ recordings });
}

export async function saveTripRecording(recording: TripRecording): Promise<void> {
  tripLibrary.upsert(recording);
  await offlineSet('tripRecordings', recording.id, recording);
}

export async function deleteTripRecording(id: string): Promise<void> {
  tripLibrary.remove(id);
  await offlineDelete('tripRecordings', id);
}
