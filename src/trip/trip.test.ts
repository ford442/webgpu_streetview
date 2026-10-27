import { MapsCallBudget } from '../services/maps/callBudget';
import { L_ROUTE, ORIGIN } from '../services/routing/__tests__/routeFixtures';
import { buildActiveRoute } from '../services/routing/routeGeometry';
import { createTripStore, type TripProgress } from '../state/tripStore';
import { tripLibrary } from './tripLibrary';
import { createTripRecorder, type TripHopSample } from './tripRecorder';
import { MAX_TRIP_HOPS, parseTripRecording, type TripHop, type TripRecording } from './tripRecording';
import { TripReplay, createMeteredPanoLookup, type ReplayStreetViewService } from './tripReplay';
import { TRIP_LINK_MAX_CHARS, buildTripLinkUrl, decodeTripFile, decodeTripLink, encodeTripFile, encodeTripLink } from './tripFile';

const route = buildActiveRoute(L_ROUTE, { stops: [ORIGIN, L_ROUTE.polyline[4]!], providerId: 'test' });
const stops = [{ ...ORIGIN, label: 'Home' }, { ...L_ROUTE.polyline[4]!, label: 'Shop' }];

const progress = (alongM: number): TripProgress => ({
  alongM, crossM: 0, remainingM: route.lengthM - alongM, nextStepIndex: 0, distanceToNextStepM: 0, etaS: null, avgSpeedMps: null,
});

function sampleAt(i: number, overrides: Partial<TripHopSample> = {}): TripHopSample {
  return {
    panoId: `pano-${i}`,
    panoDate: i % 2 === 0 ? '2024-06' : null,
    lat: ORIGIN.lat + i * 1e-4,
    lng: ORIGIN.lng,
    heading: 90 + i,
    pitch: -2,
    zoom: 1,
    carHeading: 90,
    weather: { rain: 0.4, snow: 0, wind: 0.2, fog: 0.1, timeOfDay: i < 3 ? 'day' : 'sunset' },
    look: i < 3 ? null : 'noir',
    nightIntensity: 0.25,
    ...overrides,
  };
}

function recordTrip(hopCount: number, maxHops?: number) {
  const store = createTripStore({ status: 'ready', route, stops });
  let clock = 1_000;
  let current = 0;
  const saved: TripRecording[] = [];
  const recorder = createTripRecorder({
    store,
    sample: () => sampleAt(current),
    persist: async (r) => { saved.push(r); },
    now: () => clock,
    maxHops,
  });
  store.update({ status: 'driving', progress: progress(0) });
  for (let i = 1; i < hopCount; i++) {
    clock += 3000;
    current = i;
    store.update({ progress: progress(i * 10) });
    // The same pano again (a stuck hop) is not a new record.
    store.update({ progress: progress(i * 10 + 1) });
  }
  clock += 3000;
  store.update({ status: 'arrived' });
  recorder.dispose();
  return { saved, store };
}

beforeEach(() => tripLibrary.resetForTests());

describe('tripRecorder', () => {
  it('records one hop per pano change from drive start to arrival', () => {
    const { saved } = recordTrip(6);
    const rec = saved.at(-1)!;
    expect(rec.hops.map((h) => h.panoId)).toEqual(['pano-0', 'pano-1', 'pano-2', 'pano-3', 'pano-4', 'pano-5']);
    expect(rec.hops.map((h) => h.t)).toEqual([0, 3000, 6000, 9000, 12000, 15000]);
    expect(rec.name).toBe('Home → Shop');
    expect(rec.routeId).toBe(route.id);
    expect(rec.hops[4]).toMatchObject({ look: 'noir', weather: { timeOfDay: 'sunset', rain: 0.4 } });
    expect(parseTripRecording(JSON.parse(JSON.stringify(rec)))).toEqual(rec);
    expect(tripLibrary.get().recordingId).toBeNull();
  });

  it('continues the same recording across a pause and caps its size', () => {
    const store = createTripStore({ status: 'ready', route, stops });
    let n = 0;
    const saved: TripRecording[] = [];
    const recorder = createTripRecorder({ store, sample: () => sampleAt(n), persist: async (r) => { saved.push(r); }, maxHops: 3 });
    store.update({ status: 'driving', progress: progress(0) });
    n = 1;
    store.update({ progress: progress(10) });
    store.update({ status: 'ready' });
    n = 2;
    store.update({ status: 'driving' });
    n = 3;
    store.update({ progress: progress(30) });
    expect(recorder.current()!.hops.map((h) => h.panoId)).toEqual(['pano-0', 'pano-1', 'pano-2']);
    expect(recorder.current()!.truncated).toBe(true);
    store.reset();
    expect(saved.at(-1)!.hops).toHaveLength(3);
    expect(recorder.current()).toBeNull();
    recorder.dispose();
  });

  it('lists snapshots taken during the drive', () => {
    const store = createTripStore({ status: 'ready', route, stops });
    const recorder = createTripRecorder({ store, sample: () => sampleAt(0), persist: async () => {} });
    recorder.noteStill({ snapshotId: 'ignored', name: 'x', lat: 0, lng: 0, panoId: null });
    store.update({ status: 'driving' });
    recorder.noteStill({ snapshotId: 'snap-1', name: 'Corner', lat: 1, lng: 2, panoId: 'pano-0' });
    expect(recorder.current()!.stills).toEqual([expect.objectContaining({ snapshotId: 'snap-1', name: 'Corner' })]);
    recorder.dispose();
  });
});

