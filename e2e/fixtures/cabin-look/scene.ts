/**
 * Cabin look harness (scripts/capture-cabin-look.mjs).
 *
 * Boots real car mode through `initCarMode` on a shared software-WebGPU device,
 * lights it with a synthetic equirect + sun, runs N frames through `updateCarMode`
 * and composites the cabin texture over a synthetic road with the production
 * `CabinCompositePass`. Reports a PNG data URL on `window.__out.png`.
 *
 * Query: w, h, frames, night (0-1), alt (sun altitude, rad), az, dome, hl,
 * rain, vehicle, quality (low|medium|high, default medium), yaw (head yaw offset, deg), pitch (deg).
 * Diagnostics: `probe` (emitter attribution over `region=x0,y0,x1,y1` as frame
 * fractions, default the cluster well), `sprites=0` (hide the glow halos for a
 * with/without pair), `glowgain=<n>` (force shader-halo intensity), and
 * `out.sprites` (each halo's world/screen position).
 */
import { createCabinRendererAsync, preloadWebGPUCabinRenderer } from '/src/car/interior/createCabinRenderer';
import { CabinCompositePass } from '/src/renderer/cabinComposite';
import { collectOptionalDeviceFeatures } from '/src/renderer/deviceInit';
import { initCarMode, toggleCarMode, updateCarMode } from '/src/car/runtime/lifecycle';
import { getState } from '/src/car/runtime/state';
import { GPU_PROFILES } from '/src/utils/performance';
import type { VehicleType } from '/src/car/VehicleManager';
import * as THREE from 'three';

const realFetch = window.fetch.bind(window);
window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const m = /\/shaders\/([^/?#]+\.wgsl)/.exec(url);
    return realFetch(m ? `/shaders/${m[1]}` : input, init);
}) as typeof window.fetch;

const q = new URLSearchParams(location.search);

// SwiftShader's renderer string lands in detectGPUProfile's Low tier. `quality`
// spoofs the unmasked renderer so the Medium/High cabin paths get built.
const SPOOF: Record<string, string> = { medium: 'Intel Iris Xe', high: 'NVIDIA GeForce RTX 3060' };
const spoof = SPOOF[q.get('quality') ?? 'medium'];
if (spoof) {
    for (const Ctx of [WebGLRenderingContext, WebGL2RenderingContext]) {
        const get = Ctx.prototype.getParameter;
        Ctx.prototype.getParameter = function (this: WebGLRenderingContext, p: number) {
            return p === 0x9246 /* UNMASKED_RENDERER_WEBGL */ ? spoof : get.call(this, p);
        } as typeof get;
    }
}
const W = Number(q.get('w') ?? 960);
const H = Number(q.get('h') ?? 540);
const frames = Number(q.get('frames') ?? 90);
const night = Number(q.get('night') ?? 0);
const alt = Number(q.get('alt') ?? (night > 0.5 ? -0.4 : 0.6));
const az = Number(q.get('az') ?? 0.6);
const dome = q.get('dome') === '1';
const hl = q.get('hl') === '1';
const rain = Number(q.get('rain') ?? 0);
const vehicle = (q.get('vehicle') ?? 'sedan') as VehicleType;
const yaw = Number(q.get('yaw') ?? 0);
const pitch = Number(q.get('pitch') ?? 0);
const hideSprites = q.get('sprites') === '0';
const regionRect = (q.get('region') ?? '0.36,0.52,0.6,0.68').split(',').map(Number) as [number, number, number, number];

const out: Record<string, unknown> = {};
(window as unknown as { __out: unknown }).__out = out;
const errors: string[] = [];

/** Day: blue sky over warm ground; night: near-black with a sodium-lit horizon. */
function makeEquirect(dark: number): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 128;
    const g = c.getContext('2d')!;
    const grad = g.createLinearGradient(0, 0, 0, 128);
    const mix = (a: number[], b: number[]) => a.map((v, i) => Math.round(v * (1 - dark) + b[i]! * dark));
    const [s0, s1, h, gr] = [mix([70, 130, 220], [4, 6, 14]), mix([180, 210, 240], [20, 18, 22]), mix([230, 225, 210], [70, 45, 20]), mix([90, 80, 70], [10, 9, 8])];
    grad.addColorStop(0, `rgb(${s0})`);
    grad.addColorStop(0.45, `rgb(${s1})`);
    grad.addColorStop(0.5, `rgb(${h})`);
    grad.addColorStop(1, `rgb(${gr})`);
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 128);
    return c;
}

