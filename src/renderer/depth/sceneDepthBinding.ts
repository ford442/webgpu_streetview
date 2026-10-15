/**
 * The scene-depth auxiliary input every depth consumer binds (#320).
 *
 * The depth pass (`depth/DepthFramePass.ts`) owns a small `r16float` texture of
 * normalised scene depth (0 = at the camera, 1 = horizon or beyond — the same
 * scale as `viewDepthProxy`) and a 48-byte `SceneDepthParams` uniform. It
 * publishes both as one bind group on `FrameContext.aux.depth`. Consumers bind
 * that group — or, when there is no depth this frame, the per-device fallback
 * below — at their own group index:
 *
 * | consumer | group | reads |
 * |---|---|---|
 * | `weather-post.wgsl` / `weather-post-compute.wgsl` | 2 | `sceneDepth()` for fog, rain/snow, DOF |
 * | `streetview.wgsl` (pass 1) | 1 | the release dolly |
 *
 * This is a bind-group entry, not new weather slots: the 44-float weather
 * block is untouched, and with `blend = 0` and `dolly = 0` (the fallback, and
 * every frame without depth) every consumer takes a branch that returns the
 * pre-depth value bit-exactly.
 */
import { createTrackedBuffer, createTrackedTexture, destroyTracked } from '../gpuMemoryTracking';

/** Scene depth as a pass may read it this frame. */
export interface AuxDepth {
    readonly texture: GPUTexture;
    readonly view: GPUTextureView;
    readonly width: number;
    readonly height: number;
    /** Bumped on every depth upload, so a consumer can tell a new map from the last one. */
    readonly generation: number;
    /** Texture + sampler + params, in `getSceneDepthBindGroupLayout`'s shape. */
    readonly bindGroup: GPUBindGroup;
}

/** Auxiliary textures passes may read — filled by `Renderer` before the frame encodes. */
export interface FrameAux {
    depth?: AuxDepth;
}

export const SCENE_DEPTH_FORMAT: GPUTextureFormat = 'r16float';

/** Group index of the scene-depth group in both weather pipelines. */
export const WEATHER_SCENE_DEPTH_GROUP = 2;
/** Group index of the scene-depth group in the pass-1 pipeline. */
export const STREETVIEW_SCENE_DEPTH_GROUP = 1;

/**
 * `SceneDepthParams` in the WGSL (all `f32`, 48 bytes). Must match the struct in
 * `streetview.wgsl`, `weather-post/01-foundation.wgsl` and
 * `weather-post-compute.wgsl` — `sceneDepthBinding.test.ts` reads all three.
 */
export const SceneDepthParamIndex = {
    /** Weight of the depth map against `viewDepthProxy`; 0 returns the proxy exactly. */
    blend: 0,
    /**
     * Release dolly along the view axis in pass 1: > 0 pushes the held frame in
     * (a forward hop), < 0 pulls it back. 0 keeps the plain crossfade exactly.
     */
    dolly: 1,
    /** Release dolly across the view (a side-step): near pixels slide the most. */
    dollyLateral: 2,
    /** Screen Y of the dolly's focus of expansion (the horizon at capture). */
    foeY: 3,
    /** Screen UV → depth-map UV shift for the current POV (look-around since inference). */
    shiftX: 4,
    shiftY: 5,
    /** The same shift for the hold snapshot's POV (pass 1's held frame). */
    heldShiftX: 6,
    heldShiftY: 7,
    /** Digital zoom the depth map was inferred at (pass 1 maps snapshot UVs to screen UVs). */
    zoom: 8,
} as const;

/** Nine used, padded to a 16-byte multiple. */
export const SCENE_DEPTH_PARAMS_FLOAT_COUNT = 12;
export const SCENE_DEPTH_PARAMS_BYTE_SIZE = SCENE_DEPTH_PARAMS_FLOAT_COUNT * 4;

const layouts = new WeakMap<GPUDevice, GPUBindGroupLayout>();

/**
 * The one scene-depth layout per device: 0 depth texture (filterable float),
 * 1 linear sampler, 2 `SceneDepthParams` uniform. Shared so the group the depth
 * pass builds is compatible with every pipeline that declares it.
 */
export function getSceneDepthBindGroupLayout(device: GPUDevice): GPUBindGroupLayout {
    let layout = layouts.get(device);
    if (!layout) {
        const visibility = GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE;
        layout = device.createBindGroupLayout({
            label: 'scene-depth-bind-group-layout',
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

export function createSceneDepthSampler(device: GPUDevice): GPUSampler {
    return device.createSampler({
        label: 'scene-depth-sampler',
        magFilter: 'linear',
        minFilter: 'linear',
        addressModeU: 'clamp-to-edge',
        addressModeV: 'clamp-to-edge',
    });
}

export function createSceneDepthBindGroup(
    device: GPUDevice,
    view: GPUTextureView,
    sampler: GPUSampler,
    params: GPUBuffer,
    label: string,
): GPUBindGroup {
    return device.createBindGroup({
        label,
        layout: getSceneDepthBindGroupLayout(device),
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

/**
 * "No depth this frame": a 1×1 texture and an all-zero params block
 * (`blend = 0`, `dolly = 0`), so every consumer takes its pre-depth branch.
 * One per device; `Renderer` releases it on teardown.
 */
export function getSceneDepthFallback(device: GPUDevice): GPUBindGroup {
    let fallback = fallbacks.get(device);
    if (!fallback) {
        const texture = createTrackedTexture(device, {
            label: 'scene-depth-fallback',
            size: [1, 1],
            format: SCENE_DEPTH_FORMAT,
            usage: GPUTextureUsage.TEXTURE_BINDING,
        }, 'scene-depth-fallback');
        // Buffers are zero-initialised, which is exactly blend 0 / dolly 0.
        const params = createTrackedBuffer(device, {
            label: 'scene-depth-fallback-params',
            size: SCENE_DEPTH_PARAMS_BYTE_SIZE,
            usage: GPUBufferUsage.UNIFORM,
        }, 'scene-depth-fallback-params');
        const bindGroup = createSceneDepthBindGroup(
            device,
            texture.createView(),
            createSceneDepthSampler(device),
            params,
            'scene-depth-fallback',
        );
        fallback = { texture, params, bindGroup };
        fallbacks.set(device, fallback);
    }
    return fallback.bindGroup;
}

/** This frame's scene-depth group: the published depth, or the fallback. */
export function resolveSceneDepthBindGroup(device: GPUDevice, aux: FrameAux | undefined): GPUBindGroup {
    return aux?.depth?.bindGroup ?? getSceneDepthFallback(device);
}

/** Destroy the device's fallback (renderer teardown). Safe when there is none. */
export function releaseSceneDepthFallback(device: GPUDevice | undefined): void {
    if (!device) return;
    const fallback = fallbacks.get(device);
    if (!fallback) return;
    fallbacks.delete(device);
    destroyTracked(fallback.texture);
    destroyTracked(fallback.params);
}
