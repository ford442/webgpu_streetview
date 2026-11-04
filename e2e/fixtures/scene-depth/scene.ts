/**
 * Fixture page for e2e/scene-depth.spec.ts, e2e/scene-semantic.spec.ts (#352)
 * and scripts/capture-depth-looks.mjs.
 *
 * Boots the production `Renderer` (through `createStreetViewRenderer`) on the
 * real device, feeds it `alley.jpg` as the "panorama", and exposes
 * `window.__scene` so the caller can switch scene depth on, wait for maps, and
 * read frames back exactly:
 *
 * - The weather clock is frozen (`Date.now`), so fog roll, rain and dither hold
 *   still and the same inputs give the same pixels — which is what lets the
 *   spec assert `depthBlend = 0` is *bit-exact* with no depth at all.
 * - The canvas context is an offscreen stand-in whose `getCurrentTexture()` is
 *   a `COPY_SRC` texture: the renderer only ever calls `configure`,
 *   `unconfigure` and `getCurrentTexture`, and reading a real swap chain back
 *   on SwiftShader has lost the device before (see the windshield fixtures).
 */
import { createStreetViewRenderer } from '/src/renderer/createStreetViewRenderer';
import type { StreetViewRenderer } from '/src/renderer/RendererBackend';
import { createDefaultWeatherParams } from '/src/renderer/packWeatherParams';
import { WeatherParamIndex as I } from '/src/renderer/weatherUniformLayout';
import { getSceneDepthStats, type SceneDepthStats } from '/src/renderer/depth/sceneDepthStatsStore';
import { getSceneSemanticStats, type SceneSemanticStats } from '/src/renderer/semantic/sceneSemanticStatsStore';
import type { SemanticEffectWeights } from '/src/renderer/semantic/semanticParams';

const FROZEN_NOW = 1_760_000_000_000;
Date.now = () => FROZEN_NOW;

type Look = 'clear' | 'fog' | 'rain' | 'dof' | 'snow' | 'night' | 'dusk';

interface Capture {
    hash: string;
    width: number;
    height: number;
    /** Mean sRGB 0–255 per region (see REGIONS). */
    regions: Record<string, [number, number, number]>;
    png?: string;
}

type Photo = 'alley' | 'street';
type Box = [number, number, number, number];

/** Named regions (UV boxes) per fixture photo — see README.md. */
const PHOTO_REGIONS: Record<Photo, Record<string, Box>> = {
    /** alley.jpg: a near wall that fills the left of the frame, and the far doorway. */
    alley: {
        nearWall: [0.12, 0.12, 0.34, 0.55],
        farDoor: [0.6, 0.44, 0.66, 0.52],
        nearGround: [0.35, 0.86, 0.6, 0.98],
    },
    /** street.jpg (semantic spec): open sky, the road, the trees in front of the shops, a parked pickup. */
    street: {
        sky: [0.1, 0.06, 0.4, 0.26],
        road: [0.08, 0.88, 0.5, 0.98],
        trees: [0.8, 0.3, 0.95, 0.55],
        vehicle: [0.7, 0.76, 0.86, 0.86],
    },
};
let photo: Photo = 'alley';
let REGIONS = PHOTO_REGIONS.alley;

const canvas = document.getElementById('gpu') as HTMLCanvasElement;
const uncaptured: string[] = [];
let renderer: StreetViewRenderer | null = null;
let source: HTMLCanvasElement | null = null;
let look: Look = 'clear';
let depthOptions = { enabled: false, blend: 0, reducedMotion: false };
let semanticOptions = { enabled: false, blend: 0, reducedMotion: false };
/** Frames kept by name (`capture({ keep })`) for per-pixel comparisons in the page. */
const kept = new Map<string, Uint8ClampedArray>();

