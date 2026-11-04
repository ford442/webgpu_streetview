import { test, expect, type BrowserContext, type Page, type TestInfo } from '@playwright/test';
import { requireGpuAdapter } from './gpuLane';

/**
 * Semantic scene layer (#352) on a real WebGPU device (SwiftShader): the
 * rebuilt DDRNet23-Slim (`npm run fetch:models`) as a second ORT session in
 * the depth Worker, fed the depth model's tensor from the production
 * Renderer's pass-1 frame, consumed by the real weather shader.
 *
 * The photo is `street.jpg` (CC0, e2e/fixtures/scene-depth/README.md): open
 * sky, road, trees, a parked pickup. Frames are read back exactly (offscreen
 * target, frozen weather clock), and the per-region comparisons run in the
 * page on kept frames (`capture({ keep })` / `compareKept`): `mean` is the
 * mean luma delta, `std` its deviation (streaks, texture), `max` the largest
 * channel delta of any pixel.
 *
 * On SwiftShader one depth + semantic inference takes a couple of minutes, and
 * turning the layer on runs one more (the current depth map has no class map),
 * so one page is shared across the serial tests. Inference time is recorded,
 * not asserted — the ≤ 40 ms budget is a real-GPU number.
 */

const FIXTURE = '/e2e/fixtures/scene-depth/scene.html';
const LOOKS = ['clear', 'fog', 'rain', 'snow', 'night'] as const;
type Look = (typeof LOOKS)[number];
/** Map ids (semanticClasses.ts). */
const SKY = 0, ROAD = 1, VEGETATION = 4, VEHICLE = 5;

interface Capture { hash: string }
interface Delta { mean: number; std: number; max: number; rgb: [number, number, number]; pixels: number }
interface DepthStats { state: string; reason: string | null; inputWidth: number; inputHeight: number }
interface SemanticStats {
    state: string;
    reason: string | null;
    fromCache: boolean | null;
    inferenceMs: number | null;
    inferences: number;
    failures: number;
    width: number;
    height: number;
    histogram: Record<string, number> | null;
    meanConfidence: number | null;
    skyEdgeY: number | null;
    appliedBlend: number;
    generation: number;
}
interface Effects { rainSky: number; wetRoad: number; snowCover: number; fogSky: number; relight: number; skyReplace: number }
interface Scene {
    boot(o?: { missingModel?: boolean; photo?: 'alley' | 'street' }): Promise<unknown>;
    setLook(l: Look): void;
    setDepth(o: { enabled: boolean; blend: number }): void;
    setSemantic(o: { enabled: boolean; blend: number; reducedMotion?: boolean }): void;
    setSemanticEffects(e: Effects): void;
    waitForSemanticState(s: string[], t?: number): Promise<SemanticStats>;
    waitForSemanticMaps(n: number, t?: number): Promise<SemanticStats>;
    capture(o?: { png?: boolean; keep?: string }): Promise<Capture>;
    compareKept(a: string, b: string, region: string): Delta;
    semanticMap(): Promise<{ png: string; width: number; height: number; regions: Record<string, Record<number, number>> } | null>;
    stats(): DepthStats;
    semanticStats(): SemanticStats;
    passes(): Record<string, { state: string; reason?: string }>;
    probeOk(): boolean | null;
    uncaptured(): string[];
}
type SceneWindow = Window & { __scene: Scene; __sceneReady?: boolean };

const ALL_ON: Effects = { rainSky: 1, wetRoad: 1, snowCover: 1, fogSky: 1, relight: 1, skyReplace: 1 };
/** Everything but sky replacement — rain, snow and fog "cloud" the sky, which would mask the effect under test. */
const NO_SKY: Effects = { ...ALL_ON, skyReplace: 0 };

function call<K extends keyof Scene>(page: Page, method: K, ...args: Parameters<Scene[K]>): Promise<Awaited<ReturnType<Scene[K]>>> {
    return page.evaluate(
        ([m, a]) => {
            const api = (window as unknown as SceneWindow).__scene as unknown as Record<string, (...x: unknown[]) => unknown>;
            return api[m]!(...a);
        },
        [method, args] as [string, unknown[]],
    ) as Promise<Awaited<ReturnType<Scene[K]>>>;
}

