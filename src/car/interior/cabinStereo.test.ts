import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createEyeCameras, eyeViewport, updateEyeCameras } from './cabinStereo';

function headCamera(): THREE.PerspectiveCamera {
    // Parented like the cabin camera: a rig at identity, a turned head pivot.
    const rig = new THREE.Group();
    const pivot = new THREE.Group();
    pivot.position.set(0.3, 1.2, 0.1);
    pivot.rotation.set(0.1, 0.4, 0, 'YXZ');
    const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.05, 100);
    camera.coordinateSystem = THREE.WebGPUCoordinateSystem;
    camera.updateProjectionMatrix();
    rig.add(pivot);
    pivot.add(camera);
    rig.updateMatrixWorld(true);
    return camera;
}

const ndc = (camera: THREE.Camera, world: THREE.Vector3) => world.clone().project(camera);
const ahead = (camera: THREE.Camera, metres: number) =>
    new THREE.Vector3(0, 0, -metres).applyMatrix4(camera.matrixWorld);

describe('cabin stereo eyes', () => {
    it('sbs: the eyes sit ±IPD/2 along the head camera\'s x, and the head is untouched', () => {
        const head = headCamera();
        const before = head.matrixWorld.clone();
        const eyes = createEyeCameras();
        updateEyeCameras(eyes, head, { kind: 'sbs', ipd: 0.064, convergence: 1 }, THREE.WebGPUCoordinateSystem);
        const l = new THREE.Vector3().setFromMatrixPosition(eyes.left.matrixWorld);
        const r = new THREE.Vector3().setFromMatrixPosition(eyes.right.matrixWorld);
        expect(l.distanceTo(r)).toBeCloseTo(0.064, 6);
        const right = new THREE.Vector3(1, 0, 0).transformDirection(head.matrixWorld);
        expect(r.clone().sub(l).normalize().dot(right)).toBeCloseTo(1, 6);
        expect(head.matrixWorld.equals(before)).toBe(true);
    });

    it('sbs: a point at the convergence distance has zero parallax; nearer is crossed, farther uncrossed', () => {
        const head = headCamera();
        const eyes = createEyeCameras();
        updateEyeCameras(eyes, head, { kind: 'sbs', ipd: 0.064, convergence: 1 }, THREE.WebGPUCoordinateSystem);
        const parallax = (m: number) => ndc(eyes.right, ahead(head, m)).x - ndc(eyes.left, ahead(head, m)).x;
        expect(parallax(1)).toBeCloseTo(0, 6);
        expect(parallax(0.5)).toBeLessThan(0); // in front of the screen
        expect(parallax(20)).toBeGreaterThan(0); // behind it
        // Depth stays in WebGPU's 0..1 at the planes.
        const near = ndc(eyes.left, ahead(head, 0.05 + 1e-6)).z;
        expect(near).toBeCloseTo(0, 3);
    });

    it('views: WebXR projections are taken from GL clip depth to the renderer\'s', () => {
        const head = headCamera();
        const eyes = createEyeCameras();
        const gl = new THREE.PerspectiveCamera(90, 1, 0.1, 50); // default coordinate system: WebGL
        gl.updateProjectionMatrix();
        const offset = (x: number) => new Float32Array(new THREE.Matrix4().makeTranslation(x, 0, 0).elements);
        const projection = new Float32Array(gl.projectionMatrix.elements);
        updateEyeCameras(eyes, head, {
            kind: 'views',
            views: [{ eyeFromHead: offset(-0.03), projection }, { eyeFromHead: offset(0.03), projection }],
        }, THREE.WebGPUCoordinateSystem);
        expect(ndc(eyes.left, ahead(head, 0.1 + 1e-6)).z).toBeCloseTo(0, 3);
        expect(ndc(eyes.left, ahead(head, 50 - 1e-3)).z).toBeCloseTo(1, 3);
        const l = new THREE.Vector3().setFromMatrixPosition(eyes.left.matrixWorld);
        const r = new THREE.Vector3().setFromMatrixPosition(eyes.right.matrixWorld);
        expect(l.distanceTo(r)).toBeCloseTo(0.06, 6);
    });

    it('lays the eyes out side by side', () => {
        expect(eyeViewport(0, 800, 450).toArray()).toEqual([0, 0, 400, 450]);
        expect(eyeViewport(1, 800, 450).toArray()).toEqual([400, 0, 400, 450]);
    });
});
