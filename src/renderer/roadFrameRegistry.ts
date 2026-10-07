/**
 * Single-slot handoff of the road frame's HDR intermediate from the Street View
 * renderer to the cabin — the reverse direction of `cabinOverlayRegistry`.
 *
 * The cabin's windshield "portal" (`car/interior/WindshieldPortal.ts`) samples
 * the pass-1 HDR intermediate through the glass: refracted through droplets,
 * cleared where the wipers have been. Both ends live on opposite sides of a lazy
 * chunk boundary (`Renderer` is eager, the car interior is behind
 * `carRuntimeLoader`), so — exactly like the cabin texture going the other way —
 * the renderer **publishes** and the cabin **reads**.
 *
 * ### What is, and is not, exposed
 *
 * Only the **pass-1 HDR intermediate** (`rgba16float` / `rg11b10ufloat`). Never
 * the hidden Google Maps canvas, never `videoTexture` (the live upload), never
 * a rear-view feed. That is what makes the hold-pause guarantee structural:
 * while `holdActive`, pass 1 draws from `previousFrameTexture`, so the
 * intermediate the portal samples *is* the held frame — there is no code path
 * from here to a live Maps upload. `held` is reported so the cabin probe can
 * say so.
 *
 * ### Single module instance
 *
 * Written from the eager renderer, read from the lazy car chunk. If a Rollup
 * split ever duplicated this module each chunk would get its own slot and the
 * portal would silently stay on the hole fallback with no type or test error, so
 * `scripts/check-bundle-budget.sh` asserts it lives in exactly one chunk.
 */
import { WeatherParamIndex } from './weatherUniformLayout';

/**
 * The stages of `weather-post`'s `fs_main` the cabin mirrors so a droplet lens
 * shows the road the way the road looks, rather than the raw intermediate.
 *
 * Values are the **packed shader-space** floats (`packWeatherParams`), not the UI
 * ones — vibrance/saturation/contrast are `UI − 1`, so `0` is identity for every
 * grade knob and `rainIntensity` runs 0..2. Mirroring the packed values means the
 * cabin never has to know the UI→shader scaling.
 *
 * Deliberately *not* here: fog, haze, dust, light shafts, headlights, named-look
 * LUTs. They are spatial or texture-driven and stay a known delta inside droplet
 * lenses — see `docs/RENDERER_FALLBACK.md` § "Windshield portal".
 */
export interface RoadLook {
    vibrance: number;
    saturation: number;
    contrast: number;
    exposure: number;
    temperature: number;
    tint: number;
    nightIntensity: number;
    /** Shader-space (0..2), not the cabin's 0..1 `rainNorm`. */
    rainIntensity: number;
    /**
     * False when `shaderEffectsEnabled` is off: `weather-post` then returns the
     * raw intermediate, so the portal must not grade or tonemap either.
     */
    graded: boolean;
}

export function createNeutralRoadLook(): RoadLook {
    return {
        vibrance: 0,
        saturation: 0,
        contrast: 0,
        exposure: 0,
        temperature: 0,
        tint: 0,
        nightIntensity: 0,
        rainIntensity: 0,
        graded: true,
    };
}

/** Copy the look fields out of a packed 44-float weather block. Allocation-free. */
export function readRoadLookInto(params: ArrayLike<number>, into: RoadLook): RoadLook {
    const I = WeatherParamIndex;
    // A short array (a test, or `updateColorParams`' 6-float slice) leaves the
    // later fields alone rather than zeroing them.
    if (params.length > I.tint) {
        into.vibrance = params[I.vibrance]!;
        into.saturation = params[I.saturation]!;
        into.contrast = params[I.contrast]!;
        into.exposure = params[I.exposure]!;
        into.temperature = params[I.temperature]!;
        into.tint = params[I.tint]!;
    }
    if (params.length > I.rainIntensity) into.rainIntensity = params[I.rainIntensity]!;
    if (params.length > I.nightIntensity) into.nightIntensity = params[I.nightIntensity]!;
    if (params.length > I.shaderEffectsEnabled) {
        into.graded = params[I.shaderEffectsEnabled]! >= 0.5;
    }
    return into;
}

export interface RoadHdrFrame {
    /**
     * The pass-1 HDR intermediate. **Owned by the renderer**: it is destroyed and
     * replaced on resize, so read it fresh every cabin frame and never cache it.
     */
    texture: GPUTexture;
    /**
     * The `GPUDevice` that owns `texture`. A cabin still running on a previous
     * device (a renderer replaced without the device being lost) must not bind a
     * texture from another one — that is a validation error on every submit.
     */
    device: GPUDevice;
    format: GPUTextureFormat;
    width: number;
    height: number;
    /** True while the hold-pause snapshot is what pass 1 is drawing. */
    held: boolean;
    look: RoadLook;
}

export interface RoadFrameSource {
    /** Null until the renderer has drawn a frame, and after it is torn down. */
    getFrame(): RoadHdrFrame | null;
}

/** What `Renderer` hands the factory — deliberately narrow. */
export interface RoadFrameSourceDeps {
    getDevice(): GPUDevice;
    getIntermediate(): {
        texture: GPUTexture | undefined;
        format: GPUTextureFormat;
        width: number;
        height: number;
    };
    isHoldActive(): boolean;
    getLook(): RoadLook;
    /** False once the renderer is destroyed / device-lost. */
    isAlive(): boolean;
}

export function createRoadFrameSource(deps: RoadFrameSourceDeps): RoadFrameSource {
    return {
        getFrame() {
            if (!deps.isAlive()) return null;
            const { texture, format, width, height } = deps.getIntermediate();
            // Not created until the first frame's `ensureIntermediateTexture`.
            if (!texture || width <= 0 || height <= 0) return null;
            return {
                texture,
                device: deps.getDevice(),
                format,
                width,
                height,
                held: deps.isHoldActive(),
                look: deps.getLook(),
            };
        },
    };
}

let source: RoadFrameSource | null = null;

/** Publish the renderer's frame. Replaces whatever a previous renderer left. */
export function publishRoadFrameSource(next: RoadFrameSource): void {
    source = next;
}

/**
 * Retract `owner` — and only `owner`. A device-lost re-init can publish the new
 * renderer's source before the old renderer's teardown runs; an unconditional
 * clear here would then wipe the live one.
 */
export function retractRoadFrameSource(owner: RoadFrameSource | null): void {
    if (owner && source === owner) source = null;
}

export function getRoadFrameSource(): RoadFrameSource | null {
    return source;
}

/** Test-only: drop whatever a previous test published. */
export function resetRoadFrameSourceForTests(): void {
    source = null;
}
