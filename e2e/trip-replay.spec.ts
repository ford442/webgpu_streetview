import { test, expect, type Page } from '@playwright/test';
import { dismissWelcome, gotoApp, hasMapsKey } from './helpers';

/**
 * Trip recordings (#332, docs/ROAD_TRIPS.md). The smoke half runs without a
 * Maps key: an imported `.svtrip` is listed with its replay cost. The keyed
 * half drives a short real route, records it, replays it, and checks the
 * replay landed on the same pano ids with the same capture dates.
 */

async function openTripPanel(page: Page): Promise<void> {
  await page.getByRole('button', { name: /🧭 Trip/ }).click();
  await expect(page.getByRole('heading', { name: /Trip planner/i })).toBeVisible();
}

const recording = {
  version: 1,
  id: 'trip-e2e',
  name: 'Old Town loop',
  createdAt: '2026-10-21T10:00:00.000Z',
  routeId: 'route:e2e',
  stops: [
    { lat: 55.9501, lng: -3.1902, label: 'Start' },
    { lat: 55.9492, lng: -3.1962, label: 'End' },
  ],
  hops: [0, 1, 2].map((i) => ({
    t: i * 3000,
    panoId: `e2e-pano-${i}`,
    panoDate: '2023-06',
    lat: 55.9501,
    lng: -3.1902 - i * 1e-4,
    heading: 270,
    pitch: 0,
    zoom: 1,
    carHeading: 270,
    weather: { rain: 0.3, snow: 0, wind: 0.1, fog: 0, timeOfDay: 'sunset' },
    look: null,
    nightIntensity: 0,
  })),
  stills: [],
  durationMs: 6000,
  truncated: false,
};

test.describe('trip recordings', () => {
  test('an imported .svtrip is listed with its metered replay cost', async ({ page }) => {
    await gotoApp(page);
    await dismissWelcome(page);
    await openTripPanel(page);
    await page.getByLabel('Import a trip recording').setInputFiles({
      name: 'old-town-loop.svtrip',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(recording)),
    });
    await expect(page.getByText('Old Town loop')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Replay (3 lookups)' })).toBeVisible();

    await page.getByLabel('Import a trip recording').setInputFiles({
      name: 'nope.svtrip',
      mimeType: 'application/json',
      buffer: Buffer.from('{"version":99}'),
    });
    await expect(page.getByRole('region', { name: 'Trip recordings' }).getByRole('alert'))
      .toContainText(/not a road trip recording/);
  });
});

test.describe('recorded trip replay @keyed', () => {
  test.beforeEach(() => {
    test.skip(!hasMapsKey, 'REACT_APP_MAPS_API_KEY required');
  });

  test('replays a recorded drive to the same pano ids and capture dates', async ({ page }) => {
    test.setTimeout(12 * 60_000);
    // ~150 m along the Royal Mile.
    await gotoApp(page, '/?route=55.95010,-3.19020;55.95060,-3.18800');
    await dismissWelcome(page);
    await expect
      .poll(async () => page.evaluate(() => window.__STREETVIEW_PROBE__?.getTrip().status), { timeout: 120_000 })
      .toBe('ready');
    await openTripPanel(page);
    await page.getByRole('button', { name: 'Drive' }).click();
    await expect
      .poll(async () => page.evaluate(() => window.__STREETVIEW_PROBE__?.getTrip().status), {
        timeout: 8 * 60_000,
        intervals: [3000],
      })
      .toBe('arrived');

    const recorded = await page.evaluate(() => window.__STREETVIEW_PROBE__!.getTripRecordings());
    expect(recorded.recordingId).toBeNull();
    const trip = recorded.recordings[0]!;
    expect(trip.hops.length).toBeGreaterThanOrEqual(3);

    const before = await page.evaluate(() => window.__STREETVIEW_PROBE__!.getCallBudget().bySource.replay ?? 0);
    await page.getByRole('button', { name: `Replay (${trip.hops.length} lookups)` }).click();
    await expect
      .poll(async () => page.evaluate(() => window.__STREETVIEW_PROBE__!.getTripRecordings().replay?.status), {
        timeout: 3 * 60_000,
        intervals: [1000],
      })
      .toBe('done');

    const after = await page.evaluate(() => window.__STREETVIEW_PROBE__!.getTripRecordings());
    const replay = after.replay!;
    expect(replay.shownPanoIds).toEqual(trip.hops.map((h) => h.panoId));
    expect(replay).toMatchObject({ skipped: 0, substituted: 0, dateMismatches: 0, callsUsed: trip.hops.length });
    // Every hop now knows its capture date (filled from the replay lookups).
    const saved = after.recordings.find((r) => r.id === trip.id)!;
    expect(saved.hops.every((h) => typeof h.panoDate === 'string')).toBe(true);
    const budget = await page.evaluate(() => window.__STREETVIEW_PROBE__!.getCallBudget());
    expect((budget.bySource.replay ?? 0) - before).toBe(trip.hops.length);
    // The view ends where the last recorded hop left it.
    const last = saved.hops[saved.hops.length - 1]!;
    const headingDiff = Math.abs(((after.pov.heading - last.heading + 540) % 360) - 180);
    expect(headingDiff).toBeLessThanOrEqual(2);
    expect(Math.abs(after.pov.pitch - last.pitch)).toBeLessThanOrEqual(2);
    expect(await page.evaluate(() => window.__STREETVIEW_PROBE__!.getWarnings())).toEqual([]);
  });
});