const ROAD_WGSL = /* wgsl */ `
struct U { size: vec2<f32>, night: f32, hl: f32 };
@group(0) @binding(0) var<uniform> u: U;
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
  var p = array<vec2<f32>,3>(vec2(-1.0,-1.0), vec2(3.0,-1.0), vec2(-1.0,3.0));
  return vec4<f32>(p[i], 0.0, 1.0);
}
@fragment fn fs(@builtin(position) fc: vec4<f32>) -> @location(0) vec4<f32> {
  let uv = fc.xy / u.size;
  let day = 1.0 - u.night;
  let sky = mix(vec3(0.35, 0.55, 0.85), vec3(0.75, 0.82, 0.9), uv.y / 0.45) * day + vec3(0.02, 0.025, 0.05) * u.night;
  var road = mix(vec3(0.33, 0.32, 0.3), vec3(0.2, 0.2, 0.2), (uv.y - 0.45) / 0.55) * day + vec3(0.03) * u.night;
  let lane = step(abs(uv.x - 0.5), 0.004 + (uv.y - 0.45) * 0.02) * step(0.5, fract(uv.y * 20.0 / max(uv.y - 0.4, 0.05) * 0.1));
  road = road + lane * vec3(0.5, 0.45, 0.2) * (day + u.night * 0.3);
  // Headlight pool on the road ahead at night.
  let pool = u.hl * u.night * exp(-pow((uv.x - 0.5) / 0.22, 2.0) - pow((uv.y - 0.72) / 0.14, 2.0));
  road = road + pool * vec3(0.55, 0.5, 0.38);
  let c = select(sky, road, uv.y > 0.45);
  return vec4<f32>(pow(clamp(c, vec3(0.0), vec3(1.0)), vec3(1.0 / 2.2)), 1.0);
}`;

