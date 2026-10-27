import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { HEAD_YAW_LIMIT } from '../car/carSpatialModel';
import { mulMat3, rotX, rotY } from '../renderer/reproject/reprojectMath';
import {
    eyeFromHead,
    frustumFromProjection,
    halfIpdFromViews,
    headOffsetFromPosition,
    headPoseFromOrientation,
    worldFromEye,
    type XrPose,
} from './xrPose';

const DEG = Math.PI / 180;

function quat(yawDeg: number, pitchDeg: number, rollDeg = 0) {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitchDeg * DEG, yawDeg * DEG, rollDeg * DEG, 'YXZ'));
    return { x: q.x, y: q.y, z: q.z, w: q.w };
}

const ORIGIN = { x: 0.01, y: -0.02, z: 0.03 };

function pose(yawDeg: number, pitchDeg: number, rollDeg: number, x: number, y: number, z: number): XrPose {
    return { orientation: quat(yawDeg, pitchDeg, rollDeg), position: { x: ORIGIN.x + x, y: ORIGIN.y + y, z: ORIGIN.z + z } };
}

function closeMat3(a: readonly number[], b: readonly number[]) {
    a.forEach((v, i) => expect(v).toBeCloseTo(b[i]!, 6));
}

describe('WebXR pose → cabin model', () => {
    it('reads the head as car-local yaw (+ left) and pitch (+ up), ignoring roll, clamped like the mouse', () => {
        const h = headPoseFromOrientation(quat(30, -10, 25));
        expect(h.headYaw).toBeCloseTo(30 * DEG, 6);
        expect(h.headPitch).toBeCloseTo(-10 * DEG, 6);
        expect(headPoseFromOrientation(quat(150, 0)).headYaw).toBeCloseTo(HEAD_YAW_LIMIT, 6);
    });

    it('a lean is clamped to the head box', () => {
        const o = headOffsetFromPosition({ x: ORIGIN.x + 0.05, y: ORIGIN.y + 1, z: ORIGIN.z - 0.04 }, ORIGIN);
        expect(o.x).toBeCloseTo(0.05, 9);
        expect(o.y).toBeLessThan(1);
        expect(o.z).toBeCloseTo(-0.04, 9);
    });

    it.each([
        ['within the clamps', pose(20, 5, 0, 0.03, 0, 0)],
        ['rolled, behind the yaw clamp and outside the head box', pose(140, -60, 15, 0.4, 0.05, -0.3)],
    ])('head camera · eyeFromHead is the eye exactly (%s)', (_name, eye) => {
        const head = headPoseFromOrientation(eye.orientation);
        const offset = headOffsetFromPosition(eye.position, ORIGIN);
        // The head camera as the rig builds it: position = offset, rotation = YXZ(pitch, yaw).
        const camera = new THREE.Object3D();
        camera.rotation.set(head.headPitch, head.headYaw, 0, 'YXZ');
        camera.position.set(offset.x, offset.y, offset.z);
        camera.updateMatrix();
        const got = camera.matrix.clone().multiply(new THREE.Matrix4().fromArray(eyeFromHead(head, offset, eye, ORIGIN)));
        const want = new THREE.Matrix4().compose(
            new THREE.Vector3(eye.position.x - ORIGIN.x, eye.position.y - ORIGIN.y, eye.position.z - ORIGIN.z),
            new THREE.Quaternion(eye.orientation.x, eye.orientation.y, eye.orientation.z, eye.orientation.w),
            new THREE.Vector3(1, 1, 1),
        );
        got.elements.forEach((v, i) => expect(v).toBeCloseTo(want.elements[i]!, 5));
    });

    it('reads an asymmetric XR projection as ray tangents', () => {
        const near = 0.1;
        const t = { left: -1.2, right: 0.9, down: -1.0, up: 0.8 };
        const p = new THREE.Matrix4().makePerspective(t.left * near, t.right * near, t.up * near, t.down * near, near, 100);
        const f = frustumFromProjection(p.elements);
        expect(f.left).toBeCloseTo(t.left, 6);
        expect(f.right).toBeCloseTo(t.right, 6);
        expect(f.down).toBeCloseTo(t.down, 6);
        expect(f.up).toBeCloseTo(t.up, 6);
    });

    it('turns an eye into the road frame the way cabinPovSync turns a head: heading = carHeading − yaw', () => {
        closeMat3(worldFromEye(40, quat(0, 0)), rotY(40 * DEG));
        // 15° left of a car heading 40 is heading 25; 10° up is +pitch.
        closeMat3(worldFromEye(40, quat(15, 10)), mulMat3(rotY(25 * DEG), rotX(10 * DEG)));
    });

    it('half the IPD is half the distance between the eyes', () => {
        expect(halfIpdFromViews([pose(0, 0, 0, -0.032, 0, 0), pose(0, 0, 0, 0.032, 0, 0)])).toBeCloseTo(0.032, 9);
        expect(halfIpdFromViews([pose(0, 0, 0, 0, 0, 0)])).toBe(0);
    });
});
