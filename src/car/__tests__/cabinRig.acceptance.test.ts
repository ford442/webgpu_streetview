import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { CarInteriorAnimator } from '../interior/CarInteriorAnimator';
import { applyHeadPose, createCabinRig } from '../interior/cabinRig';
import { panoramaPovFromCabin } from '../carSpatialModel';
import { panoramaMatchedVerticalFov } from '../../utils/streetViewFov';
import { createEyeCameras, updateEyeCameras } from '../interior/cabinStereo';
import { eyeFromHead, headOffsetFromPosition, headPoseFromOrientation } from '../../xr/xrPose';

vi.mock('../../audio/WindAudio', () => ({
  getWindAudio: () => ({
    isPlaying: () => false,
    init: async () => false,
    start: async () => {},
    stop: () => {},
    update: () => {},
  }),
}));

const deg = (d: number) => (d * Math.PI) / 180;
const ASPECT = 16 / 9;

/** The cabin as the bootstrap builds it: carRig → headPivot → camera, plus a shell mesh. */
function makeCabin(zoom = 1) {
  const camera = new THREE.PerspectiveCamera(panoramaMatchedVerticalFov(zoom, ASPECT), ASPECT, 0.01, 100);
  const { carRig, headPivot } = createCabinRig(camera);
  headPivot.position.set(-0.37, 1.15, 0.3); // driver's eye (left-hand drive)
  const shell = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.4, 3.2), new THREE.MeshBasicMaterial());
  shell.name = 'shell';
  carRig.add(shell);
  const scene = new THREE.Scene();
  scene.add(carRig);
  scene.updateMatrixWorld(true);

  const lodManager = { updateLOD: vi.fn() } as unknown as ConstructorParameters<typeof CarInteriorAnimator>[8];
  const animator = new CarInteriorAnimator(
    camera, carRig, new THREE.Group(), new THREE.Group(), new THREE.Group(), new THREE.Group(),
    null, null, lodManager, undefined, undefined, undefined, undefined, undefined, 'medium', false,
  );
  return { scene, camera, carRig, headPivot, shell, animator };
}

/** Where a car-frame point lands on the cabin camera (NDC). */
function cabinNdc(cabin: ReturnType<typeof makeCabin>, carLocal: THREE.Vector3): THREE.Vector3 {
  cabin.scene.updateMatrixWorld(true);
  return cabin.carRig.localToWorld(carLocal.clone()).project(cabin.camera);
}

/**
 * Independent model of the panorama: an ideal pinhole at the Street View POV
 * with horizontal FOV 180°/2^zoom, in a north-up world (compass bearing b
 * along (sin b, 0, −cos b)). A car-frame direction becomes a world direction by
 * turning it clockwise by carHeading.
 */
function panoramaNdc(carHeading: number, pov: { heading: number; pitch: number }, carDir: THREE.Vector3, zoom = 1) {
  const hfov = 180 / 2 ** zoom;
  const vfov = (2 * Math.atan(Math.tan(deg(hfov) / 2) / ASPECT) * 180) / Math.PI;
  const pano = new THREE.PerspectiveCamera(vfov, ASPECT, 0.01, 1000);
  pano.rotation.order = 'YXZ';
  pano.rotation.set(deg(pov.pitch), -deg(pov.heading), 0);
  pano.updateMatrixWorld(true);
  const worldDir = carDir.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), -deg(carHeading));
  return worldDir.multiplyScalar(500).project(pano);
}

const matrixBytes = (o: THREE.Object3D) => Array.from(new Float64Array(o.matrixWorld.elements));

