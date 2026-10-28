import { test, expect, type Page } from '@playwright/test';

/**
 * The cabin audio engine (#321) in a real AudioContext.
 *
 * Unit tests run the worklet source and its binary in Node; what only a
 * browser shows is that streetview-dsp.simd.wasm really instantiates inside
 * the AudioWorklet
 * (Chromium drops a posted `WebAssembly.Module`, so the main thread posts the
 * bytes), the engine renders on the audio thread at the context's
 * own pace, the radio bus really runs through it, and — the point of the
 * design — that a main-thread stall cannot starve it. The old engine was
 * filled from the main thread with ~93 ms queued, so a 300 ms stall was
 * ~200 ms of silence; this one needs nothing from the main thread.
 *
 * The fixture under `e2e/fixtures/cabin-audio/` builds the production
 * `CabinAudio` + car audio graph; this spec drives it and reads
 * `window.__CABIN_AUDIO_PROBE__`.
 */

test.setTimeout(90_000);

const FIXTURE = '/e2e/fixtures/cabin-audio/engine.html';

interface Probe {
  mode: string;
  ready: boolean;
  binary: string | null;
  paramTransport: 'shared-ring' | 'message' | null;
  memoryBytes: number;
  sampleRate: number;
  irTaps: number;
  quanta: number;
  rendered: number;
  underruns: number;
  renderMsAvg: number | null;
  error?: string;
}

async function startEngine(page: Page, search = ''): Promise<Probe> {
  await page.goto(`${FIXTURE}${search}`);
  await page.waitForSelector('#start[data-armed="1"]');
  await page.click('#start'); // the user gesture Web Audio wants
  await page.waitForFunction(() => window.__cabin !== undefined);
  await page.evaluate(() => window.__cabin!.ready);
  return probe(page);
}

const probe = (page: Page): Promise<Probe> =>
  page.evaluate(() => ({ ...window.__CABIN_AUDIO_PROBE__ }) as Probe);

/** Wait until the worklet has posted stats past `quanta`. */
async function statsAfter(page: Page, quanta: number): Promise<Probe> {
  await page.waitForFunction(
    (q) => (window.__CABIN_AUDIO_PROBE__?.quanta ?? 0) > q,
    quanta,
    { timeout: 15_000 },
  );
  return probe(page);
}

test('the WASM engine runs in the AudioWorklet, on the worklet-only DSP binary', async ({ page }) => {
  const p = await startEngine(page);
  expect(p.error).toBeUndefined();
  expect(p.mode).toBe('worklet-wasm');
  expect(p.ready).toBe(true);
  expect(p.binary).toBe('streetview-dsp.simd.wasm');
  // Fixed memory: INITIAL_MEMORY, and the binary has no memory.grow.
  expect(p.memoryBytes).toBe(1 << 20);
  expect(p.irTaps).toBe(1024);
  // Dev serves COOP + COEP (vite.config.ts), so the page is cross-origin
  // isolated and the targets go through the shared seqlock, not messages.
  expect(await page.evaluate(() => globalThis.crossOriginIsolated)).toBe(true);
  expect(p.paramTransport).toBe('shared-ring');

  await page.evaluate(() => window.__cabin!.drive({ speedKmh: 90, rpm: 2600 }));
  const s = await statsAfter(page, p.quanta + 200);
  expect(s.rendered).toBeGreaterThan(0);
  expect(s.underruns).toBe(0);
  const level = await page.evaluate(() => window.__cabin!.measure(400));
  expect(level.rms).toBeGreaterThan(0.005);
});


test('a 300 ms main-thread stall: the audio clock and the engine keep going, zero underruns', async ({ page }) => {
  await startEngine(page);
  await page.evaluate(() => window.__cabin!.drive({ speedKmh: 60, rpm: 2200, rainIntensity: 60, wipersEnabled: true }));
  const before = await statsAfter(page, 0);
  const t0 = await page.evaluate(() => window.__cabin!.currentTime());

  // The stall: a busy main thread, the shape of a Maps tile decode or a long
  // React commit. Nothing the worklet needs comes from here.
  await page.evaluate(() => {
    const until = performance.now() + 300;
    while (performance.now() < until) { /* stall */ }
  });

  const t1 = await page.evaluate(() => window.__cabin!.currentTime());
  const after = await statsAfter(page, before.quanta + Math.ceil((before.sampleRate * 0.6) / 128));
  expect(t1 - t0).toBeGreaterThanOrEqual(0.28);
  expect(after.underruns).toBe(0);
  // Every quantum since the engine came up was rendered by it.
  expect(after.rendered).toBeGreaterThan(before.rendered + (before.sampleRate * 0.3) / 128);
  expect(after.quanta - after.rendered).toBe(before.quanta - before.rendered);
});

test('the radio plays through the cabin: the roof and the vehicle change it', async ({ page }) => {
  await startEngine(page);
  // Engine off and parked, so the tap hears the radio and the room only.
  await page.evaluate(() => {
    window.__cabin!.drive({ speedKmh: 0, rpm: 0, openness: 0, vehicle: 'sedan' });
    window.__cabin!.radio(true);
  });
  await page.waitForTimeout(300);
  const closed = await page.evaluate(() => window.__cabin!.measure(600));

  await page.evaluate(() => window.__cabin!.drive({ openness: 1 }));
  await page.waitForTimeout(300);
  const open = await page.evaluate(() => window.__cabin!.measure(600));

  await page.evaluate(() => window.__cabin!.drive({ openness: 0, vehicle: 'limousine' }));
  await page.waitForTimeout(300);
  const limo = await page.evaluate(() => window.__cabin!.measure(600));
  const p = await probe(page);

  expect(closed.rms).toBeGreaterThan(0.01);
  // Roof down: the cabin stops eating the top end.
  expect(open.hfShare).toBeGreaterThan(closed.hfShare * 1.5);
  // Another cabin is another room.
  expect(Math.abs(limo.hfShare - closed.hfShare)).toBeGreaterThan(closed.hfShare * 0.05);
  expect(p.irTaps).toBe(2048);
  expect(p.underruns).toBe(0);
});