// ── Offscreen stand-in for the swap chain ───────────────────────────────────
let configured: GPUCanvasConfiguration | null = null;
let target: GPUTexture | null = null;
const offscreenContext = {
    canvas,
    configure(desc: GPUCanvasConfiguration) {
        configured = desc;
        target?.destroy();
        target = null;
    },
    unconfigure() {
        configured = null;
    },
    getConfiguration() {
        return configured;
    },
    getCurrentTexture(): GPUTexture {
        if (!configured) throw new Error('context not configured');
        if (!target || target.width !== canvas.width || target.height !== canvas.height) {
            target?.destroy();
            target = configured.device.createTexture({
                label: 'scene-depth-fixture-target',
                size: [canvas.width, canvas.height],
                format: configured.format,
                usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC | GPUTextureUsage.TEXTURE_BINDING,
            });
        }
        return target;
    },
};
const realGetContext = canvas.getContext.bind(canvas);
canvas.getContext = ((type: string, options?: unknown) =>
    type === 'webgpu' ? offscreenContext : realGetContext(type as '2d', options as CanvasRenderingContext2DSettings)
) as typeof canvas.getContext;

function weatherParams(): Float32Array<ArrayBuffer> {
    const p = createDefaultWeatherParams();
    p[I.cameraHeading] = 0;
    p[I.cameraPitch] = 0.5;
    // Midday sun high behind the camera: no sunset glow or flare in the frame.
    p[I.sunAzimuth] = 0;
    p[I.sunAltitude] = 1.2;
    if (look === 'fog') {
        // Extinction only (no flat aerial wash), so what you see is depth.
        p[I.fogIntensity] = 0.0;
        p[I.fogDensity] = 0.45;
        p[I.fogHeight] = 0.0;
    } else if (look === 'rain') {
        p[I.rainIntensity] = 1.4;
    } else if (look === 'dof') {
        p[I.dofStrength] = 1.0;
    } else if (look === 'snow') {
        p[I.snowIntensity] = 1.0;
    } else if (look === 'dusk') {
        // Golden hour: the sun low ahead-left (SunCalc azimuth is from south, so
        // compass bearing = az + π; heading 0 looks north).
        p[I.sunAzimuth] = Math.PI - 0.5;
        p[I.sunAltitude] = 0.08;
    } else if (look === 'night') {
        // Deep night, sun well below the horizon, moon up behind the camera.
        p[I.nightIntensity] = 1.0;
        p[I.sunAltitude] = -0.6;
        p[I.moonAzimuth] = 0;
        p[I.moonAltitude] = 0.8;
    }
    return p;
}

function renderOnce(): void {
    if (!renderer || !source) return;
    renderer.updateWeatherParams(weatherParams());
    renderer.updateCameraParams(0, 0.5);
    renderer.setSceneDepth?.(depthOptions);
    renderer.setSceneSemantic?.(semanticOptions);
    renderer.renderStreetView('streetview', source, 0, 0, 1);
}

async function loadSource(): Promise<HTMLCanvasElement> {
    const img = new Image();
    img.src = `/e2e/fixtures/scene-depth/${photo}.jpg`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = canvas.width;
    c.height = canvas.height;
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    return c;
}

function device(): GPUDevice {
    return (renderer as unknown as { getSharedGpuDevice(): GPUDevice }).getSharedGpuDevice();
}

/** Render one frame and read it back from the offscreen target. */
async function capture(options: { png?: boolean; keep?: string } = {}): Promise<Capture> {
    renderOnce();
    const tex = offscreenContext.getCurrentTexture();
    const dev = device();
    const { width, height } = tex;
    const bytesPerRow = Math.ceil((width * 4) / 256) * 256;
    const buffer = dev.createBuffer({ size: bytesPerRow * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const encoder = dev.createCommandEncoder();
    encoder.copyTextureToBuffer({ texture: tex }, { buffer, bytesPerRow }, [width, height]);
    dev.queue.submit([encoder.finish()]);
    await buffer.mapAsync(GPUMapMode.READ);
    const raw = new Uint8Array(buffer.getMappedRange());
    const bgra = String(configured?.format).startsWith('bgra');
    const rgba = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const s = y * bytesPerRow + x * 4;
            const d = (y * width + x) * 4;
            rgba[d] = raw[bgra ? s + 2 : s]!;
            rgba[d + 1] = raw[s + 1]!;
            rgba[d + 2] = raw[bgra ? s : s + 2]!;
            rgba[d + 3] = 255;
        }
    }
    buffer.unmap();
    buffer.destroy();

    let h = 0x811c9dc5;
    for (let i = 0; i < rgba.length; i++) h = Math.imul(h ^ rgba[i]!, 0x01000193) >>> 0;
    const regions: Capture['regions'] = {};
    for (const [name, [x0, y0, x1, y1]] of Object.entries(REGIONS)) {
        let r = 0, g = 0, b = 0, n = 0;
        for (let y = Math.floor(y0 * height); y < Math.floor(y1 * height); y++) {
            for (let x = Math.floor(x0 * width); x < Math.floor(x1 * width); x++) {
                const i = (y * width + x) * 4;
                r += rgba[i]!; g += rgba[i + 1]!; b += rgba[i + 2]!; n++;
            }
        }
        regions[name] = [r / n, g / n, b / n];
    }
    if (options.keep) kept.set(options.keep, rgba);
    const out: Capture = { hash: h.toString(16), width, height, regions };
    if (options.png) {
        const c = document.createElement('canvas');
        c.width = width;
        c.height = height;
        c.getContext('2d')!.putImageData(new ImageData(rgba, width, height), 0, 0);
        out.png = c.toDataURL('image/png');
    }
    return out;
}

