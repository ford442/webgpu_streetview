import { test, expect } from './fixtures';
import { KEYED, NEEDS_KEY, openApp, snapshot, useMapsKey, waitForRenderer, type SvWindow } from './app';

/**
 * Production smoke, flow 6: renderer fallbacks (`docs/RENDERER_FALLBACK.md`).
 *   - a browser with no WebGPU reaches the documented hard-fail UI (and, with `?webgl2=1`, the amber
 *     "WebGL2 fallback active" banner) — never a blank page, never an automatic silent fallback;
 *   - `?cabin=webgl`, `?portal=off` and `?no_gpu_compute` each boot, enter the cabin and report the
 *     fallback they name on the probes.
 * The renderer only exists once Street View has a canvas, so all of it needs a key.
 */

test.describe('renderer fallbacks', () => {
  test.skip(!KEYED, NEEDS_KEY);

  test('no WebGPU: the blocking "WebGPU is required" UI, probe stage navigator, no renderer', async ({ page, gate }, testInfo) => {
    gate.expect('console', /WebGPU|navigator\.gpu/i, 'boot reports the missing WebGPU', { required: false });
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'gpu', { value: undefined, configurable: true });
    });
    await useMapsKey(page);
    await openApp(page);

    await expect(page.getByText(/WebGPU is required/i).first()).toBeVisible({ timeout: 120_000 });
    await expect(page.getByRole('button', { name: /reload/i }).first()).toBeVisible();
    const probe = await page.evaluate(() => {
      const w = window as unknown as SvWindow;
      return { ok: w.webgpuProbe?.ok, stage: w.webgpuProbe?.stage, rendererType: w.rendererType ?? null };
    });
    expect(probe).toEqual({ ok: false, stage: 'navigator', rendererType: null });
    await snapshot(page, testInfo, 'fallback-no-webgpu');
  });

  test('no WebGPU with ?webgl2=1: the WebGL2 renderer runs under the amber banner', async ({ page, gate }, testInfo) => {
    gate.expect('console', /WebGPU|navigator\.gpu/i, 'boot reports the missing WebGPU', { required: false });
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'gpu', { value: undefined, configurable: true });
    });
    await useMapsKey(page);
    await openApp(page, '?webgl2=1');

    await expect(page.getByText(/WebGL2 fallback active — WebGPU not in use/)).toBeVisible({ timeout: 120_000 });
    expect(await page.evaluate(() => (window as unknown as SvWindow).rendererType)).toBe('webgl');
    await snapshot(page, testInfo, 'fallback-webgl2');
  });

  const FLAGS: Array<{ flag: string; check: (page: import('@playwright/test').Page) => Promise<void> }> = [
    {
      flag: 'cabin=webgl',
      check: async (page) => {
        const cabin = await page.evaluate(() => (window as unknown as SvWindow).__CABIN_RENDERER_PROBE__);
        expect(cabin?.backend, 'cabin backend under ?cabin=webgl').toBe('webgl');
        expect(cabin?.composited ?? false, 'the one-frame compositor stands down on the WebGL hatch').toBe(false);
      },
    },
    {
      flag: 'portal=off',
      check: async (page) => {
        const cabin = await page.evaluate(() => (window as unknown as SvWindow).__CABIN_RENDERER_PROBE__);
        expect(cabin?.portal?.active, 'windshield portal under ?portal=off (hole + decal)').toBe(false);
      },
    },
    {
      flag: 'no_gpu_compute',
      check: async (page) => {
        const chores = await page.evaluate(() => (window as unknown as SvWindow).__GPU_CHORES__);
        expect(chores?.killSwitch, 'GPU chores kill switch under ?no_gpu_compute').toBe(true);
      },
    },
  ];

  for (const { flag, check } of FLAGS) {
    test(`?${flag}: boots, enters the cabin and takes the fallback path`, async ({ page }, testInfo) => {
      test.setTimeout(240_000);
      await useMapsKey(page);
      await openApp(page, `?${flag}`);
      await waitForRenderer(page);
      await page.getByRole('button', { name: /Car Mode/i }).click();
      await expect(page.getByRole('region', { name: /Car Dashboard Controls/i })).toBeVisible({ timeout: 90_000 });
      await expect
        .poll(async () => page.evaluate(() => (window as unknown as SvWindow).__CABIN_RENDERER_PROBE__?.ready ?? false), { timeout: 90_000, message: 'cabin renderer ready' })
        .toBe(true);
      await check(page);
      await snapshot(page, testInfo, `fallback-${flag.replace(/[^a-z0-9]+/gi, '-')}`);
    });
  }
});
