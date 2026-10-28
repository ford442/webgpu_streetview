/**
 * Saved trip recordings and the live recorder / replay status, as an external
 * store (like `tripStore`): the recorder and replay update it outside React,
 * the Trip panel and the coverage map subscribe with `useTripLibrary`.
 *
 * Recordings persist in the `tripRecordings` IndexedDB store, keyed by id.
 */

import { createStore, useStore } from '../state/createStore';
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

const store = createStore<TripLibraryState>(EMPTY);

export const tripLibrary = {
  get: store.get,
  subscribe: store.subscribe,
  update(patch: Partial<TripLibraryState>): void {
    store.set((state) => ({ ...state, ...patch }));
  },
  updateReplay(patch: Partial<TripReplayState>): void {
    store.set((state) => (state.replay ? { ...state, replay: { ...state.replay, ...patch } } : state));
  },
  /** Insert or replace a recording in the list (newest first). */
  upsert(recording: TripRecording): void {
    store.set((state) => {
      const rest = state.recordings.filter((r) => r.id !== recording.id);
      return { ...state, recordings: [recording, ...rest].sort((a, b) => b.createdAt.localeCompare(a.createdAt)) };
    });
  },
  remove(id: string): void {
    store.set((state) => ({
      ...state,
      recordings: state.recordings.filter((r) => r.id !== id),
      albumId: state.albumId === id ? null : state.albumId,
    }));
  },
  find(id: string | null): TripRecording | null {
    return id ? store.get().recordings.find((r) => r.id === id) ?? null : null;
  },
  resetForTests(): void {
    store.set(EMPTY);
  },
};

export function useTripLibrary<T>(selector: (s: TripLibraryState) => T): T {
  return useStore(store, selector);
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
