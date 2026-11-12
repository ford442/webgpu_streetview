/**
 * The road frame's motion field (#360 slice 1): where each intermediate pixel
 * was one frame ago, so a temporal resolve (slice 2) can fetch its history and
 * DOF / rain streaks (slice 4) can smear along one field instead of guessing.
 *
 * Pure maths only — the GPU half is `motion.wgsl` + `motionVectors.ts`. The
 * CPU reference here mirrors the shader line for line (like `reprojectMath.ts`
 * for `reproject.wgsl`), so tests pin direction, units and the reset rules
 * without a GPU.
 *
 * ### Convention
 *
 * `motion = current − previous`, in **intermediate pixels** (+x right, +y
 * down), stored `rg16float` at the intermediate's size. The history of pixel
 * `p` is at `p − motion`. A zero vector is "did not move" — and also what the
 * field holds on a frame with no motion (`mode` 0).
 *
 * ### Terms
 *
 * - **Camera** — at a pano the camera only rotates, so the previous position
 *   of a pixel is an exact homography: the current ray turned by
 *   `prevFromCurrent` (`reprojectMath.latchRotation` with the previous frame
 *   as the packed camera) and projected with the previous frame's FOV. A zoom
 *   change is the FOV term (`displayedHorizontalFov`), so it is not a separate
 *   scale.
 * - **Release dolly** — while a hop's release plays, the held frame expands
 *   from the focus of expansion by `1 + dolly·t·nearness` and side-steps by
 *   `dollyLateral·t·nearness` (`samplePrevForRelease` in `streetview.wgsl`,
 *   the fields from `depth/depthParams.ts`). The dolly term undoes this frame's
 *   progress `t` and re-applies last frame's `t0` at the same pixel's
 *   nearness — first order, like the shader, which reads nearness at the
 *   output pixel. With `dolly = dollyLateral = 0` it is the identity exactly.
 *
 * ### Two validity bits
 *
 * `TemporalHistoryTracker` answers two different questions each frame:
 *
 * - `motion` — is there a previous frame of *this view* for a vector to point
 *   into? False on the first frame, a resize, a pano change, a hold (the frame
 *   is frozen), a Maps zoom step (the canvas re-renders at another FOV) and a
 *   turn larger than the view (a cut). The field is zero then (`mode` 0).
 * - `history` — may a resolve blend last frame's *output*? Needs `motion`, and
 *   both this frame and the last to be clean: no hold, no release crossfade or
 *   legacy transition, no historical wipe. A frame written mid-crossfade holds
 *   a ghost of the previous pano, so the frame after the crossfade ends still
 *   resets (`dirty-history`). A release has motion (consumers smear along the
 *   dolly) but no history.
 */
import {
    displayedHorizontalFov,
    latchDelta,
    latchRotation,
    wrapHeadingDelta,
    type Mat3,
    type PovSample,
    type Vec2,
} from '../reproject/reprojectMath';
import { SceneDepthParamIndex } from '../depth/sceneDepthBinding';
import { LOOK_SCALE_H, LOOK_SCALE_V } from '../depth/depthParams';

const DEG = Math.PI / 180;

/** The motion field's texture format: two half floats, pixels. */
export const MOTION_FORMAT: GPUTextureFormat = 'rg16float';

export type MotionMode = 'none' | 'camera';

export const MOTION_MODE_CODE: Record<MotionMode, number> = {
    /** No previous frame of this view: the field is zero. */
    none: 0,
    /** Camera rotation + zoom, plus the release dolly when it plays. */
    camera: 1,
};

/** `MotionUniforms` in `motion.wgsl`: 28 floats, 112 bytes. */
export const MOTION_UNIFORM_FLOAT_COUNT = 28;

export const MotionUniformIndex = {
    mode: 0,
    /** tan(hfov / 2) and tan(vfov / 2) of the **previous** frame's camera. */
    prevTanHalfH: 1,
    prevTanHalfV: 2,
    /** Intermediate size in pixels — the field's units. */
    width: 3,
    height: 4,
    /** This frame's digital zoom (pass 1's `uniforms.zoom`). */
    zoom: 5,
    /** Release progress `t` this frame and last (0 outside a release). */
    progress: 6,
    prevProgress: 7,
    /** The hold look-around shift in canvas UV (`samplePrevWithLookAround`'s delta). */
    lookX: 8,
    lookY: 9,
    /** The current camera's frustum as ray tangents: centre x, centre y, half x, half y. */
    outCentreX: 12,
    outCentreY: 13,
    outHalfX: 14,
    outHalfY: 15,
    /** `prevFromCurrent`, a rotation as three vec4 columns (w unused): 16–18, 20–22, 24–26. */
    rotation: 16,
} as const;

