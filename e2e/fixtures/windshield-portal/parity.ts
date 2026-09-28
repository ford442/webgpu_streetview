/**
 * Fixture page for e2e/windshield-portal.spec.ts — two GPU-level guarantees.
 *
 * 1. **Display parity.** A droplet lens shows the road through `createRoadDisplay`,
 *    the portal's mirror of `weather-post`'s grade / night / vignette / rain /
 *    ACES. Here the *real* `WeatherPostProcessor` (real WGSL, real
 *    `packWeatherParams`) and the mirror (through the real cabin output path) shade
 *    the same uniform HDR texels, and the two results are compared. Everything the
 *    mirror deliberately omits (fog, haze, dust, shafts, flare, chromatic
 *    aberration, sun/moon, headlights) is zeroed on the road side.
 *
 * 2. **Texture ownership** (`?hazard=…`). three destroys an `ExternalTexture`'s
 *    source on `dispose()`. The road's HDR intermediate must survive the cabin
 *    disposing its wrapper: `neutered-dispose` is the production binding;
 *    `raw-dispose` is a bare `ExternalTexture`, recording that the hazard is real.
 *
 * Reports on `window.__out`.
 */
import * as THREE from 'three';
import { MeshBasicNodeMaterial, TSL } from 'three/webgpu';
import { collectOptionalDeviceFeatures } from '/src/renderer/deviceInit';
import { WeatherPostProcessor } from '/src/renderer/WeatherPostProcessor';
import { packWeatherParams } from '/src/renderer/packWeatherParams';
import { WeatherParamIndex } from '/src/renderer/weatherUniformLayout';
import { createNeutralRoadLook, readRoadLookInto } from '/src/renderer/roadFrameRegistry';
import { createRoadDisplay } from '/src/car/interior/cabinPortalMaterial';
import { computeTempMult } from '/src/car/interior/portalGrade';
import { RoadFrameBinding } from '/src/car/interior/roadFrameBinding';
import { CabinFrameTarget } from '/src/car/interior/cabinFrameTarget';
import { createCabinRendererAsync, preloadWebGPUCabinRenderer } from '/src/car/interior/createCabinRenderer';
import { GPU_PROFILES } from '/src/utils/performance';

// The app fetches `./shaders/...` relative to its own page; this page lives deeper.
const realFetch = window.fetch.bind(window);
window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const m = /\/shaders\/([^/?#]+\.wgsl)/.exec(url);
    return realFetch(m ? `/shaders/${m[1]}` : input, init);
}) as typeof window.fetch;

const q = new URLSearchParams(location.search);
const out: Record<string, unknown> = {};
(window as unknown as { __out: unknown }).__out = out;
const W = 640;
const H = 360;

