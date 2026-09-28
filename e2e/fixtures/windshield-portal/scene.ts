/**
 * Fixture page for e2e/windshield-portal.spec.ts.
 *
 * Builds the real pieces of car mode's windshield on a real (software) WebGPU
 * device and reports what happened on `window.__out`:
 *
 * - the shared `GPUDevice`, requested through the same `collectOptionalDeviceFeatures`
 *   the app uses (so `?no_clip_distances`-style scenarios are real);
 * - a synthetic HDR "road" texture published through the real `roadFrameRegistry`;
 * - the production `CarInteriorGlazingBuilder` glass + `WindowWeatherOverlay`
 *   (portal or decal, chosen by the production gate), a WebGPU cabin renderer from
 *   the production `createCabinRendererAsync`, rendered through the real
 *   `CabinFrameTarget` and composited by the real `CabinCompositePass`.
 *
 * Query: w, h, frames, rain, fog, wipers=0, blades=0, night, noclip, portal=off,
 * resize (replace the road texture, same size, mid-run), held, inset, format.
 */
import * as THREE from 'three';
import { collectOptionalDeviceFeatures } from '/src/renderer/deviceInit';
import { resolveHdrIntermediateFormat } from '/src/renderer/shaderFeatureVariants';
import {
    createNeutralRoadLook,
    createRoadFrameSource,
    publishRoadFrameSource,
} from '/src/renderer/roadFrameRegistry';
import { createCabinRendererAsync, preloadWebGPUCabinRenderer } from '/src/car/interior/createCabinRenderer';
import { CabinFrameTarget } from '/src/car/interior/cabinFrameTarget';
import { CabinCompositePass } from '/src/renderer/cabinComposite';
import { CarInteriorGlazingBuilder } from '/src/car/interior/CarInteriorGlazingBuilder';
import { WindowWeatherOverlay } from '/src/car/interior/WindowWeatherOverlay';
import { GPU_PROFILES } from '/src/utils/performance';

// The app fetches `./shaders/...` relative to its own page; this page lives deeper.
const realFetch = window.fetch.bind(window);
window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const m = /\/shaders\/([^/?#]+\.wgsl)/.exec(url);
    return realFetch(m ? `/shaders/${m[1]}` : input, init);
}) as typeof window.fetch;

const q = new URLSearchParams(location.search);
const W = Number(q.get('w') ?? 640);
const H = Number(q.get('h') ?? 360);
const rain = Number(q.get('rain') ?? 0.8);
const fog = Number(q.get('fog') ?? 0.2);
const wipers = q.get('wipers') !== '0';
const blades = q.get('blades') !== '0';
const night = Number(q.get('night') ?? 0);
const frames = Number(q.get('frames') ?? 60);
const noClip = q.has('noclip');
const held = q.has('held');

const errors: string[] = [];
const out: Record<string, unknown> = {};
(window as unknown as { __out: unknown }).__out = out;