async function open(page: Page, testInfo: TestInfo): Promise<void> {
    await page.goto(FIXTURE);
    await page.waitForFunction(() => (window as unknown as SceneWindow).__sceneReady === true);
    const fatal = await call(page, 'boot', { photo: 'street' }).then(() => undefined, (e: unknown) => (e instanceof Error ? e.message : String(e)));
    requireGpuAdapter(testInfo, fatal);
    expect(fatal, fatal).toBeUndefined();
}

/** Capture `look` with the layer at `semantic` and the given effect weights, keeping the frame as `keep`. */
async function shot(page: Page, look: Look, semantic: { enabled: boolean; blend: number }, keep: string, effects: Effects = ALL_ON): Promise<Capture> {
    await call(page, 'setLook', look);
    await call(page, 'setSemanticEffects', effects);
    await call(page, 'setSemantic', semantic);
    return call(page, 'capture', { keep });
}

const delta = (page: Page, a: string, b: string, region: string) => call(page, 'compareKept', a, b, region);

function note(testInfo: TestInfo, type: string, value: unknown): void {
    testInfo.annotations.push({ type, description: typeof value === 'string' ? value : JSON.stringify(value) });
}

test.describe('semantic scene layer on a real WebGPU device', () => {
    test.describe.configure({ mode: 'serial', timeout: 600_000 });

    let context: BrowserContext;
    let page: Page;
    /** Layer-off references, also kept in the page as `ref-<look>`. */
    const ref: Partial<Record<Look, Capture>> = {};

    test.beforeAll(async ({ browser }, testInfo) => {
        testInfo.setTimeout(1_200_000);
        context = await browser.newContext();
        page = await context.newPage();
        await open(page, testInfo);
        // Depth at weight 0 (bit-exact with no depth, e2e/scene-depth.spec.ts),
        // so these references hold whatever depth maps arrive later.
        await call(page, 'setDepth', { enabled: true, blend: 0 });
        for (const look of LOOKS) ref[look] = await shot(page, look, { enabled: false, blend: 0 }, `ref-${look}`);
        await call(page, 'setLook', 'clear');
        await call(page, 'setSemantic', { enabled: true, blend: 1 });
        const stats = await call(page, 'waitForSemanticMaps', 1, 1_100_000);
        expect(stats.state, stats.reason ?? '').toBe('ready');
    });

    test.afterAll(async () => {
        await context?.close();
    });

    test('labels the road frame: a class map, a street histogram, no validation errors', async () => {
        const testInfo = test.info();
        const stats = await call(page, 'semanticStats');
        const depth = await call(page, 'stats');
        expect(stats.generation).toBeGreaterThanOrEqual(1);
        expect(stats.inferences).toBeGreaterThanOrEqual(1);
        expect(stats.failures).toBe(0);
        expect(stats.inferenceMs).toBeGreaterThan(0);
        // One tensor feeds both sessions: the class map is the depth input's size.
        expect([stats.width, stats.height]).toEqual([depth.inputWidth, depth.inputHeight]);
        note(testInfo, 'inference', `${Math.round(stats.inferenceMs!)} ms semantic at ${stats.width}×${stats.height} (software GPU)`);
        note(testInfo, 'histogram', stats.histogram);

        const h = stats.histogram!;
        expect(Object.values(h).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 3);
        expect(h.sky).toBeGreaterThan(0.15);
        expect(h.road).toBeGreaterThan(0.05);
        expect(h.vehicle).toBeGreaterThan(0.02);
        expect(stats.meanConfidence).toBeGreaterThan(0.5);
        // Sky across most columns: the horizon estimate gets a sky edge.
        expect(stats.skyEdgeY).not.toBeNull();

        const map = await call(page, 'semanticMap');
        expect(map).not.toBeNull();
        await testInfo.attach('class-map', { body: Buffer.from(map!.png.split(',')[1]!, 'base64'), contentType: 'image/png' });
        note(testInfo, 'regions', map!.regions);
        expect(map!.regions.sky![SKY] ?? 0).toBeGreaterThan(0.95);
        expect(map!.regions.road![ROAD] ?? 0).toBeGreaterThan(0.95);
        expect(map!.regions.trees![VEGETATION] ?? 0).toBeGreaterThan(0.8);
        expect(map!.regions.vehicle![VEHICLE] ?? 0).toBeGreaterThan(0.6);

        const passes = await call(page, 'passes');
        expect(passes.semantic?.state).toBe('ready');
        expect(passes.depth?.state).toBe('ready');
        expect(await call(page, 'probeOk')).toBe(true);
        expect(await call(page, 'uncaptured')).toEqual([]);
    });

    test('semantic weight 0 is bit-exact with no semantic layer — every look', async () => {
        // The map is live and bound (aux.semantic); only its weight is 0.
        for (const look of LOOKS) {
            const zero = await shot(page, look, { enabled: true, blend: 0 }, `zero-${look}`);
            expect(zero.hash, look).toBe(ref[look]!.hash);
        }
    });

    test('rain: the sky mask takes the streaks off the sky and nowhere else', async () => {
        const testInfo = test.info();
        // Same rain, sky mask off vs on. (Rain minus clear is no streak measure:
        // the lens droplets and the rain grade differ over the sky too, by design.)
        // Inside the sky region the class weight is 1, so `streaks × (1 − rainSky ·
        // weight)` is exactly zero there (sceneSemanticBinding.test.ts pins the WGSL).
        await shot(page, 'rain', { enabled: true, blend: 1 }, 'rain-streaks-everywhere', { ...NO_SKY, rainSky: 0 });
        await shot(page, 'rain', { enabled: true, blend: 1 }, 'rain-sky-masked', NO_SKY);
        const sky = await delta(page, 'rain-sky-masked', 'rain-streaks-everywhere', 'sky');
        const road = await delta(page, 'rain-sky-masked', 'rain-streaks-everywhere', 'road');
        const vehicle = await delta(page, 'rain-sky-masked', 'rain-streaks-everywhere', 'vehicle');
        const trees = await delta(page, 'rain-sky-masked', 'rain-streaks-everywhere', 'trees');
        note(testInfo, 'rain', { sky, road, vehicle, trees });
        // Additive streaks removed: darker on average, and streak-shaped (not a flat shift).
        expect(sky.mean).toBeLessThan(0);
        expect(sky.std).toBeGreaterThan(1);
        // The curtain stays wherever there is no sky.
        expect(road.max).toBe(0);
        expect(vehicle.max).toBe(0);
        expect(Math.abs(trees.mean)).toBeLessThan(Math.abs(sky.mean) * 0.1);
    });

    test('wet road only on the road: trees and sky keep their pixels', async () => {
        const testInfo = test.info();
        // Same rain, wet road off vs on: everything else (incl. rain over sky) equal.
        await shot(page, 'rain', { enabled: true, blend: 1 }, 'rain-dry', { ...NO_SKY, wetRoad: 0 });
        await shot(page, 'rain', { enabled: true, blend: 1 }, 'rain-wet', NO_SKY);
        const road = await delta(page, 'rain-wet', 'rain-dry', 'road');
        const trees = await delta(page, 'rain-wet', 'rain-dry', 'trees');
        const sky = await delta(page, 'rain-wet', 'rain-dry', 'sky');
        note(testInfo, 'wet', { road, trees, sky });
        expect(Math.abs(road.mean) + road.std).toBeGreaterThan(2);
        expect(trees.max).toBe(0);
        expect(sky.max).toBe(0);
    });

    test('snow settles on the ground, not on the sky or the vehicles', async () => {
        const testInfo = test.info();
        await shot(page, 'snow', { enabled: true, blend: 1 }, 'snow-bare', { ...NO_SKY, snowCover: 0 });
        await shot(page, 'snow', { enabled: true, blend: 1 }, 'snow-cover', NO_SKY);
        const road = await delta(page, 'snow-cover', 'snow-bare', 'road');
        const sky = await delta(page, 'snow-cover', 'snow-bare', 'sky');
        const vehicle = await delta(page, 'snow-cover', 'snow-bare', 'vehicle');
        note(testInfo, 'snow', { road, sky, vehicle });
        expect(road.mean).toBeGreaterThan(3);
        expect(sky.max).toBe(0);
        expect(Math.abs(vehicle.mean)).toBeLessThan(Math.abs(road.mean) * 0.2);
    });

    test('night relight is class-conditional: sky and trees sink, the road picks up lamp light', async () => {
        const testInfo = test.info();
        await shot(page, 'night', { enabled: true, blend: 1 }, 'night-off', { ...NO_SKY, relight: 0 });
        await shot(page, 'night', { enabled: true, blend: 1 }, 'night-on', NO_SKY);
        const sky = await delta(page, 'night-on', 'night-off', 'sky');
        const trees = await delta(page, 'night-on', 'night-off', 'trees');
        const road = await delta(page, 'night-on', 'night-off', 'road');
        const vehicle = await delta(page, 'night-on', 'night-off', 'vehicle');
        note(testInfo, 'relight', { sky, trees, road, vehicle });
        expect(sky.mean).toBeLessThan(0);
        expect(trees.mean).toBeLessThan(0);
        expect(road.mean).toBeGreaterThan(0);
        // Tail lights: whatever the band adds on the vehicle is red.
        expect(vehicle.rgb[0]).toBeGreaterThanOrEqual(vehicle.rgb[1]);
    });

    test('sky replacement stays inside the sky, and leaves a clear midday sky alone', async () => {
        const testInfo = test.info();
        await shot(page, 'rain', { enabled: true, blend: 1 }, 'rain-photo-sky', NO_SKY);
        await shot(page, 'rain', { enabled: true, blend: 1 }, 'rain-new-sky', ALL_ON);
        const sky = await delta(page, 'rain-new-sky', 'rain-photo-sky', 'sky');
        const road = await delta(page, 'rain-new-sky', 'rain-photo-sky', 'road');
        const vehicle = await delta(page, 'rain-new-sky', 'rain-photo-sky', 'vehicle');
        note(testInfo, 'sky', { sky, road, vehicle });
        expect(Math.abs(sky.mean) + sky.std).toBeGreaterThan(4);
        expect(road.max).toBe(0);
        expect(vehicle.max).toBe(0);

        // No mood (midday, no weather): the photo's sky is the right sky.
        const clearNew = await shot(page, 'clear', { enabled: true, blend: 1 }, 'clear-new-sky', ALL_ON);
        const clearPhoto = await shot(page, 'clear', { enabled: true, blend: 1 }, 'clear-photo-sky', NO_SKY);
        expect(clearNew.hash).toBe(clearPhoto.hash);
        expect(await call(page, 'uncaptured')).toEqual([]);
    });

    test('the next visit loads the model from the Cache API, not the network', async () => {
        const testInfo = test.info();
        const next = await context.newPage();
        await open(next, testInfo);
        await call(next, 'setDepth', { enabled: true, blend: 0 });
        await call(next, 'setSemantic', { enabled: true, blend: 1 });
        const stats = await call(next, 'waitForSemanticState', ['ready', 'failed'], 180_000);
        expect(stats.state, stats.reason ?? '').toBe('ready');
        expect(stats.fromCache).toBe(true);
        await next.close();
    });
});

test('a missing semantic model fails the semantic pass, not depth or the frame', async ({ browser }, testInfo) => {
    test.setTimeout(300_000);
    const context = await browser.newContext();
    try {
        await context.route('**/models/semantic/**', (route) => route.fulfill({ status: 404, body: 'not here' }));
        const page = await context.newPage();
        await open(page, testInfo);
        await call(page, 'setDepth', { enabled: true, blend: 0 });
        const without = await call(page, 'capture');
        await call(page, 'setSemantic', { enabled: true, blend: 1 });
        const stats = await call(page, 'waitForSemanticState', ['failed', 'ready'], 240_000);
        expect(stats.state).toBe('failed');
        expect(stats.reason).toMatch(/HTTP 404|not deployed|integrity/);
        const passes = await call(page, 'passes');
        expect(passes.semantic?.state).toBe('failed');
        expect(passes.depth?.state).toBe('ready');
        expect(passes.weather?.state).toBe('ready');
        expect(await call(page, 'probeOk')).toBe(true);
        // The road frame renders exactly as it does without the layer.
        expect((await call(page, 'capture')).hash).toBe(without.hash);
        expect(await call(page, 'uncaptured')).toEqual([]);
    } finally {
        await context.close();
    }
});
