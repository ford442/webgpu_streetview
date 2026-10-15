import { test, expect, type BrowserContext, type Page, type TestInfo } from '@playwright/test';
import { requireGpuAdapter } from './gpuLane';

/**
 * Scene depth (#320) on a real WebGPU device (SwiftShader): Depth Anything V2
 * Small through onnxruntime-web in the depth Worker, fed by the production
 * Renderer's pass-1 frame, consumed by the real weather and pass-1 shaders.
 *
 * The model must be in public/models/depth/ (`npm run fetch:depth-model`; CI
 * caches it). On SwiftShader one inference takes about a minute — this lane
 * asserts the model *runs* and what it changes, not how fast (the 60 ms budget
 * is a real-GPU number). One page is shared across the serial tests so the
 * map is computed once.
 *
 * Frames are read back exactly (offscreen target, frozen weather clock — see
 * e2e/fixtures/scene-depth/scene.ts), which is what makes "bit-exact" testable.
 */

const FIXTURE = '/e2e/fixtures/scene-depth/scene.html';

type Rgb = [number, number, number];
interface Capture {
    hash: string;
    regions: Record<'nearWall' | 'farDoor' | 'nearGround', Rgb>;
}
interface Stats {
    state: string;
    reason: string | null;
    variant: string | null;
    fromCache: boolean | null;
    inferenceMs: number | null;
    inferences: number;
    inputWidth: number;
    inputHeight: number;
    generation: number;
}
interface Scene {
    boot(o?: { missingModel?: boolean }): Promise<unknown>;
    setLook(l: string): void;
    setDepth(o: { enabled: boolean; blend: number; reducedMotion?: boolean }): void;
    waitForState(s: string[], t?: number): Promise<Stats>;
    waitForMaps(n: number, t?: number): Promise<Stats>;
    capture(): Promise<Capture>;
    release(o: { travelHeading?: number; progress: number }): Promise<Capture>;
    stats(): Stats;
    passes(): Record<string, { state: string; reason?: string }>;
    probeOk(): boolean | null;
    uncaptured(): string[];
}
type SceneWindow = Window & { __scene: Scene; __sceneReady?: boolean };

/** Call one `window.__scene` method in the page (state persists between calls). */
function call<K extends keyof Scene>(
    page: Page,
    method: K,
    ...args: Parameters<Scene[K]>
): Promise<Awaited<ReturnType<Scene[K]>>> {
    return page.evaluate(
        ([m, a]) => {
            const api = (window as unknown as SceneWindow).__scene as unknown as Record<string, (...x: unknown[]) => unknown>;
            return api[m]!(...a);
        },
        [method, args] as [string, unknown[]],
    ) as Promise<Awaited<ReturnType<Scene[K]>>>;
}

async function open(page: Page, testInfo: TestInfo, options: { missingModel?: boolean } = {}): Promise<void> {
    await page.goto(FIXTURE);
    await page.waitForFunction(() => (window as unknown as SceneWindow).__sceneReady === true);
    const fatal = await call(page, 'boot', options).then(() => undefined, (e: unknown) => (e instanceof Error ? e.message : String(e)));
    requireGpuAdapter(testInfo, fatal);
    expect(fatal, fatal).toBeUndefined();
}

const luma = ([r, g, b]: Rgb) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** Capture `look` with depth at `blend` (0 = the proxy only), depth enabled or not. */
async function captureLook(page: Page, look: string, depth: { enabled: boolean; blend: number }): Promise<Capture> {
    await call(page, 'setLook', look);
    await call(page, 'setDepth', depth);
    return call(page, 'capture');
}

async function release(
    page: Page,
    depth: { enabled: boolean; blend: number; reducedMotion?: boolean },
    travelHeading: number | undefined,
): Promise<Capture> {
    await call(page, 'setLook', 'clear');
    await call(page, 'setDepth', depth);
    return call(page, 'release', { travelHeading, progress: 0.5 });
}