async function main() {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error('no WebGPU adapter');
    const features = collectOptionalDeviceFeatures(adapter, { featureLevel: 'core', enableClipDistances: true });
    const device = await adapter.requestDevice({ requiredFeatures: features });
    device.addEventListener('uncapturederror', (e: Event) => errors.push((e as GPUUncapturedErrorEvent).error.message));

    await preloadWebGPUCabinRenderer();
    const handle = await createCabinRendererAsync({
        gpuProfile: { ...GPU_PROFILES.medium, antialias: false },
        sharedDevice: device,
        search: location.search,
        probeOk: true,
    });
    out.backend = handle.backend;

    const container = document.getElementById('car')!;
    initCarMode(container, vehicle, device, handle);
    toggleCarMode(true);
    const interior = getState()!.interior;
    interior.lightingManager.setReducedMotion(true);
    interior.setEnvironmentFromPano(makeEquirect(Math.min(1, night)), 0);
    interior.setSunPosition(az, alt);
    interior.setWeatherIntensity(rain);
    interior.setDomeLight(dome);
    interior.setHeadlights(hl);

    for (let f = 0; f < frames; f++) {
        updateCarMode(0, yaw, pitch, 0, night, hl, dome);
        await new Promise((r) => setTimeout(r, 0));
    }
    await device.queue.onSubmittedWorkDone();

    // Where each glow halo landed: world position and screen NDC (x,y in -1..1).
    const lmGlows = (interior.lightingManager as unknown as { emitterGlows?: { kind: string; mesh: THREE.Mesh; uniforms: { intensity: { value: number }; glowCenter: { value: THREE.Vector3 } } | null }[] }).emitterGlows ?? [];
    const cam = interior.camera;
    cam.updateMatrixWorld(true);
    out.sprites = lmGlows.map((g) => {
        const world = g.mesh.getWorldPosition(new THREE.Vector3());
        const ndc = world.clone().project(cam);
        const mat = g.mesh.material as THREE.MeshBasicMaterial;
        return {
            kind: g.kind,
            visible: g.mesh.visible,
            world: world.toArray().map((v) => +v.toFixed(3)),
            ndc: [+ndc.x.toFixed(3), +ndc.y.toFixed(3), +ndc.z.toFixed(3)],
            level: g.uniforms ? +g.uniforms.intensity.value.toFixed(3) : +mat.opacity.toFixed(3),
            glowCenter: g.uniforms ? g.uniforms.glowCenter.value.toArray().map((v) => +v.toFixed(3)) : null,
            shader: !!g.uniforms,
        };
    });
    // `glowgain=<n>`: force every shader halo to a fixed intensity (does the
    // TSL material draw at all?). `sprites=0`: hide the halos for a with/without pair.
    const glowGain = q.has('glowgain') ? Number(q.get('glowgain')) : null;
    if (hideSprites || glowGain !== null) {
        for (const g of lmGlows) {
            if (hideSprites) g.mesh.visible = false;
            if (glowGain !== null && g.uniforms) g.uniforms.intensity.value = glowGain;
        }
        interior.render();
        await device.queue.onSubmittedWorkDone();
    }

    const source = interior.rendererDelegate.getCabinOverlaySource();
    if (!source) throw new Error('cabin is not composited (no frame target)');

    const outTex = device.createTexture({
        size: [W, H],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
    const mod = device.createShaderModule({ code: ROAD_WGSL });
    const pipe = device.createRenderPipeline({
        layout: 'auto',
        vertex: { module: mod, entryPoint: 'vs' },
        fragment: { module: mod, entryPoint: 'fs', targets: [{ format: 'rgba8unorm' }] },
    });
    const ub = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(ub, 0, new Float32Array([W, H, Math.min(1, night), hl ? 1 : 0]));
    const roadBind = device.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: ub } }] });
    const composite = new CabinCompositePass(device);
    await composite.init('rgba8unorm');
    composite.setSource(source);
    const bpr = Math.ceil((W * 4) / 256) * 256;

    /** Road + the cabin's latest frame, read back as tightly packed RGBA. */
    const shoot = async (): Promise<Uint8ClampedArray> => {
        const enc = device.createCommandEncoder();
        const pass = enc.beginRenderPass({
            colorAttachments: [{ view: outTex.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }],
        });
        pass.setPipeline(pipe);
        pass.setBindGroup(0, roadBind);
        pass.draw(3);
        pass.end();
        composite.encode(enc, outTex.createView());
        const buf = device.createBuffer({ size: bpr * H, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
        enc.copyTextureToBuffer({ texture: outTex }, { buffer: buf, bytesPerRow: bpr }, [W, H]);
        device.queue.submit([enc.finish()]);
        await buf.mapAsync(GPUMapMode.READ);
        const raw = new Uint8Array(buf.getMappedRange().slice(0));
        buf.destroy();
        const px = new Uint8ClampedArray(W * H * 4);
        for (let y = 0; y < H; y++) px.set(raw.subarray(y * bpr, y * bpr + W * 4), y * W * 4);
        return px;
    };
    const px = await shoot();

    if (q.has('probe')) {
        // Attribution: mean sRGB of the cluster well with each emitter family off.
        const region = (p: Uint8ClampedArray) => {
            const acc = [0, 0, 0];
            let n = 0;
            for (let y = Math.floor(H * regionRect[1]); y < Math.floor(H * regionRect[3]); y++) {
                for (let x = Math.floor(W * regionRect[0]); x < Math.floor(W * regionRect[2]); x++) {
                    const i = (y * W + x) * 4;
                    acc[0]! += p[i]!; acc[1]! += p[i + 1]!; acc[2]! += p[i + 2]!; n++;
                }
            }
            return acc.map((v) => Math.round(v / n));
        };
        const lm = interior.lightingManager as unknown as { emitterGlows?: { mesh: { visible: boolean } }[] };
        const dials = interior.gaugeRig?.dialMaterials ?? [];
        const plate = interior.instrumentClusterMat;
        const sprites = lm.emitterGlows ?? [];
        const render = async () => {
            interior.render();
            await device.queue.onSubmittedWorkDone();
            return region(await shoot());
        };
        const probe: Record<string, unknown> = { base: await render() };
        const plateI = plate.emissiveIntensity;
        plate.emissiveIntensity = 0;
        probe.noPlate = await render();
        plate.emissiveIntensity = plateI;
        for (const g of sprites) g.mesh.visible = false;
        probe.noSprites = await render();
        for (const g of sprites) g.mesh.visible = true;
        const dialI = dials.map((m) => m.emissiveIntensity);
        for (const m of dials) m.emissiveIntensity = 0;
        probe.noDials = await render();
        dials.forEach((m, i) => { m.emissiveIntensity = dialI[i]!; });
        const dashLight = (interior.lightingManager as unknown as { dashLight?: { intensity: number } }).dashLight;
        const dashI = dashLight?.intensity ?? 0;
        if (dashLight) dashLight.intensity = 0;
        probe.noDashLight = await render();
        plate.emissiveIntensity = 0;
        for (const g of sprites) g.mesh.visible = false;
        probe.allOff = await render();
        plate.emissiveIntensity = plateI;
        for (const g of sprites) g.mesh.visible = true;
        if (dashLight) dashLight.intensity = dashI;
        probe.levels = { plate: plateI, dials: dialI, sprites: sprites.length };
        out.probe = probe;
    }

    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    c.getContext('2d')!.putImageData(new ImageData(px, W, H), 0, 0);
    out.png = c.toDataURL('image/png');
    out.errors = errors;
    out.done = true;
}

main().catch((e) => {
    out.fatal = String((e as Error)?.stack ?? e);
    out.errors = errors;
    out.done = true;
});
