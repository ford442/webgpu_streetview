import * as THREE from 'three';
import type { CabinStereoRequest } from '../../renderer/cabinStereoRequest';

/**
 * Two eye cameras for the cabin (#331), derived from the one cabin camera so
 * the car-frame transform model is untouched: the rig stays at identity, the
 * camera stays under `headPivot`, and each eye is that camera's world matrix
 * times an eye offset in the head's frame. Nothing here writes to the scene.
 *
 * - `sbs`: ±IPD/2 along the camera's x, with an off-axis shift so a point at
 *   `convergence` metres lands at the same NDC in both eyes (zero parallax —
 *   matching the road's `reproject.wgsl` convergence plane);
 * - `views`: WebXR's per-view pose and projection, the projection converted
 *   from GL clip depth (−1..1) to the renderer's when that is WebGPU (0..1).
 *
 * The eye cameras are reused objects with their matrices set by hand
 * (`matrixAutoUpdate`/`matrixWorldAutoUpdate` off, `coordinateSystem` pinned)
 * so three's `render` never re-derives a symmetric projection over them.
 */

const GL_TO_WEBGPU_DEPTH = new THREE.Matrix4().set(
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 0.5, 0.5,
    0, 0, 0, 1,
);

export interface EyeCameras {
    readonly left: THREE.PerspectiveCamera;
    readonly right: THREE.PerspectiveCamera;
}

function eyeCamera(name: string): THREE.PerspectiveCamera {
    const camera = new THREE.PerspectiveCamera();
    camera.name = name;
    camera.matrixAutoUpdate = false;
    camera.matrixWorldAutoUpdate = false;
    return camera;
}

export function createEyeCameras(): EyeCameras {
    return { left: eyeCamera('cabin-eye-left'), right: eyeCamera('cabin-eye-right') };
}

const offset = new THREE.Matrix4();

function place(
    eye: THREE.PerspectiveCamera,
    head: THREE.PerspectiveCamera,
    eyeFromHead: THREE.Matrix4,
    projection: THREE.Matrix4,
): void {
    eye.coordinateSystem = head.coordinateSystem;
    eye.near = head.near;
    eye.far = head.far;
    eye.matrixWorld.multiplyMatrices(head.matrixWorld, eyeFromHead);
    eye.matrixWorldInverse.copy(eye.matrixWorld).invert();
    eye.projectionMatrix.copy(projection);
    eye.projectionMatrixInverse.copy(projection).invert();
}

/**
 * Aim both eye cameras for this frame. `head` must have a current
 * `matrixWorld` and projection (the cabin camera, just updated).
 */
export function updateEyeCameras(
    eyes: EyeCameras,
    head: THREE.PerspectiveCamera,
    request: CabinStereoRequest,
    coordinateSystem: number,
): void {
    if (request.kind === 'sbs') {
        const half = request.ipd / 2;
        // A point at depth Zc must project to the same NDC x in both eyes:
        // x_ndc(eye at +e) = P00·(X − e)/Zc + s  ⇒  s = P00·e / Zc.
        const p00 = head.projectionMatrix.elements[0]!;
        [[eyes.left, -half], [eyes.right, half]].forEach(([eye, e]) => {
            const s = (p00 * (e as number)) / request.convergence;
            offset.makeTranslation(e as number, 0, 0);
            // clip.x += s · clip.w, so NDC x moves by s: row 0 gains s × row 3.
            const projection = new THREE.Matrix4().copy(head.projectionMatrix);
            for (let c = 0; c < 4; c++) {
                projection.elements[c * 4] = projection.elements[c * 4]! + s * projection.elements[c * 4 + 3]!;
            }
            place(eye as THREE.PerspectiveCamera, head, offset, projection);
        });
        return;
    }
    const toRenderer = coordinateSystem === THREE.WebGPUCoordinateSystem;
    request.views.forEach((view, i) => {
        const eye = i === 0 ? eyes.left : eyes.right;
        offset.fromArray(view.eyeFromHead);
        const projection = new THREE.Matrix4().fromArray(view.projection);
        if (toRenderer) projection.premultiply(GL_TO_WEBGPU_DEPTH);
        place(eye, head, offset, projection);
    });
}

/** The CSS-pixel viewport of eye `index` (0 left, 1 right) in a side-by-side target. */
export function eyeViewport(index: 0 | 1, cssWidth: number, cssHeight: number): THREE.Vector4 {
    const half = cssWidth / 2;
    return new THREE.Vector4(index * half, 0, half, cssHeight);
}
