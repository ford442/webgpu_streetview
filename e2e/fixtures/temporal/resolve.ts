/**
 * Fixture page for e2e/temporal.spec.ts.
 *
 * Drives the production `TemporalPass` (motion field + resolve) on the real
 * device with a synthetic road frame: an analytic panorama, rendered on the
 * CPU at the intermediate's size through the production jitter sequence, as
 * the Maps canvas would be sampled by pass 1 (`streetview.wgsl`: screen UV +
 * jitter). The camera pans; the production `TemporalHistoryTracker` decides
 * history each frame and `packMotionUniforms` builds the field, exactly as
 * `Renderer` does.
 *
 * The reference is the same panorama point-sampled at every *output* pixel
 * centre — what the road shows at render scale 1 — quantised to 8 bits.
 * Reports on `window.__out`:
 *
 * - `pan` / `fastPan`: mean |resolve − native| (8-bit units) per frame, at
 *   0.6 scale, panning 0.1° / 1° a frame; `easu`: the FSR 1 upscale of the
 *   last frame (no jitter) against the same reference, for scale;
 * - `reset`: converge on one view, then jump to another with a pano change:
 *   the jump frame's error against the new view next to a fresh pass's first
 *   frame of it (equal: no ghost of the old view), and the history decision;
 * - `uncaptured`: any validation error the device raised.
 */
import { TemporalPass } from '/src/renderer/temporal/TemporalPass';
import { UpscalePass } from '/src/renderer/upscale/UpscalePass';
import {
    MOTION_UNIFORM_FLOAT_COUNT,
    TemporalHistoryTracker,
    frameTangents,
    packMotionUniforms,
} from '/src/renderer/temporal/motionMath';
import { jitterOffset, jitterPhaseCount } from '/src/renderer/temporal/temporalMath';
import { resolveSceneDepthBindGroup } from '/src/renderer/depth/sceneDepthBinding';
import type { PovSample } from '/src/renderer/reproject/reprojectMath';

interface Out {
    done?: boolean;
    fatal?: string;
    adapter?: string;
    size?: { input: [number, number]; output: [number, number]; phases: number };
    still?: number[];
    pan?: number[];
    fastPan?: number[];
    easu?: number;
    reset?: { jump: number; fresh: number; history: boolean; historyReset: string | null; settled: number };
    uncaptured?: string[];
}

const out: Out = {};
(window as unknown as { __out: Out }).__out = out;

const OUTPUT: [number, number] = [400, 240];
const SCALE = 0.6;
const INPUT: [number, number] = [Math.round(OUTPUT[0] * SCALE), Math.round(OUTPUT[1] * SCALE)];
const FORMAT: GPUTextureFormat = 'rgba8unorm';
const DEG = Math.PI / 180;
/** Contrast of the fine stripes — the detail a 0.6 frame cannot hold on its own. */
const query = new URLSearchParams(location.search);
const FINE = Number(query.get('fine') ?? 0.25);
/** `?sharp=<stops>`: the present's RCAS strength (the production default when absent). */
const SHARP = query.has('sharp') ? Number(query.get('sharp')) : undefined;

const smoothstep = (e0: number, e1: number, x: number) => {
    const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
    return t * t * (3 - 2 * t);
};

/** The panorama: a sky/ground split, soft-edged blocks and fine stripes (6–8 output px). */
function scene(lon: number, lat: number, rgb: Float32Array, o: number, pano: number): void {
    if (pano !== 0) {
        // Another pano: the same kind of image, nothing in the same place.
        lon += 1.3 * pano;
        lat -= 0.05 * pano;
    }
    const ground = smoothstep(0.01, -0.01, lat);
    const blocks = smoothstep(-0.25, 0.25, Math.sin(lon * 23) * Math.sin(lat * 31 + 0.4));
    const fine = 0.5 + 0.5 * Math.sin(lon * 190 + 2 * Math.sin(lat * 40)) * Math.sin(lat * 140);
    const sky = [0.45 + 0.3 * lat, 0.62 + 0.2 * lat, 0.9];
    const road = [0.35, 0.32, 0.28];
    for (let c = 0; c < 3; c++) {
        const base = sky[c]! * (1 - ground) + road[c]! * ground;
        const tint = c === 0 ? 0.25 : c === 1 ? 0.12 : -0.15;
        rgb[o + c] = Math.min(1, Math.max(0, base * (0.75 + 0.35 * blocks) + tint * blocks + FINE * (fine - 0.5)));
    }
}

