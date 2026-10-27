/**
 * WebXR poses → the cabin's car-frame model (#331). Pure maths, no session.
 *
 * Frames:
 * - The `local` reference space *is* the car frame: its origin is the eye
 *   point at session start (re-centred on the first pose), −Z is the car's
 *   nose, +Y up — the same axes as the cabin rig (`car/interior/cabinRig.ts`).
 * - The road's reprojection (`renderer/reproject/reprojectMath.ts`) works in
 *   x right / y up / z *forward*; `toRoadFrame` conjugates by diag(1, 1, −1).
 *
 * A headset can do what a mouse cannot — roll, lean, look behind — so the
 * model splits it: the clamped yaw/pitch goes to `cabinHeadStore` (Street View
 * POV, mirrors, everything that reads a head pose), the clamped lean to
 * `cabinHeadOffsetStore`, and the remainder (roll, beyond the clamps, the eye
 * offsets) rides in each eye's `eyeFromHead`, so the eyes stay exactly where
 * the headset says while the rig never moves.
 */
import * as THREE from 'three';
import { clampHeadOffset, clampHeadPitch, clampHeadYaw, type HeadOffset } from '../car/carSpatialModel';
import { mulMat3, rotY, type Mat3, type OutputFrustum } from '../renderer/reproject/reprojectMath';

export interface XrVec3 { readonly x: number; readonly y: number; readonly z: number }
export interface XrQuat { readonly x: number; readonly y: number; readonly z: number; readonly w: number }
export interface XrPose {
    readonly position: XrVec3;
    readonly orientation: XrQuat;
}

const DEG = Math.PI / 180;

/** Car-local head yaw (+ = left) and pitch (+ = up), radians, clamped as `cabinHeadStore` does. */
export function headPoseFromOrientation(q: XrQuat): { headYaw: number; headPitch: number } {
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(new THREE.Quaternion(q.x, q.y, q.z, q.w));
    const headYaw = Math.atan2(-forward.x, -forward.z);
    const headPitch = Math.asin(Math.max(-1, Math.min(1, forward.y)));
    return { headYaw: clampHeadYaw(headYaw), headPitch: clampHeadPitch(headPitch) };
}

/** The lean: the head's position relative to the session's origin, clamped. */
export function headOffsetFromPosition(position: XrVec3, origin: XrVec3): HeadOffset {
    return clampHeadOffset({ x: position.x - origin.x, y: position.y - origin.y, z: position.z - origin.z });
}

const headRotation = new THREE.Quaternion();
const headEuler = new THREE.Euler(0, 0, 0, 'YXZ');
const headMatrix = new THREE.Matrix4();
const eyeMatrix = new THREE.Matrix4();

/**
 * One eye relative to the cabin's head camera, column-major — what
 * `CabinEyeView.eyeFromHead` carries. The head camera sits at the clamped
 * `offset` with the clamped `head` pose (that is what the rig shows); the eye
 * is wherever the headset puts it, so `head · eyeFromHead` is the eye exactly.
 */
export function eyeFromHead(
    head: { headYaw: number; headPitch: number },
    offset: HeadOffset,
    eye: XrPose,
    origin: XrVec3,
): Float32Array {
    headEuler.set(head.headPitch, head.headYaw, 0, 'YXZ');
    headRotation.setFromEuler(headEuler);
    headMatrix.compose(new THREE.Vector3(offset.x, offset.y, offset.z), headRotation, new THREE.Vector3(1, 1, 1));
    eyeMatrix.compose(
        new THREE.Vector3(eye.position.x - origin.x, eye.position.y - origin.y, eye.position.z - origin.z),
        new THREE.Quaternion(eye.orientation.x, eye.orientation.y, eye.orientation.z, eye.orientation.w),
        new THREE.Vector3(1, 1, 1),
    );
    return new Float32Array(headMatrix.invert().multiply(eyeMatrix).elements);
}

/**
 * An `XRView.projectionMatrix` (GL clip, column-major) as ray tangents.
 * `x_ndc = P00 · tx − P20` for a ray (tx, ty, −1), so tx = (x_ndc + P20) / P00.
 */
export function frustumFromProjection(p: ArrayLike<number>): OutputFrustum {
    const p00 = p[0]!;
    const p11 = p[5]!;
    const cx = p[8]! / p00;
    const cy = p[9]! / p11;
    return { left: cx - 1 / p00, right: cx + 1 / p00, down: cy - 1 / p11, up: cy + 1 / p11 };
}

/** A car-frame rotation (three axes, −Z forward) in the road's x/y/z-forward axes. */
export function toRoadFrame(q: XrQuat): Mat3 {
    const m = new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion(q.x, q.y, q.z, q.w)).elements;
    // C · R · C with C = diag(1, 1, −1): negate the entries that mix z with x or y.
    return [
        m[0]!, m[1]!, -m[2]!,
        m[4]!, m[5]!, -m[6]!,
        -m[8]!, -m[9]!, m[10]!,
    ];
}

/** An eye's world rotation for the road: the car's heading, then the eye in the car. */
export function worldFromEye(carHeadingDeg: number, eyeOrientation: XrQuat): Mat3 {
    return mulMat3(rotY(carHeadingDeg * DEG), toRoadFrame(eyeOrientation));
}

/** Half the distance between the first two eyes (metres); 0 for a mono view. */
export function halfIpdFromViews(views: readonly XrPose[]): number {
    if (views.length < 2) return 0;
    const a = views[0]!.position;
    const b = views[1]!.position;
    return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) / 2;
}

/** −1 for the left eye, +1 for the right (a mono view counts as left: no shift either way at 0 IPD). */
export function eyeSignOf(eye: XRView['eye'] | undefined): -1 | 1 {
    return eye === 'right' ? 1 : -1;
}
