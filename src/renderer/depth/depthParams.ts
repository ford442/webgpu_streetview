/**
 * Per-frame `SceneDepthParams` (see `sceneDepthBinding.ts`): how much the depth
 * map is trusted this frame, where it sits relative to the current view, and
 * how far the release dolly moves the held frame.
 */
import { SCENE_DEPTH_PARAMS_FLOAT_COUNT, SceneDepthParamIndex } from './sceneDepthBinding';
import { wrapPanDelta, type DepthPov } from './depthScheduler';

/**
 * Screen units per normalised pan unit — the hold-pause look-around mapping
 * (`samplePrevWithLookAround` in `streetview.wgsl`: 4 / zoom and 2.8 / zoom in
 * canvas UV, i.e. 4 and 2.8 on screen once the digital zoom is applied).
 */
export const LOOK_SCALE_H = 4.0;
export const LOOK_SCALE_V = 2.8;

/** Release dolly at full strength: near pixels grow by up to 1 + this over one release. */
export const RELEASE_DOLLY = 0.35;
/** Side-step parallax: near pixels slide by up to this many screen widths over one release. */
export const RELEASE_DOLLY_LATERAL = 0.08;
/**
 * In a headset the dolly is capped (#331): a frame swelling toward the eyes
 * the head did not move is vection, and in VR that is nausea, not a cue.
 */
export const XR_RELEASE_DOLLY_SCALE = 0.4;

/** How much of the release dolly plays: none under reduced motion, capped in a headset. */
export function releaseDollyScale(options: { reducedMotion: boolean; xr: boolean }): number {
    if (options.reducedMotion) return 0;
    return options.xr ? XR_RELEASE_DOLLY_SCALE : 1;
}
/** How fast trust in a fresh map ramps up (and down after a zoom), ms. */
export const DEPTH_CONFIDENCE_TAU_MS = 160;

/** Where and when the current depth map was inferred. */
export interface DepthMapPose extends DepthPov {
    epoch: number;
}

/** The hop being released, as the hold recorded it. */
export interface DepthHoldPose {
    /** Normalised pan of the held snapshot (`HoldTransitionController.getCapturePan`). */
    capturePanX: number;
    capturePanY: number;
    /** Epoch the snapshot belongs to — the pano the dolly moves away from. */
    epoch: number;
    /**
     * Travel direction relative to the view, from the hop's link heading:
     * `forward` = cos, `lateral` = sin (positive = to the right). Null for a
     * teleport or any hop without a heading — those keep the plain crossfade.
     */
    travel: { forward: number; lateral: number } | null;
}

export interface DepthParamsInput {
    /** Preset weight (`depthBlend`), 0 when scene depth is off. */
    blend: number;
    /** Current trust in the map, 0–1 (`stepDepthConfidence`). */
    confidence: number;
    /** 0 under reduced motion; 1 otherwise. */
    dollyScale: number;
    view: DepthPov;
    map: DepthMapPose | null;
    hold: DepthHoldPose | null;
}

/** Trust target: a map of *this* pano at *this* zoom. A different pano is wrong at once. */
export function depthConfidenceTarget(map: DepthMapPose | null, epoch: number, zoom: number): number {
    if (!map || map.epoch !== epoch) return 0;
    return Math.abs(map.zoom - zoom) < 1e-3 ? 1 : 0;
}

/**
 * Ease confidence toward its target. Falling to 0 because the pano changed is
 * immediate (the old map labels a different street); everything else eases.
 */
export function stepDepthConfidence(current: number, target: number, dtMs: number, panoChanged: boolean): number {
    if (target === 0 && panoChanged) return 0;
    const k = 1 - Math.exp(-Math.max(0, dtMs) / DEPTH_CONFIDENCE_TAU_MS);
    const next = current + (target - current) * k;
    if (target === 0 && next < 0.01) return 0;
    if (target === 1 && next > 0.99) return 1;
    return next;
}

/** Pack this frame's params. All zero (the fallback's value) whenever there is nothing to apply. */
export function packSceneDepthParams(
    input: DepthParamsInput,
    out: Float32Array<ArrayBuffer> = new Float32Array(SCENE_DEPTH_PARAMS_FLOAT_COUNT),
): Float32Array<ArrayBuffer> {
    out.fill(0);
    const { map, view, hold } = input;
    if (!map) return out;

    out[SceneDepthParamIndex.blend] = Math.max(0, Math.min(1, input.blend)) * Math.max(0, Math.min(1, input.confidence));
    out[SceneDepthParamIndex.shiftX] = wrapPanDelta(view.panX, map.panX) * LOOK_SCALE_H;
    out[SceneDepthParamIndex.shiftY] = (view.panY - map.panY) * LOOK_SCALE_V;
    out[SceneDepthParamIndex.zoom] = map.zoom;

    if (hold) {
        out[SceneDepthParamIndex.heldShiftX] = wrapPanDelta(hold.capturePanX, map.panX) * LOOK_SCALE_H;
        out[SceneDepthParamIndex.heldShiftY] = (hold.capturePanY - map.panY) * LOOK_SCALE_V;
        out[SceneDepthParamIndex.foeY] = Math.max(0.05, Math.min(0.95, 0.5 + (hold.capturePanY - 0.5) * 2));
        // The dolly reads the map of the pano being left, at the zoom it was shot at.
        const dollyOk = hold.travel
            && input.blend > 0
            && map.epoch === hold.epoch
            && Math.abs(map.zoom - view.zoom) < 1e-3;
        if (dollyOk) {
            const scale = Math.max(0, Math.min(1, input.dollyScale));
            out[SceneDepthParamIndex.dolly] = RELEASE_DOLLY * hold.travel!.forward * scale;
            out[SceneDepthParamIndex.dollyLateral] = RELEASE_DOLLY_LATERAL * hold.travel!.lateral * scale;
        }
    }
    return out;
}

/** cos / sin of the travel heading relative to the view heading (degrees, clockwise). */
export function travelRelativeToView(travelHeadingDeg: number, viewHeadingDeg: number): { forward: number; lateral: number } {
    const rad = ((travelHeadingDeg - viewHeadingDeg) * Math.PI) / 180;
    return { forward: Math.cos(rad), lateral: Math.sin(rad) };
}
