import { test, expect } from '@playwright/test';
import { dismissWelcome, gotoApp, hasMapsKey } from './helpers';

test.describe('maps key missing', () => {
  test('shows missing-key banner and loading copy when no Maps key is configured', async ({
    page,
  }) => {
    test.skip(hasMapsKey, 'REACT_APP_MAPS_API_KEY is set — missing-key UI is not shown');

    await gotoApp(page);
    await dismissWelcome(page);

    const banner = page.getByRole('alert').filter({ hasText: /No Google Maps API key is configured/i });
    await expect(banner).toBeVisible({ timeout: 20_000 });

    // Loading overlay (or banner) should surface the same guidance when keyless.
    const keyCopy = page.getByText(/No Google Maps API key is configured/i);
    await expect(keyCopy.first()).toBeVisible();
  });
});