test.describe('scene depth on a real WebGPU device', () => {
    test.describe.configure({ mode: 'serial', timeout: 600_000 });

    let context: BrowserContext;
    let page: Page;
    /**
     * "No depth at all" references, captured before scene depth is first
     * switched on — switching it off later frees the Worker and its map by
     * design, so they cannot be taken afterwards without recomputing a map.
     */
    const noDepth: Record<string, Capture> = {};
    let crossfade: Capture;

    test.beforeAll(async ({ browser }, testInfo) => {
        testInfo.setTimeout(600_000);
        context = await browser.newContext();
        page = await context.newPage();
        await open(page, testInfo);
        for (const look of ['clear', 'fog', 'rain', 'dof']) {
            noDepth[look] = await captureLook(page, look, { enabled: false, blend: 0 });
        }
        crossfade = await release(page, { enabled: false, blend: 0 }, 0);
        await call(page, 'setDepth', { enabled: true, blend: 0.8 });
        const stats = await call(page, 'waitForMaps', 1, 540_000);
        expect(stats.state, stats.reason ?? '').toBe('ready');
    });

    test.afterAll(async () => {
        await context?.close();
    });

    test('runs the model on the road frame: a map, reported ready, no validation errors', async () => {
        const testInfo = test.info();
        const stats = await call(page, 'stats');
        expect(stats.generation).toBeGreaterThanOrEqual(1);
        expect(stats.inferences).toBeGreaterThanOrEqual(1);
        expect(stats.inferenceMs).toBeGreaterThan(0);
        // ≈252² at the canvas aspect, on the ViT patch grid.
        expect(stats.inputWidth % 14).toBe(0);
        expect(stats.inputHeight % 14).toBe(0);
        expect(stats.inputWidth * stats.inputHeight).toBeGreaterThan(50_000);
        expect(stats.inputWidth * stats.inputHeight).toBeLessThan(80_000);
        // SwiftShader has no shader-f16: the f32-activation variant.
        expect(stats.variant).toMatch(/^q4(f16)?$/);
        testInfo.annotations.push({ type: 'inference', description: `${stats.variant} ${Math.round(stats.inferenceMs!)} ms (software GPU)` });

        expect((await call(page, 'passes')).depth?.state).toBe('ready');
        expect(await call(page, 'probeOk')).toBe(true);
        expect(await call(page, 'uncaptured')).toEqual([]);
    });

    test('depth weight 0 is bit-exact with no depth at all — fog, rain and DOF on', async () => {
        // The map is live and bound (aux.depth); only its weight is 0.
        for (const look of ['clear', 'fog', 'rain', 'dof']) {
            const zero = await captureLook(page, look, { enabled: true, blend: 0 });
            expect(zero.hash, look).toBe(noDepth[look]!.hash);
        }
    });

    test('fog pools down the street, rain hides behind the near wall, DOF keeps it sharp', async () => {
        const fogProxy = await captureLook(page, 'fog', { enabled: true, blend: 0 });
        const fogDepth = await captureLook(page, 'fog', { enabled: true, blend: 0.8 });
        // The near wall sits above the pitch horizon, so the proxy calls it
        // "infinitely far" and fogs it; the depth map knows it is at arm's length.
        expect(luma(fogDepth.regions.nearWall)).toBeLessThan(luma(fogProxy.regions.nearWall) - 8);
        // The far doorway is far either way.
        expect(Math.abs(luma(fogDepth.regions.farDoor) - luma(fogProxy.regions.farDoor))).toBeLessThan(4);
        // The road under the camera, where the map is calibrated against the proxy, agrees.
        expect(Math.abs(luma(fogDepth.regions.nearGround) - luma(fogProxy.regions.nearGround))).toBeLessThan(6);

        // Rain: far streak layers are occluded behind the near wall; the far end keeps the whole curtain.
        const rainProxy = await captureLook(page, 'rain', { enabled: true, blend: 0 });
        const rainDepth = await captureLook(page, 'rain', { enabled: true, blend: 0.8 });
        expect(rainDepth.hash).not.toBe(rainProxy.hash);
        const streaks = (c: Capture, r: 'nearWall' | 'farDoor') => luma(c.regions[r]) - luma(noDepth.clear!.regions[r]);
        expect(streaks(rainDepth, 'nearWall')).toBeLessThan(streaks(rainProxy, 'nearWall'));

        const clear = noDepth.clear!;
        const dofProxy = await captureLook(page, 'dof', { enabled: true, blend: 0 });
        const dofDepth = await captureLook(page, 'dof', { enabled: true, blend: 0.8 });
        const wallBlur = (c: Capture) => Math.abs(luma(c.regions.nearWall) - luma(clear.regions.nearWall));
        expect(wallBlur(dofDepth)).toBeLessThan(wallBlur(dofProxy));
    });

    test('the release dollies the held frame along the hop; reduced motion keeps the crossfade', async () => {
        // Each release lands on a "new pano", which retires the map it dollied
        // with — so one release per map. Reduced motion first: a live map, no dolly.
        expect((await release(page, { enabled: true, blend: 0.8, reducedMotion: true }, 0)).hash).toBe(crossfade.hash);

        const generation = (await call(page, 'stats')).generation;
        await call(page, 'waitForMaps', generation + 1, 540_000);
        const dolly = await release(page, { enabled: true, blend: 0.8 }, 0);
        expect(dolly.hash).not.toBe(crossfade.hash);
        // The far doorway barely moves (it is at the focus of expansion, and far);
        // the near ground in front of the camera moves the most.
        const shift = (c: Capture, r: 'farDoor' | 'nearGround') => Math.abs(luma(c.regions[r]) - luma(crossfade.regions[r]));
        expect(shift(dolly, 'nearGround')).toBeGreaterThan(shift(dolly, 'farDoor'));
        // (A teleport has no link heading and keeps the crossfade — depthParams.test.ts.)
        expect(await call(page, 'uncaptured')).toEqual([]);
    });

    test('the next visit loads the model from the Cache API, not the network', async () => {
        const testInfo = test.info();
        // Same browser context as the shared page: same origin storage.
        const next = await context.newPage();
        await open(next, testInfo);
        await call(next, 'setDepth', { enabled: true, blend: 0.8 });
        const stats = await call(next, 'waitForState', ['ready', 'failed'], 120_000);
        expect(stats.state, stats.reason ?? '').toBe('ready');
        expect(stats.fromCache).toBe(true);
        await next.close();
    });
});

test('a model that is missing or fails its integrity check fails the depth pass, not the frame', async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    await open(page, testInfo, { missingModel: true });
    await call(page, 'setDepth', { enabled: true, blend: 0.8 });
    const stats = await call(page, 'waitForState', ['failed', 'ready'], 120_000);
    expect(stats.state).toBe('failed');
    const passes = await call(page, 'passes');
    expect(passes.depth?.state).toBe('failed');
    expect(passes.depth?.reason).toMatch(/integrity|HTTP 404|not deployed/);
    expect(passes.streetview?.state).toBe('ready');
    expect(passes.weather?.state).toBe('ready');
    expect(await call(page, 'probeOk')).toBe(true);

    // The road frame still renders, exactly as it does without depth.
    const withFailed = await captureLook(page, 'fog', { enabled: true, blend: 0.8 });
    const without = await captureLook(page, 'fog', { enabled: false, blend: 0 });
    expect(withFailed.hash).toBe(without.hash);
    expect(luma(without.regions.nearWall)).toBeGreaterThan(30);
    expect(await call(page, 'uncaptured')).toEqual([]);
});
