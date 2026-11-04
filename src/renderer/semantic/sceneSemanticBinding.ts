/**
 * The semantic class map every consumer binds (#352).
 *
 * `SemanticController` owns a small `rg8unorm` map (R = class id + 1, G =
 * probability; `semanticClasses.ts`) and a 64-byte `SceneSemanticParams`
 * uniform, published as one bind group on `FrameContext.aux.semantic`.
 *
 * | consumer | group | reads |
 * |---|---|---|
 * | `weather-post.wgsl` / `weather-post-compute.wgsl` | 3 | `sceneClass()` / `classWeight()`: rain over sky, wet road, snow cover, fog at the sky boundary, night relight |
 *
 * Its own group, not more entries in depth's group 2: group 2 is also pass 1's
 * and the reprojection's layout, and the two maps arrive and fail
 * independently. Like depth, it is a bind group, not weather slots — the
 * 44-float block is untouched — and the fallback (a 1×1 zero texture, an
 * all-zero block: `blend = 0`) sends every consumer down its pre-semantic
 * branch bit-exactly.
 */
import { createTrackedBuffer, createTrackedTexture, destroyTracked } from '../gpuMemoryTracking';
import { SEMANTIC_MAP_FORMAT } from './semanticClasses';

/** The class map as a pass may read it this frame. */
export interface AuxSemantic {
    readonly texture: GPUTexture;
    readonly view: GPUTextureView;
    readonly width: number;
    readonly height: number;
    /** Bumped on every upload. */
    readonly generation: number;
    /** Texture + sampler + params, in `getSceneSemanticBindGroupLayout`'s shape. */
    readonly bindGroup: GPUBindGroup;
}

/** Group index of the semantic group in both weather pipelines. */
export const WEATHER_SCENE_SEMANTIC_GROUP = 3;

/**
 * `SceneSemanticParams` in the WGSL (all `f32`, 64 bytes). Must match the
 * struct in `weather-post/01-foundation.wgsl` and `weather-post-compute.wgsl`
 * (`sceneSemanticBinding.test.ts` reads both).
 */
export const SceneSemanticParamIndex = {
    /** Preset weight × trust in the map. 0 = every consumer's pre-semantic branch (bit-exact). */
    blend: 0,
    /** Screen UV → map UV shift for the current POV (look-around since inference). */
    shiftX: 1,
    shiftY: 2,
    /** Rain streaks thinned over sky pixels (1 = none above the sky boundary). */
    rainSky: 3,
    /** Wet-road sheen on road pixels only. */
    wetRoad: 4,
    /** Settled snow on horizontal classes (road, sidewalk, vegetation). */
    snowCover: 5,
    /** Fog extinction relaxed over the sky (the bank sits below the skyline). */
    fogSky: 6,
    /** Per-class night relight (windows on buildings, lamps on road), × night. */
    relight: 7,
    /** Sky replacement: the analytic sky behind the sky matte. */
    skyReplace: 8,
    /** Digital zoom the map was inferred at. */
    zoom: 9,
    /** 1 under reduced motion: static clouds, steady windows. */
    stillness: 10,
    /**
     * The photo's mean sky colour (0–1) when the map was made, over the pixels
     * labelled sky — the sky regrade's reference and the sky key's colour; all 0 = no sky.
     */
    skyR: 11,
    skyG: 12,
    skyB: 13,
} as const;

/** Fourteen used, padded to a 16-byte multiple. */
export const SCENE_SEMANTIC_PARAMS_FLOAT_COUNT = 16;
export const SCENE_SEMANTIC_PARAMS_BYTE_SIZE = SCENE_SEMANTIC_PARAMS_FLOAT_COUNT * 4;

const layouts = new WeakMap<GPUDevice, GPUBindGroupLayout>();

/**
 * The one semantic layout per device: 0 class map (`rg8unorm`, read with
 * `textureLoad` — class ids must never be filtered), 1 linear sampler (the
 * probability matte), 2 `SceneSemanticParams`.
 */
export function getSceneSemanticBindGroupLayout(device: GPUDevice): GPUBindGroupLayout {
    let layout = layouts.get(device);
    if (!layout) {
        const visibility = GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE;
        layout = device.createBindGroupLayout({
            label: 'scene-semantic-bind-group-layout',
            entries: [
                { binding: 0, visibility, texture: { sampleType: 'float' } },
                { binding: 1, visibility, sampler: { type: 'filtering' } },
                { binding: 2, visibility, buffer: { type: 'uniform' } },
            ],
        });
        layouts.set(device, layout);
    }
    return layout;
}

export function createSceneSemanticSampler(device: GPUDevice): GPUSampler {
    return device.createSampler({
        label: 'scene-semantic-sampler',
        magFilter: 'linear',
        minFilter: 'linear',
        addressModeU: 'clamp-to-edge',
        addressModeV: 'clamp-to-edge',
    });
}

export function createSceneSemanticBindGroup(
    device: GPUDevice,
    view: GPUTextureView,
    sampler: GPUSampler,
    params: GPUBuffer,
    label: string,
): GPUBindGroup {
    return device.createBindGroup({
        label,
        layout: getSceneSemanticBindGroupLayout(device),
        entries: [
            { binding: 0, resource: view },
            { binding: 1, resource: sampler },
            { binding: 2, resource: { buffer: params } },
        ],
    });
}

interface Fallback {
    texture: GPUTexture;
    params: GPUBuffer;
    bindGroup: GPUBindGroup;
}

const fallbacks = new WeakMap<GPUDevice, Fallback>();

/** "No class map this frame": 1×1 unlabelled texel, all-zero params (`blend = 0`). One per device. */
export function getSceneSemanticFallback(device: GPUDevice): GPUBindGroup {
    let fallback = fallbacks.get(device);
    if (!fallback) {
        const texture = createTrackedTexture(device, {
            label: 'scene-semantic-fallback',
            size: [1, 1],
            format: SEMANTIC_MAP_FORMAT,
            usage: GPUTextureUsage.TEXTURE_BINDING,
        }, 'scene-semantic-fallback');
        const params = createTrackedBuffer(device, {
            label: 'scene-semantic-fallback-params',
            size: SCENE_SEMANTIC_PARAMS_BYTE_SIZE,
            usage: GPUBufferUsage.UNIFORM,
        }, 'scene-semantic-fallback-params');
        const bindGroup = createSceneSemanticBindGroup(
            device,
            texture.createView(),
            createSceneSemanticSampler(device),
            params,
            'scene-semantic-fallback',
        );
        fallback = { texture, params, bindGroup };
        fallbacks.set(device, fallback);
    }
    return fallback.bindGroup;
}

/** This frame's semantic group: the published map, or the fallback. */
export function resolveSceneSemanticBindGroup(
    device: GPUDevice,
    aux: { semantic?: AuxSemantic | undefined } | undefined,
): GPUBindGroup {
    return aux?.semantic?.bindGroup ?? getSceneSemanticFallback(device);
}

/** Destroy the device's fallback (renderer teardown). Safe when there is none. */
export function releaseSceneSemanticFallback(device: GPUDevice | undefined): void {
    if (!device) return;
    const fallback = fallbacks.get(device);
    if (!fallback) return;
    fallbacks.delete(device);
    destroyTracked(fallback.texture);
    destroyTracked(fallback.params);
}