async function readTexture(device: GPUDevice, tex: GPUTexture, w: number, h: number): Promise<Uint8Array> {
    const bytesPerRow = Math.ceil((w * 4) / 256) * 256;
    const buf = device.createBuffer({ size: bytesPerRow * h, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const enc = device.createCommandEncoder();
    enc.copyTextureToBuffer({ texture: tex }, { buffer: buf, bytesPerRow }, [w, h]);
    device.queue.submit([enc.finish()]);
    await buf.mapAsync(GPUMapMode.READ);
    const raw = new Uint8Array(buf.getMappedRange().slice(0));
    buf.unmap();
    buf.destroy();
    const px = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) px.set(raw.subarray(y * bytesPerRow, y * bytesPerRow + w * 4), y * w * 4);
    return px;
}

function toDataUrl(rgba: Uint8Array, w: number, h: number): string {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const img = c.getContext('2d')!.createImageData(w, h);
    img.data.set(rgba);
    c.getContext('2d')!.putImageData(img, 0, 0);
    return c.toDataURL('image/png');
}

const SCENE_WGSL = /* wgsl */ `
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
  var p = array<vec2<f32>,3>(vec2(-1.0,-1.0), vec2(3.0,-1.0), vec2(-1.0,3.0));
  return vec4<f32>(p[i], 0.0, 1.0);
}
struct U { size: vec2<f32>, mode: f32, pad: f32 };
@group(0) @binding(0) var<uniform> u: U;
@fragment fn fs_scene(@builtin(position) fc: vec4<f32>) -> @location(0) vec4<f32> {
  let uv = fc.xy / u.size;
  var c = mix(vec3<f32>(0.9, 1.4, 2.2), vec3<f32>(0.25, 0.22, 0.2), smoothstep(0.35, 0.6, uv.y));
  let cell = floor(uv * vec2<f32>(8.0, 4.5));
  if ((i32(cell.x) + i32(cell.y)) % 2 == 0) { c = c * vec3<f32>(1.0, 0.6, 0.5); }
  c = c + vec3<f32>(6.0, 5.0, 3.0) * smoothstep(0.05, 0.0, length((uv - vec2<f32>(0.7, 0.25)) * vec2<f32>(1.78, 1.0)));
  return vec4<f32>(c, 1.0);
}
@group(0) @binding(1) var hdr: texture_2d<f32>;
@group(0) @binding(2) var smp: sampler;
fn aces(x: vec3<f32>) -> vec3<f32> {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), vec3<f32>(0.0), vec3<f32>(1.0));
}
@fragment fn fs_display(@builtin(position) fc: vec4<f32>) -> @location(0) vec4<f32> {
  let uv = fc.xy / u.size;
  return vec4<f32>(aces(textureSampleLevel(hdr, smp, uv, 0.0).rgb), 1.0);
}
`;

async function main() {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error('no WebGPU adapter');
    // Same feature request the app makes; `?noclip` is the `?no_clip_distances` kill switch.
    const features = collectOptionalDeviceFeatures(adapter, { featureLevel: 'core', enableClipDistances: !noClip });
    const device = await adapter.requestDevice({ requiredFeatures: features });
    out.deviceFeatures = [...device.features];
    device.addEventListener('uncapturederror', (e: Event) => {
        errors.push((e as GPUUncapturedErrorEvent).error.message);
    });

    // Capture every WGSL module three generates, to see whether clip distances were emitted.
    const wgsl: string[] = [];
    const createShaderModule = device.createShaderModule.bind(device);
    device.createShaderModule = ((d: GPUShaderModuleDescriptor) => {
        wgsl.push(d.code);
        return createShaderModule(d);
    }) as typeof device.createShaderModule;

    const hdrFormat = (q.get('format') as GPUTextureFormat | null) ?? resolveHdrIntermediateFormat(features);
    out.hdrFormat = hdrFormat;

    const sceneModule = device.createShaderModule({ code: SCENE_WGSL });
    const uBuf = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
    const scenePipe = device.createRenderPipeline({
        layout: 'auto',
        vertex: { module: sceneModule, entryPoint: 'vs' },
        fragment: { module: sceneModule, entryPoint: 'fs_scene', targets: [{ format: hdrFormat }] },
    });
    const displayPipe = device.createRenderPipeline({
        layout: 'auto',
        vertex: { module: sceneModule, entryPoint: 'vs' },
        fragment: { module: sceneModule, entryPoint: 'fs_display', targets: [{ format: 'rgba8unorm' }] },
    });

    // The "road renderer": owns an HDR intermediate and may replace it at any time.
    let roadTex!: GPUTexture;
    const makeRoad = () => {
        roadTex?.destroy();
        roadTex = device.createTexture({
            size: [W, H],
            format: hdrFormat,
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
        });
        device.queue.writeBuffer(uBuf, 0, new Float32Array([W, H, 0, 0]));
        const bg = device.createBindGroup({
            layout: scenePipe.getBindGroupLayout(0),
            entries: [{ binding: 0, resource: { buffer: uBuf } }],
        });
        const enc = device.createCommandEncoder();
        const pass = enc.beginRenderPass({
            colorAttachments: [{ view: roadTex.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }],
        });
        pass.setPipeline(scenePipe);
        pass.setBindGroup(0, bg);
        pass.draw(3);
        pass.end();
        device.queue.submit([enc.finish()]);
    };
    makeRoad();

    const look = createNeutralRoadLook();
    look.nightIntensity = night;
    publishRoadFrameSource(
        createRoadFrameSource({
            getDevice: () => device,
            getIntermediate: () => ({ texture: roadTex, format: hdrFormat, width: W, height: H }),
            isHoldActive: () => held,
            getLook: () => look,
            isAlive: () => true,
        }),
    );

    // ---- the cabin, through the production constructor and gate ----
    await preloadWebGPUCabinRenderer();
    const handle = await createCabinRendererAsync({
        gpuProfile: { ...GPU_PROFILES.medium, antialias: false },
        sharedDevice: device,
        search: location.search,
        probeOk: true,
    });
    out.backend = handle.backend;
    const renderer = handle.renderer as unknown as import('three/webgpu').WebGPURenderer;
    renderer.setPixelRatio(1);
    renderer.setSize(W, H, false);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(70, W / H, 0.05, 50);
    camera.position.set(0, 1.3, 0.2);
    camera.lookAt(0, 1.3, -1);
    const interior = new THREE.Group();
    scene.add(interior);
    const mats = {
        frame: new THREE.MeshBasicMaterial({ color: 0x1b1b1b }),
        metal: new THREE.MeshBasicMaterial({ color: 0x666666 }),
    } as unknown as ConstructorParameters<typeof CarInteriorGlazingBuilder>[1];
    const glazing = new CarInteriorGlazingBuilder(interior, mats, 'high');
    const { windshieldGlassMesh } = glazing.build();
    if (blades) glazing.buildWipers();

    const overlay = new WindowWeatherOverlay(windshieldGlassMesh, {
        apertureInset: q.has('inset') ? Number(q.get('inset')) : undefined,
    });
    interior.add(overlay.getRoot());
    overlay.setWeather(rain, fog, 0.1);
    out.portalBuilt = overlay.getPortal() !== undefined;

    const frameTarget = CabinFrameTarget.create(handle.renderer, { canvas: handle.canvas, samples: 0 });
    if (!frameTarget.target) throw new Error(`no cabin frame target: ${frameTarget.reason}`);
    const cabin = frameTarget.target;

    const composite = new CabinCompositePass(device);
    await composite.init('rgba8unorm');
    composite.setSource(cabin.asOverlaySource());
    const outTex = device.createTexture({
        size: [W, H],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC,
    });

    device.pushErrorScope('validation');
    const dt = 1 / 60;
    let t = 0;
    for (let f = 0; f < frames; f++) {
        t += dt;
        if (q.has('resize') && f === Math.floor(frames / 2)) makeRoad(); // same size, new texture
        overlay.setWipersActive(wipers, wipers ? (t * 0.7) % 1 : 0);
        interior.rotation.y = 0.12 * Math.sin(t * 0.8); // the cabin body turns every frame
        overlay.update(dt);
        cabin.beginFrame();
        renderer.render(scene, camera);
        cabin.endFrame();
    }

    // Final frame: composite over the road, and read the cabin texture alone.
    const enc = device.createCommandEncoder();
    device.queue.writeBuffer(uBuf, 0, new Float32Array([W, H, 1, 0]));
    const bg = device.createBindGroup({
        layout: displayPipe.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: uBuf } },
            { binding: 1, resource: roadTex.createView() },
            { binding: 2, resource: sampler },
        ],
    });
    const pass = enc.beginRenderPass({
        colorAttachments: [{ view: outTex.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }],
    });
    pass.setPipeline(displayPipe);
    pass.setBindGroup(0, bg);
    pass.draw(3);
    pass.end();
    composite.encode(enc, outTex.createView());
    device.queue.submit([enc.finish()]);

    const compositePx = await readTexture(device, outTex, W, H);
    const cabinPx = await readTexture(device, cabin.getTexture()!, W, H);

    // Opaque-ish pixels (droplet lenses) in the middle of the glass, where the wipers sweep.
    let centreLenses = 0;
    for (let y = Math.floor(H * 0.36); y < Math.floor(H * 0.66); y++) {
        for (let x = Math.floor(W * 0.25); x < Math.floor(W * 0.75); x++) {
            if (cabinPx[(y * W + x) * 4 + 3]! > 200) centreLenses++;
        }
    }
    out.centreLenses = centreLenses;

    const validation = await device.popErrorScope();
    out.validationError = validation ? validation.message : null;
    out.uncaptured = errors;
    out.probe = JSON.parse(JSON.stringify((window as unknown as { __CABIN_RENDERER_PROBE__?: unknown }).__CABIN_RENDERER_PROBE__ ?? null));
    out.wgslHasClipDistances = wgsl.some((c) => c.includes('enable clip_distances'));
    out.snapshots = { composite: toDataUrl(compositePx, W, H), cabin: toDataUrl(cabinPx, W, H) };
    out.done = true;
}

main().catch((e) => {
    out.fatal = String((e as Error)?.stack ?? e);
    out.done = true;
});
