import { test, expect } from '@playwright/test';
import { dismissWelcome, getUncaught, gotoApp, hasMapsKey } from './helpers';

test.describe('renderer debug flags', () => {
  test('loads with ?renderer=webgl without uncaught exceptions (no live GL weather)', async ({ page }) => {
    await gotoApp(page, '/?renderer=webgl');
    await dismissWelcome(page);

    expect(page.url()).toContain('renderer=webgl');
    expect(getUncaught(page)).toEqual([]);
  });

  test('does not start a WebGL weather session when ?renderer=webgl @keyed', async ({ page }) => {
    test.skip(
      !hasMapsKey,
      'renderer breadcrumbs are only set after Maps canvas scrape; needs REACT_APP_MAPS_API_KEY',
    );

    await gotoApp(page, '/?renderer=webgl');
    await dismissWelcome(page);

    // No live GL weather: either WebGPU boots, or hard-fail — never usingWebGL.
    await expect
      .poll(async () => page.evaluate(() => window.usingWebGL === true), { timeout: 90_000 })
      .toBe(false);

    const probe = await page.evaluate(() => ({
      usingWebGL: window.usingWebGL ?? false,
      rendererType: window.rendererType ?? null,
      webglDeferred: window.webgpuProbe?.webglPreferenceDeferred ?? false,
      probeOk: window.webgpuProbe?.ok ?? null,
    }));

    expect(probe.usingWebGL).toBe(false);
    expect(probe.webglDeferred).toBe(true);
    // Capable GPU → webgpu; headless CI without WebGPU → hard-fail (null).
    expect(probe.rendererType === 'webgpu' || probe.rendererType === null).toBe(true);
  });
});
