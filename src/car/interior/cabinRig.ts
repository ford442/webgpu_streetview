import * as THREE from 'three';
import { clampHeadOffset, clampHeadPitch, clampHeadYaw, type HeadOffset } from '../carSpatialModel';

/**
 * The cabin transform hierarchy (see `car/carSpatialModel.ts`):
 *
 *     scene
 *     └─ carRig (`interiorGroup`) — shell, dash, wheel, mirrors; identity rotation, always
 *        └─ headPivot — at the driver's eye point (vehicle anchor + seat slider)
 *           └─ camera — rotation = head pose only, order 'YXZ' (yaw, then pitch, no roll)
 *
 * The interior is never a child of the camera or the pivot, and nothing here
 * rotates with `carHeading`: world turning happens in the panorama.
 */
export interface CabinRig {
    carRig: THREE.Group;
    headPivot: THREE.Group;
}

export function createCabinRig(camera: THREE.PerspectiveCamera): CabinRig {
    const carRig = new THREE.Group();
    carRig.name = 'carRig';
    const headPivot = new THREE.Group();
    headPivot.name = 'headPivot';
    carRig.add(headPivot);
    attachCameraToHeadPivot(camera, headPivot);
    return { carRig, headPivot };
}

export function attachCameraToHeadPivot(camera: THREE.PerspectiveCamera, headPivot: THREE.Group): void {
    camera.position.set(0, 0, 0);
    camera.rotation.order = 'YXZ';
    headPivot.add(camera);
}

/**
 * Aim the camera with the car-local head pose (radians; +yaw = left, +pitch = up).
 * Three.js `rotation.y > 0` turns −Z toward −X (left) and `rotation.x > 0`
 * tips it toward +Y (up), so the pose maps straight through.
 */
export function applyHeadPose(camera: THREE.Camera, headYaw: number, headPitch: number): void {
    camera.rotation.order = 'YXZ';
    camera.rotation.set(clampHeadPitch(headPitch), clampHeadYaw(headYaw), 0);
}

/**
 * Move the eye within the head pivot (#331, a headset's lean), clamped to
 * `HEAD_OFFSET_LIMIT`. The pivot's identity rotation inside the rig makes this
 * a car-frame offset; the rig itself never moves.
 */
export function applyHeadOffset(camera: THREE.Camera, offset: HeadOffset): void {
    const o = clampHeadOffset(offset);
    camera.position.set(o.x, o.y, o.z);
}
