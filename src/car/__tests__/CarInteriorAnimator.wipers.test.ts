import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { CarInteriorAnimator } from '../interior/CarInteriorAnimator';
import { wiperLowQualityOnPose, wiperParkPose } from '../carSpatialModel';

vi.mock('../../effects/WindAudio', () => ({
  getWindAudio: () => ({
    isPlaying: () => false,
    init: async () => false,
    start: async () => {},
    stop: () => {},
    update: () => {},
  }),
}));

function makeAnimator(quality: 'high' | 'medium' | 'low', reducedMotion = false) {
  const camera = new THREE.PerspectiveCamera();
  const interiorGroup = new THREE.Group();
  const roofGroup = new THREE.Group();
  const steeringWheelGroup = new THREE.Group();
  const wiperLeft = new THREE.Group();
  const wiperRight = new THREE.Group();
  const lodManager = {
    updateLOD: vi.fn(),
  } as unknown as ConstructorParameters<typeof CarInteriorAnimator>[8];

  const animator = new CarInteriorAnimator(
    camera,
    interiorGroup,
    roofGroup,
    steeringWheelGroup,
    wiperLeft,
    wiperRight,
    null,
    null,
    lodManager,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    quality,
    reducedMotion
  );

  return { animator, wiperLeft, wiperRight };
}

describe('CarInteriorAnimator wiper quality gate', () => {
  it('low quality holds a raised on-pose when toggled on', () => {
    const { animator, wiperLeft, wiperRight } = makeAnimator('low');
    const on = wiperLowQualityOnPose();
    const park = wiperParkPose();

    animator.setWipersActive(true);
    expect(animator.getWipersActive()).toBe(true);
    expect(wiperLeft.rotation.z).toBeCloseTo(on.left, 5);
    expect(wiperRight.rotation.z).toBeCloseTo(on.right, 5);

    animator.update(0.016, 0);
    expect(wiperLeft.rotation.z).toBeCloseTo(on.left, 5);
    expect(wiperRight.rotation.z).toBeCloseTo(on.right, 5);

    animator.setWipersActive(false);
    expect(animator.getWipersActive()).toBe(false);
    expect(wiperLeft.rotation.z).toBeCloseTo(park.left, 5);
    expect(wiperRight.rotation.z).toBeCloseTo(park.right, 5);
  });

  it('medium quality animates blades away from park when on', () => {
    const { animator, wiperLeft, wiperRight } = makeAnimator('medium');
    const park = wiperParkPose();

    animator.setWipersActive(true);
    // Advance enough time for a non-zero sweep angle.
    animator.update(0.2, 0);
    const moved =
      Math.abs(wiperLeft.rotation.z - park.left) > 0.01 ||
      Math.abs(wiperRight.rotation.z - park.right) > 0.01;
    expect(moved).toBe(true);
    expect(animator.getWiperPhase()).toBeGreaterThan(0);
  });
});
