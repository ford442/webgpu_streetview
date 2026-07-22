import { test, expect } from '@playwright/test';
import { dismissWelcome, gotoApp, openBookmarkPanel } from './helpers';

test.describe('bookmark panel input isolation', () => {
  test('typing WASD in bookmark name does not toggle car mode or leave the input', async ({
    page,
  }) => {
    await gotoApp(page);
    await dismissWelcome(page);

    await openBookmarkPanel(page);
    await page.getByRole('button', { name: /Save current location as bookmark/i }).click();

    const nameInput = page.getByRole('textbox', { name: /Bookmark name/i });
    await expect(nameInput).toBeFocused();

    // Includes keys that FreeLookInputHandler would otherwise treat as navigation / car toggle.
    await nameInput.type('wasdc', { delay: 20 });
    await expect(nameInput).toHaveValue('wasdc');
    await expect(nameInput).toBeFocused();

    // Car mode must not have activated from the typed "c".
    await expect(page.getByRole('region', { name: /Car Dashboard Controls/i })).toHaveCount(0);

    // Bookmarks panel stays open (global Escape/shortcut handlers did not steal focus).
    await expect(page.getByRole('heading', { name: /Bookmarks/i })).toBeVisible();
  });
});
