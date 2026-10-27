/**
 * Fixture page for e2e/stereo.spec.ts.
 *
 * Cuts the photo and its depth map out of the scene-depth golden, then:
 *
 * - **CPU**: runs `stereoSourceX` (the shader's reference) for every pixel of
 *   both eyes at a 64 mm IPD — counting pixels left without a source (holes),
 *   disocclusion fills, the widest fill run, and fills that took their colour
 *   from a surface nearer than the nearest-far neighbour (smears);
 * - **GPU**: renders each eye through the production `ReprojectPass`
 *   (`reproject.wgsl`, mode `eye`) with the depth map bound as the scene-depth
 *   group, reads it back and compares it with the CPU reference image.
 *
 * Reports on `window.__out`. Query: `ipd=<mm>` (default 64).
 */
import { ReprojectPass } from '/src/renderer/reproject/ReprojectPass';
import {
    eyeShiftRange,
    packReprojectUniforms,
    stereoSourceX,
    viewDepthProxy,
    ReprojectUniformIndex,
} from '/src/renderer/reproject/reprojectMath';
import {
    createSceneDepthBindGroup,
    createSceneDepthSampler,
    SCENE_DEPTH_PARAMS_FLOAT_COUNT,
} from '/src/renderer/depth/sceneDepthBinding';

const out: Record<string, unknown> = {};
(window as unknown as { __out: unknown }).__out = out;

const q = new URLSearchParams(location.search);
const ipd = Number(q.get('ipd') ?? 64) / 1000;

// The golden is two 482-px halves with a caption in each top-left corner.
const GOLDEN = '/docs/looks/scene-depth/depth-map-webgpu.jpg';
const HALF = 482;
const CROP = { x: 6, y: 40, width: 470, height: 352 };

async function loadImage(url: string): Promise<ImageBitmap> {
    const blob = await (await fetch(url)).blob();
    return createImageBitmap(blob);
}

function crop(bitmap: ImageBitmap, x: number): ImageData {
    const c = document.createElement('canvas');
    c.width = CROP.width;
    c.height = CROP.height;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(bitmap, x, CROP.y, CROP.width, CROP.height, 0, 0, CROP.width, CROP.height);
    return ctx.getImageData(0, 0, CROP.width, CROP.height);
}