function fakeReplayService(dates: Record<string, string | null>) {
  const calls: string[] = [];
  const service: ReplayStreetViewService = {
    getPanorama({ pano }, cb) {
      calls.push(pano);
      if (pano in dates) cb({ imageDate: dates[pano] }, 'OK');
      else cb(null, 'ZERO_RESULTS');
    },
  };
  return { service, calls };
}

function replayHarness(recording: TripRecording, dates: Record<string, string | null>, budget = new MapsCallBudget()) {
  const { service, calls } = fakeReplayService(dates);
  const shown: string[] = [];
  const views: TripHop[] = [];
  const envs: TripHop[] = [];
  const waits: number[] = [];
  const replay = new TripReplay(recording, {
    lookupPano: createMeteredPanoLookup(service, budget),
    showPano: async (id) => { shown.push(id); },
    applyView: (h) => views.push(h),
    applyEnvironment: (h) => envs.push(h),
    findPanoForYear: async (h) => (h.panoDate ? `${h.panoId}-${h.panoDate}` : null),
    wait: async (ms) => { waits.push(ms); },
  });
  return { replay, calls, shown, views, envs, waits, budget };
}

describe('TripReplay', () => {
  const recording = (): TripRecording => recordTrip(6).saved.at(-1)!;

  it('replays the recorded panos in order, metered, restoring view and environment', async () => {
    const rec = recording();
    const dates = Object.fromEntries(rec.hops.map((h) => [h.panoId, h.panoDate ?? '2024-06']));
    const h = replayHarness(rec, dates);
    expect(await h.replay.play()).toBe('done');
    expect(h.shown).toEqual(rec.hops.map((x) => x.panoId));
    expect(h.calls).toEqual(rec.hops.map((x) => x.panoId));
    expect(h.budget.getStats().bySource.replay).toBe(rec.hops.length);
    expect(h.views.map((v) => v.heading)).toEqual(rec.hops.map((x) => x.heading));
    expect(h.envs[4]).toMatchObject({ look: 'noir', weather: { timeOfDay: 'sunset' } });
    // Recorded 3 s cadence, never below the load floor.
    expect(h.waits).toEqual([3000, 3000, 3000, 3000, 3000]);
    // Dates the recording did not know are filled from the lookups.
    expect(h.replay.resolvedDates.get(1)).toBe('2024-06');
    expect(tripLibrary.get().replay).toMatchObject({ status: 'done', callsUsed: 6, dateMismatches: 0, skipped: 0 });
  });

  it('stops honestly at the call cap', async () => {
    const rec = recording();
    const h = replayHarness(rec, Object.fromEntries(rec.hops.map((x) => [x.panoId, null])), new MapsCallBudget({ panorama: 2 }));
    expect(await h.replay.play()).toBe('budget');
    expect(h.shown).toHaveLength(2);
    expect(tripLibrary.get().replay).toMatchObject({ status: 'budget', callsUsed: 2 });
    expect(tripLibrary.get().replay!.message).toMatch(/call meter/);
  });

  it('substitutes the recorded year for a vanished pano, skips one without a date, and counts date drift', async () => {
    const rec = recording();
    const dates: Record<string, string | null> = Object.fromEntries(rec.hops.map((x) => [x.panoId, x.panoDate]));
    delete dates['pano-2']; // has a recorded date → substituted
    delete dates['pano-3']; // no recorded date → skipped
    dates['pano-4'] = '2019-01'; // recorded 2024-06
    const h = replayHarness(rec, dates);
    await h.replay.play();
    expect(h.shown).toEqual(['pano-0', 'pano-1', 'pano-2-2024-06', 'pano-4', 'pano-5']);
    expect(tripLibrary.get().replay).toMatchObject({ substituted: 1, skipped: 1, dateMismatches: 1 });
  });

  it('seeks to a hop and carries on from there', async () => {
    const rec = recording();
    const h = replayHarness(rec, Object.fromEntries(rec.hops.map((x) => [x.panoId, null])));
    const done = h.replay.play();
    h.replay.seek(4);
    await done;
    expect(h.shown[0]).toBe('pano-0');
    expect(h.shown.slice(-2)).toEqual(['pano-4', 'pano-5']);
    expect(h.shown).not.toContain('pano-2');
  });
});

