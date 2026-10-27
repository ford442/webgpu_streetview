import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { requireGpuAdapter } from './gpuLane';

/**
 * The renderer's GPU foundation on a real WebGPU device (SwiftShader):
 *
 * - a pass whose WGSL fails validation is disabled and reported on
 *   `webgpuProbe.passes`, while the road frame keeps presenting and the device
 *   raises no per-frame validation errors;
 * - a .wasm that does not load fails boot at probe stage `wasm`;
 * - the canvas backing store is CSS size × DPR;
 * - an external device loss re-inits exactly once, and the renderer's own
 *   `destroy()` never re-inits;
 * - render scale (#329): `?scale=0.5` renders the road at half size and the
 *   lazy upscale pass (FSR 1.0 EASU + RCAS, or `?upscale=bilinear`) presents
 *   it at full size; an upscale that cannot build keeps the road at scale 1.
 * - the split frame's tail (#331): `?latelatch` at rest presents the frame
 *   weather wrote, bit for bit; with the view moved after packing it turns the
 *   frame the right way by the right amount; `?stereo=sbs|anaglyph` present
 *   without validation errors; a broken reproject.wgsl leaves the frame unsplit.
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
  renderScale?: {
    scale: number;
    width: number;
    height: number;
    outputWidth: number;
    outputHeight: number;
    upscale: string;
    limitedBy: string | null;
  } | null;
  lateLatch?: {
    enabled: boolean;
    mode: string;
    latchDeltaDeg: number;
    frames: { ran: number; deferred: number; dropped: number };
  };
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

/** Mean RGB of each cell of a 8×6 grid over the presented canvas — layout, not detail. */
async function presentedGrid(page: Page): Promise<number[][]> {
  const png = await page.locator('#gpu').screenshot();
  return page.evaluate(async (b64) => {
    const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob();
    const bitmap = await createImageBitmap(blob);
    const c = document.createElement('canvas');
    c.width = 8;
    c.height = 6;
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, 8, 6);
    const d = ctx.getImageData(0, 0, 8, 6).data;
    const cells: number[][] = [];
    for (let i = 0; i < d.length; i += 4) cells.push([d[i]!, d[i + 1]!, d[i + 2]!]);
    return cells;
  }, png.toString('base64'));
}

/**
 * Mean RGB of every column of the presented canvas, over the band of rows
 * [y0, y1) (fractions of the height) — where a vertical bar edge sits.
 */
async function presentedColumns(page: Page, y0 = 0.4, y1 = 0.6): Promise<number[][]> {
  const png = await page.locator('#gpu').screenshot();
  return page.evaluate(async ({ b64, y0, y1 }) => {
    const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob();
    const bitmap = await createImageBitmap(blob);
    const c = document.createElement('canvas');
    c.width = bitmap.width;
    c.height = bitmap.height;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(bitmap, 0, 0);
    const top = Math.floor(c.height * y0);
    const rows = Math.max(1, Math.floor(c.height * y1) - top);
    const d = ctx.getImageData(0, top, c.width, rows).data;
    const cols: number[][] = [];
    for (let x = 0; x < c.width; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let y = 0; y < rows; y++) {
        const i = (y * c.width + x) * 4;
        r += d[i]!;
        g += d[i + 1]!;
        b += d[i + 2]!;
      }
      cols.push([r / rows, g / rows, b / rows]);
    }
    return cols;
  }, { b64: png.toString('base64'), y0, y1 });
}

/**
 * The column shift (px, + = content moved right) that best aligns `b` onto `a`,
 * over the columns `[from, to)` of `a` (default: all that stay in range).
 */
function bestShift(a: number[][], b: number[][], maxShift: number, from = maxShift, to = a.length - maxShift): number {
  let best = 0;
  let bestErr = Infinity;
  for (let s = -maxShift; s <= maxShift; s++) {
    let err = 0;
    let n = 0;
    for (let x = Math.max(from, maxShift); x < Math.min(to, a.length - maxShift); x++) {
      const bb = b[x + s]!;
      a[x]!.forEach((v, k) => { err += Math.abs(v - bb[k]!); });
      n++;
    }
    if (err / n < bestErr) {
      bestErr = err / n;
      best = s;
    }
  }
  return best;
}

