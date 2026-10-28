/**
 * Road render scale (#329): the fraction of the canvas pass 1 and the weather
 * pass render at.
 *
 * At scale `s` the HDR intermediate, the compute weather targets and the depth
 * input are `round(canvas × s)`, the weather pass writes a road target of that
 * size, and the `upscale` frame pass (`upscale/UpscalePass.ts`, FSR 1.0 EASU +
 * RCAS) brings it to the swap chain. At exactly 1 none of that exists: weather
 * writes the swap chain and `upscale` is not encoded, so the frame is the
 * pre-#329 frame byte for byte.
 *
 * Weather **must** render at the intermediate's size: `weather-post.wgsl`'s
 * `fs_main` derives its UV as `fragCoord / textureDimensions(sceneTex)`, so a
 * full-size weather draw over a smaller intermediate would sample outside it.
 *
 * This module is the external store (like `state/povStore.ts` — per-frame
 * readers, never React context): the *requested* scale (preset default,
 * `?scale=`, or the frame-budget loop in `WebGPUCanvas` via `frameBudget.ts`)
 * and what the renderer *applied* this frame, which also lands on
 * `window.webgpuProbe.renderScale`.
 */
import { readFlag } from '../config/flags';
import { PRESETS, type QualityLevel } from '../config/visualPresets';

const RENDER_SCALE_MIN = 0.5;
const RENDER_SCALE_MAX = 1;
/** Every scale is a multiple of this: a few texture sizes, not a new one per frame. */
const RENDER_SCALE_STEP = 0.05;
const STEPS_PER_UNIT = Math.round(1 / RENDER_SCALE_STEP);

type RenderScaleMode = 'auto' | 'fixed';

/** Why the requested scale is what it is. */
export type RenderScaleReason =
    /** No configuration yet (a renderer outside the app shell, or before mount). */
    | 'default'
    /** The quality preset's starting scale. */
    | 'preset'
    /** `?scale=`. */
    | 'flag'
    /** The frame-budget loop stepped down / up. */
    | 'over-budget'
    | 'under-budget';

export interface RenderScaleRequest {
    readonly mode: RenderScaleMode;
    readonly scale: number;
    /** The range the budget loop may move in (`min === max === scale` when fixed). */
    readonly min: number;
    readonly max: number;
    readonly reason: RenderScaleReason;
}

/**
 * Why the applied scale differs from the request, if it does: the upscale pass
 * is still being built (the first scaled request), or it failed to build.
 */
type RenderScaleLimit = 'upscale-pending' | 'upscale-unavailable' | null;

/** What the renderer used for the frame it last encoded. Also `webgpuProbe.renderScale`. */
export interface AppliedRenderScale {
    mode: RenderScaleMode;
    reason: RenderScaleReason;
    requested: number;
    scale: number;
    min: number;
    max: number;
    /** Road frame (intermediate) size, px. */
    width: number;
    height: number;
    /** Swap chain size, px. */
    outputWidth: number;
    outputHeight: number;
    /** `none` at scale 1 (no upscale pass in the frame). */
    upscale: 'fsr' | 'bilinear' | 'none';
    /** True while a hold keeps the scale the hold was armed at. */
    frozen: boolean;
    limitedBy: RenderScaleLimit;
    /** How many times the applied scale has changed since boot. */
    changes: number;
}

/** Snap to the step grid and clamp to [0.5, 1]. Non-finite input reads as 1. */
export function quantizeRenderScale(scale: number): number {
    if (!Number.isFinite(scale)) return RENDER_SCALE_MAX;
    const clamped = Math.min(RENDER_SCALE_MAX, Math.max(RENDER_SCALE_MIN, scale));
    // An integer over 20: the same double as the decimal literal (0.75, 0.55…).
    return Math.round(clamped * STEPS_PER_UNIT) / STEPS_PER_UNIT;
}

/**
 * The road frame size for an output size at `scale`. Exactly the output at
 * scale 1 (no rounding path at all), never smaller than 1×1.
 */