async function readback(device: GPUDevice, tex: GPUTexture): Promise<Uint8Array> {
    const bytesPerRow = Math.ceil((W * 4) / 256) * 256;
    const buf = device.createBuffer({ size: bytesPerRow * H, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const enc = device.createCommandEncoder();
    enc.copyTextureToBuffer({ texture: tex }, { buffer: buf, bytesPerRow }, [W, H]);
    device.queue.submit([enc.finish()]);
    await buf.mapAsync(GPUMapMode.READ);
    const raw = new Uint8Array(buf.getMappedRange().slice(0));
    buf.unmap();
    buf.destroy();
    const px = new Uint8Array(W * H * 4);
    for (let y = 0; y < H; y++) px.set(raw.subarray(y * bytesPerRow, y * bytesPerRow + W * 4), y * W * 4);
    return px;
}

/** Mean RGB of a 13×13 patch around (fx, fy). */
function patchMean(px: Uint8Array, fx: number, fy: number): [number, number, number] {
    const cx = Math.floor(fx * W);
    const cy = Math.floor(fy * H);
    let r = 0, g = 0, b = 0, n = 0;
    for (let y = cy - 6; y <= cy + 6; y++) {
        for (let x = cx - 6; x <= cx + 6; x++) {
            const i = (y * W + x) * 4;
            r += px[i]!;
            g += px[i + 1]!;
            b += px[i + 2]!;
            n++;
        }
    }
    return [r / n, g / n, b / n];
}

const BASE_ENV = {
    nightIntensity: 0, rainIntensity: 0, snowIntensity: 0, wind: 50, fogDensity: 0,
    vibrance: 1, saturation: 1, contrast: 1, exposure: 0, temperature: 0, tint: 0,
    headlightsOn: false, highBeam: false, domeLightOn: false,
    sunAzimuth: 0, sunAltitude: -1, moonAzimuth: 0, moonAltitude: -1, moonIntensity: 0,
    shaderEffectsEnabled: true, timeOfDay: 'day',
};

const CASES: Array<{ name: string; env: Record<string, unknown>; color: [number, number, number] }> = [
    { name: 'neutral-mid', env: {}, color: [0.5, 0.25, 0.1] },
    { name: 'neutral-hdr', env: {}, color: [1.8, 1.2, 0.6] },
    { name: 'neutral-dark', env: {}, color: [0.05, 0.08, 0.2] },
    { name: 'grade-knobs', env: { exposure: 0.7, contrast: 1.3, saturation: 1.4, vibrance: 1.6 }, color: [0.5, 0.25, 0.1] },
    { name: 'grade-negative', env: { exposure: -0.5, contrast: 0.7, saturation: 0.6, vibrance: 0.4 }, color: [0.4, 0.5, 0.3] },
    { name: 'temp-tint', env: { temperature: 0.5, tint: -0.4 }, color: [0.5, 0.5, 0.5] },
    { name: 'temp-cool', env: { temperature: -0.6, tint: 0.5 }, color: [0.6, 0.4, 0.3] },
    { name: 'night-0.5', env: { nightIntensity: 0.5 }, color: [0.5, 0.25, 0.1] },
    { name: 'night-1.0', env: { nightIntensity: 1.0 }, color: [0.5, 0.25, 0.1] },
    { name: 'night-1.0-bright', env: { nightIntensity: 1.0 }, color: [1.8, 1.2, 0.6] },
    { name: 'bypass', env: { shaderEffectsEnabled: false }, color: [0.5, 0.25, 0.1] },
];

/** sRGB EOTF on a 0..255 code value. */
const decode = (v: number) => {
    const x = v / 255;
    return 255 * (x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4));
};

async function main() {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error('no WebGPU adapter');
    const device = await adapter.requestDevice({
        requiredFeatures: collectOptionalDeviceFeatures(adapter, { featureLevel: 'core' }),
    });
    const errors: string[] = [];
    device.addEventListener('uncapturederror', (e: Event) => errors.push((e as GPUUncapturedErrorEvent).error.message));

    const hdrFormat: GPUTextureFormat = 'rgba16float';
    const roadTex = device.createTexture({
        size: [W, H],
        format: hdrFormat,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    const fillModule = device.createShaderModule({
        code: `
        @vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
          var p = array<vec2<f32>,3>(vec2(-1.0,-1.0), vec2(3.0,-1.0), vec2(-1.0,3.0));
          return vec4<f32>(p[i], 0.0, 1.0);
        }
        @group(0) @binding(0) var<uniform> c: vec4<f32>;
        @fragment fn fs() -> @location(0) vec4<f32> { return vec4<f32>(c.rgb, 1.0); }`,
    });
    const fillBuf = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const fillPipe = device.createRenderPipeline({
        layout: 'auto',
        vertex: { module: fillModule, entryPoint: 'vs' },
        fragment: { module: fillModule, entryPoint: 'fs', targets: [{ format: hdrFormat }] },
    });
    const fill = (color: [number, number, number]) => {
        device.queue.writeBuffer(fillBuf, 0, new Float32Array([...color, 1]));
        const bg = device.createBindGroup({ layout: fillPipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: fillBuf } }] });
        const enc = device.createCommandEncoder();
        const pass = enc.beginRenderPass({ colorAttachments: [{ view: roadTex.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }] });
        pass.setPipeline(fillPipe);
        pass.setBindGroup(0, bg);
        pass.draw(3);
        pass.end();
        device.queue.submit([enc.finish()]);
    };

    // The real road pass. It only ever asks its context for `getCurrentTexture()`, so an offscreen
    // texture stands in for the swap chain (a real canvas needs a presenting page to be read back).
    const truthTex = device.createTexture({
        size: [W, H],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC | GPUTextureUsage.TEXTURE_BINDING,
    });
    const context = { getCurrentTexture: () => truthTex, configure() {}, unconfigure() {} } as unknown as GPUCanvasContext;
    const weather = new WeatherPostProcessor(device, context, document.createElement('canvas'));
    await weather.init('rgba8unorm', { canvasToneMapping: 'standard' });
    weather.updateWeatherBindGroup(roadTex.createView(), W, H);

    // The mirror, through the production cabin renderer's output path.
    await preloadWebGPUCabinRenderer();
    const handle = await createCabinRendererAsync({
        gpuProfile: { ...GPU_PROFILES.medium, antialias: false },
        sharedDevice: device,
        search: '',
        probeOk: true,
    });
    const renderer = handle.renderer as unknown as import('three/webgpu').WebGPURenderer;
    renderer.setPixelRatio(1);
    renderer.setSize(W, H, false);

    const road = createRoadDisplay();
    const dummy = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
    dummy.needsUpdate = true;
    const hdrNode = TSL.texture(dummy);
    const mirror = new MeshBasicNodeMaterial();
    mirror.lights = false;
    mirror.toneMapped = false;
    mirror.outputNode = TSL.Fn(() => {
        const hdr = (hdrNode.sample(TSL.screenUV) as unknown as { level(n: number): { rgb: never } }).level(0).rgb;
        return TSL.vec4(
            TSL.sRGBTransferEOTF(TSL.clamp(road.display(hdr, TSL.screenUV), TSL.vec3(0), TSL.vec3(1))),
            1,
        );
    })();
    const scene = new THREE.Scene();
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mirror);
    quad.frustumCulled = false;
    scene.add(quad);
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const target = CabinFrameTarget.create(handle.renderer, { canvas: handle.canvas, samples: 0 });
    if (!target.target) throw new Error(`no cabin frame target: ${target.reason}`);
    const cabin = target.target;
    const binding = new RoadFrameBinding(hdrNode as unknown as { value: unknown });
    binding.sync({ texture: roadTex, device, format: hdrFormat, width: W, height: H, held: false, look: createNeutralRoadLook() });

    const look = createNeutralRoadLook();
    const results: unknown[] = [];
    for (const c of CASES) {
        fill(c.color);
        const params = packWeatherParams({
            env: { ...BASE_ENV, ...c.env } as never,
            timeSeconds: 0,
            cameraHeading: 0.5,
            cameraPitch: 0.5,
            wasmNoiseActive: false,
        });
        for (const k of [
            'fogIntensity', 'fogDensity', 'fogHeight', 'lightShaftsIntensity', 'heatShimmerIntensity',
            'lensFlareIntensity', 'chromaticAberration', 'dustIntensity', 'humidityHaze', 'sunrise',
            'anamorphicStreak', 'dofStrength', 'motionBlurStrength',
        ] as const) params[WeatherParamIndex[k]] = 0;
        weather.updateWeatherParams(params);

        const enc = device.createCommandEncoder();
        weather.renderPass(enc);
        device.queue.submit([enc.finish()]);
        const truth = patchMean(await readback(device, truthTex), 0.5, 0.75);

        // The same path Renderer.updateWeatherParams → WindshieldPortal.update takes.
        readRoadLookInto(params, look);
        const u = road.uniforms;
        u.vibrance.value = look.vibrance;
        u.saturation.value = look.saturation;
        u.contrast.value = look.contrast;
        u.exposure.value = look.exposure;
        u.nightIntensity.value = look.nightIntensity;
        u.roadRain.value = look.rainIntensity;
        u.graded.value = look.graded ? 1 : 0;
        const [tr, tg, tb] = computeTempMult(look.temperature, look.tint);
        u.tempMult.value.set(tr, tg, tb);

        cabin.beginFrame();
        renderer.render(scene, camera);
        cabin.endFrame();
        const texture = cabin.getTexture()!;
        // The cabin target is an -srgb texture: the composite pass decodes on sample, so decode here too.
        out.cabinFormat = texture.format;
        const bytes = patchMean(await readback(device, texture), 0.5, 0.75);
        const seen = texture.format.endsWith('-srgb') ? (bytes.map(decode) as [number, number, number]) : bytes;

        results.push({
            case: c.name,
            truth: truth.map((v) => +v.toFixed(2)),
            mirror: seen.map((v) => +v.toFixed(2)),
            maxAbsDiff: +Math.max(...truth.map((v, i) => Math.abs(v - seen[i]!))).toFixed(2),
        });
    }
    out.results = results;

    // ---- texture ownership ----
    const hazard = q.get('hazard');
    if (hazard) {
        const owned = device.createTexture({
            size: [W, H],
            format: hdrFormat,
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
        });
        const node = TSL.texture(dummy);
        const probe = new MeshBasicNodeMaterial();
        probe.lights = false;
        probe.toneMapped = false;
        probe.outputNode = TSL.Fn(() =>
            TSL.vec4((node.sample(TSL.screenUV) as unknown as { level(n: number): { rgb: never } }).level(0).rgb, 1),
        )();
        quad.material = probe;

        let wrapper: THREE.Texture;
        if (hazard === 'raw-dispose') {
            const raw = new THREE.ExternalTexture(owned);
            raw.needsUpdate = true;
            (node as unknown as { value: unknown }).value = raw;
            wrapper = raw;
        } else {
            const bound = new RoadFrameBinding(node as unknown as { value: unknown });
            bound.sync({ texture: owned, device, format: hdrFormat, width: W, height: H, held: false, look: createNeutralRoadLook() });
            wrapper = bound.getWrapper()!;
        }
        cabin.beginFrame();
        renderer.render(scene, camera);
        cabin.endFrame();

        wrapper.dispose(); // what three does when it tears a texture down

        // The road renderer's next frame renders into / samples this texture.
        device.pushErrorScope('validation');
        const enc = device.createCommandEncoder();
        enc.beginRenderPass({
            colorAttachments: [{ view: owned.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }],
        }).end();
        device.queue.submit([enc.finish()]);
        const err = await device.popErrorScope();
        out.hazard = { mode: hazard, roadTextureSurvives: err === null, error: err ? err.message : null };
    }

    out.uncaptured = errors;
    out.done = true;
}

main().catch((e) => {
    out.fatal = String((e as Error)?.stack ?? e);
    out.done = true;
});
