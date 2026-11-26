import { test, expect } from './fixtures';
import { hasMapsKey } from '../helpers';
import { LIVE, openApp, useMapsKey } from './app';

/**
 * Production smoke, flow 7: a missing or invalid Maps key must end at a banner that says so, never a
 * page that sits on "Connecting…". The key is handed to the page through `config.js` (the runtime
 * config), so a keyless production build exercises both. A deployed site has its own real key baked
 * in — these two are about the BUILD, so they do not run live.
 */

test.describe('maps key', () => {
  // The compiled key (`VITE_PUBLIC_MAPS_API_KEY`) is read before `window.MAPS_API_KEY`, so the `config.js`
  // override below only works on a build WITHOUT one — precedence the app means to have. On a keyed build
  // (nightly) neither case would be testing what it says.
  test.skip(LIVE || hasMapsKey, 'a deployed site or a build with a compiled key has its own key; this is about a build without one');

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
   * is left on Google's own "Oops! Something went wrong" overlay.
   *
   * This pins the CURRENT behaviour — the invalid key reaches Google's error and no banner — instead of
   * marking the test `test.fail`, which would also accept any unrelated gate violation. The console /
   * network gate stays fully fatal here. The day the banner appears, the last assertion goes red:
   * flip it to `toBeVisible()` and delete the defect note.
   */
  test('an invalid key is reported by Google but does NOT reach the authentication-failed banner (known defect)', async ({ page, gate }) => {
    gate.expect('console', /InvalidKeyMapError/, 'Google reports the invalid key');
    gate.expect('console', /Canvas detection timed out/i, 'the scraper then times out with no canvas', { required: false });
    gate.expect('request', /maps\.gstatic\.com\/mapfiles\/transparent\.png/, "Google's own error overlay aborts its placeholder image", { required: false });
    gate.expect('pageerror', /getRootNode/i, 'uncaught rejection that accompanies an invalid key', { required: false });
    await useMapsKey(page, 'e2e-invalid-maps-key');
    await openApp(page);

    await expect(page.getByText(/didn.t load Google Maps correctly/i)).toBeVisible({ timeout: 30_000 });
    // Past the loader's 1.2 s debounce window, so a banner that was coming would be here.
    await page.waitForTimeout(3_000);
    await expect(
      page.getByRole('alert').filter({ hasText: /Google Maps API authentication failed/i }),
      'defect fixed? the banner now shows: assert toBeVisible() and drop this note',
    ).toHaveCount(0);
  });
});
