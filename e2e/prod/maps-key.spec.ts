import { test, expect } from './fixtures';
import { LIVE, openApp, useMapsKey } from './app';

/**
 * Production smoke, flow 7: a missing or invalid Maps key must end at a banner that says so, never a
 * page that sits on "Connecting…". The key is handed to the page through `config.js` (the runtime
 * config), so a keyless production build exercises both. A deployed site has its own real key baked
 * in — these two are about the BUILD, so they do not run live.
 */

test.describe('maps key', () => {
  test.skip(LIVE, 'a deployed site has its own key baked in; this is about a build without one');

  test('a missing key reaches the "No Google Maps API key" banner and loading copy', async ({ page }) => {
    await useMapsKey(page, '');
    await openApp(page);
    const banner = page.getByRole('alert').filter({ hasText: /No Google Maps API key is configured/i });
    await expect(banner).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/No Google Maps API key is configured/i).first()).toBeVisible();
  });

  /**
   * KNOWN DEFECT (found by this suite, #384): with an INVALID key Google reports `InvalidKeyMapError`
   * through `gm_authFailure`, but `loader.ts` has already marked the load a success and ignores every
   * auth failure for 1.2 s afterwards (`AUTH_FAILURE_IGNORE_WINDOW_MS`, "post-success debounce
   * window"), so the red "Google Maps API authentication failed" banner never appears and the page
   * is left on Google's own "Oops! Something went wrong" overlay. `test.fail` keeps this spec honest in
   * both directions: it stays green while the defect exists and goes red the day the banner appears,
   * at which point delete the `test.fail` line.
   */
  test('an invalid key reaches the authentication-failed banner', async ({ page, gate }) => {
    test.fail(true, 'known defect: loader.ts swallows gm_authFailure inside its post-success debounce window');
    gate.expect('console', /InvalidKeyMapError|Canvas detection timed out/i, 'Google reports the invalid key; the scraper then times out', { required: false });
    gate.expect('request', /maps\.gstatic\.com\/mapfiles\/transparent\.png/, "Google's own error overlay aborts its placeholder image", { required: false });
    gate.expect('pageerror', /getRootNode/i, 'uncaught rejection that accompanies an invalid key', { required: false });
    await useMapsKey(page, 'e2e-invalid-maps-key');
    await openApp(page);
    await expect(
      page.getByRole('alert').filter({ hasText: /Google Maps API authentication failed/i }),
    ).toBeVisible({ timeout: 15_000 });
  });
});
