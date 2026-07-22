import { test, expect } from '@playwright/test';
import { dismissWelcome, getUncaught, gotoApp, hasMapsKey } from './helpers';

test.describe('car mode', () => {
  test('toggles via toolbar / C without crash (dashboard when canvas ready)', async ({ page }) => {
    await gotoApp(page);
    await dismissWelcome(page);

    // Toolbar is available as soon as the welcome modal is dismissed.
    await page.getByRole('button', { name: /Car Mode/i }).click();
    await expect(page.getByRole('button', { name: /Free Look/i })).toBeVisible();
    expect(getUncaught(page)).toEqual([]);

    // CarModeView only mounts when the scraped canvas is ready.
    const dashboard = page.getByRole('region', { name: /Car Dashboard Controls/i });
    if (hasMapsKey) {
      await expect(dashboard).toBeVisible({ timeout: 90_000 });
    } else if (await dashboard.isVisible().catch(() => false)) {
      expect(getUncaught(page)).toEqual([]);
    }

    // Keyboard toggle back (useAppKeyboardShortcuts 'c') — ignore if focus is weird.
    await page.locator('body').click({ position: { x: 8, y: 8 } });
    await page.keyboard.press('c');
    await expect(page.getByRole('button', { name: /Car Mode/i })).toBeVisible({ timeout: 10_000 });
    expect(getUncaught(page)).toEqual([]);
  });
});
