import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { requireGpuAdapter } from './gpuLane';

/**
 * Car mode's windshield portal, on a real WebGPU device.
 *
 * The unit tests pin the logic (mask, gate, planes, binding, wiring) and, by
 * grepping the shipped WGSL, that the display mirror still matches. What jsdom
 * cannot show — that the TSL compiles, that three really emits hardware clip
 * distances, that the mirror really shades like `weather-post`, that the road's
 * texture survives the cabin — is checked here against Chromium's software
 * WebGPU adapter (SwiftShader), which exposes `clip-distances`.
 *
 * The pages under `e2e/fixtures/windshield-portal/` build the real cabin pieces
 * (see their headers); this spec only drives them and asserts. It runs in the
 * `chromium-webgpu` project (SwiftShader launch flags in playwright.config.ts),
 * where a missing adapter is a failure, not a skip — see `gpuLane.ts`.
 */

test.setTimeout(120_000);

const FIXTURES = '/e2e/fixtures/windshield-portal';

interface FixtureOut {
  done?: boolean;
  fatal?: string;
  snapshots?: Record<string, string>;
  [key: string]: unknown;
}

interface SceneOut extends FixtureOut {
  deviceFeatures: string[];
  hdrFormat: string;
  backend: string;
  portalBuilt: boolean;
  centreLenses: number;
  validationError: string | null;
  uncaptured: string[];
  wgslHasClipDistances: boolean;
  probe: {
    portal?: {
      active: boolean;
      reason?: string;
      clipDistances: boolean;
      frameFormat?: string;
      held?: boolean;
    };
  } | null;
}

interface ParityOut extends FixtureOut {
  results: Array<{ case: string; truth: number[]; mirror: number[]; maxAbsDiff: number }>;
  uncaptured: string[];
  hazard?: { mode: string; roadTextureSurvives: boolean; error: string | null };
}

async function runFixture<T extends FixtureOut>(
  page: Page,
  testInfo: TestInfo,
  file: 'scene.html' | 'parity.html',
  query = '',
): Promise<T> {
  await page.goto(`${FIXTURES}/${file}${query}`);
  await page.waitForFunction(
    () => (window as unknown as { __out?: { done?: boolean } }).__out?.done === true,
    undefined,
    { timeout: 100_000 },
  );
  const out = await page.evaluate(() => (window as unknown as { __out: FixtureOut }).__out);
  requireGpuAdapter(testInfo, out.fatal);
  expect(out.fatal, out.fatal).toBeUndefined();

  for (const [name, dataUrl] of Object.entries(out.snapshots ?? {})) {
    await testInfo.attach(`${name}.png`, {
      body: Buffer.from(dataUrl.split(',')[1]!, 'base64'),
      contentType: 'image/png',
    });
  }
  return out as T;
}

const scene = (page: Page, testInfo: TestInfo, query = '') =>
  runFixture<SceneOut>(page, testInfo, 'scene.html', query);

