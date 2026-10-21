import { test, expect } from '@playwright/test';
import { requireGpuAdapter } from './gpuLane';

/**
 * Stereo synthesis (#331) on the scene-depth golden: the alley photo and the
 * depth map #320 inferred for it (docs/looks/scene-depth/depth-map-webgpu.jpg).
 *
 * - the CPU reference (`reprojectMath.stereoSourceX`) leaves no hole at a
 *   64 mm IPD, fills every disocclusion from the far side (never a smear of
 *   the occluder), and no fill run is wider than 2 px;
 * - `reproject.wgsl` on a real device draws the same eyes as that reference.
 */

interface Out {
  done?: boolean;
  fatal?: string;
  cpu?: { width: number; height: number; holes: number; fills: number; smears: number; widestFill: number };
  gpu?: Record<'left' | 'right', { meanAbs: number; over32: number }>;
  uncaptured?: string[];
}

test.setTimeout(180_000);

test('stereo from the depth golden: no holes, background fills, GPU matches the reference', async ({ page }, testInfo) => {
  await page.goto('/e2e/fixtures/stereo/stereo.html');
  await page.waitForFunction(
    () => (window as unknown as { __out?: { done?: boolean } }).__out?.done === true,
    undefined,
    { timeout: 150_000 },
  );
  const out = await page.evaluate(() => (window as unknown as { __out: Out }).__out);
  requireGpuAdapter(testInfo, out.fatal);
  expect(out.fatal, out.fatal).toBeUndefined();

  expect(out.cpu!.holes).toBe(0);
  expect(out.cpu!.smears).toBe(0);
  expect(out.cpu!.widestFill).toBeLessThanOrEqual(2);
  expect(out.cpu!.fills).toBeGreaterThan(0);

  expect(out.uncaptured).toEqual([]);
  for (const eye of ['left', 'right'] as const) {
    // Bilinear on the GPU vs nearest on the CPU: a few levels on average, and
    // only edge pixels apart.
    expect(out.gpu![eye].meanAbs, eye).toBeLessThan(6);
    expect(out.gpu![eye].over32, eye).toBeLessThan(0.005);
  }
});