/** The view at `pov`, `w × h`, each pixel sampled at its centre + `jitter` (pixels). */
function render(pov: PovSample, w: number, h: number, jitter: readonly [number, number], pano = 0): Uint8Array<ArrayBuffer> {
    const [tanH, tanV] = frameTangents(pov.zoom, w, h);
    const cy = Math.cos(pov.heading * DEG);
    const sy = Math.sin(pov.heading * DEG);
    const rgb = new Float32Array(3);
    const px = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const u = (x + 0.5 + jitter[0]) / w;
            const v = (y + 0.5 + jitter[1]) / h;
            const ex = (u * 2 - 1) * tanH;
            const ey = (1 - v * 2) * tanV;
            // Ry(heading) · (ex, ey, 1): x east, y up, z north.
            const wx = cy * ex + sy;
            const wz = -sy * ex + cy;
            const lon = Math.atan2(wx, wz);
            const lat = Math.atan2(ey, Math.hypot(wx, wz));
            scene(lon, lat, rgb, 0, pano);
            const i = (y * w + x) * 4;
            px[i] = Math.round(rgb[0]! * 255);
            px[i + 1] = Math.round(rgb[1]! * 255);
            px[i + 2] = Math.round(rgb[2]! * 255);
            px[i + 3] = 255;
        }
    }
    return px;
}