/** tan(hfov/2), tan(vfov/2) of the road frame at a zoom and aspect. */
export function frameTangents(zoom: number, width: number, height: number): Vec2 {
    const tanHalfH = Math.tan((displayedHorizontalFov(zoom) * DEG) / 2);
    const aspect = height > 0 ? width / height : 1;
    return [tanHalfH, tanHalfH / (aspect > 0 ? aspect : 1)];
}

/** Mirror of `wrapDelta` in `streetview.wgsl`: `a − b` across the 0/1 pan seam. */
function wrapPan(a: number, b: number): number {
    let d = a - b;
    if (d > 0.5) d -= 1;
    if (d < -0.5) d += 1;
    return d;
}

/**
 * The hold look-around shift (canvas UV) pass 1 applies to the held frame —
 * `deltaX` / `deltaY` of `samplePrevWithLookAround`. Pans are normalised
 * (`panX = heading / 360`, `panY = (pitch + 90) / 180`).
 */
export function heldLookDelta(
    pan: { x: number; y: number },
    capturePan: { x: number; y: number },
    zoom: number,
): Vec2 {
    return [
        wrapPan(pan.x, capturePan.x) * (LOOK_SCALE_H / zoom),
        (pan.y - capturePan.y) * (LOOK_SCALE_V / zoom),
    ];
}

export interface MotionUniformInput {
    mode: MotionMode;
    prev: PovSample;
    current: PovSample;
    width: number;
    height: number;
    /** Release progress this frame / last frame (0 outside a release). */
    progress?: number;
    prevProgress?: number;
    /** `heldLookDelta` for this frame; zero outside a hold or release. */
    look?: Vec2;
}

/** Pack `MotionUniforms`. Pass `out` to reuse one array — `writeBuffer` copies it. */
export function packMotionUniforms(
    input: MotionUniformInput,
    out: Float32Array<ArrayBuffer> = new Float32Array(MOTION_UNIFORM_FLOAT_COUNT),
): Float32Array<ArrayBuffer> {
    const I = MotionUniformIndex;
    out.fill(0);
    out[I.mode] = MOTION_MODE_CODE[input.mode];
    out[I.width] = input.width;
    out[I.height] = input.height;
    out[I.zoom] = Math.max(1, input.current.zoom);
    out[I.progress] = input.progress ?? 0;
    out[I.prevProgress] = input.prevProgress ?? 0;
    out[I.lookX] = input.look?.[0] ?? 0;
    out[I.lookY] = input.look?.[1] ?? 0;

    const [prevH, prevV] = frameTangents(input.prev.zoom, input.width, input.height);
    const [curH, curV] = frameTangents(input.current.zoom, input.width, input.height);
    out[I.prevTanHalfH] = prevH;
    out[I.prevTanHalfV] = prevV;
    out[I.outCentreX] = 0;
    out[I.outCentreY] = 0;
    out[I.outHalfX] = curH;
    out[I.outHalfY] = curV;

    const m = prevFromCurrent(input.prev, input.current);
    for (let c = 0; c < 3; c++) {
        for (let r = 0; r < 3; r++) out[I.rotation + c * 4 + r] = m[c * 3 + r]!;
    }
    return out;
}

/** The rotation from this frame's camera rays to the previous frame's. */
function prevFromCurrent(prev: PovSample, current: PovSample): Mat3 {
    return latchRotation(prev.pitch, wrapHeadingDelta(prev.heading, current.heading), current.pitch);
}

// ── CPU reference of motion.wgsl ────────────────────────────────────────────

/**
 * Mirror of WGSL `cameraPrevUV`: the UV the previous frame showed the world
 * ray this frame shows at `uv` (`reprojectMath.latchSourceUV`'s maths, with
 * the previous frame as the packed camera).
 */
