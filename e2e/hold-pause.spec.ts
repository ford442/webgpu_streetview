import { test, expect } from '@playwright/test';
import { dismissWelcome, gotoApp, hasMapsKey } from './helpers';

const HOPS = Number(process.env.E2E_HOLD_HOPS || 5);

test.describe('hold-pause @keyed', () => {
  test.beforeEach(() => {
    test.skip(!hasMapsKey, 'REACT_APP_MAPS_API_KEY required for hold-pause hops');
  });

  test(`probe warnings stay empty over ${HOPS} hops`, async ({ page }) => {
    test.setTimeout(180_000);

    await gotoApp(page);
    await dismissWelcome(page);

    await expect
      .poll(async () => page.evaluate(() => Boolean(window.__STREETVIEW_PROBE__)), {
        timeout: 60_000,
      })
      .toBe(true);

    await page.evaluate(() => window.__STREETVIEW_PROBE__?.enablePixelWatch());

    let holdsSeen = 0;
    for (let i = 0; i < HOPS; i++) {
      await page.evaluate(() => window.__STREETVIEW_PROBE__?.clear());
      await page.keyboard.press('KeyW');

      const armedAt = Date.now();
      let sawHold = false;
      while (Date.now() - armedAt < 2500) {
        const timeline = await page.evaluate(() => window.__STREETVIEW_PROBE__?.getTimeline() ?? []);
        const entry = timeline[timeline.length - 1];
        if (entry && entry.releasedAt !== null) break;
        if (entry) sawHold = true;
        await page.waitForTimeout(120);
      }
      await page.waitForTimeout(400);

      if (sawHold) holdsSeen += 1;

      const warnings = await page.evaluate(() => window.__STREETVIEW_PROBE__?.getWarnings() ?? []);
      expect(warnings, `hop ${i} probe warnings`).toEqual([]);
    }

    // Without Street View links (bad key / auth), no hold arms — fail loudly rather than false-pass.
    expect(holdsSeen, 'at least one hold should arm when Maps key and panorama links work').toBeGreaterThan(0);
  });
});