export function scaledSize(width: number, height: number, scale: number): { width: number; height: number } {
    if (scale >= RENDER_SCALE_MAX) return { width, height };
    return {
        width: Math.max(1, Math.round(width * scale)),
        height: Math.max(1, Math.round(height * scale)),
    };
}

/** The request for a quality preset, unless `?scale=` pins one. */
export function resolveRenderScaleRequest(
    quality: QualityLevel,
    flag: number | undefined = readFlag('scale'),
): RenderScaleRequest {
    if (flag !== undefined) return fixedRequest(quantizeRenderScale(flag), 'flag');
    const preset = PRESETS[quality];
    const max = quantizeRenderScale(preset.renderScale);
    const min = Math.min(max, quantizeRenderScale(preset.renderScaleMin));
    return { mode: 'auto', scale: max, min, max, reason: 'preset' };
}

function fixedRequest(scale: number, reason: RenderScaleReason): RenderScaleRequest {
    return { mode: 'fixed', scale, min: scale, max: scale, reason };
}

/** Before the app configures it: `?scale=` if present (fixtures honour it), else 1. */
function initialRequest(): RenderScaleRequest {
    const flag = readFlag('scale');
    return flag !== undefined ? fixedRequest(quantizeRenderScale(flag), 'flag') : fixedRequest(1, 'default');
}

let request: RenderScaleRequest = initialRequest();

const applied: AppliedRenderScale = {
    mode: request.mode,
    reason: request.reason,
    requested: request.scale,
    scale: 1,
    min: request.min,
    max: request.max,
    width: 0,
    height: 0,
    outputWidth: 0,
    outputHeight: 0,
    upscale: 'none',
    frozen: false,
    limitedBy: null,
    changes: 0,
};

export function getRenderScaleRequest(): RenderScaleRequest {
    return request;
}

/** Install the session's request — `WebGPUCanvas` on mount, from the active preset. */
export function configureRenderScale(next: RenderScaleRequest): void {
    request = next;
}

/** The budget loop's write. Ignored in fixed mode; clamped to the request's range. */
export function setRequestedRenderScale(scale: number, reason: RenderScaleReason): void {
    if (request.mode !== 'auto') return;
    const next = Math.min(request.max, Math.max(request.min, quantizeRenderScale(scale)));
    if (next === request.scale) return;
    request = { ...request, scale: next, reason };
}

/** One frame's scale, as `Renderer` resolved it — also `FrameContext.renderScale`. */
export interface RenderScaleFrame {
    scale: number;
    width: number;
    height: number;
    outputWidth: number;
    outputHeight: number;
    upscale: AppliedRenderScale['upscale'];
    frozen: boolean;
    limitedBy: RenderScaleLimit;
}

/** The renderer's per-frame report. Mutates one object — no per-frame allocation. */
export function publishAppliedRenderScale(frame: RenderScaleFrame): void {
    if (frame.scale !== applied.scale) applied.changes += 1;
    applied.mode = request.mode;
    applied.reason = request.reason;
    applied.requested = request.scale;
    applied.min = request.min;
    applied.max = request.max;
    applied.scale = frame.scale;
    applied.width = frame.width;
    applied.height = frame.height;
    applied.outputWidth = frame.outputWidth;
    applied.outputHeight = frame.outputHeight;
    applied.upscale = frame.upscale;
    applied.frozen = frame.frozen;
    applied.limitedBy = frame.limitedBy;
    publishProbe();
}

export function getAppliedRenderScale(): Readonly<AppliedRenderScale> {
    return applied;
}

function publishProbe(): void {
    if (typeof window === 'undefined') return;
    const probe = window.webgpuProbe;
    if (probe && probe.renderScale !== applied) probe.renderScale = applied;
}

export function resetRenderScaleForTests(next: RenderScaleRequest = initialRequest()): void {
    request = next;
    Object.assign(applied, {
        mode: next.mode,
        reason: next.reason,
        requested: next.scale,
        scale: 1,
        min: next.min,
        max: next.max,
        width: 0,
        height: 0,
        outputWidth: 0,
        outputHeight: 0,
        upscale: 'none',
        frozen: false,
        limitedBy: null,
        changes: 0,
    } satisfies AppliedRenderScale);
}