export function cameraPrevUV(uv: Vec2, u: ArrayLike<number>): Vec2 {
    const I = MotionUniformIndex;
    const ex = u[I.outCentreX]! + (uv[0] * 2 - 1) * u[I.outHalfX]!;
    const ey = u[I.outCentreY]! + (1 - uv[1] * 2) * u[I.outHalfY]!;
    const col = (c: number, r: number) => u[I.rotation + c * 4 + r]!;
    const x = col(0, 0) * ex + col(1, 0) * ey + col(2, 0);
    const y = col(0, 1) * ex + col(1, 1) * ey + col(2, 1);
    const z = Math.max(col(0, 2) * ex + col(1, 2) * ey + col(2, 2), 1e-4);
    return [(x / z / u[I.prevTanHalfH]! + 1) * 0.5, (1 - y / z / u[I.prevTanHalfV]!) * 0.5];
}

function smoothstep(e0: number, e1: number, x: number): number {
    const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
    return t * t * (3 - 2 * t);
}

/**
 * Mirror of WGSL `heldNearness` (and of the function of that name in
 * `streetview.wgsl`): how near the held frame is at canvas UV `uv` — 1 at the
 * camera, 0 at the skyline or off the depth map. `depthAt(duv)` is the
 * scene-depth texel at depth-map UV `duv` (already clamped to [0, 1]).
 */
function heldNearness(
    uv: Vec2,
    u: ArrayLike<number>,
    d: ArrayLike<number>,
    depthAt: (duv: Vec2) => number,
): number {
    const I = MotionUniformIndex;
    const D = SceneDepthParamIndex;
    const prevUV: Vec2 = [uv[0] - u[I.lookX]!, uv[1] - u[I.lookY]!];
    const screen: Vec2 = [(prevUV[0] - 0.5) * d[D.zoom]! + 0.5, (prevUV[1] - 0.5) * d[D.zoom]! + 0.5];
    const duv: Vec2 = [screen[0] - d[D.heldShiftX]!, screen[1] - d[D.heldShiftY]!];
    const edge = Math.min(Math.min(duv[0], 1 - duv[0]), Math.min(duv[1], 1 - duv[1]));
    const coverage = smoothstep(0, 0.04, edge);
    const clamped: Vec2 = [Math.min(Math.max(duv[0], 0), 1), Math.min(Math.max(duv[1], 0), 1)];
    const depth = depthAt(clamped);
    return (1 - Math.min(Math.max(depth, 0), 1)) * coverage;
}

/**
 * Mirror of WGSL `dollyPrevUV`: where, in screen UV, the held frame showed
 * last frame what it shows at `screenUV` now. The identity when there is no
 * dolly (`dolly = dollyLateral = 0`) — the same early return as
 * `samplePrevForRelease`.
 */
export function dollyPrevUV(
    screenUV: Vec2,
    u: ArrayLike<number>,
    d: ArrayLike<number>,
    depthAt: (duv: Vec2) => number,
): Vec2 {
    const I = MotionUniformIndex;
    const D = SceneDepthParamIndex;
    const dolly = d[D.dolly]!;
    const lateral = d[D.dollyLateral]!;
    if (dolly === 0 && lateral === 0) return screenUV;
    const zoom = u[I.zoom]!;
    const uv: Vec2 = [(screenUV[0] - 0.5) / zoom + 0.5, (screenUV[1] - 0.5) / zoom + 0.5];
    const near = heldNearness(uv, u, d, depthAt);
    const foe: Vec2 = [0.5, d[D.foeY]!];
    const t = u[I.progress]!;
    const t0 = u[I.prevProgress]!;
    // This frame: the snapshot point the pixel shows (samplePrevForRelease's `src`).
    const scale = Math.max(1 + dolly * t * near, 0.5);
    const srcX = foe[0] + (screenUV[0] - foe[0]) / scale + lateral * t * near;
    const srcY = foe[1] + (screenUV[1] - foe[1]) / scale;
    // Last frame: where that snapshot point was drawn.
    const scale0 = Math.max(1 + dolly * t0 * near, 0.5);
    return [
        foe[0] + (srcX - lateral * t0 * near - foe[0]) * scale0,
        foe[1] + (srcY - foe[1]) * scale0,
    ];
}

/**
 * Mirror of WGSL `fs_main`: the motion vector (pixels, current − previous) at
 * intermediate UV `uv`. `d` is the frame's `SceneDepthParams` (all zero
 * without depth — the dolly term is then the identity).
 */
