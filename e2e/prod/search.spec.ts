import { test, expect } from './fixtures';
import { KEYED, NEEDS_KEY, openApp, readCallBudget, snapshot, useMapsKey, waitForRenderer, type SvWindow } from './app';

/**
 * Production smoke, flow 3: place search, then teleport. The shell renders without a key; teleporting
 * needs one. A coordinate paste is the cheap, deterministic destination: it must teleport (one metered
 * `teleport-prefetch` lookup, a hold) and never touch Places / Geocoding (`BILLING_SAFETY_CHECKLIST.md`).
 */

test('the search shell is present with Nearby POIs off and makes no Places call on load', async ({ page }) => {
  const placesHits: string[] = [];
  page.on('request', (request) => {
    if (/maps\.googleapis\.com\/(maps\/api\/place|\$rpc\/google\.maps\.places)/i.test(request.url())) placesHits.push(request.url());
  });
  await useMapsKey(page);
  await openApp(page);

  await expect(page.getByTestId('place-search').first()).toBeVisible();
  await expect(page.getByLabel(/Show nearby places/i).first()).not.toBeChecked();
  await expect(page.getByPlaceholder(/Place, lat, lng, or pano id/i).first()).toBeVisible();
  expect(placesHits, 'Places traffic without typing').toEqual([]);
});

test.describe('teleport', () => {
  test.skip(!KEYED, NEEDS_KEY);

  test('a pasted coordinate teleports with one lookup and no Places call', async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    const placesHits: string[] = [];
    page.on('request', (request) => {
      if (/maps\.googleapis\.com\/(maps\/api\/place|\$rpc\/google\.maps\.places|maps\/api\/geocode)/i.test(request.url())) placesHits.push(request.url());
    });
    await useMapsKey(page);
    await openApp(page);
    await waitForRenderer(page);

    const before = await readCallBudget(page);
    await page.evaluate(() => (window as unknown as SvWindow).__STREETVIEW_PROBE__?.clear());

    const box = page.getByPlaceholder(/Place, lat, lng, or pano id/i).first();
    await box.fill('48.85826, 2.29450'); // the Eiffel Tower: dense, stable Street View coverage
    await box.press('Enter');

    // The teleport arms a hold and releases it once the new panorama is stable.
    await expect
      .poll(
        async () =>
          page.evaluate(() => {
            const timeline = (window as unknown as SvWindow).__STREETVIEW_PROBE__?.getTimeline() ?? [];
            const last = timeline[timeline.length - 1];
            return last ? last.releasedAt !== null : false;
          }),
        { timeout: 90_000, message: 'teleport hold armed and released' },
      )
      .toBe(true);

    const after = await readCallBudget(page);
    const teleportLookups = (after.bySource['teleport-prefetch'] ?? 0) - (before.bySource['teleport-prefetch'] ?? 0);
    expect(teleportLookups, 'teleport-prefetch lookups').toBeGreaterThanOrEqual(1);
    expect(teleportLookups, 'teleport-prefetch lookups').toBeLessThanOrEqual(3);
    expect(after.placeSearch - before.placeSearch, 'a coordinate paste is not a Places / Geocoding call').toBe(0);
    expect(placesHits).toEqual([]);
    expect(await page.evaluate(() => (window as unknown as SvWindow).__STREETVIEW_PROBE__?.getWarnings() ?? [])).toEqual([]);
    await snapshot(page, testInfo, 'street-view-teleported');
  });
});
