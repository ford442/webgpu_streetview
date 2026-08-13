import { test, expect } from '@playwright/test';
import { dismissWelcome, getUncaught, gotoApp } from './helpers';

test.describe('boot', () => {
  test('loads welcome modal and dismisses without uncaught exceptions', async ({ page }) => {
    await gotoApp(page);

    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('heading', { name: '1ink.us Streetview' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Start Exploring/i })).toBeVisible();

    await dismissWelcome(page);
    await expect(page.getByRole('dialog')).toHaveCount(0);

    expect(getUncaught(page)).toEqual([]);
  });

  test('loads with ?look=noir without uncaught exceptions', async ({ page }) => {
    await gotoApp(page, '/?look=noir');
    await dismissWelcome(page);
    expect(page.url()).toContain('look=noir');
    expect(getUncaught(page)).toEqual([]);
  });
});
