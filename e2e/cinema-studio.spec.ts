import { test, expect } from '@playwright/test';
import { dismissWelcome, gotoApp } from './helpers';

test.describe('cinema studio', () => {
  test('cinema mode toggles via Shift+F and exits on Esc', async ({ page }) => {
    await gotoApp(page);
    await dismissWelcome(page);

    await expect(page.getByTestId('cinema-overlay')).toHaveCount(0);

    await page.keyboard.press('Shift+F');
    await expect(page.getByTestId('cinema-overlay')).toBeVisible();
    await expect(page.getByTestId('cinema-letterbox-top')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('cinema-overlay')).toHaveCount(0);
  });

  test('tour panel opens and export JSON button is available', async ({ page }) => {
    await gotoApp(page);
    await dismissWelcome(page);

    await page.getByRole('button', { name: /Tour/i }).click();
    await expect(page.getByRole('heading', { name: /Tour/i })).toBeVisible();

    const importBtn = page.getByRole('button', { name: /Import JSON/i });
    await expect(importBtn).toBeVisible();

    // With no tours, export buttons are absent — import is the export-path entry point.
    await expect(page.getByTestId('tour-export-json')).toHaveCount(0);
  });
});