describe('grounded cabin — acceptance', () => {
  it('FREE_LOOK 90° left faces the driver door; the interior world matrix is byte-identical', () => {
    const cabin = makeCabin();
    cabin.animator.setCarHeading(34);
    cabin.animator.setHeadOrientation(0, 0);
    cabin.scene.updateMatrixWorld(true);
    const shellBefore = matrixBytes(cabin.shell);
    const rigBefore = matrixBytes(cabin.carRig);

    cabin.animator.setHeadOrientation(deg(90), 0); // +yaw = look LEFT
    cabin.scene.updateMatrixWorld(true);

    expect(matrixBytes(cabin.shell)).toEqual(shellBefore);
    expect(matrixBytes(cabin.carRig)).toEqual(rigBefore);
    expect(cabin.carRig.rotation.toArray().slice(0, 3)).toEqual([0, 0, 0]);

    // The driver's door glass is straight out to the left of the eye point.
    const doorGlass = cabin.headPivot.position.clone().add(new THREE.Vector3(-0.5, 0, 0));
    const ndc = cabinNdc(cabin, doorGlass);
    expect(ndc.x).toBeCloseTo(0, 6);
    expect(ndc.y).toBeCloseTo(0, 6);
  });

  it('the interior is never under the camera or the head pivot', () => {
    const cabin = makeCabin();
    const ancestors: THREE.Object3D[] = [];
    cabin.shell.traverseAncestors((a) => ancestors.push(a));
    expect(ancestors).not.toContain(cabin.camera);
    expect(ancestors).not.toContain(cabin.headPivot);
    expect(cabin.camera.parent).toBe(cabin.headPivot);
    expect(cabin.headPivot.parent).toBe(cabin.carRig);
    expect(cabin.camera.rotation.order).toBe('YXZ');
  });

  it.each([
    [0, 0, 0],
    [30, 0, 1],
    [70, 10, 1],
    [-45, -20, 2],
    [85, 30, 3],
  ])('FREE_LOOK yaw %i° pitch %i° zoom %i: the outside stays registered with the window frames', (yawDeg, pitchDeg, zoom) => {
    const carHeading = 34;
    const cabin = makeCabin(zoom);
    applyHeadPose(cabin.camera, deg(yawDeg), deg(pitchDeg));
    const pov = panoramaPovFromCabin(carHeading, deg(yawDeg), deg(pitchDeg));

    // Window-frame directions fixed to the car (from the eye), around the view.
    for (const [bearing, elev] of [[-yawDeg + 8, 3], [-yawDeg - 6, -4], [-yawDeg, 0]]) {
      const b = deg(bearing!);
      const e = deg(elev!);
      const carDir = new THREE.Vector3(Math.sin(b) * Math.cos(e), Math.sin(e), -Math.cos(b) * Math.cos(e));
      const inCabin = cabinNdc(cabin, cabin.headPivot.position.clone().add(carDir.clone().multiplyScalar(50)));
      const inPano = panoramaNdc(carHeading, pov, carDir, zoom);
      expect(inCabin.x).toBeCloseTo(inPano.x, 3);
      expect(inCabin.y).toBeCloseTo(inPano.y, 3);
    }
  });

  it('STEER right pans the outside leftward across the windshield; the cabin does not move', () => {
    const cabin = makeCabin();
    cabin.animator.setHeadOrientation(0, 0);
    cabin.scene.updateMatrixWorld(true);
    const shellBefore = matrixBytes(cabin.shell);
    const cameraBefore = matrixBytes(cabin.camera);

    // A building at compass 40°, seen through the windshield.
    const building = (carHeading: number) => {
      const rel = deg(40 - carHeading);
      return panoramaNdc(carHeading, panoramaPovFromCabin(carHeading, 0, 0),
        new THREE.Vector3(Math.sin(rel), 0, -Math.cos(rel)));
    };
    const before = building(34).x;
    cabin.animator.setCarHeading(44); // steer right 10°
    cabin.scene.updateMatrixWorld(true);
    const after = building(44).x;

    expect(after).toBeLessThan(before);
    expect(matrixBytes(cabin.shell)).toEqual(shellBefore);
    expect(matrixBytes(cabin.camera)).toEqual(cameraBefore);
  });

  it('no roll creeps in when looking with pitch', () => {
    const cabin = makeCabin();
    cabin.animator.setHeadOrientation(deg(40), deg(12));
    expect(cabin.camera.rotation.z).toBe(0);
    expect(cabin.carRig.rotation.z).toBe(0);
  });

  it('a WebXR head pose (#331) — rolled, leaning, beyond the yaw clamp — moves only the eyes; interiorGroup is byte-identical', () => {
    const cabin = makeCabin();
    cabin.animator.setCarHeading(34);
    cabin.animator.setHeadOrientation(0, 0);
    cabin.animator.setHeadOffset({ x: 0, y: 0, z: 0 });
    cabin.scene.updateMatrixWorld(true);
    const shellBefore = matrixBytes(cabin.shell);
    const rigBefore = matrixBytes(cabin.carRig);
    const pivotBefore = matrixBytes(cabin.headPivot);

    // The headset, in the car frame relative to the eye point: 130° left, 8° down, 12° roll, leaning out.
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(deg(-8), deg(130), deg(12), 'YXZ'));
    const xrHead = { position: { x: -0.35, y: 0.04, z: 0.1 }, orientation: { x: q.x, y: q.y, z: q.z, w: q.w } };
    const origin = { x: 0, y: 0, z: 0 };
    const head = headPoseFromOrientation(xrHead.orientation);
    const offset = headOffsetFromPosition(xrHead.position, origin);
    cabin.animator.setHeadOrientation(head.headYaw, head.headPitch);
    cabin.animator.setHeadOffset(offset);
    cabin.scene.updateMatrixWorld(true);

    expect(matrixBytes(cabin.shell)).toEqual(shellBefore);
    expect(matrixBytes(cabin.carRig)).toEqual(rigBefore);
    expect(matrixBytes(cabin.headPivot)).toEqual(pivotBefore);
    // The lean is clamped to the head box, and only the camera carries it.
    expect(cabin.camera.position.x).toBeCloseTo(-0.2, 9);
    expect(cabin.camera.rotation.z).toBe(0);

    // The eye the cabin renders is exactly the headset's, roll and all.
    const eyes = createEyeCameras();
    const eyeView = { position: { x: -0.35 - 0.032, y: 0.04, z: 0.1 }, orientation: xrHead.orientation };
    updateEyeCameras(eyes, cabin.camera, {
      kind: 'views',
      views: [
        { eyeFromHead: eyeFromHead(head, offset, eyeView, origin), projection: new Float32Array(cabin.camera.projectionMatrix.elements) },
        { eyeFromHead: eyeFromHead(head, offset, xrHead, origin), projection: new Float32Array(cabin.camera.projectionMatrix.elements) },
      ],
    }, THREE.WebGLCoordinateSystem);
    const want = cabin.headPivot.matrixWorld.clone().multiply(new THREE.Matrix4().compose(
      new THREE.Vector3(eyeView.position.x, eyeView.position.y, eyeView.position.z), q, new THREE.Vector3(1, 1, 1),
    ));
    eyes.left.matrixWorld.elements.forEach((v, i) => expect(v).toBeCloseTo(want.elements[i]!, 5));
    expect(matrixBytes(cabin.carRig)).toEqual(rigBefore);
  });
});
