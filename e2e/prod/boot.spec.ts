import { test, expect } from './fixtures';
import { KEYED, LIVE, NEEDS_KEY, expectedSha, openApp, snapshot, useMapsKey, type SvWindow } from './app';

/**
 * Production smoke, flow 1 + build identity (#384): the built app boots on the real hosting
 * contract — hashed assets under a sub-path, the stamped service worker, COOP/COEP, wasm — and
 * (with a Maps key) reaches the first WebGPU frame. Runs against `vite preview` of `build/` and
 * against a deployed site unchanged; the console / network gate (`fixtures.ts`) watches every test.
 */

/** The two lines `scripts/stamp-sw.mjs` rewrites in the built worker (`@sw-stamp`). */
const stampedCacheId = (worker: string): string | undefined => /const CACHE_ID = ["']([^"']+)["']/.exec(worker)?.[1];
const stampedShaders = (worker: string): string[] => {
  const list = /const SHADER_URLS = (\[.*?\]);/s.exec(worker)?.[1];
  return list ? (JSON.parse(list) as string[]) : [];
};

test.describe('build identity', () => {
  test('build-info.json and window.__SV__.build name the expected commit', async ({ page }) => {
    const expected = expectedSha();
    expect(expected, 'no expected SHA: set E2E_EXPECT_SHA or run `npm run build` first').toMatch(/^[0-9a-f]{40}$/);

    await useMapsKey(page);
    await openApp(page);

    const served = await page.request.get(`./build-info.json?cb=${Date.now()}`);
    expect(served.status(), 'build-info.json').toBe(200);
    expect(served.headers()['content-type']).toMatch(/json/);
    const info = (await served.json()) as { sha: string; version: string; dirty: boolean };
    expect(info.sha, 'deployed build-info.json sha').toBe(expected);

    const inPage = await page.evaluate(() => (window as unknown as SvWindow).__SV__?.build);
    expect(inPage, 'window.__SV__.build').toBeDefined();
    expect(inPage?.sha, 'sha the running bundle was built from').toBe(expected);
    expect(inPage?.version).toBe(info.version);
    if (LIVE) expect(inPage?.dirty, 'a deployed build is made from a clean tree').toBe(false);
  });
});

test.describe('hosting contract', () => {
  test('COOP and COEP arrive once each and the page is cross-origin isolated', async ({ page }) => {
    const response = await page.goto('./', { waitUntil: 'domcontentloaded' });
    // A duplicated header reads `same-origin, same-origin`: not a valid value, so no isolation.
    expect(response?.headers()['cross-origin-opener-policy']).toBe('same-origin');
    expect(response?.headers()['cross-origin-embedder-policy']).toBe('credentialless');
    expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);
    expect(await page.evaluate(() => typeof SharedArrayBuffer)).toBe('function');
  });

  test('the service worker registers with the build-stamped cache id', async ({ page }) => {
    await openApp(page);

    const worker = await page.request.get('./service-worker.js');
    expect(worker.status()).toBe(200);
    const text = await worker.text();
    const id = stampedCacheId(text);
    expect(id, 'service-worker.js must be stamped by `npm run build` (scripts/stamp-sw.mjs)').toBeDefined();
    expect(id).not.toBe('dev');
    expect(stampedShaders(text), 'the stamped shader list').not.toHaveLength(0);

    await expect
      .poll(
        async () =>
          page.evaluate(async () => {
            const registration = await navigator.serviceWorker?.getRegistration();
            return registration?.active?.state ?? null;
          }),
        { timeout: 30_000 },
      )
      .toBe('activated');
    await expect
      .poll(async () => page.evaluate(() => caches.keys()), { timeout: 30_000 })
      .toContain(`streetview-sw-${id}-static`);
  });

  test('wasm and shaders are served as themselves, not as the SPA fallback', async ({ page }, testInfo) => {
    await openApp(page);

    const wasm = await page.request.get('./wasm/streetview-wasm.simd.wasm');
    expect(wasm.status()).toBe(200);
    const wasmType = wasm.headers()['content-type'] ?? '';
    // The loader falls back to a plain compile when the type is wrong; the host config is advisory there (verify-live).
    if (!/application\/wasm/.test(wasmType)) testInfo.annotations.push({ type: 'advisory', description: `.wasm served as ${wasmType}` });
    expect(await page.evaluate((bytes) => WebAssembly.validate(new Uint8Array(bytes)), [...(await wasm.body())])).toBe(true);

    const worker = await (await page.request.get('./service-worker.js')).text();
    const shaders = stampedShaders(worker);
    expect(shaders.length).toBeGreaterThan(0);
    // A sample, not the lot: `verify:live --files` checks every file; a burst here would trip the host's rate limit.
    for (const url of shaders.slice(0, 3)) {
      const shader = await page.request.get(url);
      expect(shader.status(), url).toBe(200);
      expect(await shader.text(), `${url} must be WGSL`).toMatch(/@(fragment|vertex|compute)|fn\s+\w+\s*\(/);
    }
  });
});

test.describe('cold boot', () => {
  test('without a Maps key the shell boots and says so', async ({ page }, testInfo) => {
    test.skip(KEYED, 'this run has a key');
    await useMapsKey(page, '');
    await openApp(page);
    await expect(page.getByRole('alert').filter({ hasText: /No Google Maps API key is configured/i })).toBeVisible({ timeout: 20_000 });
    await snapshot(page, testInfo, 'shell-keyless');
  });

  test('with a Maps key the WebGPU renderer reaches ready and presents a frame', async ({ page }, testInfo) => {
    test.skip(!KEYED, NEEDS_KEY);
    await useMapsKey(page);
    await openApp(page);

    await expect(page.getByRole('alert').filter({ hasText: /No Google Maps API key is configured/i })).toHaveCount(0);
    await expect(page.getByText('Connecting to Google Maps...')).toHaveCount(0, { timeout: 90_000 });

    // stage 'ok' is the last of navigator → adapter → limits → device → canvas → compute → pipeline → wasm.
    await expect
      .poll(async () => page.evaluate(() => (window as unknown as SvWindow).webgpuProbe?.stage), { timeout: 90_000 })
      .toBe('ok');
    const probe = await page.evaluate(() => {
      const w = window as unknown as SvWindow;
      return { ...w.webgpuProbe, rendererType: w.rendererType };
    });
    expect(probe.ok, probe.reason).toBe(true);
    expect(probe.rendererType).toBe('webgpu');

    // The shader passes are registered; an OPTIONAL pass that failed is listed with its reason, never silent.
    const passes = probe.passes ?? {};
    expect(Object.keys(passes), 'registered passes').toEqual(expect.arrayContaining(['streetview', 'weather']));
    expect(passes.streetview?.state).toBe('ready');
    const failed = Object.entries(passes).filter(([, status]) => status.state === 'failed');
    await testInfo.attach('webgpu-passes', { body: JSON.stringify(passes, null, 2), contentType: 'application/json' });
    expect(failed.map(([id, status]) => `${id}: ${status.reason ?? 'no reason recorded'}`), 'failed passes').toEqual([]);

    // First frame: the renderer has encoded one (render scale is published from it) and the canvas is not black.
    await expect
      .poll(async () => page.evaluate(() => (window as unknown as SvWindow).webgpuProbe?.renderScale !== undefined), { timeout: 90_000 })
      .toBe(true);
    await snapshot(page, testInfo, 'street-view');
  });
});
