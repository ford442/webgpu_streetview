/**
 * The temporal resolve's CPU side (#360): when it presents, the pass-1 jitter
 * sequence, and the resolve's uniform block. The GPU half is `temporal.wgsl`
 * + `TemporalPass.ts`; the motion field it reprojects along is
 * `motion.wgsl` + `motionVectors.ts`.
 *
 * ### Jitter
 *
 * The road's source is the Maps canvas — a texture, not geometry — so the
 * jitter is a **sampling offset**: pass 1 adds `jitterUV` to the screen UV it
 * samples the canvas at (`streetview.wgsl`, `PanoramaUniforms.jitter`). The
 * intermediate pixel `i` then shows the content at `i + 0.5 + jitterPx`, and
 * the resolve (`temporal.wgsl`) weights each sample by its distance to the
 * output pixel from exactly that position.
 *
 * Halton(2, 3), 1-based (index 0 is the origin), `ceil(8 · (output/input)²)`
 * phases — eight samples per output pixel whatever the scale (FSR 2's rule).
 * Without the resolve the jitter is **exactly zero**: the pass-1 uniforms are
 * the pre-temporal ones plus four zero floats, and `uv + 0.0` is `uv`.
 */

export type TemporalMode = 'off' | 'on' | 'auto';

/** Whether a frame at `scale` presents through the resolve. */
export function wantsTemporal(mode: TemporalMode, scale: number): boolean {
    return mode === 'on' || (mode === 'auto' && scale < 1);
}

/** The radical inverse of `index` in `base` — Halton's sequence, in [0, 1). */
export function halton(index: number, base: number): number {
    let f = 1;
    let r = 0;
    let i = Math.floor(index);
    while (i > 0) {
        f /= base;
        r += f * (i % base);
        i = Math.floor(i / base);
    }
    return r;
}

/** Phases before the sequence repeats: eight samples per output pixel. */
export function jitterPhaseCount(inputWidth: number, outputWidth: number): number {
    const ratio = inputWidth > 0 ? outputWidth / inputWidth : 1;
    return Math.max(8, Math.min(64, Math.ceil(8 * ratio * ratio)));
}

/**
 * Frame `frameIndex`'s sub-pixel offset in **intermediate pixels**, each axis
 * in [−0.5, 0.5). `+x` right, `+y` down (the content shown at a pixel moves by
 * that much).
 */
export function jitterOffset(frameIndex: number, phaseCount: number): [number, number] {
    const n = Math.max(1, Math.floor(phaseCount));
    const i = (((Math.floor(frameIndex) % n) + n) % n) + 1;
    return [halton(i, 2) - 0.5, halton(i, 3) - 0.5];
}

// ── Resolve uniforms ────────────────────────────────────────────────────────

/** `TemporalUniforms` in `temporal.wgsl`: 12 floats, 48 bytes. */
export const TEMPORAL_UNIFORM_FLOAT_COUNT = 12;

export const TemporalUniformIndex = {
    inputWidth: 0,
    inputHeight: 1,
    outputWidth: 2,
    outputHeight: 3,
    /** The jitter pass 1 sampled this intermediate with, intermediate pixels. */
    jitterX: 4,
    jitterY: 5,
    /** 1 — blend the reprojected history; 0 — this frame alone (a reset). */
    history: 6,
    /** The accumulated weight is capped here: about the frames a pixel averages. */
    maxWeight: 7,
    /** Output ceiling: 1 on an SDR swap chain, the extended headroom on `?hdr`. */
    peak: 8,
    /** Variance clip: the YCoCg box is mean ± this × σ of the 3×3 neighbourhood. */
    clipGamma: 9,
    pad0: 10,
    pad1: 11,
} as const;

/** History texture: rgb the resolved colour, a the accumulated weight (unclamped half float). */
export const TEMPORAL_HISTORY_FORMAT: GPUTextureFormat = 'rgba16float';

/** About sixteen frames of history at full weight — the convergence/ghosting trade. */
export const TEMPORAL_MAX_WEIGHT = 16;
/**
 * Salvi's variance clip, intersected with the neighbourhood's min/max: 1 is
 * tight (fine detail flickers toward the mean), 2 keeps a near-Nyquist
 * stripe's peaks while still rejecting a ghost outside the local range.
 */
export const TEMPORAL_CLIP_GAMMA = 2;
/**
 * RCAS on the present (stops below maximum, as `upscale`'s): the accumulated
 * frame is a little soft from its sub-output-pixel kernel and the history
 * resampling, and RCAS gives that back without touching the history.
 */
export const TEMPORAL_RCAS_SHARPNESS_STOPS = 1;

export interface TemporalUniformInput {
    inputWidth: number;
    inputHeight: number;
    outputWidth: number;
    outputHeight: number;
    jitter: readonly [number, number];
    history: boolean;
    peak: number;
}

/** Pack `TemporalUniforms`. Pass `out` to reuse one array — `writeBuffer` copies it. */
export function packTemporalUniforms(
    input: TemporalUniformInput,
    out: Float32Array<ArrayBuffer> = new Float32Array(TEMPORAL_UNIFORM_FLOAT_COUNT),
): Float32Array<ArrayBuffer> {
    const I = TemporalUniformIndex;
    out.fill(0);
    out[I.inputWidth] = input.inputWidth;
    out[I.inputHeight] = input.inputHeight;
    out[I.outputWidth] = input.outputWidth;
    out[I.outputHeight] = input.outputHeight;
    out[I.jitterX] = input.jitter[0];
    out[I.jitterY] = input.jitter[1];
    out[I.history] = input.history ? 1 : 0;
    out[I.maxWeight] = TEMPORAL_MAX_WEIGHT;
    out[I.peak] = input.peak;
    out[I.clipGamma] = TEMPORAL_CLIP_GAMMA;
    return out;
}