test.describe('windshield portal on a real WebGPU device', () => {
  test('the portal shades lens pixels like weather-post does', async ({ page }, testInfo) => {
    const out = await runFixture<ParityOut>(page, testInfo, 'parity.html');
    expect(out.uncaptured).toEqual([]);
    expect(out.results.length).toBeGreaterThanOrEqual(11);
    for (const r of out.results) {
      // Measured worst case is ~1 code value (8-bit rounding + weather-post's dither);
      // 3 leaves headroom for other software rasterisers without hiding a wrong stage.
      expect(r.maxAbsDiff, `${r.case}: road ${r.truth} vs portal ${r.mirror}`).toBeLessThanOrEqual(3);
    }
  });

  test('is live with clip-distances, samples the HDR frame, and raises no GPU errors', async ({ page }, testInfo) => {
    const out = await scene(page, testInfo);

    expect(out.deviceFeatures).toContain('clip-distances');
    expect(out.backend).toBe('webgpu');
    expect(out.portalBuilt).toBe(true);
    // three emitted hardware clip distances, not a fragment discard.
    expect(out.wgslHasClipDistances).toBe(true);
    expect(out.probe?.portal).toMatchObject({
      active: true,
      clipDistances: true,
      frameFormat: out.hdrFormat,
      held: false,
    });
    expect(out.validationError).toBeNull();
    expect(out.uncaptured).toEqual([]);
  });

  test('works with both HDR intermediate formats', async ({ page }, testInfo) => {
    for (const format of ['rgba16float', 'rg11b10ufloat']) {
      const out = await scene(page, testInfo, `?format=${format}&frames=20`);
      expect(out.probe?.portal, format).toMatchObject({ active: true, frameFormat: format });
      expect(out.validationError, format).toBeNull();
      expect(out.uncaptured, format).toEqual([]);
    }
  });

  test('the wipers clear the droplets: a persistent wet mask, not a sector that moves', async ({ page }, testInfo) => {
    // Same rain, same time step; only the wipers differ. Blades are left out so the only
    // opaque pixels in the middle of the glass are droplet lenses.
    const dry = await scene(page, testInfo, '?rain=1&fog=0&wipers=0&blades=0&frames=90');
    const wiped = await scene(page, testInfo, '?rain=1&fog=0&wipers=1&blades=0&frames=90');

    expect(dry.centreLenses).toBeGreaterThan(300);
    expect(wiped.centreLenses).toBeLessThan(dry.centreLenses * 0.6);
  });

  test('falls back to hole + decal when the device has no clip-distances', async ({ page }, testInfo) => {
    // `noclip` asks collectOptionalDeviceFeatures for the ?no_clip_distances kill switch, so the
    // shared device genuinely lacks the feature — the same state as an adapter without it.
    const out = await scene(page, testInfo, '?noclip=1&frames=30');

    expect(out.deviceFeatures).not.toContain('clip-distances');
    expect(out.backend).toBe('webgpu');
    expect(out.portalBuilt).toBe(false);
    expect(out.wgslHasClipDistances).toBe(false);
    expect(out.probe?.portal).toMatchObject({ active: false, clipDistances: false });
    expect(out.probe?.portal?.reason).toMatch(/clip-distances/);
    expect(out.validationError).toBeNull();
    expect(out.uncaptured).toEqual([]);
  });

  test('falls back to hole + decal with ?portal=off, even on a capable device', async ({ page }, testInfo) => {
    const out = await scene(page, testInfo, '?portal=off&frames=30');

    expect(out.deviceFeatures).toContain('clip-distances');
    expect(out.portalBuilt).toBe(false);
    expect(out.probe?.portal).toMatchObject({ active: false, clipDistances: true });
    expect(out.probe?.portal?.reason).toMatch(/portal=off/);
    expect(out.validationError).toBeNull();
    expect(out.uncaptured).toEqual([]);
  });

  test('survives the road replacing its texture at the same size mid-run', async ({ page }, testInfo) => {
    // three caches the bind-group view by size; a stale view of the destroyed texture would be a
    // validation error on the next cabin submit.
    const out = await scene(page, testInfo, '?resize=1&frames=60');

    expect(out.validationError).toBeNull();
    expect(out.uncaptured).toEqual([]);
    expect(out.probe?.portal?.active).toBe(true);
  });

  test('reports the hold-pause snapshot', async ({ page }, testInfo) => {
    const out = await scene(page, testInfo, '?held=1&frames=20');
    expect(out.probe?.portal).toMatchObject({ active: true, held: true });
  });

  test('the road\'s texture survives the cabin disposing its wrapper', async ({ page }, testInfo) => {
    const out = await runFixture<ParityOut>(page, testInfo, 'parity.html', '?hazard=neutered-dispose');
    expect(out.hazard).toEqual({ mode: 'neutered-dispose', roadTextureSurvives: true, error: null });
    expect(out.uncaptured).toEqual([]);
  });
});