async function run(): Promise<void> {
    const adapter = await navigator.gpu?.requestAdapter();
    if (!adapter) throw new Error('no WebGPU adapter');
    out.adapter = adapter.info?.description || adapter.info?.vendor || 'unknown';
    const device = await adapter.requestDevice();
    const uncaptured: string[] = [];
    device.addEventListener('uncapturederror', (e) => uncaptured.push((e as GPUUncapturedErrorEvent).error.message));

    // The app fetches `./shaders/...` relative to its page; this page lives deeper.
    const realFetch = window.fetch.bind(window);
    window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        const m = /\/shaders\/([^/?#]+\.wgsl)/.exec(url);
        return m ? realFetch(`/shaders/${m[1]}`, init) : realFetch(input, init);
    }) as typeof window.fetch;

    // --- a blit: CPU pixels → the pass's road target (it is RENDER_ATTACHMENT only) ---
    const blitModule = device.createShaderModule({
        label: 'fixture-blit',
        code: `
@group(0) @binding(0) var src: texture_2d<f32>;
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
    var p = array<vec2<f32>, 3>(vec2<f32>(-1.0, -1.0), vec2<f32>(3.0, -1.0), vec2<f32>(-1.0, 3.0));
    return vec4<f32>(p[i], 0.0, 1.0);
}
@fragment fn fs(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
    return textureLoad(src, vec2<i32>(pos.xy), 0);
}`,
    });
    const blit = device.createRenderPipeline({
        label: 'fixture-blit-pipeline',
        layout: 'auto',
        vertex: { module: blitModule, entryPoint: 'vs' },
        fragment: { module: blitModule, entryPoint: 'fs', targets: [{ format: FORMAT }] },
    });
    const staging = device.createTexture({
        label: 'fixture-staging',
        size: INPUT,
        format: 'rgba8unorm',
        usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING,
    });
    const blitGroup = device.createBindGroup({
        layout: blit.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: staging.createView() }],
    });
    const output = device.createTexture({
        label: 'fixture-output',
        size: OUTPUT,
        format: FORMAT,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
    const outputView = output.createView();
    const depth = resolveSceneDepthBindGroup(device, undefined);

    const upload = (encoder: GPUCommandEncoder, target: GPUTextureView, pixels: Uint8Array<ArrayBuffer>) => {
        device.queue.writeTexture({ texture: staging }, pixels, { bytesPerRow: INPUT[0] * 4 }, INPUT);
        const pass = encoder.beginRenderPass({
            colorAttachments: [{ view: target, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }],
        });
        pass.setPipeline(blit);
        pass.setBindGroup(0, blitGroup);
        pass.draw(3);
        pass.end();
    };

    const bytesPerRow = Math.ceil((OUTPUT[0] * 4) / 256) * 256;
    const readback = device.createBuffer({ size: bytesPerRow * OUTPUT[1], usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    /** Mean |output − reference| over every pixel and channel, in 8-bit units. */
    const meanError = async (reference: Uint8Array): Promise<number> => {
        const encoder = device.createCommandEncoder();
        encoder.copyTextureToBuffer({ texture: output }, { buffer: readback, bytesPerRow }, OUTPUT);
        device.queue.submit([encoder.finish()]);
        await readback.mapAsync(GPUMapMode.READ);
        const px = new Uint8Array(readback.getMappedRange());
        let sum = 0;
        for (let y = 0; y < OUTPUT[1]; y++) {
            for (let x = 0; x < OUTPUT[0]; x++) {
                for (let c = 0; c < 3; c++) {
                    sum += Math.abs(px[y * bytesPerRow + x * 4 + c]! - reference[(y * OUTPUT[0] + x) * 4 + c]!);
                }
            }
        }
        readback.unmap();
        return sum / (OUTPUT[0] * OUTPUT[1] * 3);
    };

    const phases = jitterPhaseCount(INPUT[0], OUTPUT[0]);
    out.size = { input: INPUT, output: OUTPUT, phases };

    /** A fresh resolve and tracker, the way `Renderer` drives them. */
    const makeRun = async () => {
        const pass = new TemporalPass(device);
        await pass.init(FORMAT, SHARP === undefined ? { peak: 1 } : { peak: 1, sharpnessStops: SHARP });
        const tracker = new TemporalHistoryTracker();
        const motion = new Float32Array(MOTION_UNIFORM_FLOAT_COUNT);
        let jitterIndex = 0;
        const frame = async (pov: PovSample, panoEpoch = 0) => {
            const decision = tracker.step({
                pov,
                width: INPUT[0],
                height: INPUT[1],
                holdActive: false,
                panoEpoch,
                transitioning: false,
                historicalWipe: false,
            });
            packMotionUniforms({
                mode: decision.motion ? 'camera' : 'none',
                prev: decision.prev?.pov ?? pov,
                current: pov,
                width: INPUT[0],
                height: INPUT[1],
            }, motion);
            const jitter = decision.history ? jitterOffset(jitterIndex++, phases) : ([0, 0] as const);
            pass.setFrame({ motionUniforms: motion, jitter, history: decision.history });
            const encoder = device.createCommandEncoder();
            const target = pass.ensureInput(INPUT[0], INPUT[1])!;
            upload(encoder, target, render(pov, INPUT[0], INPUT[1], jitter, panoEpoch));
            if (!pass.encode(encoder, outputView, OUTPUT[0], OUTPUT[1], depth)) throw new Error('temporal encode refused');
            device.queue.submit([encoder.finish()]);
            const error = await meanError(render(pov, OUTPUT[0], OUTPUT[1], [0, 0], panoEpoch));
            return { error, decision };
        };
        return { pass, frame };
    };

    const panRun = async (degPerFrame: number, frames: number) => {
        const { pass, frame } = await makeRun();
        const errors: number[] = [];
        for (let i = 0; i < frames; i++) {
            errors.push((await frame({ heading: 20 + i * degPerFrame, pitch: 0, zoom: 1 })).error);
        }
        pass.dispose();
        return errors;
    };
    out.still = await panRun(0, 16);
    out.pan = await panRun(0.1, 16);
    out.fastPan = await panRun(1, 16);

    // --- the FSR 1 baseline at the same scale and view ---------------------
    const easu = new UpscalePass(device, 'fsr');
    await easu.init(FORMAT, { peak: 1 });
    {
        const pov = { heading: 20 + 15 * 0.1, pitch: 0, zoom: 1 };
        const encoder = device.createCommandEncoder();
        upload(encoder, easu.ensureInput(INPUT[0], INPUT[1])!, render(pov, INPUT[0], INPUT[1], [0, 0]));
        easu.encode(encoder, outputView, OUTPUT[0], OUTPUT[1]);
        device.queue.submit([encoder.finish()]);
        out.easu = await meanError(render(pov, OUTPUT[0], OUTPUT[1], [0, 0]));
    }
    easu.dispose();

    // --- a pano change resets in the same frame: no ghost -------------------
    {
        const a = { heading: 20, pitch: 0, zoom: 1 };
        const { pass, frame } = await makeRun();
        let settled = 0;
        for (let i = 0; i < 12; i++) settled = (await frame({ ...a, heading: a.heading + i * 0.1 })).error;
        // A hop: a small turn (well inside the view) onto another pano — only the epoch says "new image".
        const jumped = await frame({ ...a, heading: a.heading + 12 * 0.1 }, 1);
        pass.dispose();
        const fresh = await makeRun();
        const first = await fresh.frame({ ...a, heading: a.heading + 12 * 0.1 }, 1);
        fresh.pass.dispose();
        out.reset = {
            jump: jumped.error,
            fresh: first.error,
            history: jumped.decision.history,
            historyReset: jumped.decision.historyReset,
            settled,
        };
    }

    await device.queue.onSubmittedWorkDone();
    await new Promise((r) => setTimeout(r, 100));
    out.uncaptured = uncaptured;
}

run().then(
    () => { out.done = true; },
    (e: unknown) => {
        out.fatal = e instanceof Error ? e.message : String(e);
        out.done = true;
    },
);