async function main() {
    const golden = await loadImage(GOLDEN);
    const photo = crop(golden, CROP.x);
    const depthImage = crop(golden, HALF + CROP.x);
    const W = CROP.width;
    const H = CROP.height;
    const depth = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) depth[i] = depthImage.data[i * 4]! / 255;

    const uniformsFor = (eyeSign: -1 | 1) => packReprojectUniforms({
        mode: 'eye',
        zoom: 1,
        outputWidth: W,
        outputHeight: H,
        delta: { yawDeg: 0, pitchDeg: 0 },
        ipd,
        eyeSign,
        fillBlur: false,
    });

    // ── CPU reference ────────────────────────────────────────────────────────
    // The shader's centreDepth at blend 1: the map, faded to the proxy at its edge.
    const depthAt = (u: Float32Array, y: number) => (x: number) => {
        const px = Math.min(W - 1, Math.max(0, Math.floor(x * W)));
        const py = Math.min(H - 1, Math.max(0, Math.floor(y * H)));
        const edge = Math.min(x, 1 - x, y, 1 - y);
        const t = Math.min(1, Math.max(0, edge / 0.04));
        const coverage = t * t * (3 - 2 * t);
        const proxy = viewDepthProxy(y, u[ReprojectUniformIndex.horizonY]!);
        return proxy + (depth[py * W + px]! - proxy) * coverage;
    };
    const reference: Record<string, Uint8ClampedArray> = {};
    let holes = 0;
    let fills = 0;
    let smears = 0;
    let widestFill = 0;
    for (const eyeSign of [-1, 1] as const) {
        const u = uniformsFor(eyeSign);
        const img = new Uint8ClampedArray(W * H * 4);
        for (let py = 0; py < H; py++) {
            const y = (py + 0.5) / H;
            const d = depthAt(u, y);
            let run = 0;
            for (let px = 0; px < W; px++) {
                const hit = stereoSourceX((px + 0.5) / W, eyeSign, d, u);
                if (!Number.isFinite(hit.x)) {
                    holes++;
                    continue;
                }
                if (hit.consistent) {
                    run = 0;
                } else {
                    fills++;
                    run++;
                    widestFill = Math.max(widestFill, run);
                    // A smear is a fill taken from the occluder: the nearest
                    // surface in the searched span, where that span has an edge.
                    const [far, near] = eyeShiftRange(eyeSign, u);
                    const x = (px + 0.5) / W;
                    let nearest = 1;
                    let farthest = 0;
                    for (let k = 0; k <= 16; k++) {
                        const dk = d(x - (near + ((far - near) * k) / 16));
                        nearest = Math.min(nearest, dk);
                        farthest = Math.max(farthest, dk);
                    }
                    if (farthest - nearest > 0.05 && d(hit.x) < nearest + 0.02) smears++;
                }
                const sx = Math.min(W - 1, Math.max(0, Math.round(hit.x * W - 0.5)));
                const s = (py * W + sx) * 4;
                const o = (py * W + px) * 4;
                img[o] = photo.data[s]!;
                img[o + 1] = photo.data[s + 1]!;
                img[o + 2] = photo.data[s + 2]!;
                img[o + 3] = 255;
            }
        }
        reference[eyeSign] = img;
    }
    out.cpu = { width: W, height: H, holes, fills, smears, widestFill };

    // ── GPU ──────────────────────────────────────────────────────────────────
    const adapter = await navigator.gpu?.requestAdapter();
    if (!adapter) throw new Error('no WebGPU adapter');
    const device = await adapter.requestDevice();
    const errors: string[] = [];
    device.addEventListener('uncapturederror', (e) => errors.push((e as GPUUncapturedErrorEvent).error.message));

    const format: GPUTextureFormat = 'rgba8unorm';
    const pass = new ReprojectPass(device);
    await pass.init(format);
    pass.ensureSource(W, H);
    const photoBitmap = await createImageBitmap(photo);
    device.queue.copyExternalImageToTexture({ source: photoBitmap }, { texture: pass.getSourceTexture()! }, [W, H]);

    const depthTexture = device.createTexture({
        label: 'stereo-fixture-depth',
        size: [W, H],
        format: 'r8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    const bytes = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) bytes[i] = depthImage.data[i * 4]!;
    device.queue.writeTexture({ texture: depthTexture }, bytes, { bytesPerRow: W }, [W, H]);
    const params = device.createBuffer({
        label: 'stereo-fixture-depth-params',
        size: SCENE_DEPTH_PARAMS_FLOAT_COUNT * 4,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const p = new Float32Array(SCENE_DEPTH_PARAMS_FLOAT_COUNT);
    p[0] = 1; // blend: the map
    p[8] = 1; // zoom
    device.queue.writeBuffer(params, 0, p);
    const depthGroup = createSceneDepthBindGroup(
        device, depthTexture.createView(), createSceneDepthSampler(device), params, 'stereo-fixture-depth-group',
    );

    const bytesPerRow = Math.ceil((W * 4) / 256) * 256;
    const gpu: Record<string, { meanAbs: number; over32: number }> = {};
    for (const [slot, eyeSign] of [[1, -1], [2, 1]] as const) {
        const target = device.createTexture({
            label: 'stereo-fixture-eye',
            size: [W, H],
            format,
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
        });
        pass.writeUniforms(slot, uniformsFor(eyeSign));
        const readback = device.createBuffer({ size: bytesPerRow * H, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
        const encoder = device.createCommandEncoder();
        if (!pass.encode(encoder, target.createView(), depthGroup, { slot, format })) throw new Error('reproject did not encode');
        encoder.copyTextureToBuffer({ texture: target }, { buffer: readback, bytesPerRow }, [W, H]);
        device.queue.submit([encoder.finish()]);
        await readback.mapAsync(GPUMapMode.READ);
        const data = new Uint8Array(readback.getMappedRange());
        const ref = reference[eyeSign]!;
        let sum = 0;
        let over = 0;
        for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
                const g = y * bytesPerRow + x * 4;
                const r = (y * W + x) * 4;
                const e = (Math.abs(data[g]! - ref[r]!) + Math.abs(data[g + 1]! - ref[r + 1]!) + Math.abs(data[g + 2]! - ref[r + 2]!)) / 3;
                sum += e;
                if (e > 32) over++;
            }
        }
        readback.unmap();
        gpu[eyeSign === -1 ? 'left' : 'right'] = { meanAbs: sum / (W * H), over32: over / (W * H) };
    }
    await device.queue.onSubmittedWorkDone();
    out.gpu = gpu;
    out.uncaptured = errors;
    out.done = true;
}

main().catch((e) => {
    out.fatal = e instanceof Error ? e.message : String(e);
    out.done = true;
});
