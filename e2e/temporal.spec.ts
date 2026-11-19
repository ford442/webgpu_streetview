import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { requireGpuAdapter } from './gpuLane';

/**
 * The temporal resolve (#360) on a real WebGPU device (SwiftShader), with a
 * synthetic road frame (e2e/fixtures/temporal/resolve.ts): an analytic
 * panorama with soft blocks and fine stripes (~5–9 output px), rendered at
 * 0.6 scale through the production jitter, against the same panorama
 * point-sampled at native resolution.
 *
 * - a pure pan (0.1° a frame) converges within 8 frames to under 2/255 mean
 *   error, and stays there; a fast pan (1° a frame, ~3.5 px) too — the
 *   motion field and the jitter agree on where every sample is;
 * - converged, it beats FSR 1 (EASU + RCAS) at the same scale;
 * - a hop onto another pano resets the history in the same frame: that frame
 *   is exactly a fresh resolve's first frame of the new pano (no ghost).
 *
 * The stress run (stripes at 0.4 contrast, close to the 0.6 frame's Nyquist)
 * is held to "still beats FSR 1 and stays bounded" — no 8-bit accumulation of
 * ~6 jittered samples a pixel reaches 2/255 on that; the numbers land on the
 * annotation.
 *
 * Unit tests pin the wiring against a fake device; this is where the WGSL
 * compiles and runs. `gpu` project (SwiftShader flags in playwright.config.ts).
 */

const FIXTURE = '/e2e/fixtures/temporal/resolve.html';

interface Out {
  done?: boolean;
  fatal?: string;
  size: { input: [number, number]; output: [number, number]; phases: number };
  still: number[];
  pan: number[];
  fastPan: number[];
  easu: number;
  reset: { jump: number; fresh: number; history: boolean; historyReset: string | null; settled: number };
  uncaptured: string[];
}

/** 2/255 of the 8-bit range: the acceptance bar. */
const CONVERGED = 2;

async function run(page: Page, testInfo: TestInfo, query = ''): Promise<Out> {
  await page.goto(`${FIXTURE}${query}`);
  await page.waitForFunction(
    () => (window as unknown as { __out?: { done?: boolean } }).__out?.done === true,
    undefined,
    { timeout: 170_000 },
  );
  const out = await page.evaluate(() => (window as unknown as { __out: Out }).__out);
  requireGpuAdapter(testInfo, out.fatal);
  expect(out.fatal, out.fatal).toBeUndefined();
  testInfo.annotations.push({ type: `temporal${query}`, description: JSON.stringify(out) });
  expect(out.uncaptured).toEqual([]);
  return out;
}

test.setTimeout(180_000);

test('temporal resolve: converges on a pan, beats FSR 1, resets on a hop', async ({ page }, testInfo) => {
  const out = await run(page, testInfo);
  expect(out.size).toMatchObject({ input: [240, 144], output: [400, 240] });

  // Frame 0 is the reset frame (a soft spatial upsample); frames 1–7 accumulate.
  for (const [label, errors] of [['pan', out.pan], ['fast pan', out.fastPan]] as const) {
    const msg = `${label} errors ${JSON.stringify(errors)}`;
    expect(errors[0]!, msg).toBeGreaterThan(CONVERGED);
    expect(errors[7]!, msg).toBeLessThan(CONVERGED);
    for (const e of errors.slice(7)) expect(e, msg).toBeLessThan(CONVERGED);
  }
  expect(out.pan.at(-1)!).toBeLessThan(out.easu);

  expect(out.reset.history).toBe(false);
  expect(out.reset.historyReset).toBe('pano');
  expect(out.reset.settled).toBeLessThan(CONVERGED);
  // The hop frame is a first frame of the new pano — nothing of the old one blended in.
  expect(out.reset.jump).toBeCloseTo(out.reset.fresh, 6);
});

test('temporal resolve, stress: near-Nyquist stripes stay bounded and beat FSR 1', async ({ page }, testInfo) => {
  const out = await run(page, testInfo, '?fine=0.4');
  for (const errors of [out.still, out.pan, out.fastPan]) {
    const msg = JSON.stringify(errors);
    expect(errors.at(-1)!, msg).toBeLessThan(errors[0]!);
    // Converged, no drift: the last frames are no worse than frame 8.
    expect(errors.at(-1)!, msg).toBeLessThan(errors[7]! + 0.25);
    expect(errors.at(-1)!, msg).toBeLessThan(out.easu);
  }
});
