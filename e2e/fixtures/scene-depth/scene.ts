/**
 * Fixture page for e2e/scene-depth.spec.ts and scripts/capture-depth-looks.mjs.
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

const FROZEN_NOW = 1_760_000_000_000;
Date.now = () => FROZEN_NOW;

type Look = 'clear' | 'fog' | 'rain' | 'dof';

interface Capture {
    hash: string;
    width: number;
    height: number;
    /** Mean sRGB 0–255 per region (see REGIONS). */
    regions: Record<string, [number, number, number]>;
    png?: string;
}

/** In alley.jpg: a near wall that fills the left of the frame, and the far doorway. */
const REGIONS: Record<string, [number, number, number, number]> = {
    nearWall: [0.12, 0.12, 0.34, 0.55],
    farDoor: [0.6, 0.44, 0.66, 0.52],
    nearGround: [0.35, 0.86, 0.6, 0.98],
};

const canvas = document.getElementById('gpu') as HTMLCanvasElement;
const uncaptured: string[] = [];
let renderer: StreetViewRenderer | null = null;
let source: HTMLCanvasElement | null = null;
let look: Look = 'clear';
let depthOptions = { enabled: false, blend: 0, reducedMotion: false };

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
    if (look === 'fog') {
        // Extinction only (no flat aerial wash), so what you see is depth.
        p[I.fogIntensity] = 0.0;
        p[I.fogDensity] = 0.45;
        p[I.fogHeight] = 0.0;
    } else if (look === 'rain') {
        p[I.rainIntensity] = 1.4;
    } else if (look === 'dof') {
        p[I.dofStrength] = 1.0;
    }
    return p;
}

function renderOnce(): void {
    if (!renderer || !source) return;
    renderer.updateWeatherParams(weatherParams());
    renderer.updateCameraParams(0, 0.5);
    renderer.setSceneDepth?.(depthOptions);
    renderer.renderStreetView('streetview', source, 0, 0, 1);
}

async function loadSource(): Promise<HTMLCanvasElement> {
    const img = new Image();
    img.src = '/e2e/fixtures/scene-depth/alley.jpg';
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
async function capture(options: { png?: boolean } = {}): Promise<Capture> {
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
    async boot(options: { missingModel?: boolean } = {}) {
        if (!navigator.gpu) throw new Error('no WebGPU adapter');
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
    capture,
    depthMap,
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
    passes: () => JSON.parse(JSON.stringify(window.webgpuProbe?.passes ?? {})),
    probeOk: () => window.webgpuProbe?.ok ?? null,
    uncaptured: () => [...uncaptured],
};

(window as unknown as { __scene: typeof api }).__scene = api;
(window as unknown as { __sceneReady: boolean }).__sceneReady = true;
