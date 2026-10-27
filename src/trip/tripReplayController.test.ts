import { normalizeIncomingSessionFields } from '../app/sharedSessionSync';
import { MapsCallBudget } from '../services/maps/callBudget';
import { encodeTripLink } from './tripFile';
import { tripLibrary } from './tripLibrary';
import type { TripRecording } from './tripRecording';
import { createMeteredPanoLookup } from './tripReplay';
import {
  activeReplayBroadcast,
  configureTripReplay,
  followHostReplay,
  isFollowingHostReplay,
  resetTripReplayControllerForTests,
  startReplay,
} from './tripReplayController';

vi.mock('./tripLibrary', async (orig) => {
  const real = await orig<typeof import('./tripLibrary')>();
  return { ...real, saveTripRecording: vi.fn(async (r: TripRecording) => real.tripLibrary.upsert(r)) };
});

function recording(hops = 8): TripRecording {
  return {
    version: 1,
    id: 'trip-a',
    name: 'A → B',
    createdAt: '2026-10-21T10:00:00.000Z',
    routeId: 'route:a',
    stops: [{ lat: 1, lng: 2, label: 'A' }, { lat: 1.01, lng: 2, label: 'B' }],
    hops: Array.from({ length: hops }, (_, i) => ({
      t: i * 3000,
      panoId: `p${i}`,
      panoDate: null,
      lat: 1 + i * 1e-4,
      lng: 2,
      heading: 0,
      pitch: 0,
      zoom: 1,
      carHeading: 0,
      weather: { rain: 0, snow: 0, wind: 0, fog: 0, timeOfDay: 'day' as const },
      look: null,
      nightIntensity: 0,
    })),
    stills: [],
    durationMs: (hops - 1) * 3000,
    truncated: false,
  };
}

let shown: string[] = [];
let release: (() => void) | null = null;
const budget = new MapsCallBudget();

beforeEach(() => {
  vi.useRealTimers();
  tripLibrary.resetForTests();
  shown = [];
  configureTripReplay(() => ({
    lookupPano: createMeteredPanoLookup({ getPanorama: (_r, cb) => cb({ imageDate: '2023-04' }, 'OK') }, budget),
    showPano: async (id) => { shown.push(id); },
    applyView: () => {},
    applyEnvironment: () => {},
    // Hold between hops until the test releases the next one.
    wait: (_ms, signal) => new Promise<void>((resolve) => {
      release = resolve;
      signal.addEventListener('abort', () => resolve(), { once: true });
    }),
  }));
});

afterEach(() => resetTripReplayControllerForTests());


describe('shared-session replay', () => {
  it('validates the replay field a guest receives', async () => {
    const link = (await encodeTripLink(recording()))!;
    expect(normalizeIncomingSessionFields({ replay: { link, index: 3, playing: true } }).replay)
      .toEqual({ link, index: 3, playing: true });
    expect(normalizeIncomingSessionFields({ replay: { link: 'bad link!', index: 0 } }).replay).toBeUndefined();
    expect(normalizeIncomingSessionFields({ replay: { link, index: -1 } }).replay).toBeUndefined();
    expect(normalizeIncomingSessionFields({ replay: { link: 'x'.repeat(5000), index: 0 } }).replay).toBeUndefined();
  });

  it('the host broadcasts its replay; a guest replays it locally and re-seeks on drift', async () => {
    const rec = recording();
    tripLibrary.upsert(rec);
    expect(startReplay(rec)).toBe(true);
    // The link payload is gzipped asynchronously.
    await vi.waitFor(() => expect(activeReplayBroadcast()).toBeDefined());
    const remote = activeReplayBroadcast();
    expect(remote).toMatchObject({ index: 0, playing: true });
    expect(remote!.link).toBe(await encodeTripLink(rec));
    resetTripReplayControllerForTests();

    // Guest side.
    shown = [];
    configureTripReplay(() => ({
      lookupPano: createMeteredPanoLookup({ getPanorama: (_r, cb) => cb({ imageDate: '2023-04' }, 'OK') }, budget),
      showPano: async (id) => { shown.push(id); },
      applyView: () => {},
      applyEnvironment: () => {},
      wait: (_ms, signal) => new Promise<void>((resolve) => {
        release = resolve;
        signal.addEventListener('abort', () => resolve(), { once: true });
      }),
    }));
    const before = budget.getStats().bySource.replay ?? 0;
    await followHostReplay({ ...remote!, index: 2 });
    expect(isFollowingHostReplay()).toBe(true);
    await vi.waitFor(() => expect(shown).toEqual(['p2']));
    expect(budget.getStats().bySource.replay).toBe(before + 1);

    // Host jumped ahead: the guest seeks instead of walking every hop.
    await followHostReplay({ ...remote!, index: 6 });
    release?.();
    await vi.waitFor(() => expect(shown.at(-1)).toBe('p6'));
    expect(shown).not.toContain('p4');

    await followHostReplay(undefined);
    expect(isFollowingHostReplay()).toBe(false);
    expect(tripLibrary.get().replay?.status).toBe('stopped');
  });
});