/** The current depth map as a grey PNG (white = far), read off the depth pass's texture. */
async function depthMap(): Promise<{ png: string; width: number; height: number; rows: number[] } | null> {
    const depth = (renderer as unknown as { depth?: { currentAux(): { texture: GPUTexture } | undefined } }).depth;
    const tex = depth?.currentAux()?.texture;
    if (!tex) return null;
    const dev = device();
    const { width, height } = tex;
    const bytesPerRow = Math.ceil((width * 2) / 256) * 256;
    const buffer = dev.createBuffer({ size: bytesPerRow * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const encoder = dev.createCommandEncoder();
    encoder.copyTextureToBuffer({ texture: tex }, { buffer, bytesPerRow }, [width, height]);
    dev.queue.submit([encoder.finish()]);
    await buffer.mapAsync(GPUMapMode.READ);
    const halves = new Uint16Array(buffer.getMappedRange().slice(0));
    buffer.unmap();
    buffer.destroy();
    const half = (h: number) => {
        const e = (h >> 10) & 0x1f;
        const m = h & 0x3ff;
        const v = e === 0 ? m * 2 ** -24 : (1 + m / 1024) * 2 ** (e - 15);
        return h & 0x8000 ? -v : v;
    };
    const rgba = new Uint8ClampedArray(width * height * 4);
    const rows: number[] = [];
    for (let y = 0; y < height; y++) {
        let sum = 0;
        for (let x = 0; x < width; x++) {
            const v = half(halves[y * (bytesPerRow / 2) + x]!);
            sum += v;
            const i = (y * width + x) * 4;
            rgba[i] = rgba[i + 1] = rgba[i + 2] = Math.round(v * 255);
            rgba[i + 3] = 255;
        }
        rows.push(sum / width);
    }
    const c = document.createElement('canvas');
    c.width = width;
    c.height = height;
    c.getContext('2d')!.putImageData(new ImageData(rgba, width, height), 0, 0);
    return { png: c.toDataURL('image/png'), width, height, rows };
}

interface SemanticInternals {
    semantic?: {
        currentAux(): { texture: GPUTexture } | undefined;
        setEffects(effects: Readonly<SemanticEffectWeights>): void;
    };
}

/**
 * The current class map as a palette PNG, plus each named region's class
 * shares (class id → fraction of the region's map texels; -1 = unlabelled).
 */
async function semanticMap(): Promise<{ png: string; width: number; height: number; regions: Record<string, Record<number, number>> } | null> {
    const tex = (renderer as unknown as SemanticInternals).semantic?.currentAux()?.texture;
    if (!tex) return null;
    const dev = device();
    const { width, height } = tex;
    const bytesPerRow = Math.ceil((width * 2) / 256) * 256;
    const buffer = dev.createBuffer({ size: bytesPerRow * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const encoder = dev.createCommandEncoder();
    encoder.copyTextureToBuffer({ texture: tex }, { buffer, bytesPerRow }, [width, height]);
    dev.queue.submit([encoder.finish()]);
    await buffer.mapAsync(GPUMapMode.READ);
    const raw = new Uint8Array(buffer.getMappedRange().slice(0));
    buffer.unmap();
    buffer.destroy();
    // sky, road, sidewalk, building, vegetation, vehicle, person (semanticClasses.ts).
    const palette = [[70, 130, 180], [128, 64, 128], [244, 35, 232], [70, 70, 70], [107, 142, 35], [0, 0, 142], [220, 20, 60]];
    const rgba = new Uint8ClampedArray(width * height * 4);
    const ids: number[] = [];
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const id = raw[y * bytesPerRow + x * 2]! - 1;
            ids.push(id);
            const [r, g, b] = palette[id] ?? [0, 0, 0];
            const i = (y * width + x) * 4;
            rgba[i] = r!; rgba[i + 1] = g!; rgba[i + 2] = b!; rgba[i + 3] = 255;
        }
    }
    const c = document.createElement('canvas');
    c.width = width;
    c.height = height;
    c.getContext('2d')!.putImageData(new ImageData(rgba, width, height), 0, 0);
    const regions: Record<string, Record<number, number>> = {};
    for (const [name, [x0, y0, x1, y1]] of Object.entries(REGIONS)) {
        const counts: Record<number, number> = {};
        let n = 0;
        for (let y = Math.floor(y0 * height); y < Math.ceil(y1 * height); y++) {
            for (let x = Math.floor(x0 * width); x < Math.ceil(x1 * width); x++) {
                const id = ids[y * width + x]!;
                counts[id] = (counts[id] ?? 0) + 1;
                n++;
            }
        }
        for (const id of Object.keys(counts)) counts[Number(id)] = counts[Number(id)]! / n;
        regions[name] = counts;
    }
    return { png: c.toDataURL('image/png'), width, height, regions };
}

/**
 * Per-pixel difference of two kept frames over a region: mean and standard
 * deviation of the luma delta, and the largest channel delta. A uniform grade
 * moves the mean; streaks and texture move the deviation.
 */
function compareKept(a: string, b: string, region: string): { mean: number; std: number; max: number; rgb: [number, number, number]; pixels: number } {
    const fa = kept.get(a);
    const fb = kept.get(b);
    const box = REGIONS[region];
    if (!fa || !fb || !box) throw new Error(`compareKept: missing ${!fa ? a : !fb ? b : region}`);
    const width = canvas.width;
    const height = canvas.height;
    const [x0, y0, x1, y1] = box;
    let sum = 0, sumSq = 0, max = 0, n = 0, sr = 0, sg = 0, sb = 0;
    for (let y = Math.floor(y0 * height); y < Math.floor(y1 * height); y++) {
        for (let x = Math.floor(x0 * width); x < Math.floor(x1 * width); x++) {
            const i = (y * width + x) * 4;
            const dr = fa[i]! - fb[i]!, dg = fa[i + 1]! - fb[i + 1]!, db = fa[i + 2]! - fb[i + 2]!;
            const d = 0.2126 * dr + 0.7152 * dg + 0.0722 * db;
            sum += d; sumSq += d * d; n++;
            sr += dr; sg += dg; sb += db;
            max = Math.max(max, Math.abs(dr), Math.abs(dg), Math.abs(db));
        }
    }
    const mean = sum / n;
    return { mean, std: Math.sqrt(Math.max(0, sumSq / n - mean * mean)), max, rgb: [sr / n, sg / n, sb / n], pixels: n };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Keep frames coming (slowly — the depth Worker shares the CPU-emulated GPU) until `done`. */
async function renderUntil(done: () => boolean, timeoutMs: number, label: string): Promise<void> {
    const start = performance.now();
    while (!done()) {
        if (performance.now() - start > timeoutMs) throw new Error(`timed out waiting for ${label}: ${JSON.stringify(getSceneDepthStats())}`);
        renderOnce();
        await sleep(250);
    }
}

const api = {
    async boot(options: { missingModel?: boolean; photo?: Photo } = {}) {
        if (!navigator.gpu) throw new Error('no WebGPU adapter');
        photo = options.photo ?? 'alley';
        REGIONS = PHOTO_REGIONS[photo];
        if (options.missingModel) {
            // Models resolve against document.baseURI; this one has none (the dev
            // server answers with its HTML shell, which fails the integrity check).
            Object.defineProperty(document, 'baseURI', { get: () => `${location.origin}/no-models-here/` });
        }
        source = await loadSource();
        const result = await createStreetViewRenderer(canvas, {});
        if (!result.renderer) throw new Error(`renderer failed to boot: ${result.fallbackReason}`);
        renderer = result.renderer;
        device().addEventListener('uncapturederror', (e: Event) => {
            uncaptured.push((e as GPUUncapturedErrorEvent).error.message);
        });
        for (let i = 0; i < 3; i++) {
            renderOnce();
            await sleep(16);
        }
        return { ok: true };
    },
    setLook(next: Look) {
        look = next;
    },
    setDepth(next: { enabled: boolean; blend: number; reducedMotion?: boolean }) {
        depthOptions = { reducedMotion: false, ...next };
        renderOnce();
    },
    async waitForState(states: SceneDepthStats['state'][], timeoutMs = 120_000) {
        await renderUntil(() => states.includes(getSceneDepthStats().state), timeoutMs, `state ${states.join('|')}`);
        return getSceneDepthStats();
    },
    /** Wait for `generation` maps and full trust in the last one. */
    async waitForMaps(generation: number, timeoutMs = 400_000) {
        await renderUntil(() => {
            const s = getSceneDepthStats();
            return s.state === 'failed'
                || (s.generation >= generation && s.appliedBlend >= depthOptions.blend - 1e-3);
        }, timeoutMs, `${generation} depth maps`);
        // Let the trust ramp land exactly on the preset weight.
        for (let i = 0; i < 30; i++) renderOnce();
        return getSceneDepthStats();
    },
    setSemantic(next: { enabled: boolean; blend: number; reducedMotion?: boolean }) {
        semanticOptions = { reducedMotion: false, ...next };
        renderOnce();
    },
    /** Per-effect weights (all 1 by default) — lets one effect be judged on its own. */
    setSemanticEffects(effects: SemanticEffectWeights) {
        (renderer as unknown as SemanticInternals).semantic?.setEffects(effects);
        renderOnce();
    },
    async waitForSemanticState(states: SceneSemanticStats['state'][], timeoutMs = 300_000) {
        await renderUntil(() => states.includes(getSceneSemanticStats().state), timeoutMs, `semantic state ${states.join('|')}`);
        return getSceneSemanticStats();
    },
    /** Wait for `generation` class maps and full trust in the last one. */
    async waitForSemanticMaps(generation: number, timeoutMs = 540_000) {
        await renderUntil(() => {
            const s = getSceneSemanticStats();
            return s.state === 'failed'
                || (s.generation >= generation && s.appliedBlend >= semanticOptions.blend - 1e-3);
        }, timeoutMs, `${generation} semantic maps`);
        for (let i = 0; i < 30; i++) renderOnce();
        return getSceneSemanticStats();
    },
    capture,
    compareKept,
    depthMap,
    semanticMap,
    /**
     * A hop's release, mid-crossfade: hold (snapshot), release onto the "new"
     * pano (the same photo), and render at `progress`.
     */
    async release(options: { travelHeading?: number; progress: number; png?: boolean }) {
        renderer!.beginHoldTransition(0, 0, undefined, options.travelHeading);
        renderer!.endHoldTransition();
        renderer!.setTransitionProgress(options.progress);
        const frame = await capture({ png: options.png });
        renderer!.setTransitionProgress(0);
        return frame;
    },
    stats: () => getSceneDepthStats(),
    semanticStats: () => JSON.parse(JSON.stringify(getSceneSemanticStats())) as SceneSemanticStats,
    passes: () => JSON.parse(JSON.stringify(window.webgpuProbe?.passes ?? {})),
    probeOk: () => window.webgpuProbe?.ok ?? null,
    uncaptured: () => [...uncaptured],
};

(window as unknown as { __scene: typeof api }).__scene = api;
(window as unknown as { __sceneReady: boolean }).__sceneReady = true;
