import { test, expect } from '@playwright/test';
import { dismissWelcome, gotoApp, hasMapsKey } from './helpers';

/**
 * Trip planner (routed road trips). The smoke half runs without a Maps key:
 * the panel keeps keyboard input away from the street view, and a failing
 * routing server shows an honest error instead of a route. The keyed half
 * drives a short real route and is opt-in (it takes minutes at hop pace).
 */

async function openTripPanel(page: import('@playwright/test').Page): Promise<void> {
  await page.getByRole('button', { name: /🧭 Trip/ }).click();
  await expect(page.getByRole('heading', { name: /Trip planner/i })).toBeVisible();
}

test.describe('trip planner', () => {
  test('typing in the destination field never drives or toggles car mode', async ({ page }) => {
    await gotoApp(page);
    await dismissWelcome(page);
    await openTripPanel(page);

    const destination = page.getByRole('textbox', { name: /Destination/i });
    await destination.click();
    await destination.type('wasdc', { delay: 20 });
    await expect(destination).toHaveValue('wasdc');
    await expect(destination).toBeFocused();
    await expect(page.getByRole('region', { name: /Car Dashboard Controls/i })).toHaveCount(0);
  });

  test('no route without an origin; an unreachable routing server is an error, never a fake route', async ({ page }) => {
    await page.route('**/route/v1/driving/**', (route) => route.abort('connectionrefused'));
    // ?route= plans on load once the first pano is up; without a key there is
    // no pano, so plan from the panel when an origin exists, else assert the
    // planner refuses to plan without one.
    await gotoApp(page, '/?route=55.95330,-3.18830;55.94860,-3.20000');
    await dismissWelcome(page);
    await openTripPanel(page);
    const plan = page.getByRole('button', { name: 'Plan route' });
    if (!hasMapsKey) {
      await expect(plan).toBeDisabled();
      return;
    }
    await expect(page.getByRole('alert')).toContainText(/could not be reached/i, { timeout: 120_000 });
    await expect(page.getByRole('button', { name: 'Drive' })).toHaveCount(0);
  });
});

test.describe('routed drive @keyed', () => {
  test.beforeEach(() => {
    test.skip(!hasMapsKey, 'REACT_APP_MAPS_API_KEY required');
    test.skip(!process.env.E2E_ROUTE_DRIVE, 'set E2E_ROUTE_DRIVE=1 for the multi-minute routed drive');
  });

  test('drives a short urban route to arrival with clean hold-pause and few re-snaps', async ({ page }) => {
    test.setTimeout(20 * 60_000);
    // ~600 m through Edinburgh's Old Town (two turns).
    await gotoApp(page, '/?route=55.95010,-3.19020;55.94920,-3.19620;55.94730,-3.19480');
    await dismissWelcome(page);
    await expect
      .poll(async () => page.evaluate(() => window.__STREETVIEW_PROBE__?.getTrip().status), { timeout: 120_000 })
      .toBe('ready');
    await openTripPanel(page);
    await page.getByRole('button', { name: 'Drive' }).click();
    await expect
      .poll(async () => page.evaluate(() => window.__STREETVIEW_PROBE__?.getTrip().status), {
        timeout: 18 * 60_000,
        intervals: [5000],
      })
      .toBe('arrived');
    const trip = await page.evaluate(() => window.__STREETVIEW_PROBE__!.getTrip());
    expect(trip.resnaps).toBeLessThanOrEqual(3);
    expect(await page.evaluate(() => window.__STREETVIEW_PROBE__!.getWarnings())).toEqual([]);
    const budget = await page.evaluate(() => window.__STREETVIEW_PROBE__!.getCallBudget());
    expect(budget.bySource['route-resnap'] ?? 0).toBe(trip.resnaps);
  });
});