export function motionAt(
    uv: Vec2,
    u: ArrayLike<number>,
    d: ArrayLike<number>,
    depthAt: (duv: Vec2) => number = () => 1,
): Vec2 {
    const I = MotionUniformIndex;
    if (u[I.mode]! < 0.5) return [0, 0];
    const prev = cameraPrevUV(dollyPrevUV(uv, u, d, depthAt), u);
    return [(uv[0] - prev[0]) * u[I.width]!, (uv[1] - prev[1]) * u[I.height]!];
}

// ── History validity ────────────────────────────────────────────────────────

export interface TemporalFrameInput {
    pov: PovSample;
    /** Intermediate size this frame. */
    width: number;
    height: number;
    holdActive: boolean;
    /** Bumped on every pano change (the depth controller's epoch: every hold release). */
    panoEpoch: number;
    /** A release crossfade or a legacy transition is on screen. */
    transitioning: boolean;
    /** The year-chip wipe is on screen. */
    historicalWipe: boolean;
    /** Release progress `t` (0 outside a release). */
    releaseProgress?: number;
}

type MotionResetReason = 'first-frame' | 'resize' | 'hold' | 'pano' | 'maps-zoom' | 'cut';
type HistoryResetReason = MotionResetReason | 'transition' | 'historical-wipe' | 'dirty-history';

export interface TemporalFrameDecision {
    /** A motion field exists this frame (`mode` camera). */
    motion: boolean;
    motionReset: MotionResetReason | null;
    /** The resolve may blend last frame's output. */
    history: boolean;
    historyReset: HistoryResetReason | null;
    /** The previous frame's POV and release progress — what to pack against. Null without motion. */
    prev: { pov: PovSample; releaseProgress: number } | null;
}

interface TrackedFrame {
    pov: PovSample;
    width: number;
    height: number;
    holdActive: boolean;
    panoEpoch: number;
    releaseProgress: number;
    /** Its output is a usable history: no hold, crossfade or wipe in it. */
    clean: boolean;
}

/**
 * Per-frame validity of the motion field and the history. One instance per
 * renderer; `step` once per road frame, `reset` on anything that discards the
 * history texture (device loss, a pass rebuilt).
 */
export class TemporalHistoryTracker {
    private last: TrackedFrame | null = null;

    public reset(): void {
        this.last = null;
    }

    public step(frame: TemporalFrameInput): TemporalFrameDecision {
        const clean = !frame.holdActive && !frame.transitioning && !frame.historicalWipe;
        const prev = this.last;
        this.last = {
            pov: { ...frame.pov },
            width: frame.width,
            height: frame.height,
            holdActive: frame.holdActive,
            panoEpoch: frame.panoEpoch,
            releaseProgress: frame.releaseProgress ?? 0,
            clean,
        };

        const motionReset = motionResetReason(prev, frame);
        if (motionReset) {
            return { motion: false, motionReset, history: false, historyReset: motionReset, prev: null };
        }
        let historyReset: HistoryResetReason | null = null;
        if (frame.historicalWipe) historyReset = 'historical-wipe';
        else if (frame.transitioning) historyReset = 'transition';
        else if (!prev!.clean) historyReset = 'dirty-history';
        return {
            motion: true,
            motionReset: null,
            history: historyReset === null,
            historyReset,
            prev: { pov: { ...prev!.pov }, releaseProgress: prev!.releaseProgress },
        };
    }
}

function motionResetReason(prev: TrackedFrame | null, frame: TemporalFrameInput): MotionResetReason | null {
    if (!prev) return 'first-frame';
    if (prev.width !== frame.width || prev.height !== frame.height) return 'resize';
    // A held frame is frozen content; the frame after a hold shows a new pano.
    if (frame.holdActive || prev.holdActive) return 'hold';
    if (prev.panoEpoch !== frame.panoEpoch) return 'pano';
    // The Maps canvas re-renders at a new integer zoom: another image, not a scale of this one.
    if (Math.floor(Math.max(1, prev.pov.zoom)) !== Math.floor(Math.max(1, frame.pov.zoom))) return 'maps-zoom';
    // A turn wider than the view shares no pixels with the last frame.
    const fov = Math.min(displayedHorizontalFov(prev.pov.zoom), displayedHorizontalFov(frame.pov.zoom));
    if (latchDelta(prev.pov, frame.pov).magnitudeDeg >= fov) return 'cut';
    return null;
}
