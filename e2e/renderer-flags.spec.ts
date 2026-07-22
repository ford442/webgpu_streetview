import { test, expect } from '@playwright/test';
import { dismissWelcome, getUncaught, gotoApp, hasMapsKey } from './helpers';

test.describe('renderer debug flags', () => {
  test('loads with ?renderer=webgl without uncaught exceptions', async ({ page }) => {
    await gotoApp(page, '/?renderer=webgl');
    await dismissWelcome(page);

    expect(page.url()).toContain('renderer=webgl');
    expect(getUncaught(page)).toEqual([]);
  });

  test('sets window.rendererType to webgl when renderer mounts @keyed', async ({ page }) => {
    test.skip(
      !hasMapsKey,
      'window.rendererType is only set after Maps canvas scrape; needs REACT_APP_MAPS_API_KEY',
    );

    await gotoApp(page, '/?renderer=webgl');
    await dismissWelcome(page);

    await expect
      .poll(async () => page.evaluate(() => window.rendererType ?? null), { timeout: 90_000 })
      .toBe('webgl');

    await expect.poll(async () => page.evaluate(() => window.usingWebGL === true)).toBe(true);
  });
});
