/**
 * Fixture page for e2e/gpu-foundation.spec.ts.
 *
 * Boots the production `Renderer` (through the production
 * `createStreetViewRenderer`) on the real device, feeds it a synthetic
 * panorama canvas, and reports on `window.__out`:
 *
 * - `passes` — `webgpuProbe.passes`, the per-pass ready/failed record;
 * - `uncaptured` — every `uncapturederror` the device raised while rendering
 *   (a failed pass must be skipped, not encoded invalid every frame);
 * - (the spec screenshots the canvas itself to see the road frame is on screen);
 * - `backing` / `css` — the canvas backing store vs its CSS box, sized by the
 *   production `canvasBackingStore` helpers;
 * - with `?lost=1`, how many times the renderer booted across an external
 *   `device.destroy()` and a later intentional `renderer.destroy()`, driven by
 *   the production `DeviceLossRecovery` the way `WebGPUCanvas` drives it.
 *
 * Query: `break=<file.wgsl>` serves that shader with a syntax error;
 * `frames=N`; `lost=1`.
 */
import { createStreetViewRenderer } from '/src/renderer/createStreetViewRenderer';
import type { StreetViewRenderer } from '/src/renderer/RendererBackend';
import { DeviceLossRecovery } from '/src/renderer/deviceLossRecovery';
import {
    dprCapForPixelRatio,
    observeCanvasBox,
    resolveBackingStoreSize,
} from '/src/components/canvasBackingStore';

const q = new URLSearchParams(location.search);
const broken = q.get('break');
const frames = Number(q.get('frames') ?? 30);
const lostMode = q.has('lost');

const out: Record<string, unknown> = {};
(window as unknown as { __out: unknown }).__out = out;

// The app fetches `./shaders/...` relative to its own page; this page lives deeper.
const realFetch = window.fetch.bind(window);
window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const m = /\/shaders\/([^/?#]+\.wgsl)/.exec(url);
    if (!m) return realFetch(input, init);
    const response = await realFetch(`/shaders/${m[1]}`, init);
    if (m[1] !== broken) return response;
    const text = await response.text();
    return new Response(`${text}\nfn broken_on_purpose( {`, { status: 200 });
}) as typeof window.fetch;

const gpuCanvas = document.getElementById('gpu') as HTMLCanvasElement;

function sizeBackingStore(maxTextureDimension: number): Promise<void> {
    return new Promise((resolve) => {
        const stop = observeCanvasBox(gpuCanvas, (box) => {
            const size = resolveBackingStoreSize({
                ...box,
                devicePixelRatio: window.devicePixelRatio || 1,
                dprCap: dprCapForPixelRatio(2),
                maxTextureDimension,
            });
            gpuCanvas.width = size.width;
            gpuCanvas.height = size.height;
            out.css = [box.cssWidth, box.cssHeight];
            out.backing = [size.width, size.height];
            out.devicePixelRatio = window.devicePixelRatio;
            stop();
            resolve();
        });
    });
}

/** A bright synthetic "panorama" — big enough for the stability fingerprint (≥256²). */
function makeSource(): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 256;
    const ctx = c.getContext('2d')!;
    const g = ctx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, '#8fc4ff');
    g.addColorStop(0.55, '#d9e7f2');
    g.addColorStop(0.56, '#6b6b5e');
    g.addColorStop(1, '#3d3a33');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 512, 256);
    return c;
}

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

/** Render `n` frames, one per animation frame. */
async function renderFrames(renderer: StreetViewRenderer, source: HTMLCanvasElement, n: number): Promise<void> {
    for (let i = 0; i < n; i++) {
        await nextFrame();
        renderer.renderStreetView('streetview', source, 0, 0, 1);
    }
}

async function boot(onLost?: (info: GPUDeviceLostInfo) => void) {
    const result = await createStreetViewRenderer(gpuCanvas, { onLost });
    if (!result.renderer) throw new Error(`renderer failed to boot: ${result.fallbackReason}`);
    return result.renderer;
}

async function main() {
    if (!navigator.gpu) {
        throw new Error('no WebGPU adapter');
    }
    await sizeBackingStore(8192);

    const uncaptured: string[] = [];
    const source = makeSource();

    if (!lostMode) {
        const renderer = await boot();
        const device = (renderer as unknown as { getSharedGpuDevice(): GPUDevice }).getSharedGpuDevice();
        device.addEventListener('uncapturederror', (e: Event) => {
            uncaptured.push((e as GPUUncapturedErrorEvent).error.message);
        });
        await renderFrames(renderer, source, frames);
        // Let any asynchronous validation errors from those frames arrive.
        await device.queue.onSubmittedWorkDone();
        await new Promise((r) => setTimeout(r, 100));
        out.probeOk = window.webgpuProbe?.ok ?? null;
        out.passes = JSON.parse(JSON.stringify(window.webgpuProbe?.passes ?? {}));
        out.cabinComposited = renderer.isCabinCompositedInFrame?.() ?? null;
        out.maxTextureDimension2D = device.limits.maxTextureDimension2D;
        out.uncaptured = uncaptured;
        // Left running: the spec screenshots the presented frame.
        out.done = true;
        return;
    }

    // Device-loss recovery, wired the way WebGPUCanvas wires it.
    const recovery = new DeviceLossRecovery({ baseDelayMs: 50 });
    let boots = 0;
    let current: StreetViewRenderer | null = null;
    const reinitDone: Array<() => void> = [];
    const start = async () => {
        current = await boot((info) => {
            out.lastLostReason = info.reason;
            const decision = recovery.onDeviceLost();
            if (decision.action === 'reinit') {
                setTimeout(() => void start(), decision.delayMs);
            }
        });
        boots += 1;
        recovery.onBootSucceeded();
        await renderFrames(current, source, 3);
        reinitDone.shift()?.();
    };
    await start();

    // An external destroy — not the renderer's own teardown — is a genuine loss: one re-init.
    const reinitted = new Promise<void>((r) => reinitDone.push(r));
    (current as unknown as { getSharedGpuDevice(): GPUDevice }).getSharedGpuDevice().destroy();
    await Promise.race([reinitted, new Promise((r) => setTimeout(r, 5000))]);
    out.bootsAfterExternalDestroy = boots;

    // The renderer's own destroy must not come back.
    current!.destroy();
    await new Promise((r) => setTimeout(r, 1000));
    out.bootsAfterIntentionalDestroy = boots;
    out.done = true;
}

main().catch((e) => {
    out.fatal = e instanceof Error ? e.message : String(e);
    out.done = true;
});
