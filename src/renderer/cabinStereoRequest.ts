/**
 * What the renderer needs the cabin to draw this frame: one view (the default)
 * or two eyes side by side (#331).
 *
 * Single-slot handoff across the lazy-chunk boundary, like
 * `cabinOverlayRegistry`: the renderer side (`?stereo=sbs`, a WebXR session)
 * **publishes**, the car runtime (`car/interior/CarInteriorRenderer`) **reads**
 * once per cabin frame. Null means mono — the pre-#331 cabin.
 *
 * Either way the cabin target keeps its size; a stereo cabin draws the left
 * eye into the left half and the right into the right, each with the full
 * frame's aspect squeezed into half the width — the same layout as the
 * side-by-side road, so the composite maps it 1:1.
 */

/** Two eyes from the cabin camera: ±IPD/2 sideways, converged at `convergence` metres. */
export interface CabinStereoSideBySide {
    readonly kind: 'sbs';
    readonly ipd: number;
    readonly convergence: number;
}

/**
 * Two eyes given outright — a WebXR frame's views. Matrices are column-major,
 * in the head's frame (`eyeFromHead`: the eye's pose relative to the viewer)
 * and WebXR's GL clip space for `projection` (the cabin converts to its own).
 */
export interface CabinStereoViews {
    readonly kind: 'views';
    readonly views: readonly [CabinEyeView, CabinEyeView];
}

export interface CabinEyeView {
    readonly eyeFromHead: Float32Array;
    readonly projection: Float32Array;
}

export type CabinStereoRequest = CabinStereoSideBySide | CabinStereoViews;

let request: CabinStereoRequest | null = null;

export function publishCabinStereoRequest(next: CabinStereoRequest | null): void {
    request = next;
}

export function getCabinStereoRequest(): CabinStereoRequest | null {
    return request;
}

/** Test-only. */
export function resetCabinStereoRequestForTests(): void {
    request = null;
}
