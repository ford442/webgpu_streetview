import fs from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { KEYED, NEEDS_KEY, openApp, readCallBudget, snapshot, useMapsKey, waitForRenderer, type SvWindow } from './app';

/**
 * Production smoke, flow 5: the trip planner, then cruise along the route. The panel works without a key;
 * a drive needs one. The route comes from a recorded OSRM response (`e2e/fixtures/trip/`) served at the
 * routing endpoint — deterministic, and not a request to the public demo server on every run. Cruising
 * on the route must cost **zero** extra Maps calls per hop: only an off-route re-snap is metered.
 */

const OLD_TOWN = path.join(process.cwd(), 'e2e', 'fixtures', 'trip', 'edinburgh-old-town.osrm.json');
/** ~600 m through Edinburgh's Old Town (two turns) — the same route as the dev-server drive spec. */
const ROUTE_QUERY = '?route=55.95010,-3.19020;55.94920,-3.19620;55.94730,-3.19480';

async function openTripPanel(page: Page): Promise<void> {
  await page.getByRole('button', { name: /🧭 Trip/ }).click();
  await expect(page.getByRole('heading', { name: /Trip planner/i })).toBeVisible();
}

const trip = (page: Page) =>
  page.evaluate(() => {
    const t = (window as unknown as SvWindow).__STREETVIEW_PROBE__?.getTrip();
    if (!t) throw new Error('window.__STREETVIEW_PROBE__ is not installed');
    return t;
  });

test.describe('trip planner panel', () => {
  test('typing in the destination field never drives or toggles car mode', async ({ page }, testInfo) => {
    await useMapsKey(page);
    await openApp(page);
    await openTripPanel(page);

    const destination = page.getByRole('textbox', { name: /Destination/i });
    await destination.click();
    await destination.type('wasdc', { delay: 20 });
    await expect(destination).toHaveValue('wasdc');
    await expect(destination).toBeFocused();
    await expect(page.getByRole('region', { name: /Car Dashboard Controls/i })).toHaveCount(0);
    await snapshot(page, testInfo, 'trip-panel');
  });

  test('without a Maps key there is no origin to plan from', async ({ page }) => {
    test.skip(KEYED, 'this run has a key');
    await useMapsKey(page, '');
    await openApp(page);
    await openTripPanel(page);
    await expect(page.getByRole('button', { name: 'Plan route' })).toBeDisabled();
  });

  test('an unreachable routing server is an honest error, never a fake route', async ({ page, gate }) => {
    test.skip(!KEYED, NEEDS_KEY);
    gate.expect('request', /\/route\/v1\/driving\//, 'the routing server is made unreachable on purpose');
    gate.expect('console', /Failed to load resource|route|routing/i, 'the browser logs the refused routing request', { required: false });
    await page.route('**/route/v1/driving/**', (route) => route.abort('connectionrefused'));
    await useMapsKey(page);
    await openApp(page, ROUTE_QUERY);
    await openTripPanel(page);
    await expect(page.getByRole('alert')).toContainText(/could not be reached/i, { timeout: 120_000 });
    await expect(page.getByRole('button', { name: 'Drive' })).toHaveCount(0);
  });
});

test.describe('routed drive', () => {
  test.skip(!KEYED, NEEDS_KEY);

  test('plans the route, drives it, and on-route hops make zero extra Maps calls', async ({ page }, testInfo) => {
    test.setTimeout(8 * 60_000);
    const osrm = fs.readFileSync(OLD_TOWN, 'utf8');
    await page.route('**/route/v1/driving/**', (route) => route.fulfill({ contentType: 'application/json', body: osrm }));
    await useMapsKey(page);
    await openApp(page, ROUTE_QUERY);
    await waitForRenderer(page);

    await expect.poll(async () => (await trip(page)).status, { timeout: 120_000, message: 'trip planned' }).toBe('ready');
    const planned = await trip(page);
    expect(planned.lengthM, 'planned route length (m)').toBeGreaterThan(500);
    await openTripPanel(page);
    await snapshot(page, testInfo, 'trip-planned');
    await page.getByRole('button', { name: 'Drive' }).click();

    // Let the first hops settle (the start may re-snap once), then measure a window of on-route hops.
    const windowStartM = 30;
    const windowLengthM = 60;
    await expect.poll(async () => (await trip(page)).alongM ?? 0, { timeout: 4 * 60_000, intervals: [2000], message: 'driving past the first 30 m' }).toBeGreaterThan(windowStartM);
    const startedAt = { budget: await readCallBudget(page), trip: await trip(page) };
    await expect
      .poll(async () => (await trip(page)).alongM ?? 0, { timeout: 4 * 60_000, intervals: [2000], message: 'driving a further 60 m' })
      .toBeGreaterThan((startedAt.trip.alongM ?? windowStartM) + windowLengthM);
    const endedAt = { budget: await readCallBudget(page), trip: await trip(page) };

    const resnapCalls = (endedAt.budget.bySource['route-resnap'] ?? 0) - (startedAt.budget.bySource['route-resnap'] ?? 0);
    const panoramaCalls = endedAt.budget.panorama - startedAt.budget.panorama;
    expect(panoramaCalls - resnapCalls, `getPanorama calls other than route re-snaps over ${windowLengthM} m of on-route hops`).toBe(0);
    expect(endedAt.trip.resnaps - startedAt.trip.resnaps, 'trip re-snaps').toBe(resnapCalls);
    expect(endedAt.trip.error).toBeNull();
    expect(await page.evaluate(() => (window as unknown as SvWindow).__STREETVIEW_PROBE__?.getWarnings() ?? []), 'hold-pause warnings while driving').toEqual([]);
    await testInfo.attach('trip-call-budget', { body: JSON.stringify({ startedAt, endedAt }, null, 2), contentType: 'application/json' });
    await snapshot(page, testInfo, 'trip-driving');

    await page.getByRole('button', { name: 'Stop' }).click();
  });
});
