import { test, expect } from './fixtures';
import { KEYED, NEEDS_KEY, openApp, snapshot, useMapsKey, waitForRenderer, type SvWindow } from './app';

/**
 * Production smoke, flow 4: car / cabin mode. Enter it, take the pointer lock and give it up again (what
 * Esc does — the browser owns that key, the app only hears `pointerlockchange`), watch the vehicle model's
 * telemetry advance as the car is driven, and hear the cabin audio engine start in its AudioWorklet.
 */

test.describe('car / cabin mode', () => {
  test.skip(!KEYED, NEEDS_KEY);

  test('cabin renders, the pointer locks and unlocks, telemetry advances and the audio engine runs', async ({ page }, testInfo) => {
    test.setTimeout(240_000);
    await useMapsKey(page);
    await openApp(page);
    await waitForRenderer(page);

    // --- enter the cabin (a user gesture: it also unlocks Web Audio) ---
    await page.getByRole('button', { name: /Car Mode/i }).click();
    await expect(page.getByRole('region', { name: /Car Dashboard Controls/i })).toBeVisible({ timeout: 90_000 });
    await expect
      .poll(async () => page.evaluate(() => (window as unknown as SvWindow).__CABIN_RENDERER_PROBE__?.ready ?? false), { timeout: 90_000, message: 'cabin renderer ready' })
      .toBe(true);
    const cabin = await page.evaluate(() => (window as unknown as SvWindow).__CABIN_RENDERER_PROBE__);
    await testInfo.attach('cabin-renderer-probe', { body: JSON.stringify(cabin, null, 2), contentType: 'application/json' });

    // --- pointer lock in (a click on the bare windshield asks for it) and out (Esc → pointerlockchange) ---
    const size = page.viewportSize() ?? { width: 1280, height: 720 };
    await page.mouse.click(Math.round(size.width / 2), Math.round(size.height * 0.3));
    await expect
      .poll(async () => page.evaluate(() => document.pointerLockElement !== null), { timeout: 15_000, message: 'pointer lock acquired by a click on the cabin' })
      .toBe(true);
    // A real Esc is consumed by the browser, which exits the lock; scripted keys never reach that path.
    await page.evaluate(() => document.exitPointerLock());
    await expect
      .poll(async () => page.evaluate(() => document.pointerLockElement === null), { timeout: 10_000, message: 'pointer lock released' })
      .toBe(true);
    await expect(page.getByRole('region', { name: /Car Dashboard Controls/i })).toBeVisible();

    // --- the vehicle model advances as the car is driven (W hops forward; the hop sets the target speed) ---
    const speeds = new Set<number>();
    await expect
      .poll(
        async () => {
          await page.keyboard.press('KeyW');
          await page.waitForTimeout(1500);
          const telemetry = await page.evaluate(() => (window as unknown as SvWindow).__VEHICLE__);
          if (telemetry) speeds.add(Math.round(telemetry.speedKmh * 10));
          return telemetry?.speedKmh ?? 0;
        },
        { timeout: 60_000, intervals: [500], message: 'window.__VEHICLE__.speedKmh while driving' },
      )
      .toBeGreaterThan(0);
    const telemetry = await page.evaluate(() => (window as unknown as SvWindow).__VEHICLE__);
    expect(telemetry?.rpm, 'engine rpm').toBeGreaterThan(0);
    expect(speeds.size, 'telemetry changes between samples').toBeGreaterThan(1);

    // --- cabin audio: the WASM engine renders in the worklet, with one AudioContext and no underruns ---
    await expect
      .poll(async () => page.evaluate(() => (window as unknown as SvWindow).__CABIN_AUDIO_PROBE__?.ready ?? false), { timeout: 60_000, message: 'cabin audio engine ready' })
      .toBe(true);
    await expect
      .poll(async () => page.evaluate(() => (window as unknown as SvWindow).__CABIN_AUDIO_PROBE__?.rendered ?? 0), { timeout: 30_000, message: 'worklet quanta rendered' })
      .toBeGreaterThan(0);
    const audio = await page.evaluate(() => (window as unknown as SvWindow).__CABIN_AUDIO_PROBE__);
    expect(audio?.error).toBeUndefined();
    expect(audio?.mode).toBe('worklet-wasm');
    expect(audio?.contexts, 'one AudioContext (audio/audioRuntime.ts)').toBe(1);

    await snapshot(page, testInfo, 'cabin');
  });
});
