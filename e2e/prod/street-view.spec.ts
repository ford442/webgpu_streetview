import { test, expect } from './fixtures';
import { KEYED, LIVE, NEEDS_KEY, headingDelta, openApp, readCallBudget, readPov, snapshot, useMapsKey, waitForRenderer, type SvWindow } from './app';

/**
 * Production smoke, flow 2: look, pan and navigate. A drag turns the view (the POV store changes), `W`
 * hops to the next panorama, and every hop holds the previous frame (hold-pause): the probe records the
 * arm → release and no warning, i.e. the live Maps canvas is never uploaded while `holdActive`.
 */

const HOPS = Number(process.env.E2E_HOLD_HOPS || (LIVE ? 3 : 5));

test.describe('look, pan and hop', () => {
  test.skip(!KEYED, NEEDS_KEY);

  test('a drag turns the view; hops hold-pause cleanly and stay inside the call budget', async ({ page }, testInfo) => {
    test.setTimeout(240_000);
    await useMapsKey(page);
    await openApp(page);
    await waitForRenderer(page);
    await expect.poll(async () => page.evaluate(() => Boolean((window as unknown as SvWindow).__STREETVIEW_PROBE__)), { timeout: 60_000 }).toBe(true);

    // --- look / pan: a left-button drag on the view turns heading (and pitch) ---
    const before = await readPov(page);
    const size = page.viewportSize() ?? { width: 1280, height: 720 };
    const cx = Math.round(size.width / 2);
    const cy = Math.round(size.height / 2);
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    for (let step = 1; step <= 12; step++) await page.mouse.move(cx + step * 25, cy + step * 4);
    await page.mouse.up();
    await expect
      .poll(async () => headingDelta((await readPov(page)).heading, before.heading), { message: 'POV heading after a 300 px drag' })
      .toBeGreaterThan(1);
    await snapshot(page, testInfo, 'street-view-panned');

    // --- hops with hold-pause ---
    await page.evaluate(() => (window as unknown as SvWindow).__STREETVIEW_PROBE__?.enablePixelWatch?.());
    const budgetBefore = await readCallBudget(page);
    let holdsSeen = 0;
    for (let hop = 0; hop < HOPS; hop++) {
      await page.evaluate(() => (window as unknown as SvWindow).__STREETVIEW_PROBE__?.clear());
      await page.keyboard.press('KeyW');

      const armedAt = Date.now();
      let sawHold = false;
      while (Date.now() - armedAt < 4000) {
        const timeline = await page.evaluate(() => (window as unknown as SvWindow).__STREETVIEW_PROBE__?.getTimeline() ?? []);
        const entry = timeline[timeline.length - 1];
        if (entry) sawHold = true;
        if (entry && entry.releasedAt !== null) break;
        await page.waitForTimeout(120);
      }
      await page.waitForTimeout(400);
      if (sawHold) holdsSeen += 1;

      const warnings = await page.evaluate(() => (window as unknown as SvWindow).__STREETVIEW_PROBE__?.getWarnings() ?? []);
      expect(warnings, `hop ${hop}: hold-pause probe warnings (live GMaps canvas uploaded while holdActive?)`).toEqual([]);
    }
    expect(holdsSeen, 'at least one hold arms when Street View links work').toBeGreaterThan(0);

    // A hop is the app's own move along the panorama's links: it must not buy lookups. The session meter
    // (services/maps/callBudget.ts) is the proof, and a live run is a billable one.
    const budgetAfter = await readCallBudget(page);
    expect(budgetAfter.panorama - budgetBefore.panorama, 'extra getPanorama calls over the hops').toBeLessThanOrEqual(HOPS * 2);
    const blocked = await page.evaluate(() => (window as unknown as SvWindow).__STREETVIEW_PROBE__?.getCallBudget().byKind.panorama.blocked);
    expect(blocked, 'the panorama call cap must not be hit by a smoke').toBe(0);
    await testInfo.attach('call-budget', { body: JSON.stringify({ before: budgetBefore, after: budgetAfter }, null, 2), contentType: 'application/json' });
  });
});
