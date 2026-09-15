import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { CarInteriorAnimator } from '../interior/CarInteriorAnimator';

vi.mock('../../effects/WindAudio', () => ({
  getWindAudio: () => ({
    isPlaying: () => false,
    init: async () => false,
    start: async () => {},
    stop: () => {},
    update: () => {},
  }),
}));

function makeAnimator() {
  const camera = new THREE.PerspectiveCamera();
  camera.rotation.order = 'YXZ';
  const interiorGroup = new THREE.Group();
  const roofGroup = new THREE.Group();
  const lodManager = {
    updateLOD: vi.fn(),
  } as unknown as ConstructorParameters<typeof CarInteriorAnimator>[8];

  const animator = new CarInteriorAnimator(
    camera,
    interiorGroup,
    roofGroup,
    new THREE.Group(),
    new THREE.Group(),
    new THREE.Group(),
    null,
    null,
    lodManager,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    'medium',
    false,
  );

  return { animator, camera, interiorGroup };
}

describe('CarInteriorAnimator free-look chassis vs head', () => {
  it('keeps chassis yaw on carHeading when the head looks around', () => {
    const { animator, camera, interiorGroup } = makeAnimator();
    const carHeading = 34;
    const centeredYaw = -THREE.MathUtils.degToRad(carHeading);

    animator.setCarOrientation(carHeading);
    animator.setHeadOrientation(carHeading, 10);

    expect(interiorGroup.rotation.y).toBeCloseTo(centeredYaw, 5);
    expect(camera.rotation.y).toBeCloseTo(centeredYaw, 5);

    animator.setHeadOrientation(carHeading + 25, 10);

    expect(interiorGroup.rotation.y).toBeCloseTo(centeredYaw, 5);
    expect(camera.rotation.y).toBeCloseTo(-THREE.MathUtils.degToRad(carHeading + 25), 5);
  });

  it('does not introduce roll when looking with pitch', () => {
    const { animator, camera, interiorGroup } = makeAnimator();
    animator.setCarOrientation(34, 0, 0);
    animator.setHeadOrientation(54, 12);

    expect(interiorGroup.rotation.z).toBeCloseTo(0, 5);
    expect(camera.rotation.z).toBeCloseTo(0, 5);
  });
});