describe('.svtrip files and ?trip= links', () => {
  it('round-trips a file through gzip, and accepts plain JSON', async () => {
    const rec = recordTrip(6).saved.at(-1)!;
    const blob = await encodeTripFile(rec);
    const head = new Uint8Array(await blob.slice(0, 2).arrayBuffer());
    expect([head[0], head[1]]).toEqual([0x1f, 0x8b]);
    expect(await decodeTripFile(blob)).toEqual(rec);
    expect(await decodeTripFile(new Blob([JSON.stringify(rec)]))).toEqual(rec);
    expect(await decodeTripFile(new Blob(['{"version":99}']))).toBeNull();
    expect(await decodeTripFile(new Blob([new Uint8Array([0x1f, 0x8b, 1, 2, 3])]))).toBeNull();
  });

  it('round-trips a short trip through a link, to rounding', async () => {
    const rec = recordTrip(6).saved.at(-1)!;
    const url = await buildTripLinkUrl(rec, 'https://example.test/app?route=x&hdr=1');
    expect(url).not.toBeNull();
    const parsed = new URL(url!);
    expect(parsed.searchParams.has('route')).toBe(false);
    expect(parsed.searchParams.get('hdr')).toBe('1');
    const back = await decodeTripLink(parsed.searchParams.get('trip'));
    expect(back).not.toBeNull();
    expect(back!.hops.map((x) => x.panoId)).toEqual(rec.hops.map((x) => x.panoId));
    expect(back!.hops.map((x) => x.panoDate)).toEqual(rec.hops.map((x) => x.panoDate));
    expect(back!.hops.map((x) => x.t)).toEqual(rec.hops.map((x) => x.t));
    back!.hops.forEach((x, i) => {
      expect(x.lat).toBeCloseTo(rec.hops[i]!.lat, 6);
      expect(x.heading).toBeCloseTo(rec.hops[i]!.heading, 1);
      expect(x.weather).toEqual(rec.hops[i]!.weather);
      expect(x.look).toBe(rec.hops[i]!.look);
    });
    back!.stops.forEach((st, i) => {
      expect(st.label).toBe(rec.stops[i]!.label);
      expect(st.lat).toBeCloseTo(rec.stops[i]!.lat, 6);
      expect(st.lng).toBeCloseTo(rec.stops[i]!.lng, 6);
    });
  });

  it('is a file, not a link, when the trip is long', async () => {
    const rec = recordTrip(6).saved.at(-1)!;
    const long: TripRecording = {
      ...rec,
      hops: Array.from({ length: 400 }, (_, i) => ({ ...rec.hops[0]!, t: i * 3000, panoId: `p${i}-${(i * 2654435761) % 1e9}` })),
    };
    expect(await encodeTripLink(long)).toBeNull();
    expect(await decodeTripLink('x'.repeat(TRIP_LINK_MAX_CHARS * 3))).toBeNull();
    expect(await decodeTripLink('not-base64-gzip')).toBeNull();
    expect(MAX_TRIP_HOPS).toBeGreaterThan(400);
  });
});