function maxCellDelta(a: number[][], b: number[][]): number {
  let max = 0;
  a.forEach((cell, i) => cell.forEach((v, k) => { max = Math.max(max, Math.abs(v - b[i]![k]!)); }));
  return max;
}

test.setTimeout(120_000);

test.describe('GPU foundation on a real WebGPU device', () => {
  test('a healthy boot: every pass ready, frame presented, no validation errors', async ({ page }, testInfo) => {
    const out = await run(page, testInfo);
    expect(out.probeOk).toBe(true);
    for (const id of ['streetview', 'historical-wipe', 'weather', 'cabin-composite']) {
      expect(out.passes?.[id]?.state, id).toBe('ready');
    }
    // Scene depth (#320) is a lazy pass: registered, but nothing is built or
    // downloaded until it is switched on — e2e/scene-depth.spec.ts drives it.
    expect(out.passes?.depth).toBeUndefined();
    // Render scale 1: the upscale pass is lazy and never built.
    expect(out.passes?.upscale).toBeUndefined();
    expect(out.renderScale).toMatchObject({ scale: 1, width: 400, height: 300, upscale: 'none' });
    expect(out.uncaptured).toEqual([]);
    expect(await presentedBrightness(page)).toBeGreaterThan(PRESENTED);
    expect(out.maxTextureDimension2D).toBeGreaterThanOrEqual(4096);
  });

  test.describe('render scale (#329)', () => {
    test('?scale=1 builds no upscale and presents the same frame as no flag', async ({ page }, testInfo) => {
      await run(page, testInfo);
      const unflagged = await presentedGrid(page);
      const out = await run(page, testInfo, '?scale=1');
      expect(out.passes?.upscale).toBeUndefined();
      expect(out.renderScale).toMatchObject({ scale: 1, width: 400, height: 300, upscale: 'none', limitedBy: null });
      expect(maxCellDelta(await presentedGrid(page), unflagged)).toBe(0);
    });

    for (const upscale of ['fsr', 'bilinear'] as const) {
      test(`?scale=0.5 (${upscale}): a half-size road frame, upscaled to the full canvas`, async ({ page }, testInfo) => {
        await run(page, testInfo);
        const native = await presentedGrid(page);
        const out = await run(page, testInfo, `?scale=0.5${upscale === 'bilinear' ? '&upscale=bilinear' : ''}`);
        expect(out.passes?.upscale?.state, out.passes?.upscale?.reason).toBe('ready');
        expect(out.renderScale).toMatchObject({
          scale: 0.5, width: 200, height: 150, outputWidth: 400, outputHeight: 300, upscale, limitedBy: null,
        });
        expect(out.uncaptured).toEqual([]);
        expect(await presentedBrightness(page)).toBeGreaterThan(PRESENTED);
        // The whole frame, in place: a quarter-frame or offset upscale would move the cells far.
        expect(maxCellDelta(await presentedGrid(page), native)).toBeLessThan(24);
      });
    }

    test('a broken upscale.wgsl: failed on the probe, the road stays at scale 1 and presents', async ({ page }, testInfo) => {
      const out = await run(page, testInfo, '?scale=0.5&break=upscale.wgsl');
      const upscale = out.passes?.upscale;
      expect(upscale?.state).toBe('failed');
      expect(upscale?.compilation?.some((m) => m.type === 'error' && m.lineNum > 0)).toBe(true);
      expect(out.renderScale).toMatchObject({ scale: 1, width: 400, limitedBy: 'upscale-unavailable' });
      expect(out.uncaptured).toEqual([]);
      expect(await presentedBrightness(page)).toBeGreaterThan(PRESENTED);
    });
  });

  test.describe('split frame tail (#331)', () => {
    test('?latelatch at rest copies the frame weather wrote, bit for bit', async ({ page }, testInfo) => {
      await run(page, testInfo, '?pattern=bars');
      const unlatched = await presentedGrid(page);
      const out = await run(page, testInfo, '?pattern=bars&latelatch=1');
      expect(out.passes?.reproject?.state, out.passes?.reproject?.reason).toBe('ready');
      expect(out.lateLatch).toMatchObject({ enabled: true, mode: 'copy', latchDeltaDeg: 0 });
      expect(out.uncaptured).toEqual([]);
      expect(maxCellDelta(await presentedGrid(page), unlatched)).toBe(0);
    });

    test('?latelatch turns the packed frame to the view read at tail time', async ({ page }, testInfo) => {
      await run(page, testInfo, '?pattern=bars');
      const packed = await presentedColumns(page);
      const out = await run(page, testInfo, '?pattern=bars&latelatch=1&livepov=5,0');
      expect(out.lateLatch?.mode).toBe('latch');
      expect(out.lateLatch?.latchDeltaDeg).toBeCloseTo(5, 5);
      expect(out.uncaptured).toEqual([]);
      const latched = await presentedColumns(page);
      // Turned right by 5° at a 90° FOV: the centre moves left by tan(5°)/2 of
      // the width (off-centre columns move further — a rotation, not a slide).
      const w = packed.length;
      const expected = -Math.round((Math.tan((5 * Math.PI) / 180) / 2) * w);
      const shift = bestShift(packed, latched, 40, w / 2 - 30, w / 2 + 30);
      expect(Math.abs(shift - expected), `shift ${shift}, expected ${expected}`).toBeLessThanOrEqual(1);
    });

    for (const stereo of ['sbs', 'anaglyph'] as const) {
      test(`?stereo=${stereo} presents a synthesised pair without validation errors`, async ({ page }, testInfo) => {
        const out = await run(page, testInfo, `?pattern=bars&stereo=${stereo}`);
        expect(out.passes?.reproject?.state, out.passes?.reproject?.reason).toBe('ready');
        expect(out.lateLatch?.mode).toBe(stereo);
        expect(out.uncaptured).toEqual([]);
        expect(await presentedBrightness(page)).toBeGreaterThan(PRESENTED);
      });
    }

    test('?stereo=sbs: each half is the whole frame, squeezed; the eyes disagree only by parallax', async ({ page }, testInfo) => {
      await run(page, testInfo, '?pattern=bars&stereo=sbs');
      const cols = await presentedColumns(page, 0.1, 0.3); // sky: far away, uncrossed
      const half = cols.length / 2;
      const left = cols.slice(0, half);
      const right = cols.slice(half);
      // Same content in both halves, offset by a few px of parallax — never a different picture.
      const shift = bestShift(left, right, 12);
      expect(Math.abs(shift)).toBeLessThanOrEqual(12);
      expect(shift).toBeGreaterThan(0); // the sky sits behind the screen: right eye sees it further right
    });

    test('a broken reproject.wgsl: failed on the probe, the frame stays unsplit and presents', async ({ page }, testInfo) => {
      const out = await run(page, testInfo, '?latelatch=1&break=reproject.wgsl');
      const reproject = out.passes?.reproject;
      expect(reproject?.state).toBe('failed');
      expect(reproject?.compilation?.some((m) => m.type === 'error' && m.lineNum > 0)).toBe(true);
      expect(out.lateLatch?.enabled).toBe(false);
      expect(out.uncaptured).toEqual([]);
      expect(await presentedBrightness(page)).toBeGreaterThan(PRESENTED);
    });
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

  test('a .wasm that does not load fails boot at stage "wasm" — the binary is the only implementation', async ({ page }, testInfo) => {
    await page.goto(`${FIXTURE}?wasm=missing`);
    await page.waitForFunction(() => (window as unknown as { __out?: { done?: boolean } }).__out?.done === true);
    const out = await page.evaluate(() => ({
      fatal: (window as unknown as { __out: Out }).__out.fatal,
      probe: window.webgpuProbe
        ? { ok: window.webgpuProbe.ok, stage: window.webgpuProbe.stage, reason: window.webgpuProbe.reason }
        : null,
    }));
    requireGpuAdapter(testInfo, out.fatal);
    expect(out.fatal).toMatch(/renderer failed to boot/);
    expect(out.probe).toEqual({ ok: false, stage: 'wasm', reason: expect.stringMatching(/streetview-wasm failed to load: HTTP 404/) });
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
