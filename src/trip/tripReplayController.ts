/**
 * The one active trip replay, React-free like `tripController`: the Trip panel
 * starts / pauses / scrubs it, shared sessions mirror it, and
 * `app/useTripRecording.ts` injects the app side (the metered lookup, the
 * hold-pause teleport, the POV and environment setters) with
 * {@link configureTripReplay}.
 *
 * Shared sessions: the host broadcasts the recording as its link payload plus
 * the hop index ({@link activeReplayBroadcast}); a guest decodes it and runs
 * the same replay locally — every pano lookup on the guest's own meter — and
 * re-seeks when it drifts from the host ({@link followHostReplay}).
 */

import { decodeTripLink, encodeTripLink } from './tripFile';
import { saveTripRecording, tripLibrary } from './tripLibrary';
import type { TripRecording } from './tripRecording';
import { TripReplay, type TripReplayDeps, type TripReplayOptions } from './tripReplay';

/** What a host puts in `SessionState.replay`. */
export interface SessionReplay {
  /** `?trip=` payload of the recording (`tripFile.encodeTripLink`). */
  link: string;
  index: number;
  playing: boolean;
}

/** A guest re-seeks when it is this many hops away from the host. */
const GUEST_DRIFT_HOPS = 2;

let deps: (() => TripReplayDeps | null) | null = null;
let active: TripReplay | null = null;
let broadcast: { recordingId: string; link: string | null } | null = null;
let following: { link: string; replay: TripReplay } | null = null;

/** Injected by the app shell; a function so the deps are read fresh per replay. */
export function configureTripReplay(next: (() => TripReplayDeps | null) | null): void {
  deps = next;
}

export function startReplay(recording: TripRecording, fromIndex = 0, options?: TripReplayOptions): boolean {
  const d = deps?.();
  if (!d) return false;
  active?.stop();
  const replay = new TripReplay(recording, d, options);
  active = replay;
  broadcast = { recordingId: recording.id, link: null };
  void encodeTripLink(recording).then((link) => {
    if (broadcast?.recordingId === recording.id) broadcast.link = link;
  });
  void replay.play(fromIndex).then((status) => {
    if (active === replay) active = null;
    if (status === 'done') backfillDates(replay);
  });
  return true;
}

/** Write the capture dates a finished replay looked up into hops that did not know theirs. */
function backfillDates(replay: TripReplay): void {
  const recording = tripLibrary.find(replay.recording.id) ?? replay.recording;
  let changed = false;
  const hops = recording.hops.map((hop, i) => {
    const date = replay.resolvedDates.get(i);
    if (hop.panoDate || !date) return hop;
    changed = true;
    return { ...hop, panoDate: date };
  });
  if (changed) {
    saveTripRecording({ ...recording, hops }).catch((err) => console.warn('[trip] Failed to save replay dates', err));
  }
}

export function pauseReplay(): void {
  active?.pause();
}

export function resumeReplay(): void {
  active?.resume();
}

export function seekReplay(index: number): void {
  if (active) {
    active.seek(index);
    return;
  }
  const replay = tripLibrary.get().replay;
  const recording = tripLibrary.find(replay?.recordingId ?? null);
  if (recording) startReplay(recording, index);
}

export function stopReplay(): void {
  active?.stop();
  active = null;
  broadcast = null;
  following = null;
}

export function activeReplay(): TripReplay | null {
  return active;
}

/** The host's replay for `SessionState.replay`, read at send time; undefined when none (or too long for a link). */
export function activeReplayBroadcast(): SessionReplay | undefined {
  const state = tripLibrary.get().replay;
  if (!active || !broadcast?.link || !state || state.recordingId !== broadcast.recordingId) return undefined;
  return { link: broadcast.link, index: state.index, playing: state.status === 'playing' };
}

/** Guest side: mirror the host's replay locally, or stop when the host stopped. */
export async function followHostReplay(remote: SessionReplay | undefined): Promise<void> {
  if (!remote) {
    if (following) stopReplay();
    return;
  }
  if (following?.link !== remote.link) {
    const recording = await decodeTripLink(remote.link);
    if (!recording) return;
    tripLibrary.upsert(recording);
    if (!startReplay(recording, remote.index)) return;
    following = { link: remote.link, replay: active! };
  }
  const local = tripLibrary.get().replay;
  if (!local || active !== following?.replay) return;
  if (Math.abs(local.index - remote.index) >= GUEST_DRIFT_HOPS) active.seek(remote.index);
  if (remote.playing && local.status === 'paused') active.resume();
  else if (!remote.playing && local.status === 'playing') active.pause();
}

/** True while a guest is replaying the host's trip (it drives the pano, not the host packets). */
export function isFollowingHostReplay(): boolean {
  return following !== null && active === following.replay;
}

/** Test-only. */
export function resetTripReplayControllerForTests(): void {
  stopReplay();
  deps = null;
}
