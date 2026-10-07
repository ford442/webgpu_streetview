import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { requireGpuAdapter } from './gpuLane';

/**
 * The renderer's GPU foundation on a real WebGPU device (SwiftShader):
 *
 * - a pass whose WGSL fails validation is disabled and reported on
 *   `webgpuProbe.passes`, while the road frame keeps presenting and the device
 *   raises no per-frame validation errors;
 * - the canvas backing store is CSS size × DPR;
 * - an external device loss re-inits exactly once, and the renderer's own
 *   `destroy()` never re-inits.
 *
 * Unit tests pin the same logic against a fake device; this is where a real
 * `getCompilationInfo` / `createRenderPipelineAsync` / error scope runs.
 */

const FIXTURE = '/e2e/fixtures/gpu-foundation/renderer.html';

interface PassStatus {
  state: 'ready' | 'failed';
  reason?: string;
  compilation?: Array<{ type: string; message: string; lineNum: number; linePos: number }>;
}

interface Out {
  done?: boolean;
  fatal?: string;
  passes?: Record<string, PassStatus>;
  probeOk?: boolean | null;
  cabinComposited?: boolean | null;
  uncaptured?: string[];
  css?: [number, number];
  backing?: [number, number];
  devicePixelRatio?: number;
  maxTextureDimension2D?: number;
  bootsAfterExternalDestroy?: number;
  bootsAfterIntentionalDestroy?: number;
  lastLostReason?: string;
}

async function run(page: Page, testInfo: TestInfo, query = ''): Promise<Out> {
  await page.goto(`${FIXTURE}${query}`);
  await page.waitForFunction(
    () => (window as unknown as { __out?: { done?: boolean } }).__out?.done === true,
    undefined,
    { timeout: 100_000 },
  );
  const out = await page.evaluate(() => (window as unknown as { __out: Out }).__out);
  requireGpuAdapter(testInfo, out.fatal);
  expect(out.fatal, out.fatal).toBeUndefined();
  return out;
}

/**
 * Mean RGB sum of the canvas as the compositor shows it — a black (dropped)
 * road frame is ~0. Screenshot, then decode in the page (no PNG lib needed).
 */
async function presentedBrightness(page: Page): Promise<number> {
  const png = await page.locator('#gpu').screenshot();
  return page.evaluate(async (b64) => {
    const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob();
    const bitmap = await createImageBitmap(blob);
    const c = document.createElement('canvas');
    c.width = bitmap.width;
    c.height = bitmap.height;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(bitmap, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += d[i]! + d[i + 1]! + d[i + 2]!;
    return sum / (d.length / 4);
  }, png.toString('base64'));
}

/**
 * The page behind the canvas is black, so an unpresented or dropped frame reads
 * ~0; the synthetic panorama through weather (or the ACES fallback) reads far
 * above this.
 */
const PRESENTED = 150;

test.setTimeout(120_000);

test.describe('GPU foundation on a real WebGPU device', () => {
  test('a healthy boot: every pass ready, frame presented, no validation errors', async ({ page }, testInfo) => {
    const out = await run(page, testInfo);
    expect(out.probeOk).toBe(true);
    for (const id of ['streetview', 'historical-wipe', 'weather', 'cabin-composite']) {
      expect(out.passes?.[id]?.state, id).toBe('ready');
    }
    expect(out.uncaptured).toEqual([]);
    expect(await presentedBrightness(page)).toBeGreaterThan(PRESENTED);
    expect(out.maxTextureDimension2D).toBeGreaterThanOrEqual(4096);
  });

  test('a broken cabin-composite.wgsl is isolated: failed with compilation info, road frame still presents', async ({ page }, testInfo) => {
    const out = await run(page, testInfo, '?break=cabin-composite.wgsl');
    const cabin = out.passes?.['cabin-composite'];
    expect(cabin?.state).toBe('failed');
    expect(cabin?.compilation?.some((m) => m.type === 'error' && m.lineNum > 0)).toBe(true);
    expect(out.passes?.streetview?.state).toBe('ready');
    expect(out.passes?.weather?.state).toBe('ready');
    expect(out.probeOk).toBe(true);
    expect(out.cabinComposited).toBe(false);
    // Skipped, not encoded invalid every frame.
    expect(out.uncaptured).toEqual([]);
    expect(await presentedBrightness(page)).toBeGreaterThan(PRESENTED);
  });

  test('a broken weather-post.wgsl presents the road through the fallback instead of failing boot', async ({ page }, testInfo) => {
    const out = await run(page, testInfo, '?break=weather-post.wgsl&weather=fragment');
    expect(out.passes?.weather?.state).toBe('failed');
    expect(out.passes?.['present-fallback']?.state).toBe('ready');
    expect(out.probeOk).toBe(true);
    expect(out.uncaptured).toEqual([]);
    expect(await presentedBrightness(page)).toBeGreaterThan(PRESENTED);
  });

  test('a broken streetview.wgsl fails boot at stage "pipeline" — there is no road frame without it', async ({ page }, testInfo) => {
    await page.goto(`${FIXTURE}?break=streetview.wgsl`);
    await page.waitForFunction(() => (window as unknown as { __out?: { done?: boolean } }).__out?.done === true);
    const out = await page.evaluate(() => ({
      fatal: (window as unknown as { __out: Out }).__out.fatal,
      probe: window.webgpuProbe ? { ok: window.webgpuProbe.ok, stage: window.webgpuProbe.stage } : null,
    }));
    requireGpuAdapter(testInfo, out.fatal);
    expect(out.fatal).toMatch(/renderer failed to boot/);
    expect(out.probe).toEqual({ ok: false, stage: 'pipeline' });
  });

  test.describe('at DPR 2', () => {
    test.use({ deviceScaleFactor: 2 });

    test('the backing store is CSS size × DPR', async ({ page }, testInfo) => {
      const out = await run(page, testInfo, '?frames=5');
      expect(out.devicePixelRatio).toBe(2);
      expect(out.css).toEqual([400, 300]);
      expect(out.backing).toEqual([800, 600]);
      expect(out.uncaptured).toEqual([]);
      expect(await presentedBrightness(page)).toBeGreaterThan(PRESENTED);
    });
  });

  test('an external device.destroy() re-inits exactly once; the renderer\'s own destroy() never does', async ({ page }, testInfo) => {
    const out = await run(page, testInfo, '?lost=1');
    expect(out.lastLostReason).toBe('destroyed');
    expect(out.bootsAfterExternalDestroy).toBe(2);
    expect(out.bootsAfterIntentionalDestroy).toBe(2);
  });
});
