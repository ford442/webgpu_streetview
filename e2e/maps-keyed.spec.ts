import { test, expect } from '@playwright/test';
import { dismissWelcome, gotoApp, hasMapsKey } from './helpers';

test.describe('maps key present @keyed', () => {
  test.beforeEach(() => {
    test.skip(!hasMapsKey, 'REACT_APP_MAPS_API_KEY required for keyed Maps path');
  });

  test('loading advances past Connecting and probe appears', async ({ page }) => {
    await gotoApp(page);
    await dismissWelcome(page);

    // Missing-key banner must not appear when a real key is configured.
    await expect(
      page.getByRole('alert').filter({ hasText: /No Google Maps API key is configured/i }),
    ).toHaveCount(0);

    // Overlay should leave the early "Connecting…" gate (or never show it for long).
    await expect(page.getByText('Connecting to Google Maps...')).toHaveCount(0, {
      timeout: 90_000,
    });

    await expect
      .poll(async () => page.evaluate(() => Boolean(window.__STREETVIEW_PROBE__)), {
        timeout: 60_000,
      })
      .toBe(true);
  });
});
